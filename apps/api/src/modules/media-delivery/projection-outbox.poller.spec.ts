// apps/api/src/modules/media-delivery/projection-outbox.poller.spec.ts
// Y1a+Y1b T15 单元档：纯函数判定面（退避/dead 判据〔maxAttempts∨SPOOL_DEADLINE failed 档〕/
// 503 分类）+onModuleDestroy 生命周期（停 claim+等在飞有界）——先红（符号不存在=编译级红锚）。
// 真双端状态机（claim/flush/recheck 六终态）归 projection-outbox.poller.int.spec.ts（真 PG 纪律）。
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { ServiceUnavailableException } from '@nestjs/common';
import {
  ProjectionOutboxPoller,
  PROJECTION_MAX_ATTEMPTS,
  PROJECTION_BACKOFF_BASE_MS,
  PROJECTION_BACKOFF_MAX_MS,
  PROJECTION_LEASE_MS,
  computeProjectionBackoffMs,
  isProjectionDead,
  classifyApplyError,
} from './projection-outbox.poller';
import { SPOOL_DEADLINE_MS } from '../collab/collab-persistence.service';
import { docDeliveryAppliedUnpersisted } from './delivery-lag.metrics';

/** dead 判据消费 T14 契约常量（窄面别名=消费点钉注释——T14 评审命名陷阱收口）。 */
describe('T15 常量钉值（dead 判据=耗 maxAttempts ∨ failed 档 1h 兜底）', () => {
  it('PROJECTION_MAX_ATTEMPTS=5（materialize 同族值）；LEASE 覆盖 apply+flush 段', () => {
    expect(PROJECTION_MAX_ATTEMPTS).toBe(5);
    expect(PROJECTION_LEASE_MS).toBeGreaterThanOrEqual(30_000);
  });
  it('退避：基数起指数、封顶 PROJECTION_BACKOFF_MAX_MS、抖幅有界', () => {
    for (let a = 1; a <= 6; a += 1) {
      const v = computeProjectionBackoffMs(a);
      const base = Math.min(PROJECTION_BACKOFF_BASE_MS * 2 ** (a - 1), PROJECTION_BACKOFF_MAX_MS);
      expect(v).toBeGreaterThanOrEqual(Math.floor(base * 0.5));
      expect(v).toBeLessThanOrEqual(Math.ceil(base * 1.5));
    }
    expect(computeProjectionBackoffMs(99)).toBeLessThanOrEqual(Math.ceil(PROJECTION_BACKOFF_MAX_MS * 1.5));
  });
});

describe('T15 isProjectionDead（仅 failed 档消费——G58：spooled 档永不判死由调用面保证）', () => {
  const NOW = 1_800_000_000_000;
  it('attempts 边界：<MAX 不死；=MAX 死（真 apply 失败耗尽）', () => {
    expect(isProjectionDead({ attempts: PROJECTION_MAX_ATTEMPTS - 1, createdAtMs: NOW - 1_000, nowMs: NOW })).toBe(false);
    expect(isProjectionDead({ attempts: PROJECTION_MAX_ATTEMPTS, createdAtMs: NOW - 1_000, nowMs: NOW })).toBe(true);
  });
  it('SPOOL_DEADLINE_MS 兜底（spec :91 failed=耗 maxAttempts+spoolDeadline 1h）：行龄>1h 且 failed 档判死；行龄内不死', () => {
    expect(isProjectionDead({ attempts: 1, createdAtMs: NOW - SPOOL_DEADLINE_MS - 1, nowMs: NOW })).toBe(true);
    expect(isProjectionDead({ attempts: 1, createdAtMs: NOW - SPOOL_DEADLINE_MS + 1_000, nowMs: NOW })).toBe(false);
  });
});

