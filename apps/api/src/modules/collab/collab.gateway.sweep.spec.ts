// apps/api/src/modules/collab/collab.gateway.sweep.spec.ts
// 批3-4：session-expiry sweep（灰度默认关）+ closeTeamDocuments 补 webSocket.close。
// 形态：直构单元组（shutdown spec 先例——mock prisma，不 listen），fake timers 驱动 60s tick 与 5s grace；
// 连接用 fake（context 快照 + sendStateless + webSocket.close），文档塞 server.hocuspocus.documents。
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CollabGateway } from './collab.gateway';
import { CollabSpoolService } from './collab-spool.service';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';

// Y0a-2：gateway 构造签名扩必填 spool——本 spec 临时目录域（beforeEach 建/afterEach 清）
let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};

function buildGateway() {
  const prisma = {
    session: {
      findUnique: vi.fn().mockResolvedValue({ user: { id: 'u1', name: '张三' }, userId: 'u1', expiresAt: new Date(Date.now() + 24 * 3600 * 1000) }),
    },
    canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1' }) },
    teamMember: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER', userId: 'u1' }) },
    canvasDoc: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  const repo = createMockRepo();   // Y0a-1：mock-repo 工厂（loadUpdates 已删）
  const lease = createLeaseStub();   // Y0a-3 T5：redisSync 退役——租约 stub（isServing 恒 true）
  const perm = { resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR') };
  const gateway = new CollabGateway(
    prisma as any, new EventEmitter2() as any, repo as any, lease as any,
    perm as any, 47000 + Math.floor(Math.random() * 5000),
    undefined, undefined, undefined, new CollabSpoolService(spoolDir),
  );
  return { gateway, prisma };
}

interface FakeConn {
  context: { token?: string; sessionExpiresAt?: Date };
  sendStateless: ReturnType<typeof vi.fn>;
  webSocket: { close: ReturnType<typeof vi.fn> };
  document: { name: string };
}

function makeConn(name: string, overrides: { expiresAt?: Date } = {}): FakeConn {
  return {
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
  it('灰度锚：COLLAB_SWEEP_ENABLED 默认关 → 关=零行为差异（不 close、不发通知、零 DB 查询）', async () => {
    vi.stubEnv('COLLAB_SWEEP_ENABLED', '');   // 缺省形态（未设置/空串均视为关）
    const { gateway, prisma } = buildGateway();
    const conn = makeConn('project:p1');
    seedDocument(gateway, 'project:p1', [conn]);
    (gateway as any).startSessionSweep();
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
    (gateway as any).startSessionSweep();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(conn.sendStateless).toHaveBeenCalledTimes(1);
    expect(conn.sendStateless).toHaveBeenCalledWith(JSON.stringify({ type: 'session-expiring' }));
    expect(conn.webSocket.close).not.toHaveBeenCalled();   // grace 窗口内不关

    await vi.advanceTimersByTimeAsync(5_000);
    expect(conn.webSocket.close).toHaveBeenCalledWith(4401, 'session-expired');
  });

  it('快照未过期 → 跳过（零 DB 查询——快照是第一道闸）', async () => {
    vi.stubEnv('COLLAB_SWEEP_ENABLED', 'true');
    const { gateway, prisma } = buildGateway();
    const conn = makeConn('project:p1', { expiresAt: new Date(Date.now() + 3600_000) });
    seedDocument(gateway, 'project:p1', [conn]);
    (gateway as any).startSessionSweep();
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
    (gateway as any).startSessionSweep();

    await vi.advanceTimersByTimeAsync(65_000);
    expect(conn.webSocket.close).not.toHaveBeenCalled();
    expect(conn.context.sessionExpiresAt).toEqual(renewed);   // 快照刷新：下轮按新死线
    await vi.advanceTimersByTimeAsync(120_000);
    expect(prisma.session.findUnique).toHaveBeenCalledTimes(1);   // 快照刷新后不再复验
    expect(conn.webSocket.close).not.toHaveBeenCalled();
  });

  it('移除成员也踢：session 有效但 teamMember 无 → 通知+grace+close', async () => {
    vi.stubEnv('COLLAB_SWEEP_ENABLED', 'true');
    const { gateway, prisma } = buildGateway();
    prisma.teamMember.findUnique.mockResolvedValue(null);   // 个体被移除（能力 latch 债顺手关）
    const conn = makeConn('project:p1');
    seedDocument(gateway, 'project:p1', [conn]);
    (gateway as any).startSessionSweep();
    await vi.advanceTimersByTimeAsync(65_000);
    expect(conn.webSocket.close).toHaveBeenCalledWith(4401, 'session-expired');
  });

  it('复验异常 fail-open：单次 DB 抖动不关；连续 5 次（≈5min）仍关', async () => {
    vi.stubEnv('COLLAB_SWEEP_ENABLED', 'true');
    const { gateway, prisma } = buildGateway();
    prisma.session.findUnique.mockRejectedValue(new Error('connection terminated'));
    const conn = makeConn('project:p1');
    seedDocument(gateway, 'project:p1', [conn]);
    (gateway as any).startSessionSweep();

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
    (gateway as any).startSessionSweep();

    prisma.session.findUnique.mockRejectedValue(new Error('flap'));
    for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(60_000);   // 4 连败
    prisma.session.findUnique.mockResolvedValue({ user: { id: 'u1' }, userId: 'u1', expiresAt: new Date(Date.now() + 24 * 3600 * 1000) });
    await vi.advanceTimersByTimeAsync(60_000);   // 成功 → 复位（但快照还是过期死线→刷新为新值）
    prisma.session.findUnique.mockRejectedValue(new Error('flap again'));
    await vi.advanceTimersByTimeAsync(60_000);   // 失败 1 次
    await vi.advanceTimersByTimeAsync(5_000);
    expect(conn.webSocket.close).not.toHaveBeenCalled();   // 复位后从头数，不累计旧账
  });

  it('原生 setInterval + unref（源码断言——禁 @Cron/@Interval 死代码形态，R28）', () => {
    const src = readFileSync(resolve(__dirname, 'collab.gateway.ts'), 'utf8');
    expect(src).toMatch(/sessionSweepTimer\s*=\s*setInterval/);
    expect(src).toMatch(/sessionSweepTimer\.unref/);
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

    gateway.closeTeamDocuments(['p1']);

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
    expect(() => gateway.closeTeamDocuments(['p1'])).not.toThrow();
    expect(c2.webSocket.close).toHaveBeenCalled();
  });
});
