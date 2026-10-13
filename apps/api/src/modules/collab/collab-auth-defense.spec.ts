// apps/api/src/modules/collab/collab-auth-defense.spec.ts
// Y0b-3 T3（§3.1bis 拒绝路径防放大）：
// - describe A（Step 0.6/P-K 红锚）：sweep 判据门两分支——快照死线 ∨ permCache 5min 到期才复验；
//   改前单分支（快照未过期 continue）使权限复验零调用=降级/撤权最长 7d 不可见。3×3 矩阵
//   （输入源 tick/event/cache × 结果 viewer 维持/editor 降级/null 踢线）全路径 sweep 驱动。
// - describe B（Step 1 验收锚 v2.2 输出级）：refusalCache 白名单四类 15s TTL/per-socket 桶
//   10/min/全局信号量 4/清空单点=transition('serving')+spool 翻转/无凭据不落缓存。
// 形态：直构单元组（sweep spec 先例——fake conn+seedDocument+startSessionSweep+fake timers；
// 验收锚用真实 timer——桶窗口/信号量 gate 不需要时钟推进）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CollabGateway } from './collab.gateway';
import { CollabPgBreakerService } from './collab-pg-breaker.service';
import { CollabSpoolService } from './collab-spool.service';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { register } from 'prom-client';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { measureHeapPressure, resetHeapPressure, stubHeapMeasure } from './heap-pressure';
import { CLIENT_PROTOCOL_VERSION } from '@flowweb/shared';

