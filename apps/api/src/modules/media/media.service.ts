import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import Redis from 'ioredis';

@Injectable()
export class MediaService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async getMediaUrl(fileId: string, userId: string): Promise<string> {
    // 1. Redis cache — key includes userId to prevent cross-user cache pollution
    const cacheKey = `media:url:${userId}:${fileId}`;
    const cachedUrl = await this.redis.get(cacheKey);
    if (cachedUrl) {
      return cachedUrl;
    }

    // 2. Permission check: query by both id AND userId to prevent ID traversal
    const media = await this.prisma.media.findFirst({
      where: { id: fileId, userId },
    });
    if (!media) {
      throw new NotFoundException('媒体资源不存在');
    }

    // 3. Generate presigned URL (15 min valid)
    const url = await this.minio.generatePresignedGetUrl(media.key, 900);

    // 4. Write to cache (14 min TTL, 1 min shorter than URL expiry)
    await this.redis.set(cacheKey, url, 'EX', 840);

    return url;
  }
}
