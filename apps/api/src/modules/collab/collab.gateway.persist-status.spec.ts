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
import { CollabSpoolService } from './collab-spool.service';
import { stampDocSchema, type DocLike, type DocMapLike } from '@flowweb/shared';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { pollUntil } from '../../test-utils/poll-until';

/** 测试内 Y.Doc→DocLike 适配（stampDocSchema 消费——v2 档快照夹具用） */
function toDocLike(doc: Y.Doc): DocLike {
  return {
    getMap: (name) => doc.getMap(name) as unknown as DocMapLike,
    createMap: () => new Y.Map() as unknown as DocMapLike,
  };
}

function buildGateway() {
  const prisma = {
    session: {
      findUnique: vi.fn().mockResolvedValue({ user: { id: 'u1', name: '张三' }, userId: 'u1', expiresAt: new Date(Date.now() + 24 * 3600 * 1000) }),
      update: vi.fn(async (args: any) => ({ user: { id: 'u1', name: '张三' }, userId: 'u1', expiresAt: args.data.expiresAt })),
    },
    canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1' }) },
    teamMember: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER', userId: 'u1' }) },
  };
  const appends: Uint8Array[] = [];
  // Y0a-1：repo stub 收敛 mock-repo 工厂（快照经 hydrateWithRecovery 喂——装载读唯一入口）
  const repo = createMockRepo({
    append: vi.fn(async (_pid: string, u: Uint8Array) => { appends.push(new Uint8Array(u)); return { ok: true as const, seq: 1n }; }),   // AppendResult 契约（Y0a-2 判别消费）
  });
  const redisSync = { syncFromPeers: vi.fn(async () => {}) };
  const spool = new CollabSpoolService(spoolDir);   // 同一实例注入 gateway——peek 才看得见 gateway 写入的帧
  const gateway = new CollabGateway(
    prisma as any, new EventEmitter2() as any, repo as any, redisSync as any,
    { resolve: vi.fn() } as any, 44500 + Math.floor(Math.random() * 2000),
    undefined, undefined, undefined, spool,
  );
  return { gateway, repo, appends, spool };
}

function registerDoc(gateway: CollabGateway, name: string): Document {
  const doc = new Document(name);
  (gateway.server.hocuspocus.documents as Map<string, any>).set(name, doc);
  return doc;
}

