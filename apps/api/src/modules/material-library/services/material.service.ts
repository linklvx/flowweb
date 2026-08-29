import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { MinioService } from '../../minio/minio.service';
import { THUMBNAIL_GENERATOR_QUEUE } from '../constants/material-library.constants';
import { getOwnerTeamId, assertTeamMember } from '../../team/team.util';

@Injectable()
export class MaterialService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minioService: MinioService,
    @InjectQueue(THUMBNAIL_GENERATOR_QUEUE) private readonly thumbnailQueue: Queue,
  ) {}

  /** 团队维度入口统一门：外部 teamId 自证成员资格，否则回落本人默认团队 */
  private async resolveTeamId(teamId: string | undefined | null, userId: string): Promise<string> {
    const resolved = teamId ?? (await getOwnerTeamId(this.prisma, userId));
    await assertTeamMember(this.prisma, resolved, userId);
    return resolved;
  }

  async getFilesByFolderId(userId: string, folderId: string | null, type?: 'image' | 'video' | 'audio', teamId?: string) {
    const resolved = await this.resolveTeamId(teamId, userId);
    const where: any = { teamId: resolved, folderId, deletedAt: null };

    if (type) {
      where.type = 'generated';
      switch (type) {
        case 'image':
          where.mimeType = { startsWith: 'image/' };
          break;
        case 'video':
          where.mimeType = { startsWith: 'video/' };
          break;
        case 'audio':
          where.mimeType = { startsWith: 'audio/' };
          break;
      }
    }

    const files = await this.prisma.media.findMany({
      where,
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

  async moveFile(userId: string, fileId: string, folderId: string | null, teamId?: string) {
    const resolved = await this.resolveTeamId(teamId, userId);
    // 文件与目标文件夹均按 teamId 过滤——跨团队目标统一报「不存在」，防存在性探测
    const file = await this.prisma.media.findFirst({
      where: { id: fileId, teamId: resolved, deletedAt: null },
    });
    if (!file) throw new BadRequestException('文件不存在');

    if (folderId) {
      const folder = await this.prisma.materialFolder.findFirst({
        where: { id: folderId, teamId: resolved, deletedAt: null },
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

  async toggleFavorite(userId: string, fileId: string, teamId?: string) {
    const resolved = await this.resolveTeamId(teamId, userId);
    const file = await this.prisma.media.findFirst({
      where: { id: fileId, teamId: resolved, deletedAt: null },
    });
    if (!file) throw new BadRequestException('文件不存在');

    return this.prisma.media.update({
      where: { id: fileId },
      data: { isFavorite: !file.isFavorite },
    });
  }

  async deleteFile(userId: string, fileId: string, teamId?: string) {
    const resolved = await this.resolveTeamId(teamId, userId);
    const file = await this.prisma.media.findFirst({
      where: { id: fileId, teamId: resolved, deletedAt: null },
    });
    if (!file) throw new BadRequestException('文件不存在');

    return this.prisma.media.update({
      where: { id: fileId },
      data: { deletedAt: new Date() },
    });
  }

  async deleteFiles(userId: string, ids: string[], teamId?: string): Promise<number> {
    if (ids.length === 0) return 0;
    const resolved = await this.resolveTeamId(teamId, userId);
    const result = await this.prisma.media.updateMany({
      where: { id: { in: ids }, teamId: resolved, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return result.count;
  }

  async getFileCounts(userId: string, teamId?: string): Promise<{ image: number; video: number; audio: number }> {
    const resolved = await this.resolveTeamId(teamId, userId);
    const counts = await this.prisma.media.groupBy({
      by: ['mimeType'],
      where: { teamId: resolved, deletedAt: null, type: 'generated' },
      _count: true,
    });

    const result = { image: 0, video: 0, audio: 0 };
    counts.forEach((item: { mimeType: string; _count: number }) => {
      if (item.mimeType.startsWith('image/')) result.image += item._count;
      else if (item.mimeType.startsWith('video/')) result.video += item._count;
      else if (item.mimeType.startsWith('audio/')) result.audio += item._count;
    });

    return result;
  }

  async moveFiles(userId: string, ids: string[], folderId: string | null, teamId?: string): Promise<number> {
    if (ids.length === 0) return 0;
    const resolved = await this.resolveTeamId(teamId, userId);
    if (folderId) {
      const folder = await this.prisma.materialFolder.findFirst({
        where: { id: folderId, teamId: resolved, deletedAt: null },
      });
      if (!folder) throw new BadRequestException('文件夹不存在');
    }
    const result = await this.prisma.media.updateMany({
      where: { id: { in: ids }, teamId: resolved, deletedAt: null },
      data: { folderId },
    });
    return result.count;
  }
}
