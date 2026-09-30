// apps/api/src/modules/collab/collab.gateway.persist-status.spec.ts
// 批3-4：persist-status 电平 + 有界退避重试（doc 级 + stash projectId 级两阶段）+ 新连接补推
// + doc epoch 字段（R1c 前置物）+ canvas_doc 大小 gauge。
// 形态：直构 + 真 Document（@hocuspocus/server 导出——broadcastStateless/connections 真形状），
// fake timers 驱动退避梯（1s/2s/5s/15s/30s，5 次≈53s）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Document } from '@hocuspocus/server';
import { register } from 'prom-client';
import * as Y from 'yjs';
import { CollabGateway } from './collab.gateway';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function buildGateway() {
  const prisma = {
    session: {
      findUnique: vi.fn().mockResolvedValue({ user: { id: 'u1', name: '张三' }, userId: 'u1', expiresAt: new Date(Date.now() + 24 * 3600 * 1000) }),
      update: vi.fn(async (args: any) => ({ user: { id: 'u1', name: '张三' }, userId: 'u1', expiresAt: args.data.expiresAt })),
    },
    canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1' }) },
    teamMember: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER', userId: 'u1' }) },
    canvasDoc: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  const appends: Uint8Array[] = [];
  const repo = {
    append: vi.fn(async (_pid: string, u: Uint8Array) => { appends.push(new Uint8Array(u)); }),
    loadUpdates: vi.fn().mockResolvedValue([]),
    compact: vi.fn().mockResolvedValue(undefined),
  };
  const redisSync = { syncFromPeers: vi.fn(async () => {}) };
  const gateway = new CollabGateway(
    prisma as any, new EventEmitter2() as any, repo as any, redisSync as any,
    { resolve: vi.fn() } as any, 44500 + Math.floor(Math.random() * 2000),
  );
  return { gateway, repo, appends };
}

function registerDoc(gateway: CollabGateway, name: string): Document {
  const doc = new Document(name);
  (gateway.server.hocuspocus.documents as Map<string, any>).set(name, doc);
  return doc;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('批3-4 persist-status 电平 + 退避重试', () => {
  it('append 失败 → broadcastStateless(healthy:false) + 1s 后重试成功 → broadcastStateless(healthy:true)、电平清除', async () => {
    const { gateway, repo } = buildGateway();
    const doc = registerDoc(gateway, 'project:p1');
    const bcSpy = vi.spyOn(doc, 'broadcastStateless').mockImplementation(() => {});
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);
    doc.getMap('nodes').set('n1', 1);
    repo.append.mockRejectedValueOnce(new Error('db down'));

    await expect(gateway.hooks.onStoreDocument({ document: doc as any, documentName: 'project:p1' } as any))
      .rejects.toThrow('db down');
    expect(bcSpy).toHaveBeenCalledWith(JSON.stringify({ type: 'persist-status', healthy: false }));
    expect((gateway as any).persistUnhealthy.has('project:p1')).toBe(true);

    await vi.advanceTimersByTimeAsync(1_000);   // 1s 后第一档重试
    expect(repo.append).toHaveBeenCalledTimes(2);   // 失败 1 + 重试成功 1
    expect(bcSpy).toHaveBeenCalledWith(JSON.stringify({ type: 'persist-status', healthy: true }));
    expect((gateway as any).persistUnhealthy.has('project:p1')).toBe(false);
    expect((gateway as any).persistRetry.get('project:p1')).toBeUndefined();
  });

  it('梯子有界：持续失败恰重试 5 次（1s/2s/5s/15s/30s ≈53s）后耗尽——数据留队等下次 load 回灌', async () => {
    const { gateway, repo } = buildGateway();
    const doc = registerDoc(gateway, 'project:p1');
    vi.spyOn(doc, 'broadcastStateless').mockImplementation(() => {});
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);
    doc.getMap('nodes').set('n1', 1);
    repo.append.mockRejectedValue(new Error('db down'));

    await gateway.hooks.onStoreDocument({ document: doc as any, documentName: 'project:p1' } as any).catch(() => {});
    for (const delay of [1_000, 2_000, 5_000, 15_000, 30_000]) {
      await vi.advanceTimersByTimeAsync(delay);
      repo.append.mockClear();
    }
    expect(repo.append).not.toHaveBeenCalled();   // 第 5 档已耗尽：无第 6 个定时器
    expect((gateway as any).pendingUpdates.get(doc as any)).toHaveLength(1);   // 数据仍留活队列
  });

  it('持续失败不刷屏：退避梯多级推进（1+5 次失败）→ unhealthy 广播恰 1 次（电平翻转才广播）', async () => {
    const { gateway, repo } = buildGateway();
    const doc = registerDoc(gateway, 'project:p1');
    const bcSpy = vi.spyOn(doc, 'broadcastStateless').mockImplementation(() => {});
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);
    doc.getMap('nodes').set('n1', 1);
    repo.append.mockRejectedValue(new Error('db down'));

    await gateway.hooks.onStoreDocument({ document: doc as any, documentName: 'project:p1' } as any).catch(() => {});
    for (const delay of [1_000, 2_000, 5_000, 15_000, 30_000]) {
      await vi.advanceTimersByTimeAsync(delay);
    }
    const unhealthy = JSON.stringify({ type: 'persist-status', healthy: false });
    const unhealthyCalls = bcSpy.mock.calls.filter(([payload]) => payload === unhealthy);
    expect(unhealthyCalls).toHaveLength(1);   // 首次失败翻转电平广播 1 次；5 档重试全失败不再广播
    expect((gateway as any).persistUnhealthy.has('project:p1')).toBe(true);   // 电平保持 unhealthy
  });

  it('两阶段·stash 级：doc 已不在内存（卸载）→ 重试直写 repo.append(stash)，unflushed 清空', async () => {
    const { gateway, repo } = buildGateway();
    // 不 registerDoc——doc 不在 server.documents（卸载形态）
    const doc: any = new Y.Doc(); doc.getConnectionsCount = () => 0;
    await gateway.hooks.onLoadDocument({ document: doc, documentName: 'project:p1' } as any);
    doc.getMap('nodes').set('n1', 1);
    repo.append.mockRejectedValueOnce(new Error('db down'));
    await gateway.hooks.onDisconnect({ document: doc, documentName: 'project:p1' } as any);   // flush 失败 → stash
    expect((gateway as any).unflushed.get('p1')).toBeTruthy();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(repo.append).toHaveBeenCalledTimes(2);   // stash 直写（projectId 级二阶段）
    expect((gateway as any).unflushed.has('p1')).toBe(false);
  });

  it('成功转折由有机 store 也能关闭：用户继续编辑触发的 store 成功 → 定时器撤销 + healthy 广播', async () => {
    const { gateway, repo } = buildGateway();
    const doc = registerDoc(gateway, 'project:p1');
    const bcSpy = vi.spyOn(doc, 'broadcastStateless').mockImplementation(() => {});
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);
    doc.getMap('nodes').set('n1', 1);
    repo.append.mockRejectedValueOnce(new Error('db down'));
    await gateway.hooks.onStoreDocument({ document: doc as any, documentName: 'project:p1' } as any).catch(() => {});
    expect((gateway as any).persistRetry.has('project:p1')).toBe(true);

    doc.getMap('nodes').set('n2', 2);
    await gateway.hooks.onStoreDocument({ document: doc as any, documentName: 'project:p1' } as any);   // 有机重试成功
    expect((gateway as any).persistRetry.has('project:p1')).toBe(false);   // 定时器撤销
    expect(bcSpy).toHaveBeenCalledWith(JSON.stringify({ type: 'persist-status', healthy: true }));

    await vi.advanceTimersByTimeAsync(60_000);
    expect(repo.append).toHaveBeenCalledTimes(2);   // 撤销后无额外定时器触发
  });

  it('新连接补推：unhealthy 电平期新鉴权连接收到 sendStateless(persist-status healthy:false)', async () => {
    const { gateway, repo } = buildGateway();
    const doc = registerDoc(gateway, 'project:p1');
    vi.spyOn(doc, 'broadcastStateless').mockImplementation(() => {});
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);
    doc.getMap('nodes').set('n1', 1);
    repo.append.mockRejectedValue(new Error('db down'));
    await gateway.hooks.onStoreDocument({ document: doc as any, documentName: 'project:p1' } as any).catch(() => {});   // → unhealthy（此时无连接，广播零对象）

    repo.append.mockResolvedValue(undefined);
    // unhealthy 电平期一条新连接进入（真 Document 的 flush/broadcast 读写 messageAddress/send——fake 补齐库形状）
    const conn = { messageAddress: 'project:p1', send: vi.fn(), sendStateless: vi.fn(), webSocket: { close: vi.fn() } };
    (doc.connections as Map<any, any>).set(conn, { clients: new Set() });
    await gateway.hooks.onAuthenticate({
      requestParameters: new URLSearchParams('token=tok'),
      requestHeaders: new Headers(),
      documentName: 'project:p1',
      connectionConfig: { readOnly: false, isAuthenticated: false },
    } as any);
    await vi.advanceTimersByTimeAsync(600);
    expect(conn.sendStateless).toHaveBeenCalledWith(JSON.stringify({ type: 'persist-status', healthy: false }));
  });

  it('shutdown 清：退避定时器随 onApplicationShutdown 撤销', async () => {
    const { gateway, repo } = buildGateway();
    vi.spyOn(gateway.server, 'destroy').mockResolvedValue(undefined as any);
    const doc = registerDoc(gateway, 'project:p1');
    vi.spyOn(doc, 'broadcastStateless').mockImplementation(() => {});
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);
    doc.getMap('nodes').set('n1', 1);
    repo.append.mockRejectedValue(new Error('db down'));
    await gateway.hooks.onStoreDocument({ document: doc as any, documentName: 'project:p1' } as any).catch(() => {});

    await gateway.onApplicationShutdown();
    const calls = repo.append.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(repo.append.mock.calls.length).toBe(calls);   // 无重试触发
  });
});

