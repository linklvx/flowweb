// apps/api/src/modules/collab/collab.gateway.shutdown.spec.ts
// 批3-2：shutdown 有界化 + close(1012) + stopOnSignals。
// 形态：直构（shadow-sweep spec 先例——mock prisma/repo/redisSync，不调 onModuleInit 不 listen）。
// 背景：库默认 stopOnSignals:true 在 listen() 注册信号 handler → destroy 后 process.exit(0)
// 抢跑 Nest drain 链（hocuspocus-server.esm.js:1684-1690）；destroy 无界——ioredis 等保活
// 句柄使进程退不出 → pm2 SIGKILL → stash 丢。
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CollabGateway } from './collab.gateway';
import { CollabSpoolService } from './collab-spool.service';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';

// Y0a-2：gateway 构造签名扩必填 spool——本 spec 临时目录域（beforeEach 建/afterEach 清）
let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};
beforeEach(async () => {
  const d = await makeSpoolDir('y0a2-shutdown-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
});
afterEach(async () => { await spoolCleanup(); });

function buildGateway() {
  const prisma = { canvasDoc: { findUnique: vi.fn().mockResolvedValue(null) } };
  const repo = createMockRepo();   // Y0a-1：mock-repo 工厂（loadUpdates 已删）
  const redisSync = { syncFromPeers: vi.fn(async () => {}) };
  const gateway = new CollabGateway(
    prisma as any, new EventEmitter2() as any, repo as any, redisSync as any,
    { resolve: vi.fn() } as any, 43000 + Math.floor(Math.random() * 20000),
    undefined, undefined, undefined, new CollabSpoolService(spoolDir),
  );
  return { gateway };
}

interface FakeConn { webSocket: { close: ReturnType<typeof vi.fn> } }

/** 向 server.hocuspocus.documents 塞 fake doc（connections: Map<Conn, {clients}>——@hocuspocus/server Document 形状） */
function seedDocument(gateway: CollabGateway, name: string, conns: FakeConn[]) {
  const connections = new Map(conns.map((c) => [c, { clients: new Set() }]));
  (gateway.server.hocuspocus.documents as Map<string, any>).set(name, { name, connections });
  return connections;
}

describe('批3-2 stopOnSignals', () => {
  it('Server 构造显式 stopOnSignals:false——禁库信号 handler 的 process.exit(0) 抢跑 Nest drain 链', () => {
    const { gateway } = buildGateway();
    expect((gateway.server.configuration as any).stopOnSignals).toBe(false);
  });
});

describe('批3-2 关停前 close(1012)', () => {
  it('对存活连接 close(1012, "service restart")，先于 destroy 调用', async () => {
    const { gateway } = buildGateway();
    const c1 = { webSocket: { close: vi.fn() } };
    const c2 = { webSocket: { close: vi.fn() } };
    seedDocument(gateway, 'project:p1', [c1]);
    seedDocument(gateway, 'project:p2', [c2]);
    const destroySpy = vi.spyOn(gateway.server, 'destroy').mockResolvedValue(undefined as any);
    await gateway.onApplicationShutdown();
    expect(c1.webSocket.close).toHaveBeenCalledWith(1012, 'service restart');
    expect(c2.webSocket.close).toHaveBeenCalledWith(1012, 'service restart');
    expect((c1.webSocket.close as any).mock.invocationCallOrder[0]).toBeLessThan((destroySpy as any).mock.invocationCallOrder[0]);
  });

  it('遍历副本（先复制后关）——close 回调中途删除未访问连接不漏关', async () => {
    const { gateway } = buildGateway();
    const c1 = { webSocket: { close: vi.fn() } };
    const c2 = { webSocket: { close: vi.fn() } };
    const connections = seedDocument(gateway, 'project:p1', [c1, c2]);
    // c1.close 删未访问的 c2：活 Map 迭代下 c2 漏关；快照迭代两连全关
    c1.webSocket.close.mockImplementation(() => { connections.delete(c2 as any); });
    vi.spyOn(gateway.server, 'destroy').mockResolvedValue(undefined as any);
    await gateway.onApplicationShutdown();
    expect(c2.webSocket.close).toHaveBeenCalledWith(1012, 'service restart');
  });

  it('单个 close 抛错各自吞（F11）——其余连接仍关、shutdown 不挂', async () => {
    const { gateway } = buildGateway();
    const c1 = { webSocket: { close: vi.fn(() => { throw new Error('already closed'); }) } };
    const c2 = { webSocket: { close: vi.fn() } };
    seedDocument(gateway, 'project:p1', [c1, c2]);
    vi.spyOn(gateway.server, 'destroy').mockResolvedValue(undefined as any);
    await expect(gateway.onApplicationShutdown()).resolves.toBeUndefined();
    expect(c2.webSocket.close).toHaveBeenCalledWith(1012, 'service restart');
  });
});

describe('批3-2 destroy 8s 有界 race', () => {
  it('destroy 永挂 → 8s 超时后 onApplicationShutdown 返回不挂 + warn 点名内存 doc 数', async () => {
    vi.useFakeTimers();
    try {
      const { gateway } = buildGateway();
      seedDocument(gateway, 'project:p1', [{ webSocket: { close: vi.fn() } }]);
      seedDocument(gateway, 'project:p2', [{ webSocket: { close: vi.fn() } }]);
      vi.spyOn(gateway.server, 'destroy').mockImplementation(() => new Promise<any>(() => {}));
      const warnSpy = vi.spyOn((gateway as any).logger, 'warn').mockImplementation(() => {});
      const shutdown = gateway.onApplicationShutdown();
      let resolved = false;
      void shutdown.then(() => { resolved = true; });
      await vi.advanceTimersByTimeAsync(7999);
      expect(resolved).toBe(false);   // 未满 8s 不放行（race 上界存在性）
      await vi.advanceTimersByTimeAsync(1);
      await shutdown;                 // 超时分支 resolve——进程退出链不被 destroy 挂死
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('destroy'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('2'));   // 点名内存 doc 数
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroy 正常完成 → 不点名超时', async () => {
    const { gateway } = buildGateway();
    vi.spyOn(gateway.server, 'destroy').mockResolvedValue(undefined as any);
    const warnSpy = vi.spyOn((gateway as any).logger, 'warn').mockImplementation(() => {});
    await gateway.onApplicationShutdown();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