let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};
beforeEach(async () => {
  const d = await makeSpoolDir('y0b3-defense-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
  resetHeapPressure();   // T4：heap 谓词迟滞模块态随测试复位
});
afterEach(async () => { await spoolCleanup(); });

function buildGateway() {
  const prisma = {
    session: {
      findUnique: vi.fn().mockResolvedValue({ user: { id: 'u1', name: '张三' }, userId: 'u1', expiresAt: new Date(Date.now() + 24 * 3600 * 1000) }),
      update: vi.fn(async (args: any) => ({ user: { id: 'u1', name: '张三' }, expiresAt: args.data.expiresAt })),
    },
    canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1', userId: 'other' }) },
    projectMember: { findUnique: vi.fn().mockResolvedValue(null) },
    teamMember: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER', userId: 'u1' }) },
  };
  const repo = createMockRepo();
  const lease = createLeaseStub();
  // F-3 换轨（T3）：recheckConnection/authenticateInner 判据走 resolveWithTeam——stub 双方法齐备
  const perm = {
    resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
    resolveWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' }),
  };
  const spool = new CollabSpoolService(spoolDir);
  spool.setOwner('test-owner');
  const gateway = new CollabGateway(
    prisma as any, new EventEmitter2() as any, repo as any, lease as any,
    perm as any, 46000 + Math.floor(Math.random() * 3000),
    undefined, undefined, undefined, spool,
  );
  (gateway as any).collabState = 'serving';
  return { gateway, prisma, perm, spool };
}

interface FakeConn {
  context: { token?: string; sessionExpiresAt?: Date };
  readOnly?: boolean;
  sendStateless: ReturnType<typeof vi.fn>;
  webSocket: { close: ReturnType<typeof vi.fn> };
}

function makeConn(overrides: { expiresAt?: Date; readOnly?: boolean } = {}): FakeConn {
  return {
    context: { token: 'tok', sessionExpiresAt: overrides.expiresAt ?? new Date(Date.now() - 1000) },
    readOnly: overrides.readOnly ?? false,
    sendStateless: vi.fn(),
    webSocket: { close: vi.fn() },
  };
}

function seedDocument(gateway: CollabGateway, name: string, conns: FakeConn[]) {
  const connections = new Map(conns.map((c) => [c, { clients: new Set() }]));
  (gateway.server.hocuspocus.documents as Map<string, any>).set(name, { name, connections });
  return connections;
}

function authPayload(socketId = 'sock-def-1', documentName = 'project:p1') {
  return {
    requestHeaders: new Headers({ cookie: 'flowweb.session_token=tok' }),
    requestParameters: new URLSearchParams(`csv=${CLIENT_PROTOCOL_VERSION}`),   // Y0b-3 T5 版本门：装置带当前协议版（缺 csv=CLIENT_VERSION_MISSING 先拒）
    socketId,
    documentName,
    connectionConfig: { readOnly: false, isAuthenticated: false },
  };
}

// ============ describe A：sweep 判据门两分支（P-K——Step 0.6 红锚） ============
describe('Y0b-3 T3 sweep 判据门（快照死线 ∨ permCache 5min 到期——权限复验全路径）', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it('权限降级在 session 未过期时也会被发现（改前红：判据门只看快照死线——dueForPerm 分支缺失，复验零调用）', async () => {
    const { gateway, perm } = buildGateway();
    const conn = makeConn({ expiresAt: new Date(Date.now() + 7 * 24 * 3600_000), readOnly: false });   // EDITOR 连接（session 远期）
    seedDocument(gateway, 'project:p1', [conn]);
    (gateway as any).permCache.set(conn, { role: 'PROJECT_EDITOR', at: Date.now() });   // 连接时已复验（5min 会话级结论缓存播种）
    perm.resolveWithTeam.mockResolvedValue({ role: 'PROJECT_VIEWER', teamId: 't1' });   // DB 直改——降级（session 仍有效）
    (gateway as any).sweepIntervalMs = () => 60_000;   // Y0b-3 T8 jitter：固定间隔隔离时序（节奏锚在 perm-events spec）
    (gateway as any).startSessionSweep();
    await vi.advanceTimersByTimeAsync(5 * 60_000 * 1.2 + 1_000);   // sweep 兜底窗（permCache 5min+上界）
    expect(conn.readOnly).toBe(true);                              // 改前红：复验未被调用
    expect(conn.webSocket.close).not.toHaveBeenCalled();           // 降级不断连（E13 语义=修越权写）
  });

  it.each([
    ['tick', 'viewer 维持'], ['tick', 'editor 降级'], ['tick', 'null 踢线'],
    ['event', 'viewer 维持'], ['event', 'editor 降级'], ['event', 'null 踢线'],
    ['cache', 'viewer 维持'], ['cache', 'editor 降级'], ['cache', 'null 踢线'],
  ])('3×3 矩阵：输入源=%s × 结果=%s', async (source, outcome) => {
    const { gateway, prisma, perm } = buildGateway();
    const conn = makeConn({ expiresAt: new Date(Date.now() + 7 * 24 * 3600_000), readOnly: outcome === 'viewer 维持' });
    const cache: Map<object, unknown> = (gateway as any).permCache;
    if (source === 'cache') {
      cache.set(conn, { role: 'PROJECT_EDITOR', at: Date.now() });   // 未到期结论（5min 窗内）
    } else if (source === 'event') {
      // event 格经"预置结论+手动失效缓存+tick"模拟事件触发复验（实连事件面=T8 collab-perm-events.spec）
      cache.set(conn, { role: 'PROJECT_EDITOR', at: Date.now() });
      cache.delete(conn);
    }   // tick：无条目=首查必复验（判据门语义）
    perm.resolveWithTeam.mockResolvedValue(
      outcome === 'null 踢线' ? { role: null, teamId: 't1' } : { role: 'PROJECT_VIEWER', teamId: 't1' });
    seedDocument(gateway, 'project:p1', [conn]);
    (gateway as any).sweepIntervalMs = () => 60_000;   // Y0b-3 T8 jitter：固定间隔隔离时序（节奏锚在 perm-events spec）
    (gateway as any).startSessionSweep();
    await vi.advanceTimersByTimeAsync(60_000);   // tick（不越 grace 窗——sweep spec 先例形态）
    if (source === 'cache') {
      expect(prisma.session.findUnique).not.toHaveBeenCalled();   // 缓存命中零 DB（缓存命中不重查库锚）
      expect(conn.webSocket.close).not.toHaveBeenCalled();        // 缓存窗内不踢
      if (outcome === 'viewer 维持') expect(conn.readOnly).toBe(true);
      if (outcome === 'editor 降级') expect(conn.readOnly).toBe(false);   // 缓存窗内不降级（5min 上界有意——即时性归 T8 事件面）
      return;
    }
    if (outcome === 'null 踢线') {
      expect(conn.webSocket.close).not.toHaveBeenCalled();        // grace 窗内先通知
      expect(conn.sendStateless).toHaveBeenCalledWith(JSON.stringify({ type: 'session-expiring' }));
      await vi.advanceTimersByTimeAsync(5_000);
      expect(conn.webSocket.close).toHaveBeenCalledWith(4401, 'session-expired');
      return;
    }
    // viewer 维持 / editor 降级：复验发生（查了 DB）且降级生效不断连
    expect(prisma.session.findUnique).toHaveBeenCalledTimes(1);
    expect(conn.readOnly).toBe(true);
    expect(conn.webSocket.close).not.toHaveBeenCalled();
  });

  it.each([
    ['draining', 'collabState'], ['spool-unwritable', 'spool'],
  ])('I-2：%s 期 sweep 复验 role=EDITOR 不解冻 readOnly 连接（readOnly 三写者共享：drain 冻结/spool 降级/viewer 降级——升回分支守卫停写状态；改前红：静默翻 false 破 SV9/B12 drain 停写契约）', async (guard) => {
    const { gateway, perm, spool } = buildGateway();
    const conn = makeConn({ expiresAt: new Date(Date.now() + 7 * 24 * 3600_000), readOnly: true });   // readOnly=true=drain 冻结/spool 降级态
    seedDocument(gateway, 'project:p1', [conn]);
    if (guard === 'collabState') (gateway as any).collabState = 'draining';   // isShuttingDown()=true（drain 期 sweep tick 照跑——sweepSessions 无状态门）
    else vi.spyOn(spool, 'isWritable').mockReturnValue(false);   // isWritableOrDegraded()='spool-unwritable'
    perm.resolveWithTeam.mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' });   // 复验 role 可写（冻结期授权变化场景）
    (gateway as any).sweepIntervalMs = () => 60_000;   // Y0b-3 T8 jitter：固定间隔隔离时序（节奏锚在 perm-events spec）
    (gateway as any).startSessionSweep();
    await vi.advanceTimersByTimeAsync(60_000);   // 一轮 sweep tick——permCache 无条目=首查必复验
    expect(conn.readOnly).toBe(true);            // 改前红：升回分支无条件翻 false=冻结窗内静默解冻
    expect(conn.webSocket.close).not.toHaveBeenCalled();   // 不解冻≠踢线（保持冻结只读）
  });
});

