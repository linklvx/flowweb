// apps/api/src/modules/collab/collab-perm-events.spec.ts
// Y0b-3 T8：sweep 收窄——节奏与事件。判据/降级/升回已在 T3 落地（collab.gateway.sweep.spec）——
// 本文件只测：节奏（5min±20% jitter，setTimeout 自排链）/事件驱动即时踢权（collab.perm.changed →
// permCache 失效 + scheduleImmediateSweep——单一执行路径 sweepSessions，sweep 5min 只是兜底）/
// awareness role 改写实接（★对端可见锚——clock 递增证据，禁只断言服务端 states：meta 未递增时
// 对端按 y-protocols 时钟门全丢弃而服务端自以为成功=假绿型）/emit 点接线（team.service 权限变更点）/
// T7 评审小修（awarenessDriftLogged 断连清理 + guardAwareness 兜底 catch 留痕）。
// 形态：直构单元组（sweep spec 同款——mock prisma+fake conn+fake timers）+真连装置
// （dual-client-server——对端可见性判官，禁 fake timers）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CollabGateway } from './collab.gateway';
import { CollabSpoolService } from './collab-spool.service';
import { TeamService } from '../team/team.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { startDualClientServer, type DualClientKit } from '../../test-utils/dual-client-server';
import { pollUntil } from '../../test-utils/poll-until';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { register } from 'prom-client';
import { CLIENT_PROTOCOL_VERSION } from '@flowweb/shared';

// ===== 直构单元组（collab.gateway.sweep.spec buildGateway 同款，暴露 emitter 供事件注入）=====
let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};

function buildGateway() {
  const prisma = {
    session: {
      findUnique: vi.fn().mockResolvedValue({ user: { id: 'u1', name: '张三' }, userId: 'u1', expiresAt: new Date(Date.now() + 24 * 3600 * 1000) }),
    },
    canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1' }) },
    projectMember: { findUnique: vi.fn().mockResolvedValue(null) },
    teamMember: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER', userId: 'u1' }) },
  };
  const repo = createMockRepo();
  const lease = createLeaseStub();
  const perm = {
    resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
    resolveWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' }),
  };
  const emitter = new EventEmitter2();
  const gateway = new CollabGateway(
    prisma as any, emitter as any, repo as any, lease as any,
    perm as any, 47000 + Math.floor(Math.random() * 5000),
    undefined, undefined, undefined, new CollabSpoolService(spoolDir),
  );
  return { gateway, prisma, perm, emitter };
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
    context: { token: 'tok', sessionExpiresAt: overrides.expiresAt ?? new Date(Date.now() + 3600_000) },   // 默认快照未过期——隔离 session-expiry 腿
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

/** prom-client 计数增量断言（collab.gateway.sweep.spec 同款——register 全局单例，恒用增量） */
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
  const d = await makeSpoolDir('y0b3-perm-events-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await spoolCleanup();
});

describe('Y0b-3 T8 sweep 节奏（5min±20% jitter）', () => {
  it('jitter±20%：sweepIntervalMs 连续 10 次采样 ∈ [4min, 6min]（不聚集脉冲——抽间隔函数区间断言）', () => {
    const { gateway } = buildGateway();
    const fn = (gateway as any).sweepIntervalMs.bind(gateway);   // 现状红：方法不存在
    for (let i = 0; i < 10; i++) {
      const ms = fn();
      expect(ms).toBeGreaterThanOrEqual(4 * 60_000);
      expect(ms).toBeLessThanOrEqual(6 * 60_000);
    }
  });

  it('源码锚：startSessionSweep 为 setTimeout 自排链（jitter 间隔逐轮重排——setInterval 固定周期无法表达）+unref 保持（R28 意图：禁 @Cron/@Interval 装饰器死代码）', () => {
    const { readFileSync } = require('node:fs');
    const { resolve } = require('node:path');
    const src = readFileSync(resolve(__dirname, 'collab.gateway.ts'), 'utf8');
    expect(src).toMatch(/sessionSweepTimer\s*=\s*setTimeout/);   // 现状红：仍是 setInterval
    expect(src).toMatch(/sessionSweepTimer\.unref/);
    expect(src).toMatch(/sweepIntervalMs\(\)/);
  });
});

