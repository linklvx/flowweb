// Y0a-3 T2：租约 service 全语义 mock 层——CAS（自愈 seed 同事务）/心跳三态（owner-only+单调钟）/
// classifyZeroRow 三分流（fenced|revoked|lease-error）/everHeld-revoked 门/rejoin/halt/构造断言/release。
// V24：到期类用例小 env（构造前设——HB*2≤TTL 不变式仍满足）+事件定序（onLost/onAcquired 的 Promise
// 替代固定 sleep——<1s 余量问题根除）；B14：tagged template 断言一律 join('?')/slice(1) 值断言。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CollabLeaseService } from './collab-lease.service';
import { CollabSpoolService } from './collab-spool.service';
import { makeSpoolDir } from '../../test-utils/spool-dir';

function buildService(query: ReturnType<typeof vi.fn>, spool: CollabSpoolService) {
  const exec = vi.fn().mockResolvedValue(0);   // 预授权适配#2：自愈 seed INSERT 走 $executeRaw——捕获供断言
  const prisma = { $queryRaw: query, $transaction: vi.fn(async (fn: any) => fn({ $queryRaw: query, $executeRaw: exec })) };
  const repo = { setLeaseOwner: vi.fn() };
  const svc = new CollabLeaseService(prisma as any, repo as any, spool);
  return { svc, prisma, repo, exec };
}
const renewSql = (frag: unknown) => String(frag).includes('"renewedAt" = now()') && String(frag).includes('RETURNING "renewedAt"');
const text = (c: unknown[]) => (c[0] as string[]).join('?');
const withTimeout = <T,>(p: Promise<T>, ms = 5_000, msg = '事件未到达（定序失败）') =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