// Y0a-2：gateway 构造签名扩必填 spool——本 spec 临时目录域（beforeEach 建/afterEach 清）
let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};
beforeEach(async () => {
  vi.useFakeTimers();
  const d = await makeSpoolDir('y0a2-persist-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
});
afterEach(async () => {
  vi.useRealTimers();
  await spoolCleanup();
});

describe('批3-4 persist-status 电平 + 退避重试', () => {
  it('append 失败 → broadcastStateless(healthy:false) + 1s 后重试成功 → broadcastStateless(healthy:true)、电平清除', async () => {
    const { gateway, repo } = buildGateway();
    const doc = registerDoc(gateway, 'project:p1');
    const bcSpy = vi.spyOn(doc, 'broadcastStateless').mockImplementation(() => {});
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);
    doc.getMap('nodes').set('n1', 1);
    repo.append.mockRejectedValueOnce(new Error('db down'));

    await expect(gateway.hooks.onStoreDocument({ document: doc as any, documentName: 'project:p1' } as any))
      .resolves.toBe(false);   // Y0a-2 契约 3 反转：任何路径不 throw（旧断言 rejects.toThrow 必红点）
    expect(bcSpy).toHaveBeenCalledWith(JSON.stringify({ type: 'persist-status', healthy: false }));
    expect((gateway as any).persistUnhealthy.has('project:p1')).toBe(true);

    await vi.advanceTimersByTimeAsync(1_000);   // 1s 后第一档重试触发
    // Y0a-2：重试帧通道 peek/append/confirm 走真实 fs IO（异步于 fake timer 触发点）——真实窗口等其落定
    await vi.useRealTimers();
    await pollUntil(() => repo.append.mock.calls.length >= 2, 2_000);
    vi.useFakeTimers();
    expect(repo.append).toHaveBeenCalledTimes(2);   // 失败 1 + 重试成功 1
    expect(bcSpy).toHaveBeenCalledWith(JSON.stringify({ type: 'persist-status', healthy: true }));
    expect((gateway as any).persistUnhealthy.has('project:p1')).toBe(false);
    expect((gateway as any).persistRetry.get('project:p1')).toBeUndefined();
  });

  it('梯子有界：持续失败恰重试 5 次（1s/2s/5s/15s/30s ≈53s）后耗尽——数据留 spool 帧等下次 load 回灌', async () => {
    const { gateway, repo, spool } = buildGateway();
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
    expect(repo.append).not.toHaveBeenCalled();   // 第 5 档已耗尽：无第 6 个定时器（退避无上限改造随 Task 4——本批此断言不动）
    expect(await spool.peek('p1')).toHaveLength(1);   // Y0a-2：数据仍在 spool 帧（内存 unflushed 退役——清单 A peek 替换；:89 装置随 V4 换键）
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

  it('两阶段·detached：doc 已不在内存（卸载）→ 重试经 spool 帧通道直写 repo.append，帧回收', async () => {
    const { gateway, repo, spool } = buildGateway();
    // 不 registerDoc——doc 不在 server.documents（卸载形态）
    const doc = new Document('project:p1');   // Y0a-2：真 Document（disconnect 走 storeDocumentSerialized——saveMutex 需真锁载体）
    await gateway.hooks.onLoadDocument({ document: doc, documentName: 'project:p1' } as any);
    doc.getMap('nodes').set('n1', 1);
    repo.append.mockRejectedValueOnce(new Error('db down'));
    await gateway.hooks.onDisconnect({ document: doc, documentName: 'project:p1' } as any);   // flush 失败 → 批入 spool（契约 3 不抛）
    expect(await spool.peek('p1')).toHaveLength(1);   // Y0a-2：失败批已入 spool（fsync 落定）

    await vi.advanceTimersByTimeAsync(1_000);   // 触发 1s 档
    // Y0a-2：帧通道 peek/append/confirm 走真实 fs IO——真实窗口等其落定再断言
    await vi.useRealTimers();
    await pollUntil(() => repo.append.mock.calls.length >= 2, 2_000);
    vi.useFakeTimers();
    expect(repo.append).toHaveBeenCalledTimes(2);   // 帧直写（projectId 级二阶段——X5 detached 帧通道）
    expect(await spool.peek('p1')).toHaveLength(0);   // confirm → 段回收
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

describe('O0b-0 版本门 v2.1（WS loadDocument=唯一戳源）+ 幂等戳契约（终裁 51③——原"零写放大"契约由"至多一次幂等戳"接替）', () => {
  it('无戳∧零节点 → loadDocument stamp 自愈：meta.size===1 ∧ stamp update 进 pending（落库链）', async () => {
    const { gateway } = buildGateway();
    const doc = registerDoc(gateway, 'project:p1');
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);
    // 自愈戳落位：meta 只此一键
    expect(doc.getMap('meta').get('schemaVersion')).toBe(2);
    expect(doc.getMap('meta').size).toBe(1);
    // stamp 发生在 replaying 抑制窗外 → update 进 pending（下次 store 落库）
    const q = (gateway as any).pendingQueues.get((gateway as any).docProject.get(doc as any));   // Y4：两跳（V4 projectId 键控）
    expect(q.length).toBeGreaterThan(0);
    // epoch 播种契约保留（批3-4）
    expect(typeof (gateway as any).docEpoch.get(doc as any)).toBe('number');
  });

  it('幂等契约锚：首次 loadDocument 后 meta.size===1 ∧ 第二实例 load 同 doc 新增 update=0（每 doc 至多一次幂等戳）', async () => {
    const { gateway, repo } = buildGateway();
    // 第一实例：空 DB → 无戳零节点 → stamp 自愈 → store 落库（stamp update 持久化）
    const doc1 = registerDoc(gateway, 'project:p1');
    await gateway.hooks.onLoadDocument({ document: doc1 as any, documentName: 'project:p1' } as any);
    await gateway.hooks.onStoreDocument({ document: doc1 as any, documentName: 'project:p1' } as any);
    expect(repo.append).toHaveBeenCalledTimes(1);
    // 落库快照回放进 mock DB——第二实例 load 同 doc
    repo.hydrateWithRecovery.mockResolvedValue({
      state: Buffer.from(repo.append.mock.calls[0][1] as Uint8Array), updates: [], stateSeq: 0n,
    });
    const doc2 = registerDoc(gateway, 'project:p1');
    await gateway.hooks.onLoadDocument({ document: doc2 as any, documentName: 'project:p1' } as any);
    expect(doc2.getMap('meta').get('schemaVersion')).toBe(2);   // replay 已戳
    expect((gateway as any).pendingQueues.get((gateway as any).docProject.get(doc2 as any))).toHaveLength(0); // 已戳=CURRENT ⇒ no-op 零新增写（Y4 两跳）
  });

  it('戳=1（人为写 1 的 DB 快照）→ loadDocument 拒（throw 带明确信息——v1 旧档无迁移）', async () => {
    const { gateway, repo } = buildGateway();
    const snap = new Y.Doc();
    snap.getMap('meta').set('schemaVersion', 1);
    repo.hydrateWithRecovery.mockResolvedValue({
      state: Buffer.from(Y.encodeStateAsUpdate(snap)), updates: [], stateSeq: 0n,
    });
    const doc = registerDoc(gateway, 'project:p1');
    await expect(gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any))
      .rejects.toThrow(/schemaVersion/);
  });

  it('无戳∧有节点（裸 doc 快照——手建节点不经 fillDoc 构造纪律）→ loadDocument 拒', async () => {
    const { gateway, repo } = buildGateway();
    const snap = new Y.Doc();
    const m = new Y.Map();
    m.set('type', 'textInput');
    const pos = new Y.Map();
    pos.set('x', 1); pos.set('y', 2);
    m.set('position', pos);
    m.set('data', new Y.Map());
    snap.getMap('nodes').set('n1', m);
    repo.hydrateWithRecovery.mockResolvedValue({
      state: Buffer.from(Y.encodeStateAsUpdate(snap)), updates: [], stateSeq: 0n,
    });
    const doc = registerDoc(gateway, 'project:p1');
    await expect(gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any))
      .rejects.toThrow(/schemaVersion/);
  });
});

describe('批3-4 doc epoch + canvas_doc gauge', () => {
  it('onLoadDocument 播种 doc epoch（服务端 WeakMap——重入不换代）', async () => {
    const { gateway } = buildGateway();
    const doc = registerDoc(gateway, 'project:p1');
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);
    const epoch = (gateway as any).docEpoch.get(doc as any);
    expect(typeof epoch).toBe('number');
    // 重入不换代（同 doc 实例恒定代际）
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);
    expect((gateway as any).docEpoch.get(doc as any)).toBe(epoch);
  });

  it('canvas_doc 大小 gauge：load 播种快照字节 + append 增量累加', async () => {
    const { gateway, repo } = buildGateway();
    const snapDoc = new Y.Doc(); snapDoc.getMap('nodes').set('a', 1);
    stampDocSchema(toDocLike(snapDoc));   // O0b-0：v2 档快照（版本门放行前提）
    const snap = Buffer.from(Y.encodeStateAsUpdate(snapDoc));
    repo.hydrateWithRecovery.mockResolvedValue({ state: snap, updates: [], stateSeq: 0n });
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