describe('T15 classifyApplyError（Minor#4：epoch 易主=决定性证据先判——任何错误形态；次按 status 分档）', () => {
  const SUE = new ServiceUnavailableException('collab not serving (lease not held)');
  it('epoch 已动（含失守 null）⇒ fenced——与错误形态无关（滚动部署/双开不耗 attempts）', () => {
    expect(classifyApplyError(SUE, 7n, null)).toBe('fenced');
    expect(classifyApplyError(SUE, 7n, 8n)).toBe('fenced');
    expect(classifyApplyError(new Error('boom'), 7n, null)).toBe('fenced');   // Minor#4：epoch 不等即决定性——非 503 亦 fenced
    expect(classifyApplyError(new Error('boom'), 7n, 8n)).toBe('fenced');
  });
  it('epoch 未动的 503 族 ⇒ fenced（drain/真空窗/受理门等租约档——重试无意义非本代真失败）', () => {
    expect(classifyApplyError(SUE, 7n, 7n)).toBe('fenced');
  });
  it('epoch 未动的非 503 ⇒ transient（真失败——耗 attempts，如 degraded spool 503 之外的 infra 错误）', () => {
    expect(classifyApplyError(new Error('boom'), 7n, 7n)).toBe('transient');
  });
});

/** 最小 fake 面（onModuleDestroy 生命周期用——状态机断言归 int spec）。 */
function makePoller(over: {
  claimRows?: any[];
  deliverArtifact?: (...args: any[]) => Promise<any>;
  epoch?: bigint | null;
} = {}): { poller: ProjectionOutboxPoller; tx: any; reconciler: any; docs: any; prisma: any } {
  const rows = over.claimRows ?? [];
  const artifacts = new Map(rows.map((r) => [r.artifactId, {
    id: r.artifactId, rev: r.artifactRev, mediaId: r.mediaId ?? null, resultText: null,
    targetField: 'fileId', sourceIntentRowId: null, sourceExecSeq: null, source: 'generated',
  }]));
  const tx: any = {
    $queryRaw: vi.fn(async () => rows.map((r) => ({ id: r.id }))),
    artifactProjection: {
      updateMany: vi.fn(async () => ({ count: rows.length })),
      findMany: vi.fn(async () => rows),
    },
  };
  const prisma: any = {
    $transaction: vi.fn(async (fn: any) => fn(tx)),
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async () => 0),
    artifactProjection: {
      findUnique: vi.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      findFirst: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
      count: vi.fn(async () => 0),
    },
    nodeArtifact: {
      findMany: vi.fn(async ({ where }: any) => (where.id.in as string[]).map((id) => artifacts.get(id)).filter(Boolean)),
      findUnique: vi.fn(async ({ where }: any) => artifacts.get(where.id) ?? null),
    },
    generationIntent: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
  };
  const epochOf = () => (over.epoch === undefined ? 1n : over.epoch);   // 缺省=held 1n；显式 null=失守
  const lease: any = { isServing: () => epochOf() !== null, currentEpoch: () => epochOf() };
  const docs: any = {
    deliverArtifact: over.deliverArtifact ?? vi.fn(async () => ({ data: { written: true }, execWritten: true })),
    flushDocument: vi.fn(async () => ({ kind: 'persisted' })),
    withSession: vi.fn(async (_p: string, fn: any) => fn({ getMap: () => new Map() })),
  };
  const teamCredit: any = { rollbackDeliveryFailed: vi.fn(async () => true) };
  // T16：post-apply 触发桩——requestReconcile 仅入队（零 IO），poller 循环对其零内部依赖；
  // 返回桩供触发点断言（spec 评审 P2#3——projected/orphaned 两触发点禁裸奔）
  const reconciler: any = { requestReconcile: vi.fn() };
  return { poller: new ProjectionOutboxPoller(prisma, lease, docs, teamCredit, reconciler), tx, reconciler, docs, prisma };
}