describe('CollabLeaseService', () => {
  let dir: { dir: string; cleanup: () => Promise<void> };
  let spool: CollabSpoolService;
  beforeEach(async () => {
    process.env.COLLAB_LEASE_TTL_MS = '10000';
    process.env.COLLAB_LEASE_HEARTBEAT_MS = '3000';
    dir = await makeSpoolDir('y0a3-lease-');
    spool = new CollabSpoolService(dir.dir);
  });
  afterEach(async () => { delete process.env.COLLAB_LEASE_TTL_MS; delete process.env.COLLAB_LEASE_HEARTBEAT_MS; await dir.cleanup(); });

  it('构造断言（Z18）：HB*2>TTL → throw（负/零 TTL=make_interval 负秒=恒可夺——互斥静默失效）', () => {
    process.env.COLLAB_LEASE_TTL_MS = '4000';
    process.env.COLLAB_LEASE_HEARTBEAT_MS = '3000';
    expect(() => buildService(vi.fn(), spool)).toThrow(/不变式/);
  });

  it('owner 有界+fs-safe（V4）：host 段 ≤24、总长 ≤64、仅 [A-Za-z0-9_-]——同时是 spool 子目录名（Windows 禁冒号；长 hostname 不得致 setOwner throw）', () => {
    const { svc } = buildService(vi.fn(), spool);
    expect(svc.owner.length).toBeLessThanOrEqual(64);
    expect(svc.owner).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(() => spool.setOwner(svc.owner)).not.toThrow();
  });

  it('CAS 成功：held+repo.setLeaseOwner(owner)+spool.setOwner(owner)+epoch gauge+自愈 seed 同事务', async () => {
    const query = vi.fn().mockResolvedValue([{ epoch: 5n }]);
    const setOwnerSpy = vi.spyOn(spool, 'setOwner');
    const { svc, repo, exec } = buildService(query, spool);
    const ok = await svc.tryAcquireFast();
    expect(ok).toBe(true);
    expect(svc.isServing()).toBe(true);
    expect(repo.setLeaseOwner).toHaveBeenCalledWith(expect.any(String));
    expect(setOwnerSpy).toHaveBeenCalledWith(expect.any(String));
    expect(text(exec.mock.calls[0])).toContain('ON CONFLICT (scope) DO NOTHING');   // Z17 自愈 seed 同事务（适配#2：$executeRaw 捕获）
    expect((await svc.diag()).epoch).toBe('5');
  });

  it('CAS 0 行（他人持有/未过期）：false+不触 repo/spool 接线', async () => {
    const { svc, repo } = buildService(vi.fn().mockResolvedValue([]), spool);
    await expect(svc.tryAcquireFast()).resolves.toBe(false);
    expect(svc.isServing()).toBe(false);
    expect(repo.setLeaseOwner).not.toHaveBeenCalled();
  });

  it('单点负责制（W5）：成功⇒tryAcquireFast 内已 await onAcquired（kit 不变量：返回即已启动）', async () => {
    const onAcquired = vi.fn(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const { svc } = buildService(vi.fn().mockResolvedValue([{ epoch: 1n }]), spool);
    svc.onAcquired = onAcquired;
    const t0 = Date.now();
    await svc.tryAcquireFast();
    expect(onAcquired).toHaveBeenCalledTimes(1);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(20);   // await 穿透（fire-and-forget 则 ≈0）
  });

  it('onHeld 原子（V4/I1）：spool.setOwner 抛 → state 非 held+租约行已释放（防半 held 僵尸）+rethrow', async () => {
    const badSpool = new CollabSpoolService(dir.dir);
    vi.spyOn(badSpool, 'setOwner').mockImplementation(() => { throw new Error('owner 非法'); });
    const query = vi.fn().mockResolvedValue([{ epoch: 1n }]);
    const { svc } = buildService(query, badSpool);
    await expect(svc.tryAcquireFast()).rejects.toThrow('owner 非法');
    expect(svc.isServing()).toBe(false);
    expect(query.mock.calls.some((c) => text(c).includes('SET owner = NULL'))).toBe(true);   // 行已释放——其他实例不被僵尸挡
  });

  it('心跳三态-unknown：单次抛错不隔离——1s 重试恢复；renew 语句 owner-only（无 TTL 守卫）', async () => {
    process.env.COLLAB_LEASE_TTL_MS = '1500';   // 预授权适配#3：TTL=1000 时死线 ttl+hb=1200ms 与 1s 重试触发点(~1200ms)结构同刻=必翻车；1500 使死线 1700ms>重试点
    process.env.COLLAB_LEASE_HEARTBEAT_MS = '200';
    let renewCalls = 0; let failFirst = true;
    const query = vi.fn().mockImplementation((...args: any[]) => {
      if (renewSql(args[0])) {
        renewCalls += 1;
        if (failFirst) { failFirst = false; return Promise.reject(new Error('PG 抖动')); }
        return Promise.resolve([{ renewedAt: new Date() }]);
      }
      return Promise.resolve([{ epoch: 1n }]);
    });
    const { svc } = buildService(query, spool);
    await svc.tryAcquireFast();
    await withTimeout(vi.waitFor(() => { if (renewCalls < 2) throw new Error('尚未重试'); }, 4_000), 4_000, '1s 重试未发生');   // 第一次抖动→1s 后重试成功（4s 入 waitFor——默认 1s 早于重试点）
    expect(svc.isServing()).toBe(true);   // 关键断言：unknown ≠ fenced（单次抖动不隔离）
    const renewText = text(query.mock.calls.find((c) => renewSql(c[0]))!);
    expect(renewText).not.toContain('"expiresAt" >= now()');   // SV1：owner-only——TTL 守卫=活性抖动误判源
  });

  it('心跳三态-unknown 到期（单调钟）：renew 恒败 → ttl+hb 窗内无成功 → isolate(heartbeat-unknown-expired)', async () => {
    process.env.COLLAB_LEASE_TTL_MS = '200';
    process.env.COLLAB_LEASE_HEARTBEAT_MS = '100';
    const query = vi.fn().mockImplementation((...args: any[]) =>
      renewSql(args[0]) ? Promise.reject(new Error('PG down')) : Promise.resolve([{ epoch: 1n }]));
    const onLost = vi.fn();
    const { svc } = buildService(query, spool);
    svc.onLost = onLost;
    await svc.tryAcquireFast();
    await withTimeout(vi.waitFor(() => { if (!onLost.mock.calls.length) throw new Error('未隔离'); }, 4_000), 4_000);   // 隔离点~1.1s>vi.waitFor 默认 1s——预算入 waitFor
    expect(onLost).toHaveBeenCalledWith('heartbeat-unknown-expired');
    expect(svc.isServing()).toBe(false);
  });

  it('心跳三态-fenced（V24 定序）：renew 0 行+行 owner=他人 → isolate(heartbeat-fenced)+repo 清 null+rejoin CAS 0 行不复得', async () => {
    process.env.COLLAB_LEASE_HEARTBEAT_MS = '200';
    let lost = false;   // phase flip：held 期 renew 成功；lost 后 renew 0 行+行 owner=他人+rejoin CAS 0 行
    const query = vi.fn().mockImplementation((...args: any[]) => {
      if (renewSql(args[0])) return Promise.resolve(lost ? [] : [{ renewedAt: new Date() }]);
      if (String(args[0]).includes('SELECT owner')) return Promise.resolve([{ owner: 'other-instance' }]);
      return Promise.resolve(lost ? [] : [{ epoch: 1n }]);   // 首获成功；rejoin CAS 0 行
    });
    const onLost = vi.fn();
    const { svc, repo } = buildService(query, spool);
    svc.onLost = onLost;
    await svc.tryAcquireFast();
    lost = true;                                       // 被夺
    await withTimeout(vi.waitFor(() => { if (!onLost.mock.calls.length) throw new Error('未隔离'); }), 4_000);
    expect(onLost).toHaveBeenCalledWith('heartbeat-fenced');
    expect(repo.setLeaseOwner).toHaveBeenLastCalledWith(null);   // 契约 16 fail-closed
    await new Promise((r) => setTimeout(r, 1_500));              // rejoin 首退避 1s——CAS 仍 0 行
    expect(svc.isServing()).toBe(false);                          // 不复得（mock 定序稳定——无竞态窗口）
  });

  it('classifyZeroRow-revoked（W7）：行 owner=revoked → revoked 终态+onLost(revoked)+不再 CAS', async () => {
    process.env.COLLAB_LEASE_HEARTBEAT_MS = '200';
    let casCount = 0;
    const query = vi.fn().mockImplementation((...args: any[]) => {
      if (renewSql(args[0])) return Promise.resolve([]);
      if (String(args[0]).includes('SELECT owner')) return Promise.resolve([{ owner: 'revoked' }]);
      casCount += 1;
      return Promise.resolve([{ epoch: 1n }]);
    });
    const onLost = vi.fn();
    const { svc } = buildService(query, spool);
    svc.onLost = onLost;
    await svc.tryAcquireFast();
    const afterAcquire = casCount;
    await withTimeout(vi.waitFor(() => { if (!onLost.mock.calls.length) throw new Error('未撤销'); }), 4_000);
    expect(onLost).toHaveBeenCalledWith('revoked');
    await new Promise((r) => setTimeout(r, 2_500));   // rejoin 窗口（若有 bug 会 CAS）
    expect(casCount).toBe(afterAcquire);              // revoked 不 rejoin——无新 CAS
    expect(svc.isServing()).toBe(false);
  });

  it('everHeld-revoked 门（V5/I2/I6）：unknown 到期隔离（不查行）后行被 break-glass 改 revoked → rejoin 前置门判 revoked → 终态不复得（CAS 不执行）', async () => {
    process.env.COLLAB_LEASE_TTL_MS = '200';
    process.env.COLLAB_LEASE_HEARTBEAT_MS = '100';
    let rowOwner: string | null = null;   // 行态受控
    let casSuccess = 0;
    const query = vi.fn().mockImplementation((...args: any[]) => {
      const t = text(args);
      if (renewSql(args[0])) return Promise.reject(new Error('PG down'));                  // unknown 路径
      if (String(args[0]).includes('SELECT owner')) return Promise.resolve(rowOwner == null ? [] : [{ owner: rowOwner }]);
      if (t.includes('epoch = epoch + 1')) { casSuccess += 1; return Promise.resolve([{ epoch: 9n }]); }   // 无门则 rejoin 会成功
      return Promise.resolve([{ epoch: 1n }]);
    });
    const onLost = vi.fn();
    const { svc } = buildService(query, spool);
    svc.onLost = onLost;
    await svc.tryAcquireFast();                        // everHeld=true
    await withTimeout(vi.waitFor(() => { if (!onLost.mock.calls.length) throw new Error('未隔离'); }, 4_000), 4_000);   // unknown 到期→lost→rejoin 退避（隔离点~1.1s——预算入 waitFor）
    rowOwner = 'revoked';                              // break-glass 发生
    await new Promise((r) => setTimeout(r, 2_000));    // rejoin 首退避 1s 后 attemptAcquire 查行→revoked
    expect(svc.getState()).toBe('revoked');            // 终态（I6：被撤进程不得复得）
    expect(casSuccess).toBe(1);                        // 仅首获——rejoin 的 CAS UPDATE 未执行（门在 CAS 前）
  });

  it('rejoin 复得（SV5）：fenced 隔离后 CAS 恢复成功 → held+onAcquired 重跑', async () => {
    process.env.COLLAB_LEASE_HEARTBEAT_MS = '200';
    let phase: 'held' | 'lost' = 'held';
    const query = vi.fn().mockImplementation((...args: any[]) => {
      if (renewSql(args[0])) return Promise.resolve(phase === 'held' ? [{ renewedAt: new Date() }] : []);
      if (String(args[0]).includes('SELECT owner')) return Promise.resolve([{ owner: 'other' }]);
      return Promise.resolve(phase === 'held' ? [{ epoch: 1n }] : [{ epoch: 2n }]);   // rejoin CAS 成功
    });
    const onAcquired = vi.fn();
    const onLost = vi.fn();
    const { svc } = buildService(query, spool);
    svc.onAcquired = onAcquired; svc.onLost = onLost;
    await svc.tryAcquireFast();
    phase = 'lost';
    await withTimeout(vi.waitFor(() => { if (onAcquired.mock.calls.length < 2) throw new Error('未复得'); }, 5_000), 5_000);   // 复得点~1.2s（rejoin 首退避 1s）——预算入 waitFor
    expect(svc.isServing()).toBe(true);
  });

  it('halt（W9）：关停闸后 acquireLoop 退出', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const { svc } = buildService(query, spool);
    const loop = svc.acquireLoop();
    await new Promise((r) => setTimeout(r, 100));
    svc.halt();
    await withTimeout(loop, 4_000, 'halted 后循环未退出');
  });

  it('acquireLoop 单飞（V7）：并发二调不双跑（第二次立即返回）', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const { svc } = buildService(query, spool);
    const a = svc.acquireLoop(); void svc.acquireLoop();
    await new Promise((r) => setTimeout(r, 100));
    svc.halt();
    await withTimeout(a, 4_000);
    expect(query.mock.calls.length).toBeLessThanOrEqual(2);   // 无并发双循环各 30 次的形态
  });

  it('release：owner=NULL 语句+离开 held+幂等；spool owner 不清+epoch gauge 复位（V6）', async () => {
    const query = vi.fn().mockImplementation((...a: any[]) =>
      text(a).includes('epoch = epoch + 1') ? Promise.resolve([{ epoch: 1n }]) : Promise.resolve([{}]));
    const setOwnerSpy = vi.spyOn(spool, 'setOwner');
    const { svc } = buildService(query, spool);
    await svc.tryAcquireFast();
    await svc.release();
    expect(svc.isServing()).toBe(false);
    expect(setOwnerSpy).toHaveBeenCalledTimes(1);      // 只 set 一次——release/isolate 均不清 spool owner
    await svc.release();                               // 幂等不抛
  });
});