describe('批3-4 doc epoch + canvas_doc gauge', () => {
  it('onLoadDocument 播种 doc epoch（服务端 WeakMap——不写 ydoc meta、不进 pending，零写放大与重放等价契约不破）', async () => {
    const { gateway } = buildGateway();
    const doc = registerDoc(gateway, 'project:p1');
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);
    const epoch = (gateway as any).docEpoch.get(doc as any);
    expect(typeof epoch).toBe('number');
    expect((gateway as any).pendingUpdates.get(doc as any)).toHaveLength(0);
    expect(doc.getMap('meta').size).toBe(0);   // 不污染 doc 状态（canonical 重放等价的前提）
    // 重入不换代（同 doc 实例恒定代际）
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);
    expect((gateway as any).docEpoch.get(doc as any)).toBe(epoch);
  });

  it('canvas_doc 大小 gauge：load 播种快照字节 + append 增量累加', async () => {
    const { gateway, repo } = buildGateway();
    const snapDoc = new Y.Doc(); snapDoc.getMap('nodes').set('a', 1);
    const snap = Buffer.from(Y.encodeStateAsUpdate(snapDoc));
    (gateway as any).prisma.canvasDoc.findUnique.mockResolvedValue({ projectId: 'p1', state: snap });
    const doc = registerDoc(gateway, 'project:p1');
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);

    // prom-client Gauge.get() 在带 label 时不回值——经 register JSON 读（本文件独占 register 实例）
    const gaugeValue = async () => {
      const metrics = await register.getMetricsAsJSON();
      return (metrics.find((m: any) => m.name === 'yjs_canvas_doc_bytes')?.values ?? [])
        .find((v: any) => v.labels?.projectId === 'p1')?.value;
    };
    expect(await gaugeValue()).toBe(snap.length);

    doc.getMap('nodes').set('b', 2);
    await gateway.hooks.onStoreDocument({ document: doc as any, documentName: 'project:p1' } as any);
    const payload = repo.append.mock.calls[0][1] as Uint8Array;
    expect(await gaugeValue()).toBe(snap.length + payload.byteLength);
  });
});
