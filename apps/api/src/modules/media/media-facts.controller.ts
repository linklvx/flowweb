// apps/api/src/modules/media/media-facts.controller.ts —— C2-3（地基修复批·C2 卡，spec §3.1-3）
// facts 端点改道 MediaFact 当前态表+归一与合成（旧 MediaFactOutbox 读道已断流——写点 C2-2 改道后
// outbox 零新行；outbox 表/读者退役归 C2-4）：
//   POST /api/media/facts?teamId=...  body {mediaIds: string[]}（≤200 超限 400）
//   → [{mediaId, facts: [{factVersion, factType, payload}]}]（factVersion wire=string——BigInt
//     JSON 序列化纪律；当前态行经 normalizeFactRows 归一：每 media 恰一行 state〔无则自 Media.status
//     合成〕+至多一行 natural，**全部行版本归一到该 media 的 max(factVersion)**——wire 端
//     mergeFactRows/unionFact 把 state+natural 当同一版本流等值正交合并（两脸全前提）；行序=state 前
//     natural 后。不 mark published（当前态无消费标记——旧 outbox pending→published 面随读道退役）。
// ACL=团队级单门（Z7''-v14：teamId 走 resolveTeamId 同款门——缺省回落本人默认团队，外部传入必过
// assertTeamMember；**跨 team mediaId 静默不返**——batch 端点同口径）+软删过滤（deletedAt:null——
// 软删 media 的 facts 不出）。
import { Body, Controller, Inject, Post, Query, Req, BadRequestException, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { getOwnerTeamId, assertTeamMember } from '../team/team.util';

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

/** normalizeFactRows 输入：media 当前态行（controller select id/status/factVersion）。 */
export interface MediaRowForFacts {
  id: string;
  status: string;
  factVersion: bigint;
}

/** normalizeFactRows 输入：MediaFact 当前态行。 */
export interface FactRowForFacts {
  mediaId: string;
  factType: string;
  factVersion: bigint;
  payload: unknown;
}

/** 坏 payload 跳过计数（spec §3.1-1 读侧再校验——出口=warn 日志；media_fact_read_total metric 归 C2-5）。 */
export interface NormalizeFactsResult {
  rows: MediaFactsRow[];
  skippedBadPayload: number;
}

/** Media.status → 合成 state payload 映射（spec §3.1-3：pending→processing；completed/failed 直传；
 *  processing 同义直传——MediaStatus 词表 {pending,processing,completed,failed}）。 */
function syntheticStatePayload(status: string): { status: 'processing' | 'completed' | 'failed' } {
  if (status === 'completed') return { status: 'completed' };
  if (status === 'failed') return { status: 'failed' };
  return { status: 'processing' };
}

/** state 行 payload 可用判据（与 web parseFactRow 同口径：status∈processing|completed|failed）。 */
function isUsableStatePayload(p: unknown): boolean {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return false;
  const s = (p as Record<string, unknown>).status;
  return s === 'processing' || s === 'completed' || s === 'failed';
}

/** natural 行 payload 可用判据（与 web parseFactRow 同口径：宽高正有限数）。 */
function isUsableNaturalPayload(p: unknown): boolean {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return false;
  const { naturalWidth: w, naturalHeight: h } = p as Record<string, unknown>;
  return typeof w === 'number' && Number.isFinite(w) && w > 0
    && typeof h === 'number' && Number.isFinite(h) && h > 0;
}

/** 归一与合成纯函数（C2-3 核心——可单测）：
 *  - 坏 payload 行跳过+计数（读侧再校验）；
 *  - 版本归一：该 media 全部响应行 factVersion=max(该 media 各行版本, Media.factVersion)——
 *    合成 state 行与 natural 行同版本，wire 端单调门把两类当同一版本流合并（unionFact 等值正交）；
 *  - state 合成：无可用 state 行（含零 fact 历史/边缘媒体）→按 Media.status 合成（版本同归一值）；
 *  - 行序：state 前 natural 后（服务端序无保证消费面序无关——此序=未升级消费端加固面）。 */
export function normalizeFactRows(
  mediaRows: readonly MediaRowForFacts[],
  factRows: readonly FactRowForFacts[],
): NormalizeFactsResult {
  const byMedia = new Map<string, FactRowForFacts[]>();
  for (const f of factRows) {
    const list = byMedia.get(f.mediaId) ?? [];
    list.push(f);
    byMedia.set(f.mediaId, list);
  }
  let skippedBadPayload = 0;
  const rows: MediaFactsRow[] = [];
  for (const m of mediaRows) {
    const usable: FactRowForFacts[] = [];
    for (const f of byMedia.get(m.id) ?? []) {
      const usablePayload = f.factType === 'state' ? isUsableStatePayload(f.payload)
        : f.factType === 'natural' ? isUsableNaturalPayload(f.payload) : false;
      if (!usablePayload) {
        skippedBadPayload += 1;
        continue;
      }
      usable.push(f);
    }
    const state = usable.find((f) => f.factType === 'state');
    const natural = usable.find((f) => f.factType === 'natural');
    let version = m.factVersion;
    for (const f of usable) if (f.factVersion > version) version = f.factVersion;
    const facts: MediaFactWire[] = [
      {
        factVersion: version.toString(),
        factType: 'state',
        payload: state ? (state.payload as Record<string, unknown>) : syntheticStatePayload(m.status),
      },
    ];
    if (natural) {
      facts.push({ factVersion: version.toString(), factType: 'natural', payload: natural.payload as Record<string, unknown> });
    }
    rows.push({ mediaId: m.id, facts });
  }
  return { rows, skippedBadPayload };
}

@Controller('api/media/facts')
export class MediaFactsController {
  private readonly logger = new Logger(MediaFactsController.name);

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
    // 团队单门+软删过滤锚=Media（spec §3.1-3：deletedAt:null——软删 media 的 facts 不出；跨 team
    // mediaId 静默不返，batch 端点同口径）。orderBy id=响应行确定性（旧 outbox 读道同序）。
    const ownMedia = await this.prisma.media.findMany({
      where: { id: { in: mediaIds }, teamId: resolved, deletedAt: null },
      select: { id: true, status: true, factVersion: true },
      orderBy: { id: 'asc' },
    });
    if (ownMedia.length === 0) return [];
    const factRows = await this.prisma.mediaFact.findMany({
      where: { mediaId: { in: ownMedia.map((m) => m.id) } },
      select: { mediaId: true, factType: true, factVersion: true, payload: true },
    });
    const { rows, skippedBadPayload } = normalizeFactRows(ownMedia, factRows);
    if (skippedBadPayload > 0) {
      this.logger.warn(`media facts 坏 payload 跳过：count=${skippedBadPayload}`);
    }
    return rows;
  }
}
