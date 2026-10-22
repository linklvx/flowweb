// apps/api/src/modules/media/media-facts.controller.ts —— Y1a+Y1b T16（spec :45 P1/:91 Z18''④：
// 「mark 后 lazy GET media-facts 补拉」+T15 交接面）：MediaFactOutbox REST 读端点（**全仓此前
// 不存在——本卡建**）——客户端 pendingFacts 的拉取通道（重连全量拉+fileId 到达 lazy 补拉）。
//
// 形态=POST（spec :45 P1：GET 500 ids→POST——500×36≈18KB 超 nginx 8KB header 上限 414）：
//   POST /api/media/facts?teamId=...  body {mediaIds: string[]}（≤200 超限 400）
//   → [{mediaId, facts: [{factVersion, factType, payload}]}]（factVersion wire=string——BigInt
//     JSON 序列化纪律，T6 收紧同源；payload={status,errorCode?...}——processing/completed/failed
//     事实，natural 类事实原样透传）
// ACL=团队级单门（Z7''-v14：teamId 走 resolveTeamId 同款门——缺省回落本人默认团队，外部传入必过
// assertTeamMember；**跨 team mediaId 静默不返**——batch 端点同口径，单 media 403 兜底在 content）。
// at-least-once（spec ⑪）：读取不删行——pending 行读后标 published+publishedAt（retention 7d 由
// intent-reconcile 每日清理；published 行仍在保留窗内可重复拉取——客户端 factVersion 单调去重消费）。
import { Body, Controller, Inject, Post, Query, Req, BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { getOwnerTeamId, assertTeamMember } from '../team/team.util';
import { mediaFactOutboxLag } from '../media-delivery/delivery-lag.metrics';

/** 单批 mediaId 上界（spec :45 P1：POST ≤200——与 batchGet 的 BatchGetMediaDto @ArrayMaxSize(200) 同源）。 */
export const MEDIA_FACTS_MAX_IDS = 200;

/** wire 事实形态（响应行——factVersion=string：Media.factVersion BigInt wire 纪律）。 */
export interface MediaFactWire {
  factVersion: string;
  factType: string;
  payload: Record<string, unknown>;
}

export interface MediaFactsRow {
  mediaId: string;
  facts: MediaFactWire[];
}

@Controller('api/media/facts')
export class MediaFactsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Post()
  async facts(
    @Req() req: Request & { user?: { id?: string } },
    @Query('teamId') teamId: string | undefined,
    @Body() body: { mediaIds?: unknown },
  ): Promise<MediaFactsRow[]> {
    const userId = req.user?.id;
    // 团队单门（media-batch.service resolveTeamId 同款——缺省回落本人默认团队）
    const resolved = teamId ?? (await getOwnerTeamId(this.prisma, userId as string));
    await assertTeamMember(this.prisma, resolved, userId as string);

    const mediaIds = body?.mediaIds;
    if (!Array.isArray(mediaIds) || mediaIds.some((id) => typeof id !== 'string' || id === '')) {
      throw new BadRequestException('body 须为 {mediaIds: string[]}');
    }
    if (mediaIds.length === 0) return [];
    if (mediaIds.length > MEDIA_FACTS_MAX_IDS) {
      throw new BadRequestException(`mediaIds 超上限（≤${MEDIA_FACTS_MAX_IDS}——分批拉取）`);
    }
    // 团队单门过滤锚=Media.teamId（Z7''-v14 assertMediaReadable=assertTeamMember(Media.teamId) 同构
    // ——outbox 行携 projectId 非团队；跨 team mediaId 静默不返，batch 端点同口径）。
    const ownMedia = await this.prisma.media.findMany({
      where: { id: { in: mediaIds }, teamId: resolved },
      select: { id: true },
    });
    if (ownMedia.length === 0) return [];
    const rows = await this.prisma.mediaFactOutbox.findMany({
      where: { mediaId: { in: ownMedia.map((m) => m.id) } },
      orderBy: [{ mediaId: 'asc' }, { factVersion: 'asc' }],
      select: { id: true, mediaId: true, factVersion: true, factType: true, payload: true, state: true },
    });
    // pending→published 标记（at-least-once：读后不删行；retention 7d 归 intent-reconcile 每日清理）
    const pendingIds = rows.filter((r) => r.state === 'pending').map((r) => r.id);
    if (pendingIds.length > 0) {
      await this.prisma.mediaFactOutbox.updateMany({
        where: { id: { in: pendingIds } },
        data: { state: 'published', publishedAt: new Date() },
      }).catch(() => { /* 标记失败不阻断响应——at-least-once 重拉自愈 */ });
    }
    // T19（spec :518）media_fact_outbox_lag：消费即观测——拉取点刷新最老 pending 行龄（投递滞后）
    void this.observeOutboxLag().catch(() => {});
    const byMedia = new Map<string, MediaFactWire[]>();
    for (const r of rows) {
      const list = byMedia.get(r.mediaId) ?? [];
      list.push({
        factVersion: r.factVersion.toString(),
        factType: r.factType,
        payload: (r.payload ?? {}) as Record<string, unknown>,
      });
      byMedia.set(r.mediaId, list);
    }
    return [...byMedia.entries()].map(([mediaId, facts]) => ({ mediaId, facts }));
  }

  /** T19（spec :518）media_fact_outbox_lag gauge 刷新（fire-and-forget——标记后 pending 集已收敛）。
   *  全局最老 pending 行龄（at-least-once 拉模型：无人拉=无人观测滞后，本端点即唯一消费观测点）。 */
  private async observeOutboxLag(): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ oldest: Date | null }[]>(Prisma.sql`
      SELECT min("createdAt") AS "oldest" FROM "MediaFactOutbox" WHERE "state" = 'pending'`);
    const oldest = rows[0]?.oldest;
    mediaFactOutboxLag.set(oldest ? (Date.now() - oldest.getTime()) / 1000 : 0);
  }
}