describe('Y0b-3 T8 事件驱动即时踢权（collab.perm.changed）', () => {
  it('移出团队且无显式行→事件到达 setImmediate 冲洗后复验 no-role→通知+grace→close(4401,"session-expired")（≤1s 启动踢线流程——sweep 5min 只是兜底）', async () => {
    const { gateway, perm, emitter } = buildGateway();
    perm.resolveWithTeam.mockResolvedValue({ role: null, teamId: 't1' });   // 移出团队（无显式 ProjectMember 行）
    const conn = makeConn('project:p1');
    seedDocument(gateway, 'project:p1', [conn]);
    (gateway as any).socketIdentity.set(conn.socketId, { id: 'u1', name: '张三', role: 'PROJECT_EDITOR', teamId: 't1' });
    (gateway as any).wirePermChangedEvents();   // 现状红：方法不存在
    const inc = await metricDelta('collab_sweep_close_total', { cause: 'revoked' }, async () => {
      emitter.emit('collab.perm.changed', { userId: 'u1', teamId: 't1' });
      await vi.advanceTimersByTimeAsync(1);      // setImmediate 冲洗——scheduleImmediateSweep → sweepSessions 复验
      expect(conn.sendStateless).toHaveBeenCalledWith(JSON.stringify({ type: 'session-expiring' }));   // ≤1 tick 即通知（事件即时性锚）
      await vi.advanceTimersByTimeAsync(5_000);  // grace
    });
    expect(conn.webSocket.close).toHaveBeenCalledWith(4401, 'session-expired');
    expect(inc).toBe(1);
  });

  it('事件不匹配（userId 或 teamId 不对）→零动作：不删缓存、复验零 DB（连接跳过）、零通知零 close', async () => {
    const { gateway, prisma, emitter } = buildGateway();
    const conn = makeConn('project:p1');
    seedDocument(gateway, 'project:p1', [conn]);
    (gateway as any).socketIdentity.set(conn.socketId, { id: 'u1', name: '张三', role: 'PROJECT_EDITOR', teamId: 't1' });
    (gateway as any).permCache.set(conn, { role: 'PROJECT_EDITOR', at: Date.now() });   // 缓存新鲜（未 due）
    (gateway as any).wirePermChangedEvents();
    emitter.emit('collab.perm.changed', { userId: 'other', teamId: 't1' });
    emitter.emit('collab.perm.changed', { userId: 'u1', teamId: 'other' });
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
    expect(conn.sendStateless).not.toHaveBeenCalled();
    expect(conn.webSocket.close).not.toHaveBeenCalled();
  });

  it('事件风暴合并：连续 3 次 emit → sweepSessions 恰执行一次（sweepKickPending 防惊群）；新事件再请求新一轮', async () => {
    const { gateway, emitter } = buildGateway();
    (gateway as any).wirePermChangedEvents();
    const spy = vi.spyOn(gateway as any, 'sweepSessions').mockResolvedValue(undefined);
    emitter.emit('collab.perm.changed', { userId: 'u1', teamId: 't1' });
    emitter.emit('collab.perm.changed', { userId: 'u1', teamId: 't1' });
    emitter.emit('collab.perm.changed', { userId: 'u1', teamId: 't1' });
    await vi.advanceTimersByTimeAsync(1);
    expect(spy).toHaveBeenCalledTimes(1);        // 现状红：wirePermChangedEvents 不存在
    emitter.emit('collab.perm.changed', { userId: 'u1', teamId: 't1' });
    await vi.advanceTimersByTimeAsync(1);
    expect(spy).toHaveBeenCalledTimes(2);        // 风暴后新事件=新一轮 tick
  });

  it('会话级结论缓存 5min：缓存命中轮零 DB；事件到达即清该用户缓存→立即复验（3×3 矩阵 cache-hit 行的事件失效）', async () => {
    const { gateway, prisma, emitter } = buildGateway();
    const conn = makeConn('project:p1');
    seedDocument(gateway, 'project:p1', [conn]);
    (gateway as any).socketIdentity.set(conn.socketId, { id: 'u1', name: '张三', role: 'PROJECT_EDITOR', teamId: 't1' });
    (gateway as any).wirePermChangedEvents();
    await (gateway as any).sweepSessions();      // tick1：首查复验 → permCache 写入
    const c1 = prisma.session.findUnique.mock.calls.length;
    expect(c1).toBeGreaterThan(0);
    await (gateway as any).sweepSessions();      // tick2：缓存命中（<5min）
    expect(prisma.session.findUnique.mock.calls.length).toBe(c1);   // 零 DB
    emitter.emit('collab.perm.changed', { userId: 'u1', teamId: 't1' });   // 事件=缓存失效信号
    await vi.advanceTimersByTimeAsync(1);
    expect(prisma.session.findUnique.mock.calls.length).toBeGreaterThan(c1);   // 立即复验（现状红：零 emit 面永不复验）
  });

  it("逃生阀覆盖事件腿：COLLAB_SWEEP_ENABLED='false' → 事件到达零踢（阀=session-expiry 回滚面，§4.2）", async () => {
    vi.stubEnv('COLLAB_SWEEP_ENABLED', 'false');
    const { gateway, emitter } = buildGateway();
    const conn = makeConn('project:p1');
    seedDocument(gateway, 'project:p1', [conn]);
    (gateway as any).socketIdentity.set(conn.socketId, { id: 'u1', name: '张三', role: 'PROJECT_EDITOR', teamId: 't1' });
    (gateway as any).wirePermChangedEvents();
    emitter.emit('collab.perm.changed', { userId: 'u1', teamId: 't1' });
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(conn.webSocket.close).not.toHaveBeenCalled();
    expect(conn.sendStateless).not.toHaveBeenCalled();
  });

  it('权限语义 A（int 两例之一）：移出团队但有显式 ProjectMember 行→resolveWithTeam 显式档放行（复验 revoked:false 不踢——REST 同链既有语义，预期行为非缺陷）', async () => {
    const { gateway, perm, emitter } = buildGateway();
    perm.resolveWithTeam.mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' });   // 显式行档
    const conn = makeConn('project:p1');
    seedDocument(gateway, 'project:p1', [conn]);
    (gateway as any).socketIdentity.set(conn.socketId, { id: 'u1', name: '张三', role: 'PROJECT_EDITOR', teamId: 't1' });
    (gateway as any).wirePermChangedEvents();
    emitter.emit('collab.perm.changed', { userId: 'u1', teamId: 't1' });
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(conn.webSocket.close).not.toHaveBeenCalled();   // 显式档放行：不踢
    expect(conn.readOnly).toBeUndefined();                 // 也无降级（EDITOR 保持可写）
  });

  it('socketIdentity 扩 teamId：authenticateInner 播种含 teamId（事件匹配依据——resolved.teamId 同批带出）', async () => {
    const { gateway } = buildGateway();
    (gateway as any).collabState = 'serving';   // 状态门放行（perm-chain spec 同款直构手法）
    await gateway.hooks.onAuthenticate({
      requestHeaders: new Headers({ cookie: 'flowweb.session_token=tok' }),
      requestParameters: new URLSearchParams(`csv=${CLIENT_PROTOCOL_VERSION}`),
      socketId: 'sock-team-1',
      documentName: 'project:p1',
      connectionConfig: { readOnly: false, isAuthenticated: false },
    } as any);
    expect((gateway as any).socketIdentity.get('sock-team-1')).toMatchObject({ id: 'u1', teamId: 't1' });   // 现状红：无 teamId 字段
  });
});

