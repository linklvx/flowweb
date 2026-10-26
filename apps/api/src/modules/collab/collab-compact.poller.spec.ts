// Y1c T11：CollabCompactPoller（worker 进程 compact 轮询 DB poller）——时间门/扫描候选/启动续跑
// 接线/装配面。unit 面=mock repo/prisma（tick 行为）；int 面（真 PG）=启动续跑 kill 窗收敛
// （红组②的 poller 侧锚——repo 侧语义锚在 canvas-doc-compact-publish.int.spec）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CollabCompactPoller, COMPACT_POLL_INTERVAL_MS, compactPollTickTotal } from './collab-compact.poller';
import { COMPACT_INTERVAL_MS } from './collab-persistence.service';

/** 最小 prisma 面（$queryRaw=候选扫描）。 */
const buildPrisma = (candidates: string[]) => ({
  $queryRaw: vi.fn(async () => candidates.map((projectId) => ({ projectId }))),
});

describe('Y1c T11 CollabCompactPoller（unit——tick 行为）', () => {
  it('COMPACT_POLL_INTERVAL_MS 缺省 60s（分钟级扫描——候选集变化由写入方驱动）', () => {
    expect(COMPACT_POLL_INTERVAL_MS).toBe(60_000);
    expect(COMPACT_INTERVAL_MS).toBe(60_000);   // 时间门与 api 侧 maybeCompact 同源常量（不抄第二份）
  });

  it('tick：候选 → compact 全管线；时间门（同窗二跳=skipped）；失败面分档计数不告警污染', async () => {
    const repo = {
      compact: vi.fn(async () => ({ compacted: true as const, snapshotBytes: 1, deletedRows: 2, tombstoneBytes: 0, snapshotRev: 1n, stateSeq: 1n, purgeBelowSeq: 1n })),
      resumePurges: vi.fn(async () => 0),
    };
    const poller = new CollabCompactPoller(buildPrisma(['p1']) as never, repo as never);
    await poller.tick();
    expect(repo.compact).toHaveBeenCalledWith('p1');
    // 时间门：同窗二跳=skipped（仅成功开新窗——maybeCompact 同义）
    await poller.tick();
    expect(repo.compact).toHaveBeenCalledTimes(1);
    // miss 档=正常折返（授权 CAS 败——计数非告警）
    (repo.compact as ReturnType<typeof vi.fn>).mockResolvedValue({ compacted: false, reason: 'miss' as const });
    const fresh = new CollabCompactPoller(buildPrisma(['p2']) as never, repo as never);
    await fresh.tick();
    expect(await metricValue('miss')).toBeGreaterThanOrEqual(1);
  });

  it('tick 单飞互斥：running 期二入即返（重放吃内存——防 tick 叠跑）', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const repo = {
      compact: vi.fn(async () => { await gate; return { compacted: false as const, reason: 'empty' as const }; }),
      resumePurges: vi.fn(async () => 0),
    };
    const poller = new CollabCompactPoller(buildPrisma(['p1']) as never, repo as never);
    const first = poller.tick();
    expect(await poller.tick()).toBeUndefined();   // 二入即返（不叠跑）
    release();
    await first;
  });

  it('onModuleInit：启动续跑先行+周期 timer 武装（unref）+shutdown 清 timer', async () => {
    const repo = { compact: vi.fn(), resumePurges: vi.fn(async () => 2), assertSchemaGenerationDiscipline: vi.fn(async () => undefined) };
    const poller = new CollabCompactPoller(buildPrisma([]) as never, repo as never);
    await poller.onModuleInit();
    expect(repo.resumePurges).toHaveBeenCalledTimes(1);   // kill 窗清理义务先于新扫描
    await poller.onApplicationShutdown();
  });

  // M1（T12 双评审）：worker 启动面同断言——api 面 startCollabAfterLease 的 schemaVersion⇒generation
  // 断言原本不经 worker 进程（poller 是 worker 唯一 CanvasDoc 触碰面）。fail-closed 形态：违例=拒启
  // poller 周期+ERROR（不阻进程退出语义可不同）+零 CanvasDoc 触碰（resumePurges/compact 不达）。
  it('M1 启动面断言：违例布景 ⇒ poller 拒启周期（timer 不武装）+resumePurges 零调用（红=旧实现无断言直达续跑）', async () => {
    const repo = {
      assertSchemaGenerationDiscipline: vi.fn(async () => {
        throw Object.assign(new Error('schemaVersion⇒generation 启动断言违反（1 行——schema 硬切换未伴随换代/清理）'), { schemaGenerationViolation: true });
      }),
      resumePurges: vi.fn(async () => 0),
      compact: vi.fn(),
    };
    const poller = new CollabCompactPoller(buildPrisma([]) as never, repo as never);
    await poller.onModuleInit();
    expect(repo.assertSchemaGenerationDiscipline).toHaveBeenCalledTimes(1);
    expect(repo.resumePurges).not.toHaveBeenCalled();   // 零 CanvasDoc 触碰（红：旧实现=1 次）
    expect(repo.compact).not.toHaveBeenCalled();
    expect((poller as unknown as { timer: unknown }).timer).toBeNull();   // 周期未武装（拒启 poller 周期）
  });
});

async function metricValue(result: string): Promise<number> {
  const reg = (await import('prom-client')).register;
  const text: string = await reg.getMetricsAsJSON().then((ms) => JSON.stringify(ms.find((m) => m.name === 'collab_compact_poll_tick_total')));
  const m = JSON.parse(text) as { values: { labels: { result: string }; value: number }[] };
  return m.values.find((v) => v.labels.result === result)?.value ?? 0;
}

describe('Y1c T11 CollabCompactPoller（真 PG——启动续跑 kill 窗）', () => {
  const maybeDb = process.env.DATABASE_URL ? describe : describe.skip;
  maybeDb('resumePendingPurges 接线', () => {
    it('启动续跑=repo.resumePurges 单点（红组②poller 侧——kill 在指针后/分批删前不丢清理义务）', async () => {
      const repo = { resumePurges: vi.fn(async () => 1), compact: vi.fn(), assertSchemaGenerationDiscipline: vi.fn(async () => undefined) };
      const poller = new CollabCompactPoller(buildPrisma([]) as never, repo as never);
      await poller.onModuleInit();
      expect(repo.resumePurges).toHaveBeenCalledWith();   // 启动即续跑（消费 repo 单点——真 PG 语义锚在 publish int spec 红组②）
      await poller.onApplicationShutdown();
    });
  });
});
