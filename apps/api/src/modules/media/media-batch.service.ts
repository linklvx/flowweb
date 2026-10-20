import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { getOwnerTeamId, assertTeamMember } from '../team/team.util';

/** Y1a+Y1b T5：batch 响应降级 content 路由引用——url/thumbnailUrl 字段名维持（web 契约），
 *  值从 presigned URL 换 /api/media/:id/content[?variant=thumbnail]（读侧 presign 旁路删除；
 *  presign 依赖 MinioService 随之退役）。ttlSec 语义=客户端缓存有效期提示（content 路径稳定，
 *  无签名寿命）——原 MEDIA_URL_TTL_SEC(3600) 随 presign 消亡。 */
export const MEDIA_CONTENT_URL_TTL_SEC = 86_400;

export function mediaContentUrl(mediaId: string, variant?: 'thumbnail'): string {
  return variant ? `/api/media/${mediaId}/content?variant=thumbnail` : `/api/media/${mediaId}/content`;
}

@Injectable()
export class MediaBatchService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 按 mediaId 集合查（避开 type='generated' 硬编码过滤）+ content 路由引用；
   *  teamId 走 resolveTeamId 同款门（folder.service.ts L19 先例）：缺省回落本人默认团队，外部传入必过 assertTeamMember（P0-B——纯客户端 teamId 是越权面） */
  async batchGet(userId: string, teamId: string | undefined, ids: string[]) {
    const resolved = teamId ?? (await getOwnerTeamId(this.prisma, userId));
    await assertTeamMember(this.prisma, resolved, userId);
    const rows = await this.prisma.media.findMany({
      where: { id: { in: ids }, teamId: resolved, deletedAt: null },
      select: { id: true, key: true, originalName: true, mimeType: true, size: true, thumbnailKey: true, metadata: true, createdAt: true },
    });
    return rows.map((r) => ({
      ...r,
      // size BigInt（Y1b T2 列型）→ number（<2^53 展示口径；T6 BigInt.prototype.toJSON 全局补丁后自然统一）
      size: Number(r.size),
      url: mediaContentUrl(r.id),
      thumbnailUrl: r.thumbnailKey ? mediaContentUrl(r.id, 'thumbnail') : null,
      ttlSec: MEDIA_CONTENT_URL_TTL_SEC,
    }));
  }
}
