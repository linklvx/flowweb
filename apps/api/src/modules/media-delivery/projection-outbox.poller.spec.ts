// apps/api/src/modules/media-delivery/projection-outbox.poller.spec.ts
// Y1a+Y1b T15 单元档：纯函数判定面（退避/dead 判据〔maxAttempts∨SPOOL_DEADLINE failed 档〕/
// 503 分类）+onModuleDestroy 生命周期（停 claim+等在飞有界）——先红（符号不存在=编译级红锚）。
// 真双端状态机（claim/flush/recheck 六终态）归 projection-outbox.poller.int.spec.ts（真 PG 纪律）。
import { describe, it, expect, vi } from 'vitest';
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

describe('T15 classifyApplyError（503 双义分类：epoch 易主=fenced 不耗 attempts；其余=transient 真失败计数）', () => {
  const SUE = new ServiceUnavailableException('collab not serving (lease not held)');
  it('epoch 已动（含失守 null）⇒ fenced——滚动部署/双开不耗 attempts', () => {
    expect(classifyApplyError(SUE, 7n, null)).toBe('fenced');
    expect(classifyApplyError(SUE, 7n, 8n)).toBe('fenced');
  });
  it('epoch 未动的 503（degraded spool 等）⇒ transient（真 apply 失败——耗 attempts）', () => {
    expect(classifyApplyError(SUE, 7n, 7n)).toBe('transient');
  });
  it('非 503 错误一律 transient（与 epoch 无关）', () => {
    expect(classifyApplyError(new Error('boom'), 7n, 7n)).toBe('transient');
    expect(classifyApplyError(new Error('boom'), 7n, null)).toBe('transient');
  });
});

/** 最小 fake 面（onModuleDestroy 生命周期用——状态机断言归 int spec）。 */
function makePoller(over: {
  claimRows?: any[];
  deliverArtifact?: (...args: any[]) => Promise<any>;
  epoch?: bigint | null;
} = {}): { poller: ProjectionOutboxPoller; tx: any } {
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
  return { poller: new ProjectionOutboxPoller(prisma, lease, docs, teamCredit), tx };
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
