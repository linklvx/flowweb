import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { assertTeamMember } from '../team/team.util';
import Redis from 'ioredis';

@Injectable()
export class MediaService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async getMediaUrl(fileId: string, userId: string): Promise<string> {
    // 1. 先鉴权：查 media + 团队成员校验（缓存命中不得跳过，防缓存越权）
    const media = await this.prisma.media.findUnique({ where: { id: fileId } });
    if (!media) throw new NotFoundException('媒体资源不存在');
    if (media.userId !== userId) {
      await assertTeamMember(this.prisma, media.teamId, userId); // 非 creator 走团队校验，不通过即 403
    }

    // 2. 鉴权通过后再读缓存（key 团队维度：同团队共享预热）
    const cacheKey = `media:url:${media.teamId}:${fileId}`;
    const cachedUrl = await this.redis.get(cacheKey);
    if (cachedUrl) return cachedUrl;

    // 3. 生成预签名 URL（15 min valid）并写缓存（14 min TTL，比 URL 短 1 min）
    const url = await this.minio.generatePresignedGetUrl(media.key, 900);
    await this.redis.set(cacheKey, url, 'EX', 840);
    return url;
  }
}
