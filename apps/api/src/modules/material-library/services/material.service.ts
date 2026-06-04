import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { MinioService } from '../../minio/minio.service';
import { THUMBNAIL_GENERATOR_QUEUE } from '../constants/material-library.constants';

@Injectable()
export class MaterialService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minioService: MinioService,
    @InjectQueue(THUMBNAIL_GENERATOR_QUEUE) private readonly thumbnailQueue: Queue,
  ) {}

  async getFilesByFolderId(userId: string, folderId: string | null) {
    const files = await this.prisma.media.findMany({
      where: { userId, folderId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    // Generate presigned URLs dynamically (never store expiring URLs in DB)
    // 3600s = 1hr for file list, sufficient for browse session
    return Promise.all(
      files.map(async (file) => ({
        ...file,
        url: await this.minioService.generatePresignedGetUrl(file.key, 3600),
        thumbnailUrl: file.thumbnailKey
          ? await this.minioService.generatePresignedGetUrl(file.thumbnailKey, 3600)
          : null,
      })),
    );
  }

  async moveFile(userId: string, fileId: string, folderId: string | null) {
    const file = await this.prisma.media.findFirst({
      where: { id: fileId, userId, deletedAt: null },
    });
    if (!file) throw new BadRequestException('文件不存在');

    if (folderId) {
      const folder = await this.prisma.materialFolder.findFirst({
        where: { id: folderId, userId, deletedAt: null },
      });
      if (!folder) throw new BadRequestException('文件夹不存在');
    }

    const updated = await this.prisma.media.update({
      where: { id: fileId },
      data: { folderId },
    });

    if (!updated.thumbnailKey) {
      await this.thumbnailQueue.add('generate-thumbnail', {
        mediaId: updated.id,
        key: updated.key,
        mimeType: updated.mimeType,
      });
    }

    return updated;
  }

  async toggleFavorite(userId: string, fileId: string) {
    const file = await this.prisma.media.findFirst({
      where: { id: fileId, userId, deletedAt: null },
    });
    if (!file) throw new BadRequestException('文件不存在');

    return this.prisma.media.update({
      where: { id: fileId },
      data: { isFavorite: !file.isFavorite },
    });
  }

  async deleteFile(userId: string, fileId: string) {
    const file = await this.prisma.media.findFirst({
      where: { id: fileId, userId, deletedAt: null },
    });
    if (!file) throw new BadRequestException('文件不存在');

    return this.prisma.media.update({
      where: { id: fileId },
      data: { deletedAt: new Date() },
    });
  }

  async deleteFiles(userId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.prisma.media.updateMany({
      where: { id: { in: ids }, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return result.count;
  }
}
