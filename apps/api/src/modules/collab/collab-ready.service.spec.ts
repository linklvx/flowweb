// Y0a-3 T7：G-4 载体——ready 八档 collabState 主导派生（W12）+1s 单飞缓存+epoch string+pending
// 消费 computePending（必办②同一实现禁复制）+drain 幂等/60s 解除（gateway 侧归 T5/ shutdown spec）。
import { describe, it, expect, vi } from 'vitest';
import { CollabReadyService } from './collab-ready.service';

function build(over: {
  pgOk?: boolean; diag?: any; gateway?: any; redisOk?: boolean;
} = {}) {
  const prisma = { $queryRaw: vi.fn(async () => { if (over.pgOk === false) throw new Error('PG down'); return [{}]; }) };
  const lease = {
    isServing: () => over.diag?.state === 'held',
    diag: vi.fn(async () => over.diag ?? { state: 'held' as const, owner: 'me', holder: 'me', epoch: '3', renewedAt: new Date(), statementFailed: false }),
  };
  const gateway = over.gateway ?? {
    computePending: () => ({ projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, storeInFlight: 0, strandedFiles: 0, strandedBytes: 0 }),
    isShuttingDown: () => false,
    isWritableOrDegraded: () => 'ok' as const,
    getCollabState: () => 'serving',
  };
  const redis = { status: 'ready', connect: vi.fn(async () => {}), ping: vi.fn(async () => over.redisOk === false ? Promise.reject(new Error('x')) : 'PONG'), disconnect: vi.fn() };
  const svc = new CollabReadyService(prisma as any, lease as any, gateway as any, { quarantinedSegments: () => [] } as any, redis as any);
  return { svc, gateway, redis };
}