// ============ describe B：验收锚（§3.1bis v2.2 输出级——Step 1 红锚） ============
describe('Y0b-3 T3 认证防线三层（refusalCache→信号量→桶）+清空单点', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('验收锚①：同一 socket 连续 N 次被拒 Auth（db-unavailable）→prisma 调用计数不随 N 增长（refusalCache 生效硬证据）', async () => {
    const { gateway, prisma } = buildGateway();
    prisma.session.findUnique.mockRejectedValue(new Error('db down'));
    for (let i = 0; i < 10; i++) {
      await expect(gateway.hooks.onAuthenticate(authPayload() as any)).rejects.toMatchObject({ reason: 'db-unavailable' });
    }
    // 首次后进 refusalCache（15s TTL 内）：后续 9 次零 DB——fingerprint=真实凭据（cookie token 哈希）
    expect(prisma.session.findUnique).toHaveBeenCalledTimes(1);
  });

  it('refusalCache 白名单外不入：UNAUTHENTICATED 重复→每次都走完整路径（缓存恒空）', async () => {
    const { gateway, prisma } = buildGateway();
    prisma.session.findUnique.mockResolvedValue(null);
    for (let i = 0; i < 5; i++) {
      await expect(gateway.hooks.onAuthenticate(authPayload() as any)).rejects.toMatchObject({ reason: 'unauthenticated' });
    }
    expect(prisma.session.findUnique).toHaveBeenCalledTimes(5);   // 每次都走完整路径
    expect((gateway as any).refusalCache.size).toBe(0);
  });

  it('桶超限 deny rate-limited 且不写缓存（第 11 次/分钟；断连由库 30s 超时自然完成）', async () => {
    const { gateway, prisma } = buildGateway();
    prisma.session.findUnique.mockResolvedValue(null);   // 前 10 次 unauthenticated（白名单外——不干扰缓存断言）
    for (let i = 0; i < 10; i++) {
      await expect(gateway.hooks.onAuthenticate(authPayload() as any)).rejects.toBeTruthy();
    }
    await expect(gateway.hooks.onAuthenticate(authPayload() as any)).rejects.toMatchObject({ reason: 'rate-limited' });
    expect((gateway as any).refusalCache.size).toBe(0);
    expect(prisma.session.findUnique).toHaveBeenCalledTimes(10);   // 第 11 次零 DB（桶拦在 inner 之前）
  });

  it('验收锚②：信号量满→SERVER_OVERLOADED deny+在飞峰值≤INFLIGHT_MAX（collab_auth_inflight gauge；口径：计数≠DB 在飞——deadline 到期即释放槽位但底层查询仍在飞，DB 真实并发由池 connection_limit 兜底）', async () => {
    const { gateway, prisma } = buildGateway();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    prisma.session.findUnique.mockImplementation(() => gate.then(() => { throw new Error('db down'); }));   // 挂起 inner 的 DB 步骤直至放行
    const inflight: number[] = [];
    const rejected: string[] = [];
    Array.from({ length: 16 }, (_v, i) =>
      gateway.hooks.onAuthenticate(authPayload(`sock-sem-${i}`) as any)
        .catch((e: any) => { rejected.push(e?.reason); return 0; })
        .then(() => inflight.push((gateway as any).authInflightPeak)));   // 字段直读（peak 仅测试观测——生产 gauge collect 读 authInflight 现值，非本字段）
    await new Promise((r) => setTimeout(r, 0));   // 排空同步段与微任务：12 个被拒+4 个挂 inner
    expect(rejected.filter((r) => r === 'server-overloaded').length).toBe(12);   // 第 5+ 个并发请求被拒（默认 4）
    expect(Math.max(...inflight)).toBeLessThanOrEqual(4);
    release();   // 4 个挂起请求收尾（各自带 catch——无 unhandled rejection）
  });

  it.each([
    ['drain 解除'], ['租约 rejoin'], ['fence 解除'], ['PG 半开成功'],
  ])('%s → refusalCache 清空（冻结契约 16 五钩子覆盖锚：缺一即缓存失效测试红）', async (flip) => {
    const { gateway } = buildGateway();
    const cache: Map<string, unknown> = (gateway as any).refusalCache;
    // 直构 gateway 不 listen——listenCollab/drain 定时器全链不可驱动；用最近合法状态转移链驱动
    //（fence 解除/租约 rejoin=isolated→starting→serving；drain 解除=serving→draining→serving——
    // 不变量断言的都是 transition('serving') 转移点）
    const g = gateway as any;
    if (flip === 'drain 解除') {
      g.transition('draining', 'test-drive');
      cache.set('doc|t:abc', { reason: 'draining', at: Date.now() });
      g.transition('serving', 'test-drive-release');
    } else if (flip === 'PG 半开成功') {
      // Y0b-5 T16（契约 16 第五钩子）：breaker onRecovered→清空点二（gateway 构造期 setOnRecovered 接线）
      cache.set('doc|t:abc', { reason: 'db-unavailable', at: Date.now() });
      const b = g.pgBreaker as CollabPgBreakerService;
      vi.useFakeTimers();   // 先于 recordFailure——冷却 timer 必须落在 fake registry（后开=孤儿化不 fire）
      try {
        for (let i = 0; i < 5; i++) b.recordFailure(Object.assign(new Error("Can't reach database server"), { code: 'P1001' }));
        vi.advanceTimersByTime(10_001);   // 冷却→half-open（探测位）
      } finally { vi.useRealTimers(); }
      b.recordSuccess();   // half-open 探测成功→closed+清空
    } else {
      g.transition('isolated', 'test-drive');
      cache.set('doc|t:abc', { reason: 'lease-not-ready', at: Date.now() });
      g.transition('starting', 'test-drive-rejoin');   // rejoin 合法链 isolated→starting（listenCollab）
      g.transition('serving', 'test-drive-release');
    }
    expect(cache.size).toBe(0);
  });

  it('spool 恢复 → refusalCache 清空（isWritableOrDegraded 翻转检测——authenticate 判定点记上一态）', async () => {
    const { gateway, prisma, spool } = buildGateway();
    prisma.session.findUnique.mockResolvedValue(null);   // inner 快速拒（unauthenticated——不写缓存）
    const spy = vi.spyOn(spool, 'isWritable').mockReturnValue(false);
    await gateway.hooks.onAuthenticate(authPayload() as any).catch(() => {});   // 记录 'spool-unwritable' 上一态
    const cache: Map<string, unknown> = (gateway as any).refusalCache;
    cache.set('doc|t:abc', { reason: 'draining', at: Date.now() });
    spy.mockReturnValue(true);   // spool 恢复
    await gateway.hooks.onAuthenticate(authPayload() as any).catch(() => {});   // 翻转检测→清
    expect(cache.size).toBe(0);
  });

  it('heap 释放→refusalCache 清空（T4 已接线：真实释放路径=heapPressureSample 采样翻转驱动 onServingTransition——releaseHook 一次性回调汇入同点；Y0b-5 T16 起清空点恰 2 处=serving 转移汇点+PG 半开成功钩子）', async () => {
    const src = readFileSync(resolve(__dirname, 'collab.gateway.ts'), 'utf8');
    expect(src.match(/refusalCache\.clear\(\)/g)).toHaveLength(2);   // :onServingTransition + setOnRecovered 接线（Y0b-3 预埋锚按设计改写——非放宽）
    const { gateway } = buildGateway();
    const cache: Map<string, unknown> = (gateway as any).refusalCache;
    cache.set('doc|t:abc', { reason: 'server-overloaded', at: Date.now() });
    stubHeapMeasure({ heapUsed: 0.9e9, heapLimit: 1e9, rss: 100 * 1024 * 1024 });
    measureHeapPressure(); measureHeapPressure();   // util 迟滞预热（2 连续采样=trip）
    (gateway as any).heapPressureSample();          // trip 翻转（gauge+日志；缓存不清）
    expect(cache.size).toBe(1);
    stubHeapMeasure({ heapUsed: 0.5e9, heapLimit: 1e9, rss: 100 * 1024 * 1024 });   // 双项低于释放线
    (gateway as any).heapPressureSample();          // released 翻转→onServingTransition 清空
    expect(cache.size).toBe(0);
  });

  it('无 cookie 的状态类拒绝（draining）→不落缓存（anon 键互覆防护——写入侧短路锚；状态检查先于凭据提取=draining 分型不被 unauthenticated 吞）', async () => {
    const { gateway } = buildGateway();
    (gateway as any).collabState = 'draining';
    const payload = authPayload();
    (payload as any).requestHeaders = new Headers();   // 无 cookie
    await expect(gateway.hooks.onAuthenticate(payload as any)).rejects.toMatchObject({ reason: 'draining' });
    expect((gateway as any).refusalCache.size).toBe(0);
  });

  it('拒绝计数单点：auth_reject{reason,source} 全拒绝路径经 deny 单点（state/cache 分位）', async () => {
    const { gateway, prisma } = buildGateway();
    const metric: any = register.getSingleMetric('collab_auth_reject_total');
    const countOf = async (labels: Record<string, string>): Promise<number> =>
      (await metric.get()).values.find((s: any) => Object.entries(labels).every(([k, v]) => s.labels[k] === v))?.value ?? 0;
    prisma.session.findUnique.mockRejectedValue(new Error('db down'));
    await gateway.hooks.onAuthenticate(authPayload() as any).catch(() => {});   // state（db-unavailable）
    const stateBefore = await countOf({ reason: 'db-unavailable', source: 'state' });
    await gateway.hooks.onAuthenticate(authPayload() as any).catch(() => {});   // cache 命中（15s TTL 内）
    expect(await countOf({ reason: 'db-unavailable', source: 'state' })).toBe(stateBefore);   // 第二次不再进 inner
    expect(await countOf({ reason: 'db-unavailable', source: 'cache' })).toBeGreaterThan(0);  // 缓存命中分位
  });
});