describe('T15 onModuleDestroy（停 claim+等在飞有界）', () => {
  it('在飞 tick 完成后才 resolve（有界等待）——停后不再 claim', async () => {
    let release!: (v: void) => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { poller, tx } = makePoller({
      claimRows: [{ id: 'p1', artifactId: 'a1', artifactRev: 1, projectId: 'px', nodeId: 'n1', targetField: 'fileId', targetItemId: '', mediaId: 'm1', resultText: null, attempts: 0, createdAt: new Date() }],
      deliverArtifact: async () => { await gate; return { data: { written: true }, execWritten: true }; },
    });
    const ticking = poller.tick();   // 在飞（apply 挂起）
    const shutdown = poller.onApplicationShutdown();
    release();
    await ticking;
    await shutdown;   // 在飞完成前不 resolve（有界等待）
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);   // 停后零新 claim
    const after = await poller.tick();
    expect(after.claimed).toBe(0);   // destroyed 后 tick 早退（零 claim）
  });

  it('非 lease holder：tick 早退零 claim 零耗（停 claim 等租约）', async () => {
    const { poller, tx } = makePoller({ epoch: null });
    const summary = await poller.tick();
    expect(summary.claimed).toBe(0);
    expect(summary.fenced).toBe(true);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});


describe('T16 post-apply 触发：poller→requestReconcile（spec 评审 P2#3——两触发点断言）', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'p1', artifactId: 'a1', artifactRev: 1, projectId: 'px', nodeId: 'n1',
    targetField: 'fileId', targetItemId: '', mediaId: 'm1', resultText: null,
    attempts: 0, createdAt: new Date(), ...over,
  });

  it('projected（flush persisted+recheck 一致）→ requestReconcile(projectId) 恰一次', async () => {
    const { poller, reconciler } = makePoller({ claimRows: [row()] });
    const r = await poller.tick();
    expect(r.outcomes.projected).toBe(1);
    expect(reconciler.requestReconcile).toHaveBeenCalledTimes(1);
    expect(reconciler.requestReconcile).toHaveBeenCalledWith('px');
  });

  it('fast-path（内容等值跳 apply）同触发——fileId 已在 doc 索引对齐面', async () => {
    // withSession read 返回 doc 当前值==artifact.mediaId ⇒ fast-path 分档（readNodeDataValue
    // 是 Y.Map 结构守卫读——fake doc 须真 Y.Doc 非 plain Map）
    const { poller, docs, reconciler } = makePoller({ claimRows: [row()] });
    const ydoc = new Y.Doc();
    const node = new Y.Map();
    const data = new Y.Map();
    data.set('fileId', 'm1');
    node.set('data', data);
    ydoc.getMap('nodes').set('n1', node);
    (docs.withSession as any).mockImplementation(async (_p: string, fn: any) => fn(ydoc));
    const r = await poller.tick();
    expect(r.outcomes['fast-path']).toBe(1);
    expect(reconciler.requestReconcile).toHaveBeenCalledWith('px');
  });

  it('orphaned（node 删除——written:false 权威观察点）→ requestReconcile（binding stale 清扫触发）', async () => {
    const { poller, reconciler } = makePoller({
      claimRows: [row()],
      deliverArtifact: vi.fn(async () => ({ data: { written: false, reason: 'node-deleted' }, execWritten: false })),
    });
    const r = await poller.tick();
    expect(r.outcomes.orphaned).toBe(1);
    expect(reconciler.requestReconcile).toHaveBeenCalledWith('px');
  });

  // ── Y1c T15 收口 B②（Q-M-3）：written:false reason 分档——结构缺≠node-deleted ──
  it('no-data-map（活节点缺 data Map）≠node-deleted：不 orphaned 不退款不 reconcile——走 retry-failed 档（现状红：误判 orphaned 终态）', async () => {
    const { poller, prisma, reconciler } = makePoller({
      claimRows: [row()],
      deliverArtifact: vi.fn(async () => ({ data: { written: false, reason: 'no-data-map' }, execWritten: false })),
    });
    const r = await poller.tick();
    expect(r.outcomes.orphaned ?? 0).toBe(0);                   // 活节点误删根修（未置键=0）
    expect(r.outcomes['retry-failed']).toBe(1);                 // 真失败档——耗 attempts 退避重试
    expect(reconciler.requestReconcile).not.toHaveBeenCalled(); // MediaBinding 误删面
    // 状态落 pending+attempts=1（非 orphaned 终态）——退款路径结构性不可达（mark 走 prisma 面）
    const updateArgs = (prisma.artifactProjection.updateMany as any).mock.calls;
    expect(updateArgs.some((c: any[]) => c[0]?.data?.state === 'orphaned')).toBe(false);
    expect(updateArgs.some((c: any[]) => c[0]?.data?.state === 'pending' && c[0]?.data?.attempts === 1)).toBe(true);
  });

  it('no-node-map 维持 orphaned/refund（真删/结构壳档——node-deleted 同族）', async () => {
    const { poller, reconciler } = makePoller({
      claimRows: [row()],
      deliverArtifact: vi.fn(async () => ({ data: { written: false, reason: 'no-node-map' }, execWritten: false })),
    });
    const r = await poller.tick();
    expect(r.outcomes.orphaned).toBe(1);
    expect(reconciler.requestReconcile).toHaveBeenCalledWith('px');
  });

  it('text-domain-protected（域键拒）同走 retry-failed 档——不 orphaned', async () => {
    const { poller } = makePoller({
      claimRows: [row()],
      deliverArtifact: vi.fn(async () => ({ data: { written: false, reason: 'text-domain-protected' }, execWritten: false })),
    });
    const r = await poller.tick();
    expect(r.outcomes.orphaned ?? 0).toBe(0);
    expect(r.outcomes['retry-failed']).toBe(1);
  });

  it('superseded/retry/spooled 不触发（非交付落点零索引动作）', async () => {
    // rev 又进（recheck 不一致）⇒ superseded——requestReconcile 零调用
    const { poller, prisma, reconciler } = makePoller({ claimRows: [row()] });
    // recheck（nodeArtifact.findUnique——claim/findMany 走 tx 桩不经此）返回 rev=2（≠artifactRev=1 ⇒ superseded）
    prisma.nodeArtifact.findUnique = vi.fn(async () => ({ id: 'a1', rev: 2, mediaId: 'm2' }));
    const r = await poller.tick();
    expect(r.outcomes.superseded).toBe(1);
    expect(reconciler.requestReconcile).not.toHaveBeenCalled();
  });
});

