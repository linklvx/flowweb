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
    // 团队化：上传记录按 id 查，creator 之外须为 media.teamId 成员方可确认
    const media = await this.prisma.media.findFirst({
      where: { id: dto.fileId },
    });
    if (!media) {
      throw new BadRequestException('文件记录不存在');
    }
    if (media.userId !== userId) {
      await assertTeamMember(this.prisma, media.teamId, userId);
    }

    // Verify file exists in MinIO
    const stats = await this.minio.statObject(dto.key);

    // Verify file size (tolerance ±1024)
    const actualSize = stats.ContentLength ?? 0;
    if (Math.abs(actualSize - dto.fileSize) > 1024) {
      await this.minio.delete(dto.key);
      await this.prisma.media.delete({ where: { id: dto.fileId } });
      throw new BadRequestException('文件大小不匹配，请重新上传');
    }

    // Q7：confirm 二次校验（两并发 presign 可同过，此处按 actualSize 终判）
    await this.quota.assertOnConfirm(dto.fileId, actualSize, dto.key, media.bucket);

    // Update Media status (id is unique PK, safe to use alone after ownership verified)
    await this.prisma.media.update({
      where: { id: dto.fileId },
      data: { status: 'completed', size: actualSize },
    });

    return { fileId: dto.fileId };
  }
}
