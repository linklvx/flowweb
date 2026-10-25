// apps/api/src/modules/collab/collab.gateway.sweep.spec.ts
// 批3-4：session-expiry sweep（Y0b-3 T1 起默认开——'false'=逃生阀）+ closeTeamDocuments 补 webSocket.close。
// 形态：直构单元组（shutdown spec 先例——mock prisma，不 listen），fake timers 驱动 60s tick 与 5s grace；
// 连接用 fake（context 快照 + sendStateless + webSocket.close），文档塞 server.hocuspocus.documents。
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CollabGateway } from './collab.gateway';
import { CollabSpoolService } from './collab-spool.service';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { register } from 'prom-client';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';   // Y0c T39b 波 2：内部状态访问经 façade（check-collab-test-facade 门禁）
import { CollabCloseCode } from '@flowweb/shared';

// Y0a-2：gateway 构造签名扩必填 spool——本 spec 临时目录域（beforeEach 建/afterEach 清）
let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};

function buildGateway() {
  const prisma = {
    systemHistory: { findUnique: vi.fn().mockResolvedValue({ historyId: 'spec-history-id', epochStartedAt: new Date() }) },  // Y1c T9（T8 接线）：listenCollab requireSystemHistory fail-closed 读面 mock

    session: {
      findUnique: vi.fn().mockResolvedValue({ user: { id: 'u1', name: '张三' }, userId: 'u1', expiresAt: new Date(Date.now() + 24 * 3600 * 1000) }),
    },
    canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1' }) },
    teamMember: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER', userId: 'u1' }) },
    canvasDoc: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  const repo = createMockRepo();   // Y0a-1：mock-repo 工厂（loadUpdates 已删）
  const lease = createLeaseStub();   // Y0a-3 T5：租约 stub（isServing 恒 true）
  // Y0b-3 T3（F-3）：recheckConnection 判据换轨 perm.resolveWithTeam 单源——stub 同批补
  // （否则换轨后 TypeError 折 db-unavailable 伪装复验失败，5 连败兜底误踢）
  const perm = {
    resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
    resolveWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' }),
  };
  const gateway = new CollabGateway(
    prisma as any, new EventEmitter2() as any, repo as any, lease as any,
    perm as any, 47000 + Math.floor(Math.random() * 5000),
    undefined, undefined, undefined, new CollabSpoolService(spoolDir),
  );
  return { gateway, prisma, perm };
}

interface FakeConn {
  socketId: string;
  context: { token?: string; sessionExpiresAt?: Date };
  sendStateless: ReturnType<typeof vi.fn>;
  webSocket: { close: ReturnType<typeof vi.fn> };
  document: { name: string };
}

function makeConn(name: string, overrides: { expiresAt?: Date; socketId?: string } = {}): FakeConn {
  return {
    socketId: overrides.socketId ?? `sock-${name}-${Math.random().toString(36).slice(2, 8)}`,
    context: { token: 'tok', sessionExpiresAt: overrides.expiresAt ?? new Date(Date.now() - 1000) },   // 默认快照已过期（必过期下界）
    sendStateless: vi.fn(),
    webSocket: { close: vi.fn() },
    document: { name },
  };
}

function seedDocument(gateway: CollabGateway, name: string, conns: FakeConn[]) {
  const connections = new Map(conns.map((c) => [c, { clients: new Set() }]));
  (gateway.server.hocuspocus.documents as Map<string, any>).set(name, { name, connections });
  return connections;
}

/** prom-client 计数增量断言（collab-version-gate.spec 同款——register 全局单例，恒用增量） */
async function metricDelta(name: string, labels: Record<string, string>, fn: () => Promise<unknown> | unknown): Promise<number> {
  const metric: any = register.getSingleMetric(name);
  const countOf = async () =>
    (await metric.get()).values.find((s: any) => Object.entries(labels).every(([k, v]) => s.labels[k] === v))?.value ?? 0;
  const before = await countOf();
  await fn();
  return (await countOf()) - before;
}

beforeEach(async () => {
  vi.useFakeTimers();
  const d = await makeSpoolDir('y0a2-sweep-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await spoolCleanup();
});

describe('批3-4 session sweep', () => {
  it('默认开（Y0b-3 T1 P-H 翻转，spec §3.1）：不设 env → 过期连接照常通知+grace+close(4401)', async () => {
    delete process.env.COLLAB_SWEEP_ENABLED;   // 缺省形态=开
    const { gateway, prisma } = buildGateway();
    prisma.session.findUnique.mockResolvedValue(null);   // 复验：session 已无效（过期/登出）
    const conn = makeConn('project:p1');
    seedDocument(gateway, 'project:p1', [conn]);
    gatewayFacade(gateway).stubSweepInterval(() => 60_000);   // Y0b-3 T8 jitter：固定间隔隔离本用例时序算术（5min±20% 节奏由 perm-events spec 覆盖）
    gateway.sessionGuard.startSessionSweep();   // 直调族——B1-B3 公有化后 cast 消失（偏离 64②；本文件 ×10 同判）
    await vi.advanceTimersByTimeAsync(65_000);
    expect(conn.sendStateless).toHaveBeenCalledTimes(1);
    expect(conn.sendStateless).toHaveBeenCalledWith(JSON.stringify({ type: 'session-expiring' }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(conn.webSocket.close).toHaveBeenCalledWith(4401, 'session-expired');
  });

  it("逃生阀（§4.2 回滚表）：COLLAB_SWEEP_ENABLED='false' → 零行为差异（不 close、不发通知、零 DB 查询）", async () => {
    vi.stubEnv('COLLAB_SWEEP_ENABLED', 'false');
    const { gateway, prisma } = buildGateway();
    const conn = makeConn('project:p1');
    seedDocument(gateway, 'project:p1', [conn]);
    gatewayFacade(gateway).stubSweepInterval(() => 60_000);   // Y0b-3 T8 jitter：固定间隔隔离本用例时序算术（5min±20% 节奏由 perm-events spec 覆盖）
    gateway.sessionGuard.startSessionSweep();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(conn.webSocket.close).not.toHaveBeenCalled();
    expect(conn.sendStateless).not.toHaveBeenCalled();
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
  });

  it('开启后：过期连接 → stateless 预通知 {type:"session-expiring"} → 5s grace → webSocket.close(4401)', async () => {
    vi.stubEnv('COLLAB_SWEEP_ENABLED', 'true');
    const { gateway, prisma } = buildGateway();
    prisma.session.findUnique.mockResolvedValue(null);   // 复验：session 已无效（过期/登出）
    const conn = makeConn('project:p1');
    seedDocument(gateway, 'project:p1', [conn]);
    gatewayFacade(gateway).stubSweepInterval(() => 60_000);   // Y0b-3 T8 jitter：固定间隔隔离本用例时序算术（5min±20% 节奏由 perm-events spec 覆盖）
    gateway.sessionGuard.startSessionSweep();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(conn.sendStateless).toHaveBeenCalledTimes(1);
    expect(conn.sendStateless).toHaveBeenCalledWith(JSON.stringify({ type: 'session-expiring' }));
    expect(conn.webSocket.close).not.toHaveBeenCalled();   // grace 窗口内不关

    await vi.advanceTimersByTimeAsync(5_000);
    expect(conn.webSocket.close).toHaveBeenCalledWith(4401, 'session-expired');
  });

  it('快照未过期 ∧ 权限结论缓存未到期 → 跳过（零 DB——Y0b-3 T3 两分支判据门：快照死线+permCache 5min 双判据）', async () => {
    vi.stubEnv('COLLAB_SWEEP_ENABLED', 'true');
    const { gateway, prisma } = buildGateway();
    const conn = makeConn('project:p1', { expiresAt: new Date(Date.now() + 3600_000) });
    gatewayFacade(gateway).seedPermCache(conn, 'PROJECT_EDITOR', Date.now());   // 首查已做（T3 起无条目=首查必复验——判据门语义变更）
    seedDocument(gateway, 'project:p1', [conn]);
    gatewayFacade(gateway).stubSweepInterval(() => 60_000);   // Y0b-3 T8 jitter：固定间隔隔离本用例时序算术（5min±20% 节奏由 perm-events spec 覆盖）
    gateway.sessionGuard.startSessionSweep();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
    expect(conn.webSocket.close).not.toHaveBeenCalled();
  });

  it('复验翻案：快照过期但 DB 已续期（me 探活 touch）→ 不关，快照死线刷新', async () => {
    vi.stubEnv('COLLAB_SWEEP_ENABLED', 'true');
    const { gateway, prisma } = buildGateway();
    const renewed = new Date(Date.now() + 6 * 24 * 3600 * 1000);
    prisma.session.findUnique.mockResolvedValue({ user: { id: 'u1' }, userId: 'u1', expiresAt: renewed });
    const conn = makeConn('project:p1');
    seedDocument(gateway, 'project:p1', [conn]);
    gatewayFacade(gateway).stubSweepInterval(() => 60_000);   // Y0b-3 T8 jitter：固定间隔隔离本用例时序算术（5min±20% 节奏由 perm-events spec 覆盖）
    gateway.sessionGuard.startSessionSweep();

    await vi.advanceTimersByTimeAsync(65_000);
    expect(conn.webSocket.close).not.toHaveBeenCalled();
    expect(conn.context.sessionExpiresAt).toEqual(renewed);   // 快照刷新：下轮按新死线
    await vi.advanceTimersByTimeAsync(120_000);
    expect(prisma.session.findUnique).toHaveBeenCalledTimes(1);   // 快照刷新后不再复验
    expect(conn.webSocket.close).not.toHaveBeenCalled();
  });

  it('移除成员也踢：session 有效但权限链解析无角色 → 通知+grace+close', async () => {
    vi.stubEnv('COLLAB_SWEEP_ENABLED', 'true');
    const { gateway, perm } = buildGateway();   // 解构去 cast（R2b 违规形态消除——mock 型化收窄在调用点）
    perm.resolveWithTeam.mockResolvedValue({ role: null, teamId: 't1' } as never);   // 个体被移除（能力 latch 债顺手关）——T3 F-3 换轨：复验走 resolveWithTeam
    const conn = makeConn('project:p1');
    seedDocument(gateway, 'project:p1', [conn]);
    gatewayFacade(gateway).stubSweepInterval(() => 60_000);   // Y0b-3 T8 jitter：固定间隔隔离本用例时序算术（5min±20% 节奏由 perm-events spec 覆盖）
    gateway.sessionGuard.startSessionSweep();
    await vi.advanceTimersByTimeAsync(65_000);
    expect(conn.webSocket.close).toHaveBeenCalledWith(4401, 'session-expired');
  });

  it('复验异常 fail-open：单次 DB 抖动不关；连续 5 次（≈5min）仍关', async () => {
    vi.stubEnv('COLLAB_SWEEP_ENABLED', 'true');
    const { gateway, prisma } = buildGateway();
    prisma.session.findUnique.mockRejectedValue(new Error('connection terminated'));
    const conn = makeConn('project:p1');
    seedDocument(gateway, 'project:p1', [conn]);
    gatewayFacade(gateway).stubSweepInterval(() => 60_000);   // Y0b-3 T8 jitter：固定间隔隔离本用例时序算术（5min±20% 节奏由 perm-events spec 覆盖）
    gateway.sessionGuard.startSessionSweep();

    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(conn.webSocket.close).not.toHaveBeenCalled();   // fail-open：无界放行=安全债没真修的对立面
    }
    await vi.advanceTimersByTimeAsync(60_000);   // 第 5 次连续复验失败 → 仍关
    await vi.advanceTimersByTimeAsync(5_000);     // grace
    expect(conn.webSocket.close).toHaveBeenCalledWith(4401, 'session-expired');
  });

  it('复验成功后失败计数复位（4 次失败+1 次成功+1 次失败 → 不关）', async () => {
    vi.stubEnv('COLLAB_SWEEP_ENABLED', 'true');
    const { gateway, prisma } = buildGateway();
    const conn = makeConn('project:p1');
    seedDocument(gateway, 'project:p1', [conn]);
    gatewayFacade(gateway).stubSweepInterval(() => 60_000);   // Y0b-3 T8 jitter：固定间隔隔离本用例时序算术（5min±20% 节奏由 perm-events spec 覆盖）
    gateway.sessionGuard.startSessionSweep();

    prisma.session.findUnique.mockRejectedValue(new Error('flap'));
    for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(60_000);   // 4 连败
    prisma.session.findUnique.mockResolvedValue({ user: { id: 'u1' }, userId: 'u1', expiresAt: new Date(Date.now() + 24 * 3600 * 1000) });
    await vi.advanceTimersByTimeAsync(60_000);   // 成功 → 复位（但快照还是过期死线→刷新为新值）
    prisma.session.findUnique.mockRejectedValue(new Error('flap again'));
    await vi.advanceTimersByTimeAsync(60_000);   // 失败 1 次
    await vi.advanceTimersByTimeAsync(5_000);
    expect(conn.webSocket.close).not.toHaveBeenCalled();   // 复位后从头数，不累计旧账
  });

  it('原生 setTimeout 自排链 + unref（源码断言——禁 @Cron/@Interval 死代码形态，R28；Y0b-3 T8 起 setTimeout 链承载 jitter 间隔逐轮重排）', () => {
    const src = readFileSync(resolve(__dirname, 'collab-session-guard.service.ts'), 'utf8');   // T41 W3b 锚随迁（§8.3-3/偏离 70③）：startSessionSweep setTimeout 自排链随域迁 SG——readFileSync 宿主切换，断言逐字保留
    expect(src).toMatch(/sessionSweepTimer\s*=\s*setTimeout/);
    expect(src).toMatch(/sessionSweepTimer\.unref/);
    expect(src).toMatch(/sweepIntervalMs\(\)/);
  });
});

describe('批3-4 closeTeamDocuments 补 webSocket.close', () => {
  it('解散：库 closeConnections 之外逐连接补 webSocket.close（先复制后关——库路径 removeConnection 后不漏）', () => {
    const { gateway } = buildGateway();
    const c1 = makeConn('project:p1');
    const c2 = makeConn('project:p1');
    const connections = seedDocument(gateway, 'project:p1', [c1, c2]);
    // 模拟库行为：closeConnections → Connection.close → removeConnection（活 Map 删键——不先复制则漏关）
    (gateway.server.hocuspocus as any).closeConnections = vi.fn((name?: string) => {
      for (const [conn] of [...connections]) {
        if (name && conn.document.name !== name) continue;
        connections.delete(conn as any);
      }
    });

    gateway.sessionGuard.closeTeamDocuments(['p1']);

    expect(gateway.server.hocuspocus.closeConnections).toHaveBeenCalledWith('project:p1');
    expect(c1.webSocket.close).toHaveBeenCalled();
    expect(c2.webSocket.close).toHaveBeenCalled();   // 连接已被库路径移出 Map 仍被关——复制快照生效
  });

  it('单个 webSocket.close 抛错各自吞（F11）——其余连接仍关、不抛出', () => {
    const { gateway } = buildGateway();
    const c1 = makeConn('project:p1');
    c1.webSocket.close.mockImplementation(() => { throw new Error('already closed'); });
    const c2 = makeConn('project:p1');
    seedDocument(gateway, 'project:p1', [c1, c2]);
    expect(() => gateway.sessionGuard.closeTeamDocuments(['p1'])).not.toThrow();
    expect(c2.webSocket.close).toHaveBeenCalled();
  });

  it('Y0b-3 T6 键控清理：解散清该 doc 全部连接的 connEstablishedAt 条目（防无界——他 doc 条目保留）', () => {
    const { gateway } = buildGateway();
    const c1 = makeConn('project:p1', { socketId: 'sock-d1' });
    const c2 = makeConn('project:p1', { socketId: 'sock-d2' });
    seedDocument(gateway, 'project:p1', [c1, c2]);
    const gf = gatewayFacade(gateway);
    gf.seedConnEstablishedAt('sock-d1', Date.now());
    gf.seedConnEstablishedAt('sock-d2', Date.now());
    gf.seedConnEstablishedAt('sock-other-doc', Date.now());
    gateway.sessionGuard.closeTeamDocuments(['p1']);
    expect(gf.connEstablishedAtHas('sock-d1')).toBe(false);
    expect(gf.connEstablishedAtHas('sock-d2')).toBe(false);
    expect(gf.connEstablishedAtHas('sock-other-doc')).toBe(true);
  });
});

describe('Y0b-3 T6 连接寿命 4402（socketId 键控——sweep tick 同一脉冲首部）', () => {
  it('连接超 COLLAB_CONN_MAX_LIFETIME_MS（默认 12h）→ webSocket.close(4402,"max-lifetime")（P7：connection.close 丢 code——统一 webSocket.close）+ws_close 计数单点埋', async () => {
    delete process.env.COLLAB_CONN_MAX_LIFETIME_MS;   // 缺省=12h（默认值落使用点——T1 形态）
    const { gateway } = buildGateway();
    const conn = makeConn('project:aged', { socketId: 'sock-aged', expiresAt: new Date(Date.now() + 24 * 3600 * 1000) });   // 快照未过期——隔离 session-expiry 支（本用例只看寿命腿）
    seedDocument(gateway, 'project:aged', [conn]);
    gateway.hooks.connected({ socketId: 'sock-aged', documentName: 'project:aged' } as any);   // connected 播种 connEstablishedAt
    gatewayFacade(gateway).stubSweepInterval(() => 60_000);   // Y0b-3 T8 jitter：固定间隔隔离本用例时序算术（5min±20% 节奏由 perm-events spec 覆盖）
    gateway.sessionGuard.startSessionSweep();
    // 设计注释（算术）：sweep tick=60s，12h=720 tick。先推 718 tick（12h−120s）停在死线前——
    // 每步都未越线（判据 12h−120s+i×60s>12h 恒 false），断言零 close；再推 180s（3 tick）必越线，
    // 越线后的首个 tick 关（4402）。两段式=把"死线前零误关"与"越线必关"拆成独立断言。
    await vi.advanceTimersByTimeAsync(12 * 3600_000 - 120_000);   // 未到期：不关
    expect(conn.webSocket.close).not.toHaveBeenCalled();
    const inc = await metricDelta('collab_ws_close_total', { code: '4402', reason: 'max-lifetime' }, async () => {
      await vi.advanceTimersByTimeAsync(180_000);                 // 越线（12h）后的首个 tick：4402 关
    });
    expect(conn.webSocket.close).toHaveBeenCalledTimes(1);
    expect(conn.webSocket.close).toHaveBeenCalledWith(CollabCloseCode.MAX_LIFETIME, 'max-lifetime');
    expect(inc).toBe(1);
  });

  it('env 覆写：COLLAB_CONN_MAX_LIFETIME_MS=1000 → 越线后即关（env 单源——zod 注册键 T1）', async () => {
    vi.stubEnv('COLLAB_CONN_MAX_LIFETIME_MS', '1000');
    const { gateway } = buildGateway();
    const conn = makeConn('project:shortlived', { socketId: 'sock-short', expiresAt: new Date(Date.now() + 24 * 3600 * 1000) });
    seedDocument(gateway, 'project:shortlived', [conn]);
    gateway.hooks.connected({ socketId: 'sock-short', documentName: 'project:shortlived' } as any);
    gatewayFacade(gateway).stubSweepInterval(() => 60_000);   // Y0b-3 T8 jitter：固定间隔隔离本用例时序算术（5min±20% 节奏由 perm-events spec 覆盖）
    gateway.sessionGuard.startSessionSweep();
    // env=1000ms 时死线远小于 60s tick——首个 tick（60s）即已越线并 close（原注释"首 tick 未越线
    // 第二 tick 越线"与实际时序不符——勘正；推进 120s=跨越首个 tick 的裕量写法）
    await vi.advanceTimersByTimeAsync(120_000);
    expect(conn.webSocket.close).toHaveBeenCalledWith(CollabCloseCode.MAX_LIFETIME, 'max-lifetime');
  });

  it('键控清理：断连即删 Map 条目（防无界）——清理在 early-return 之前执行（多标签 clientsCount>0 不跳清理）', async () => {
    const { gateway } = buildGateway();
    const a = makeConn('project:multi', { socketId: 'sock-multi-a' });
    const b = makeConn('project:multi', { socketId: 'sock-multi-b' });
    const connections = seedDocument(gateway, 'project:multi', [a, b]);
    const gf = gatewayFacade(gateway);
    gf.seedConnEstablishedAt('sock-multi-a', Date.now());
    gf.seedConnEstablishedAt('sock-multi-b', Date.now());
    gf.seedAuthAttemptBucket('sock-multi-a', { count: 1, windowStart: Date.now() });   // 防线桶同批清
    connections.delete(a);   // 模拟库行为：Connection.close 先 removeConnection 再触发 onDisconnect（esm:420-421）——a 已出 Map
    await gateway.hooks.onDisconnect({
      document: { name: 'project:multi', connections, getConnectionsCount: () => connections.size },
      documentName: 'project:multi', socketId: 'sock-multi-a', clientsCount: 1,   // >0=多标签 early-return 路径——清理必须先于它
    } as any);
    expect(gf.connEstablishedAtHas('sock-multi-a')).toBe(false);   // 断连者条目已删（现状红：Map 不存在/清理在早退之后）
    expect(gf.connEstablishedAtHas('sock-multi-b')).toBe(true);    // 仍在连者不受扰
    expect(gf.authAttemptBucketHas('sock-multi-a')).toBe(false);
  });

  it('键控清理：卸载（beforeUnloadDocument）清该 doc 全部连接条目——payload.document 反查', async () => {
    const { gateway } = buildGateway();
    const c1 = makeConn('project:p1', { socketId: 'sock-u1' });
    const connections = seedDocument(gateway, 'project:p1', [c1]);
    const gf = gatewayFacade(gateway);
    gf.seedConnEstablishedAt('sock-u1', Date.now());
    await gateway.hooks.beforeUnloadDocument({ documentName: 'project:p1', document: { name: 'project:p1', connections } } as any);
    expect(gf.connEstablishedAtHas('sock-u1')).toBe(false);
  });
});