// ===== 真连装置（dual-client-server——对端可见性判官；禁 fake timers：ws 握手/帧 IO 需真事件循环）=====
const DOC = 'project:ap1';
const FUTURE = new Date(Date.now() + 24 * 3600 * 1000);

describe('Y0b-3 T8 对端可见锚（真连——awareness role 改写实接）', () => {
  let kit: DualClientKit;
  beforeEach(async () => {
    vi.useRealTimers();   // 文件级 fake timers 泄漏会卡死 ws IO/握手——真连装置必须真事件循环
    kit = await startDualClientServer({}, 300);
  });
  afterEach(async () => { await kit.dispose(); });

  it('复验降级的 awareness role 改写【★对端可见锚】：对端 awareness user.role=PROJECT_VIEWER（clock 递增的证据——meta 未递增时对端按时钟门全丢弃而服务端自以为成功=假绿型；服务端 states/readOnly 断言只作旁证）', async () => {
    kit.prisma.session.findUnique.mockImplementation(async ({ where: { token } }: any) =>
      token === 'tokB' ? { userId: 'u2', expiresAt: FUTURE, user: { id: 'u2', name: '李四' } }
        : token === 'tokA' ? { userId: 'u1', expiresAt: FUTURE, user: { id: 'u1', name: '张三' } } : null);
    kit.permSvc.resolveWithTeam.mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' });
    const { provider: editor, synced: s1 } = kit.connect(DOC, 'tokB');
    await s1;
    editor.setAwarenessField('cursor', { x: 1, y: 2 });   // 非空帧→服务端登记归属+对端可见
    const { provider: peer, synced: s2 } = kit.connect(DOC, 'tokA');   // 对端=可见性判官（真连）
    await s2;
    const editorClientId = (editor.awareness as any).clientID as number;
    await pollUntil(() => (peer.awareness.getStates().get(editorClientId) as any)?.user?.role === 'PROJECT_EDITOR');   // 基线：改写前对端见 EDITOR
    // DB 翻转：u2 → VIEWER（removeMember/降权后的复验结论）
    kit.permSvc.resolveWithTeam.mockImplementation(async (_pid: string, uid: string) =>
      ({ role: uid === 'u2' ? 'PROJECT_VIEWER' : 'PROJECT_EDITOR', teamId: 't1' }));
    // 人工老化 u2 连接的 permCache（T3 判据门 dueForPerm——免 fake timers 的等效驱动）
    const document = kit.gateway.server.hocuspocus.documents.get(DOC)!;
    const conn = [...document.connections.keys()].find((c: any) => c.context?.user?.id === 'u2')!;
    (kit.gateway as any).permCache.set(conn, { role: 'PROJECT_EDITOR', at: Date.now() - 6 * 60_000 });
    const inc = await metricDelta('collab_sweep_close_total', { cause: 'role-downgraded' }, async () => {
      await (kit.gateway as any).sweepSessions();
    });
    expect(inc).toBe(1);                                  // 降级计数（现状红：rewriteAwarenessRole 为 no-op——本断言仍绿，锚在对端）
    expect((conn as any).readOnly).toBe(true);            // 服务端旁证①：readOnly 置位
    expect((kit.gateway.server.hocuspocus.documents.get(DOC)!.awareness as any).states.get(editorClientId)?.user?.role).toBe('PROJECT_VIEWER');   // 服务端旁证②（禁只断言到这——假绿型）
    await pollUntil(() => (peer.awareness.getStates().get(editorClientId) as any)?.user?.role === 'PROJECT_VIEWER', 5_000, 20);   // ★对端可见值（clock 递增的证据）——现状红：no-op 改写对端恒 EDITOR
  });
});