// ============ describe C：三指标注册（红锚——实现前 register 无此三 metric） ============
describe('Y0b-3 T3 指标注册', () => {
  it('collab_auth_reject_total{reason,source} / collab_auth_inflight / collab_auth_timeout_total 注册进默认 register', () => {
    expect(register.getSingleMetric('collab_auth_reject_total')).toBeDefined();
    expect(register.getSingleMetric('collab_auth_inflight')).toBeDefined();
    expect(register.getSingleMetric('collab_auth_timeout_total')).toBeDefined();
  });

  it('AUTH deadline 到期折 db-unavailable；底层查询迟到 rejection 不产生 unhandledRejection（race 弃分支必须有消费——超时释放槽位≠底层查询取消）', async () => {
    const { gateway } = buildGateway();
    const unhandled: unknown[] = [];
    const onUn = (r: unknown) => unhandled.push(r);
    process.on('unhandledRejection', onUn);
    try {
      let rejectLater!: (e: Error) => void;
      const slow = new Promise<never>((_res, rej) => { rejectLater = rej; });   // 永挂的"底层查询"
      await expect((gateway as any).withAuthDeadline(slow)).rejects.toMatchObject({ reason: 'db-unavailable' });
      rejectLater(new Error('late failure'));   // race 已弃分支——迟到 reject
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUn);
    }
  }, 10_000);

  it('I-1：快速成功认证 → collab_auth_timeout_total 零增量（改前红：deadline timer 成功路径不清理，到点照常 inc——inner 每次成功认证调 2 次 withAuthDeadline=假计 +2，指标信号全毁）', async () => {
    vi.useFakeTimers();
    try {
      const { gateway } = buildGateway();
      const metric: any = register.getSingleMetric('collab_auth_timeout_total');
      const value = async () => (await metric.get()).values[0]?.value ?? 0;
      const before = await value();
      await gateway.hooks.onAuthenticate(authPayload() as any);   // 快速成功（mock 全 resolve——零真实超时）
      await vi.advanceTimersByTimeAsync((CollabGateway as any).AUTH_DB_DEADLINE_MS + 1_000);   // 越过 deadline 窗：迟到 timer 若未 clear 必已 fire
      expect(await value()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('I-2 伴随锚：deadline 到期路径 inc 恰一次（clearTimeout 不得吞掉真实超时计数——与 I-1 合读=超时计数的完备性）', async () => {
    vi.useFakeTimers();
    try {
      const { gateway } = buildGateway();
      const metric: any = register.getSingleMetric('collab_auth_timeout_total');
      const value = async () => (await metric.get()).values[0]?.value ?? 0;
      const before = await value();
      let rejectLater!: (e: Error) => void;
      const slow = new Promise<never>((_res, rej) => { rejectLater = rej; });
      const raced = (gateway as any).withAuthDeadline(slow).catch((e: any) => e?.reason);
      await vi.advanceTimersByTimeAsync((CollabGateway as any).AUTH_DB_DEADLINE_MS + 1);
      expect(await raced).toBe('db-unavailable');
      expect(await value()).toBe(before + 1);   // 恰一次
      rejectLater(new Error('late failure'));   // 弃分支迟到 reject——无 unhandledRejection
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
