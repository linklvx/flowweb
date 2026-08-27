import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { PresignUploadDto } from './dto/presign.dto';
import { ConfirmUploadDto } from './dto/confirm.dto';
import { getOwnerTeamId } from '../team/team.util';
import { StorageQuotaService } from '../team/storage-quota.service';

@Injectable()
export class StorageService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject(StorageQuotaService) private readonly quota: StorageQuotaService,
  ) {}

  async presignUpload(userId: string, dto: PresignUploadDto) {
    // D4：素材直传归属——dto.teamId（成员校验）或本人默认团队
    const teamId = dto.teamId
      ? (await this.quota.assertMember(dto.teamId, userId), dto.teamId)
      : await getOwnerTeamId(this.prisma, userId);
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
    // Verify ownership — findFirst checks both id AND userId (id alone is PK but we need userId check too)
    const media = await this.prisma.media.findFirst({
      where: { id: dto.fileId, userId },
    });
    if (!media) {
      throw new BadRequestException('文件记录不存在');
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