describe('Y0b-3 T8 附带 T7 评审小修', () => {
  it('awarenessDriftLogged 断连清理：onDisconnect 首行清理段追加（漂移去重 Set 残留=socketId 级泄漏面）', async () => {
    const { gateway } = buildGateway();
    const connections = seedDocument(gateway, 'project:p1', []);
    (gateway as any).awarenessDriftLogged.add('sock-drift');   // 播种漂移去重条目
    await gateway.hooks.onDisconnect({
      document: { name: 'project:p1', connections, getConnectionsCount: () => connections.size },
      documentName: 'project:p1', socketId: 'sock-drift', clientsCount: 1,   // >0=多标签 early-return 路径——清理必须先于它
    } as any);
    expect((gateway as any).awarenessDriftLogged.has('sock-drift')).toBe(false);   // 现状红：三件套清理未含它
  });

  it('guardAwareness 兜底 catch 留痕：意外异常 logger.warn（catch 静默零观测——对齐 unloadDocument swallow 先例）', () => {
    const { gateway } = buildGateway();
    (gateway as any).socketIdentity.set('s1', { id: 'u1', name: '张三', role: 'PROJECT_EDITOR', teamId: 't1' });   // 过未认证提前 return——进 try 抛错路径
    const warnSpy = vi.spyOn((gateway as any).logger, 'warn').mockImplementation(() => {});
    (gateway as any).guardAwareness({ states: null, socketId: 's1', context: {}, connection: {}, document: { awareness: { states: new Map() } } } as any);   // [...null] 抛 TypeError 进 catch
    expect(warnSpy).toHaveBeenCalledTimes(1);   // 现状红：catch 块静默
    expect(() => (gateway as any).guardAwareness({ states: null } as any)).not.toThrow();   // 钩子禁抛契约维持
  });
});