describe('CollabReadyService（G-4 八档+P6 优先级+collabState 主导）', () => {
  it('全清：ready=true 200+pending 结构（Y5 键名+三扩字段）', async () => {
    const { svc } = build();
    const r = await svc.getReady();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ready: true, redis: 'up', pending: { projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, storeInFlight: 0, strandedFiles: 0, strandedBytes: 0 } });
  });
  it('Y0a-4/N16：授权档 loadedDocs/connections=pending 兄弟字段（computePending 同源——禁进 pending 对象）', async () => {
    const gw = {
      computePending: () => ({ projects: 1, batches: 2, spoolFiles: 0, spoolBytes: 0, storeInFlight: 0, strandedFiles: 0, strandedBytes: 0, loadedDocs: 7, connections: 9 }),
      isShuttingDown: () => false,
      isWritableOrDegraded: () => 'ok' as const,
      getCollabState: () => 'serving',
    };
    const r = await build({ gateway: gw }).svc.getReady();
    expect(r.body.loadedDocs).toBe(7);       // 旧实现 body 无此键 → 红
    expect(r.body.connections).toBe(9);
    expect(Object.keys(r.body.pending)).not.toContain('loadedDocs');   // 兄弟字段——禁进 pending（V17/SV16 pending 形状冻结）
    expect(Object.keys(r.body.pending)).not.toContain('connections');
    // 精确键集冻结：rest 解构防呆——computePending 未来新字段会被 ...pending 静默吸收进响应形状，此处即红
    expect(Object.keys(r.body.pending).sort()).toEqual(['batches', 'projects', 'spoolBytes', 'spoolFiles', 'storeInFlight', 'strandedBytes', 'strandedFiles']);
  });
  it('pg-down：SELECT 1 抛错→503 reason=pg-down（最高优先）', async () => {
    const r = await build({ pgOk: false }).svc.getReady();
    expect(r.status).toBe(503);
    expect(r.body.reason).toBe('pg-down');
  });
  it('draining（P6：高于 lease/spool——G-2a ii 断言不分档）', async () => {
    const gw = { computePending: () => ({ projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, storeInFlight: 0, strandedFiles: 0, strandedBytes: 0 }), isShuttingDown: () => true, isWritableOrDegraded: () => 'spool-unwritable' as const, getCollabState: () => 'draining' };
    const r = await build({ gateway: gw }).svc.getReady();
    expect(r.body.reason).toBe('draining');
  });
  it('lease-error：PG 通+statementFailed→503（与 pg-down 两种运维动作分流）', async () => {
    const r = await build({ diag: { state: 'held', owner: 'me', holder: 'me', epoch: '1', renewedAt: new Date(), statementFailed: true } }).svc.getReady();
    expect(r.body.reason).toBe('lease-error');
  });
  it('lease-lost：collabState isolated（W12 主导——非 lease.diag 兜底）', async () => {
    const gw = { computePending: () => ({ projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, storeInFlight: 0, strandedFiles: 0, strandedBytes: 0 }), isShuttingDown: () => false, isWritableOrDegraded: () => 'ok' as const, getCollabState: () => 'isolated' };
    const r = await build({ diag: { state: 'held', owner: 'me', holder: 'me', epoch: '1', renewedAt: new Date(), statementFailed: false }, gateway: gw }).svc.getReady();
    expect(r.body.reason).toBe('lease-lost');
  });
  it('not-serving：lease held ∧ start-failed/starting（start-failed 不再伪装 lease-not-acquired——W12）', async () => {
    const gw = { computePending: () => ({ projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, storeInFlight: 0, strandedFiles: 0, strandedBytes: 0 }), isShuttingDown: () => false, isWritableOrDegraded: () => 'ok' as const, getCollabState: () => 'start-failed' };
    const r = await build({ diag: { state: 'held', owner: 'me', holder: 'me', epoch: '1', renewedAt: new Date(), statementFailed: false }, gateway: gw }).svc.getReady();
    expect(r.body.reason).toBe('not-serving');
  });
  it('八档矩阵（V16/A2——collabState×lease.diag×spool 三真源表驱动，"1:1 派生"从此不可回退）', async () => {
    const held = { state: 'held' as const, owner: 'me', holder: 'me', epoch: '1', renewedAt: new Date(), statementFailed: false };
    const gw = (over: Partial<{ shutting: boolean; writable: string; phase: string }>) => ({
      computePending: () => ({ projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, storeInFlight: 0, strandedFiles: 0, strandedBytes: 0 }),
      isShuttingDown: () => over.shutting ?? false,
      isWritableOrDegraded: () => (over.writable ?? 'ok') as 'ok',
      getCollabState: () => over.phase ?? 'serving',
    });
    const cases: Array<{ name: string; diag?: any; gw?: Parameters<typeof gw>[0]; expect: string | null }> = [
      { name: 'serving', diag: held, gw: {}, expect: null },
      { name: 'draining', diag: held, gw: { shutting: true, writable: 'spool-unwritable', phase: 'draining' }, expect: 'draining' },
      { name: 'lease-error', diag: { ...held, statementFailed: true }, gw: {}, expect: 'lease-error' },
      { name: 'lease-lost', diag: held, gw: { phase: 'isolated' }, expect: 'lease-lost' },
      { name: 'not-serving(start-failed)', diag: held, gw: { phase: 'start-failed' }, expect: 'not-serving' },
      { name: 'not-serving(starting)', diag: held, gw: { phase: 'starting' }, expect: 'not-serving' },
      { name: 'lease-held', diag: { state: 'not-acquired', owner: null, holder: 'other-owner', epoch: '9', renewedAt: new Date(), statementFailed: false }, gw: { phase: 'acquiring' }, expect: 'lease-held' },
      { name: 'lease-not-acquired', diag: { state: 'not-acquired', owner: null, holder: null, epoch: '0', renewedAt: null, statementFailed: false }, gw: { phase: 'acquiring' }, expect: 'lease-not-acquired' },
      { name: 'spool-unwritable', diag: held, gw: { writable: 'spool-unwritable' }, expect: 'spool-unwritable' },
    ];
    for (const c of cases) {
      const r = await build({ diag: c.diag, gateway: gw(c.gw ?? {}) as any }).svc.getReady();
      if (c.expect === null) {
        expect([r.body.ready, r.status]).toEqual([true, 200]);
      } else {
        expect([r.body.ready, r.body.reason, r.status]).toEqual([false, c.expect, 503]);
      }
    }
  });
  it('holder 取证独立（禁入 reason）+revoked 行落 not-acquired 档（R8）', async () => {
    const held = await build({ diag: { state: 'not-acquired', owner: null, holder: 'other-owner', epoch: '9', renewedAt: new Date(), statementFailed: false }, gateway: { computePending: () => ({ projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, storeInFlight: 0, strandedFiles: 0, strandedBytes: 0 }), isShuttingDown: () => false, isWritableOrDegraded: () => 'ok' as const, getCollabState: () => 'acquiring' } as any }).svc.getReady();
    expect(held.body.reason).toBe('lease-held');
    expect(held.body.holder).toBe('other-owner');
  });
  it('epoch 恒 string+holderRenewedAgoMs 派生（BigInt 序列化坑）', async () => {
    const r = await build({ diag: { state: 'not-acquired', owner: null, holder: 'x', epoch: '9223372036854775807', renewedAt: new Date(), statementFailed: false }, gateway: { computePending: () => ({ projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, storeInFlight: 0, strandedFiles: 0, strandedBytes: 0 }), isShuttingDown: () => false, isWritableOrDegraded: () => 'ok' as const, getCollabState: () => 'acquiring' } as any }).svc.getReady();
    expect(() => JSON.stringify(r.body)).not.toThrow();
    expect(typeof r.body.epoch).toBe('string');
    expect(typeof r.body.holderRenewedAgoMs).toBe('number');
  });
  it('redis down 不 gating：ping reject → body.redis=down ∧ status 仍 200（BullMQ 无一票否决权）', async () => {
    const { svc } = build({ redisOk: false });
    const r = await svc.getReady();
    expect(r.status).toBe(200);
    expect(r.body.redis).toBe('down');
  });
  it('1s 单飞（Z10）：缓存+并发合流——两次串行 + 10 次并发共探 PG/redis 一次', async () => {
    const { svc, redis } = build();
    await svc.getReady();
    await svc.getReady();
    await Promise.all(Array.from({ length: 10 }, () => svc.getReady()));
    expect(redis.ping).toHaveBeenCalledTimes(1);   // 缓存期内零新探测+无并发击穿
  });
});
