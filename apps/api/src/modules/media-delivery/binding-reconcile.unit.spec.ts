// apps/api/src/modules/media-delivery/binding-reconcile.unit.spec.ts
// C3a-8 质量收口 I-2：reconcile 候选跳过（dirty/lag）、scan-failed 计数、drain 预算按尝试数计。
// 无 DB（stub 依赖——真实漂移检测行为归 binding-reconcile.int.spec）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BindingReconcileService } from './binding-reconcile.service';
import { mediaBindingReconcileOutcomeTotal } from './binding-reconcile.metrics';

const CLEAN_ANCHOR = { generation: 1, pgSeq: 5n, mediaBindingSeq: 5n, bindingsDirty: false };

function makeSvc(over: {
  anchor?: unknown;
  load?: () => Promise<unknown>;
} = {}) {
  const prisma = {
    canvasProject: { findUnique: vi.fn(async () => ({ teamId: 't1' })) },
    media: { findMany: vi.fn(async () => []) },
    mediaBinding: { findMany: vi.fn(async () => []) },
    canvasDoc: { updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  const repo = {
    readRebuildAnchor: vi.fn(async () => over.anchor === undefined ? CLEAN_ANCHOR : over.anchor),
    loadForHydrationAt: vi.fn(over.load ?? (async () => ({ state: null, stateSeq: 0n, updates: [] }))),
  };
  const runner = { markDirty: vi.fn(async () => {}), enqueue: vi.fn() };
  const svc = new BindingReconcileService(prisma as never, repo as never, runner as never);
  return { svc, prisma, repo, runner };
}

const scanFailedCount = async (): Promise<number> => {
  const m = await mediaBindingReconcileOutcomeTotal.get();
  return m.values.find((v) => v.labels.outcome === 'scan-failed')?.value ?? 0;
};

describe('C3a-8 质量收口 I-2：reconcile 候选跳过/预算/扫描异常', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('dirty 候选跳过：不重放/不计 drift/零 dirty 写零入队', async () => {
    const { svc, repo, runner } = makeSvc({ anchor: { ...CLEAN_ANCHOR, bindingsDirty: true } });
    const s = await svc.reconcileProject('p-dirty');
    expect(s).toMatchObject({ ok: false, skipped: 'dirty', scanned: 0, dirtyMarked: false });
    expect(s.drift).toEqual({ missing: 0, extra: 0, mismatch: 0 });
    expect(repo.loadForHydrationAt).not.toHaveBeenCalled();
    expect(runner.markDirty).not.toHaveBeenCalled();
    expect(runner.enqueue).not.toHaveBeenCalled();
    svc.onApplicationShutdown();
  });

  it('lag 候选跳过（mediaBindingSeq<pgSeq——rebuild 待跑）', async () => {
    const { svc, repo, runner } = makeSvc({ anchor: { generation: 1, pgSeq: 5n, mediaBindingSeq: 4n, bindingsDirty: false } });
    const s = await svc.reconcileProject('p-lag');
    expect(s).toMatchObject({ ok: false, skipped: 'lag', scanned: 0 });
    expect(repo.loadForHydrationAt).not.toHaveBeenCalled();
    expect(runner.enqueue).not.toHaveBeenCalled();
    svc.onApplicationShutdown();
  });

  it('扫描异常→scan-failed 计数（本轮跳过，不置 dirty/不入队）', async () => {
    const { svc, runner } = makeSvc({ load: async () => { throw new Error('pg jitter'); } });
    const before = await scanFailedCount();
    const s = await svc.reconcileProject('p-scan');
    expect(s.ok).toBe(false);
    expect(s.scanned).toBe(0);
    expect(await scanFailedCount()).toBe(before + 1);
    expect(runner.markDirty).not.toHaveBeenCalled();
    expect(runner.enqueue).not.toHaveBeenCalled();
    svc.onApplicationShutdown();
  });

  it('drain 预算按尝试数计：全部失败仍消耗预算（10 入队→8 尝试，防 PG 抖动风暴）', async () => {
    const { svc } = makeSvc();
    vi.spyOn(svc, 'reconcileProject').mockRejectedValue(new Error('boom'));
    for (let i = 0; i < 10; i++) svc.requestReconcile(`p-${i}`);
    expect(await svc.drain()).toBe(8);
    expect((svc as unknown as { queue: Set<string> }).queue.size).toBe(2);
    svc.onApplicationShutdown();
  });
});
