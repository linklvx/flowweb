// apps/api/src/modules/media/media-facts.controller.spec.ts —— C2-3（地基修复批·C2 卡）红测（unit：
// prisma 桩零 DB；真 PG 归 media-facts.int.spec）：facts 端点归一与合成（spec §3.1-3，plan v3）：
//   ①纯 natural 无 state → 合成 state 行（Media.status 映射：pending→processing；completed/failed
//     直传）+max(factVersion) 版本归一（响应行版本=该 media 全部 facts 的 max）+state 前 natural 后行序；
//   ②deletedAt 过滤（软删 media 的 facts 不出——ownMedia 查询 deletedAt:null）；
//   ③payload 坏行跳过+计数（spec §3.1-1 读侧再校验：坏行不进响应、可观测计数——纯函数返回值+
//     controller warn 日志；metric 归 C2-5）。
// 消费面契约（web mergeFactRows/unionFact 双顺序合并）归族 ④——apps/web/src/stores/mediaFacts.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { MediaFactsController, normalizeFactRows } from './media-facts.controller';
import { mediaFactReadTotal } from './media-fact.metrics';
import type { PrismaService } from '../../prisma/prisma.service';

/** ownMedia 查询行形态（controller select：id/status/factVersion）。 */
type MediaRow = { id: string; status: string; factVersion: bigint };
/** MediaFact 行形态（读道输入）。 */
type FactRow = { mediaId: string; factType: string; factVersion: bigint; payload: unknown };

