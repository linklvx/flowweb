import { Injectable, Inject, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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

  async getMediaUrl(fileId: string, userId: string): Promise<{ url: string; ttlSec: number }> {
    // 1. 先鉴权：查 media + 团队成员校验（缓存命中不得跳过，防缓存越权）
    const media = await this.prisma.media.findUnique({ where: { id: fileId } });
    if (!media) throw new NotFoundException('媒体资源不存在');
    if (media.userId !== userId) {
      await assertTeamMember(this.prisma, media.teamId, userId); // 非 creator 走团队校验，不通过即 403
    }

    // 2. 键 v2 = 值形状 JSON {url, expiresAt} 的版本化（防新旧 pod 混布读裸 string）；
    //    expiresAt 绝对时刻——命中由服务端算剩余，客户端时钟偏移不影响正确性（F7 根修）
    const cacheKey = `media:url:v2:${media.teamId}:${fileId}`;
    const raw = await this.redis.get(cacheKey);
    if (raw) {
      try {
        const cached = JSON.parse(raw) as { url?: unknown; expiresAt?: unknown };
        const remaining = Math.ceil(((cached.expiresAt as number) - Date.now()) / 1000);
        if (typeof cached.url === 'string' && Number.isFinite(cached.expiresAt as number) && remaining > 0) {
          return { url: cached.url, ttlSec: remaining };
        }
      } catch {
        // 坏值 fallthrough：重签覆写自愈
      }
    }

    // 3. （重新）presign（15 min）+ 写缓存（14 min TTL）
    const url = await this.minio.generatePresignedGetUrl(media.key, 900);
    await this.redis.set(cacheKey, JSON.stringify({ url, expiresAt: Date.now() + 900_000 }), 'EX', 840);
    return { url, ttlSec: 900 };
  }

  /** 公开 by-key 兑换（唯一合法域：运营公开素材 uploads/system/）。
   *  仅 trim 规范化（禁止二次解码——Express 已解码一次，再解 %2F..%2F 会绕过前缀），
   *  校验与签名必须用同一个 normalized 值。其余 key 一律 403（正路是 GET /api/media/:fileId/url）。 */
  async getPresignedUrlByKey(rawKey: string): Promise<string> {
    const key = (rawKey ?? '').trim();
    if (!key) throw new BadRequestException('key is required');
    if (!key.startsWith('uploads/system/')) throw new ForbiddenException();
    return this.minio.generatePresignedGetUrl(key, 900);
  }
}