describe('★T19 质评 Important#1：doc_delivery_applied_unpersisted 跨 project 累计（tick 全局语义）', () => {
  const rowOf = (projectId: string, i: number) => ({
    id: `pr-${projectId}-${i}`, artifactId: `a-${projectId}-${i}`, artifactRev: 1, projectId,
    nodeId: `n-${projectId}-${i}`, targetField: 'fileId', targetItemId: '', mediaId: `m-${projectId}-${i}`,
    resultText: null, attempts: 0, createdAt: new Date(),
  });
  const gaugeOf = async (): Promise<number> =>
    (await (docDeliveryAppliedUnpersisted as any).get()).values[0]?.value ?? 0;

  it('双 project：A 组 spooled（2 行）+B 组 persisted ⇒ 终值=2 非 0（改前红=B last-writer-wins 抹 A）；fk 终态档计 0', async () => {
    const rows = [rowOf('pA', 1), rowOf('pA', 2), rowOf('pB', 1)];
    const kit = makePoller({ claimRows: rows });
    // flush 按 project 分档：A=spooled（2 行滞留）/B=persisted
    (kit.docs.flushDocument as any).mockImplementation(async (pid: string) =>
      (pid === 'pA' ? { kind: 'retry', reason: 'spooled' } : { kind: 'persisted' }));
    const r = await kit.poller.tick();
    expect(r.outcomes['retry-spooled']).toBe(2);   // A 组两行 spooled
    expect(r.outcomes.projected ?? r.outcomes['fast-path']).toBe(1);   // B 组收敛
    expect(await gaugeOf()).toBe(2);   // tick 全局累计（改前红=0——B persisted 后写抹掉 A）

    // fk 终态档：行已终态化（orphaned）无待持久语义——计 0 不入累计
    const kit2 = makePoller({ claimRows: [rowOf('pC', 1)] });
    (kit2.docs.flushDocument as any).mockImplementation(async () => ({ kind: 'terminal', reason: 'fk' }));
    await kit2.poller.tick();
    expect(await gaugeOf()).toBe(0);   // fk 档清零语义（本轮唯一组=终态化零待持久）
  }, 30_000);

  it('空轮刷新：上轮 spooled 置非 0 后空 claim 轮 ⇒ gauge 归 0（改前红=旧值滞留——空轮/早退不刷新）', async () => {
    const kit = makePoller({ claimRows: [rowOf('pD', 1)] });
    (kit.docs.flushDocument as any).mockImplementation(async () => ({ kind: 'retry', reason: 'spooled' }));
    await kit.poller.tick();
    expect(await gaugeOf()).toBe(1);
    const kit2 = makePoller({ claimRows: [] });   // 空轮（零 claim）
    await kit2.poller.tick();
    expect(await gaugeOf()).toBe(0);   // tick 头清零（改前红=滞留 1）
  }, 30_000);
});