function makePrisma(media: MediaRow[], facts: FactRow[]) {
  return {
    media: { findMany: vi.fn().mockResolvedValue(media) },
    mediaFact: { findMany: vi.fn().mockResolvedValue(facts) },
    teamMember: { findFirst: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
  } as unknown as PrismaService;
}

const req = () => ({ user: { id: 'u1' } }) as never;

/** media_fact_read_total 某 result 的当前累计值（C2-5 计数器接线断言用）。 */
async function readTotal(result: string): Promise<number> {
  const m = await mediaFactReadTotal.get();
  return m.values.find((v) => (v.labels as { result?: string }).result === result)?.value ?? 0;
}

describe('C2-3：facts 端点归一与合成', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('①纯 natural v5 无 state→合成 state 行（pending→processing）+版本归一到 max+state 前 natural 后', async () => {
    const ctrl = new MediaFactsController(makePrisma(
      [{ id: 'm1', status: 'pending', factVersion: 5n }],
      [{ mediaId: 'm1', factType: 'natural', factVersion: 5n, payload: { naturalWidth: 1920, naturalHeight: 1080 } }],
    ));
    const rows = await ctrl.facts(req(), 't1', { mediaIds: ['m1'] });
    expect(rows).toEqual([
      { mediaId: 'm1', facts: [
        { factVersion: '5', factType: 'state', payload: { status: 'processing' } },   // Media.status=pending→processing 合成
        { factVersion: '5', factType: 'natural', payload: { naturalWidth: 1920, naturalHeight: 1080 } },
      ] },
    ]);
  });

  it('①b Media.status 映射 completed/failed 直传+零 fact 媒体合成（版本=Media.factVersion——历史/边缘媒体）', async () => {
    const ctrl = new MediaFactsController(makePrisma([
      { id: 'm-done', status: 'completed', factVersion: 3n },
      { id: 'm-fail', status: 'failed', factVersion: 0n },
    ], []));
    const rows = await ctrl.facts(req(), 't1', { mediaIds: ['m-done', 'm-fail'] });
    expect(rows).toEqual([
      { mediaId: 'm-done', facts: [{ factVersion: '3', factType: 'state', payload: { status: 'completed' } }] },
      { mediaId: 'm-fail', facts: [{ factVersion: '0', factType: 'state', payload: { status: 'failed' } }] },
    ]);
  });

  it('①d 分源优先：Media.status=completed 与实际 state 行 {failed,scope:probe} 发散——实际行胜（合成仅兜底缺行/坏行）', () => {
    // C2 卡出口门补钉：probe 失败矩阵「分源优先」格——实际 fact 行（probe 终态失败产物）与 Media.status
    // 分歧时以实际行为准，不被 Media.status=completed 合成覆盖（spec §3.1-2 实际行优先语义）
    const r = normalizeFactRows(
      [{ id: 'm1', status: 'completed', factVersion: 4n }],
      [{ mediaId: 'm1', factType: 'state', factVersion: 4n, payload: { status: 'failed', scope: 'probe' } }],
    );
    expect(r.rows).toEqual([
      { mediaId: 'm1', facts: [{ factVersion: '4', factType: 'state', payload: { status: 'failed', scope: 'probe' } }] },
    ]);
  });

  it('①c state+natural 双在（v6/v5 错位）：两行版本归一到同一 max+state 恒前（wire 端 unionFact 等值合并前提）', () => {
    const r = normalizeFactRows(
      [{ id: 'm1', status: 'completed', factVersion: 6n }],
      [
        { mediaId: 'm1', factType: 'natural', factVersion: 5n, payload: { naturalWidth: 1, naturalHeight: 2 } },
        { mediaId: 'm1', factType: 'state', factVersion: 6n, payload: { status: 'completed' } },
      ],
    );
    expect(r.rows).toEqual([
      { mediaId: 'm1', facts: [
        { factVersion: '6', factType: 'state', payload: { status: 'completed' } },
        { factVersion: '6', factType: 'natural', payload: { naturalWidth: 1, naturalHeight: 2 } },
      ] },
    ]);
  });

  it('②deletedAt 过滤：ownMedia 查询带 deletedAt:null（软删 media 的 facts 不出）', async () => {
    const prisma = makePrisma([{ id: 'm-live', status: 'completed', factVersion: 1n }], []);
    const ctrl = new MediaFactsController(prisma);
    const rows = await ctrl.facts(req(), 't1', { mediaIds: ['m-live', 'm-soft'] });
    expect(prisma.media.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['m-live', 'm-soft'] }, teamId: 't1', deletedAt: null }),
    }));
    expect(rows.map((r) => r.mediaId)).toEqual(['m-live']);
  });

  it('③坏 payload 跳过+计数：坏 state（status 非法）/坏 natural（宽高非正）不进响应；skippedBadPayload 可观测', () => {
    const r = normalizeFactRows(
      [{ id: 'm1', status: 'completed', factVersion: 4n }],
      [
        { mediaId: 'm1', factType: 'state', factVersion: 4n, payload: { status: 'weird' } },
        { mediaId: 'm1', factType: 'natural', factVersion: 3n, payload: { naturalWidth: 0, naturalHeight: 5 } },
      ],
    );
    expect(r.skippedBadPayload).toBe(2);
    // 坏 state 被跳过→无可用 state 行→Media.status 合成兜底（每 media 必有 state——含合成）
    expect(r.rows[0].facts).toEqual([
      { factVersion: '4', factType: 'state', payload: { status: 'completed' } },
    ]);
  });

  it('③b controller 出口：坏行不进响应+warn 日志带 teamId/样本 mediaId 上下文+read_total 计数（ok/bad_payload 双计数）', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const ok0 = await readTotal('ok');
    const bad0 = await readTotal('bad_payload');
    const ctrl = new MediaFactsController(makePrisma(
      [{ id: 'm1', status: 'completed', factVersion: 4n }],
      [{ mediaId: 'm1', factType: 'natural', factVersion: 4n, payload: { naturalWidth: -1, naturalHeight: 5 } }],
    ));
    const rows = await ctrl.facts(req(), 't1', { mediaIds: ['m1'] });
    expect(rows[0].facts).toEqual([{ factVersion: '4', factType: 'state', payload: { status: 'completed' } }]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('count=1');   // 计数入日志（C2-3 遗留收紧：含键名防 '1' 误匹配）
    expect(String(warn.mock.calls[0]?.[0])).toContain('teamId=t1');   // 排查坏 payload 缺锚修复（C2-3 质评遗留①）
    expect(String(warn.mock.calls[0]?.[0])).toContain('sampleMediaId=m1');
    expect(await readTotal('ok')).toBe(ok0);   // 唯一 fact 行坏→ok 零增（合成 state 行不计——计数面=MediaFact 表行）
    expect(await readTotal('bad_payload')).toBe(bad0 + 1);
  });
});