// ===== emit 点接线（team.service 权限变更点——漏点=撤权盲区）=====
describe('Y0b-3 T8 emit 点接线（team.service）', () => {
  function buildTeamService() {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ name: '张三' }) },
      team: { findUnique: vi.fn().mockResolvedValue({ isDefault: false, id: 't1', status: 'ACTIVE' }), update: vi.fn().mockResolvedValue({ id: 't1' }) },
      teamMember: {
        findUnique: vi.fn().mockImplementation(async ({ where: { teamId_userId: { userId } } }: any) =>
          userId === 'caller' ? { role: 'OWNER', userId: 'caller' } : { role: 'MEMBER', userId }),
        delete: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(2),
      },
      $transaction: vi.fn(async (fn: any) => fn(prisma)),
    };
    const emitter = { emit: vi.fn(), emitAsync: vi.fn().mockResolvedValue(undefined) };
    const audit = { log: vi.fn(), logTx: vi.fn() };
    const ledger = { ledgerTx: vi.fn(async (r: any) => r), ensureBalance: vi.fn(), lockBalance: vi.fn(), mutate: vi.fn() };
    const service = new TeamService(
      prisma as any, emitter as any, { add: vi.fn() } as any,
      ledger as any, audit as any, { assertSettled: vi.fn() } as any, { derivedMonthlyUsedMap: vi.fn() } as any,
    );
    return { service, prisma, emitter };
  }

  it('removeMember → emit("collab.perm.changed", { userId, teamId })（撤权核心面）', async () => {
    const { service, emitter } = buildTeamService();
    await service.removeMember('t1', 'caller', 'u-target');
    expect(emitter.emit).toHaveBeenCalledWith('collab.perm.changed', { userId: 'u-target', teamId: 't1' });   // 现状红：零 emit
  });

  it('changeRole → emit（角色变更面——TeamRole 变更使 perm 链结论失效）', async () => {
    const { service, emitter } = buildTeamService();
    await service.changeRole('t1', 'caller', 'u-target', 'ADMIN');
    expect(emitter.emit).toHaveBeenCalledWith('collab.perm.changed', { userId: 'u-target', teamId: 't1' });   // 现状红：零 emit
  });

  it('transferOwnership → emit（原 OWNER 降 ADMIN=ProjectRole PROJECT_OWNER→PROJECT_EDITOR 降权面）', async () => {
    const { service, emitter } = buildTeamService();
    await service.transferOwnership('t1', 'caller', 'u-target');
    expect(emitter.emit).toHaveBeenCalledWith('collab.perm.changed', { userId: 'caller', teamId: 't1' });   // 现状红：零 emit（原 OWNER 被降权）
  });
});
