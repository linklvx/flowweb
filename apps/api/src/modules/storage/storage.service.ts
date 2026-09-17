import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { PresignUploadDto } from './dto/presign.dto';
import { ConfirmUploadDto } from './dto/confirm.dto';
import { getOwnerTeamId, assertTeamMember } from '../team/team.util';
import { StorageQuotaService } from '../team/storage-quota.service';

@Injectable()
export class StorageService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject(StorageQuotaService) private readonly quota: StorageQuotaService,
  ) {}

  async presignUpload(userId: string, dto: PresignUploadDto) {
    // 三级回落：projectId（后端解析+成员校验）> teamId（assertMember）> 默认团队
    let teamId: string;
    if (dto.projectId) {
      const project = await this.prisma.canvasProject.findUnique({ where: { id: dto.projectId }, select: { teamId: true } });
      if (!project) throw new BadRequestException('项目不存在');
      await this.quota.assertMember(project.teamId, userId);
      teamId = project.teamId;
    } else if (dto.teamId) {
      await this.quota.assertMember(dto.teamId, userId);
      teamId = dto.teamId;
    } else {
      teamId = await getOwnerTeamId(this.prisma, userId);
    }
    await this.quota.assertCanUpload(teamId, dto.fileSize);

    const ext = dto.fileName.split('.').pop() || 'bin';
    const key = this.minio.buildKey(dto.type, userId, { ext });

    // Create Media record (pending)
    const media = await this.prisma.media.create({
      data: {
        userId,
        teamId,
        bucket: 'flowai',
        key,
        originalName: dto.fileName,
        mimeType: dto.fileType,
        size: dto.fileSize,
        status: 'pending',
        type: dto.type,
        expiresAt: dto.type === 'temp'
          ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          : null,
      },
    });

    // Generate presigned POST
    const { url, fields } = await this.minio.generatePresignedPost(
      key,
      dto.fileType,
      dto.fileSize,
    );

    return {
      fileId: media.id,
      uploadUrl: url,
      key,
      fields,
    };
  }

  async confirmUpload(userId: string, dto: ConfirmUploadDto) {
    const media = await this.prisma.media.findFirst({
      where: { id: dto.fileId },
    });
    if (!media) {
      throw new BadRequestException('文件记录不存在');
    }
    if (media.userId !== userId) {
      await assertTeamMember(this.prisma, media.teamId, userId);
    }

    // D1 服务层收口：一律以 media 行为唯一事实源。dto.key/dto.fileSize 已不读——
    // 请求体 key 曾流入 statSize/minio.delete（mismatch 分支）与 assertOnConfirm（配额分支），
    // 构成任意对象删除面。禁止回退 `media.size ?? dto.fileSize`（会让本性质静默失效）。
    const actualSize = await this.minio.statSize(media.key);

    if (Math.abs(actualSize - media.size) > 1024) {
      await this.minio.delete(media.key);
      await this.prisma.media.delete({ where: { id: dto.fileId } });
      throw new BadRequestException('文件大小不匹配，请重新上传');
    }

    await this.quota.assertOnConfirm(dto.fileId, actualSize);

    await this.prisma.media.update({
      where: { id: dto.fileId },
      data: { status: 'completed', size: actualSize },
    });

    return { fileId: dto.fileId };
  }
}
