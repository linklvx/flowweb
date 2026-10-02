import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { getOwnerTeamId, assertTeamMember } from '../team/team.util';

/** 签名 TTL 与缓存 EX 常量单源（2d-4）：吸收原 batchGet 内两处字面量 3600；
 *  并随 batch 响应条目 ttlSec 下行（spec §4.5 契约——web 侧 prefetch 写缓存取同值，双端各自锁） */
export const MEDIA_URL_TTL_SEC = 3600;

@Injectable()
export class MediaBatchService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {}

  /** 按 mediaId 集合查（避开 type='generated' 硬编码过滤）+ presigned URL——对齐 material.service 既有口径；
   *  teamId 走 resolveTeamId 同款门（folder.service.ts L19 先例）：缺省回落本人默认团队，外部传入必过 assertTeamMember（P0-B——纯客户端 teamId 是越权面） */
  async batchGet(userId: string, teamId: string | undefined, ids: string[]) {
    const resolved = teamId ?? (await getOwnerTeamId(this.prisma, userId));
    await assertTeamMember(this.prisma, resolved, userId);
    const rows = await this.prisma.media.findMany({
      where: { id: { in: ids }, teamId: resolved, deletedAt: null },
      select: { id: true, key: true, originalName: true, mimeType: true, size: true, thumbnailKey: true, metadata: true, createdAt: true },
    });
    return Promise.all(rows.map(async (r) => ({
      ...r,
      url: await this.minio.generatePresignedGetUrl(r.key, MEDIA_URL_TTL_SEC),
      thumbnailUrl: r.thumbnailKey ? await this.minio.generatePresignedGetUrl(r.thumbnailKey, MEDIA_URL_TTL_SEC) : null,
      ttlSec: MEDIA_URL_TTL_SEC,
    })));
  }
}
