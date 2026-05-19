import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { PresignUploadDto } from './dto/presign.dto';
import { ConfirmUploadDto } from './dto/confirm.dto';

@Injectable()
export class StorageService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {}

  async presignUpload(userId: string, dto: PresignUploadDto) {
    const ext = dto.fileName.split('.').pop() || 'bin';
    const key = this.minio.buildKey(dto.type, userId, { ext });

    // Create Media record (pending)
    const media = await this.prisma.media.create({
      data: {
        userId,
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
    // Verify file exists in MinIO
    const stats = await this.minio.statObject(dto.key);

    // Verify file size (tolerance ±1024)
    const actualSize = stats.ContentLength ?? 0;
    if (Math.abs(actualSize - dto.fileSize) > 1024) {
      await this.minio.delete(dto.key);
      await this.prisma.media.delete({
        where: { id: dto.fileId, userId },
      });
      throw new BadRequestException('文件大小不匹配，请重新上传');
    }

    // Update Media status
    await this.prisma.media.update({
      where: { id: dto.fileId, userId },
      data: { status: 'completed', size: actualSize },
    });

    return { fileId: dto.fileId };
  }
}
