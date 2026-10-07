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
import { createLeaseStub } from './test-utils/lease-stub';

/** 真实定时器捕获（模块求值期=useFakeTimers 安装前）：退避梯重试链含真实 fsync IO，fake 推进后需
 *  realSleep 让链在真实事件环落定并在 fake 时钟上排下一档——单 fake 会话设计（切 useRealTimers 杀在途定时器=链断）。 */
const realSetTimeout = setTimeout.bind(globalThis);
const realSleep = (ms: number) => new Promise<void>((r) => realSetTimeout(r, ms));

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
  const lease = createLeaseStub();   // Y0a-3 T5：redisSync 退役——租约 stub（isServing 恒 true）
  const spool = new CollabSpoolService(spoolDir);   // 同一实例注入 gateway——peek 才看得见 gateway 写入的帧
  spool.setOwner('test-owner');                     // R3：写路径必先 setOwner（Z13 fail-closed）
  const gateway = new CollabGateway(
    prisma as any, new EventEmitter2() as any, repo as any, lease as any,
    { resolve: vi.fn() } as any, 44500 + Math.floor(Math.random() * 2000),
    undefined, undefined, undefined, spool,
  );
  (gateway as any).collabState = 'serving';   // Y0a-3：纯态门下直构网关须显式播种放行态（生产由 onModuleInit 状态机驱动）
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

  it('退避无上限：梯子永不耗尽——5 档走完后 60s 封顶档仍排程重试（数据留 spool 帧等下次 load 回灌；梯子只加速恢复）', async () => {
    const { gateway, repo, spool } = buildGateway();
    const doc = registerDoc(gateway, 'project:p1');
    vi.spyOn(doc, 'broadcastStateless').mockImplementation(() => {});
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);
    doc.getMap('nodes').set('n1', 1);
    repo.append.mockRejectedValue(new Error('db down'));

    await gateway.hooks.onStoreDocument({ document: doc as any, documentName: 'project:p1' } as any).catch(() => {});
    // Y0a-2 Task 4（耗尽语义→永续语义，plan Step 3 首用例+V17⑤ 形态）：重试链含真实 fsync IO——全梯在
    // **单一 fake 会话**内推进（切 useRealTimers 会杀在途 fake 定时器=链断裂）；每轮 60s 推进恒覆盖链式
    // 定时器到期（各档 ≤60s 封顶），realSleep 让链落定并在 fake 时钟上排下一档。链可能级联超跑 → rung 断言下界。
    const g = gateway as any;
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
      await realSleep(50);
      repo.append.mockClear();
    }
    expect(g.persistRetry.get('project:p1')?.rung).toBeGreaterThanOrEqual(5);   // 5 档全走完
    const entry = g.persistRetry.get('project:p1');
    clearTimeout(entry.timer); entry.timer = null;   // V17⑤：作废在途定时器后，在当前时钟断言重排（不清则 schedule 早退=恒真绿）
    g.schedulePersistRetry('project:p1');
    expect(g.persistRetry.get('project:p1').timer).toBeTruthy();   // rung≥5 → 60s 封顶档（旧实现 :603 耗尽 cancel → timer null=红）
    repo.append.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    await realSleep(50);
    expect(repo.append).toHaveBeenCalledTimes(1);   // 第 6 次重试仍触发（永不耗尽；旧实现无第 6 档 → 红）
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

  it('I-1 红相：retryPersist doc 级通道消费布尔返回——store 失败须走 catch 梯（批滞留时禁 cancel+healthy 广播）', async () => {
    const { gateway, repo } = buildGateway();
    const doc = registerDoc(gateway, 'project:p1');
    const bcSpy = vi.spyOn(doc, 'broadcastStateless').mockImplementation(() => {});
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);
    doc.getMap('nodes').set('n1', 1);
    repo.append.mockRejectedValue(new Error('db down'));
    await gateway.hooks.onStoreDocument({ document: doc as any, documentName: 'project:p1' } as any).catch(() => {});   // 首败：批入 spool+电平 unhealthy+梯 rung0
    doc.getMap('nodes').set('n2', 2);   // 再编辑 → 队列非空（doc 级通道前提：doc 活跃∧队列非空）
    expect((gateway as any).persistUnhealthy.has('project:p1')).toBe(true);   // 前置：电平已 unhealthy

    await (gateway as any).retryPersist('project:p1');   // 白盒直调一轮（既有梯子用例同形）
    const entry = (gateway as any).persistRetry.get('project:p1');
    expect(entry).toBeDefined();                     // 旧实现尾部无条件 cancel → undefined → 红
    expect(entry?.timer).toBeTruthy();               // 重试定时器真值（刚排的梯未被杀）
    expect(entry?.rung).toBe(1);                     // rung 推进按既有 catch 形态（失败恰一次）
    expect((gateway as any).persistUnhealthy.has('project:p1')).toBe(true);   // 电平不翻 healthy（旧实现 false → 红）
    expect(bcSpy).not.toHaveBeenCalledWith(JSON.stringify({ type: 'persist-status', healthy: true }));   // 无虚假 healthy 广播
  });

  it('I-2 批尾锚（detached 队列通道）：spool.append 挂起窗内折并改写队列前缀 → splice 跳过（merged 留队重发）+tail anomaly 计数+1', async () => {
    const { gateway, spool } = buildGateway();
    const g = gateway as any;
    // 装置：detached 形态（不 registerDoc——doc 不在 server.documents）+梯子 entry+队列 3 条真 Y update
    const src = new Y.Doc();
    src.getMap('nodes').set('k1', 1);
    const u1 = Y.encodeStateAsUpdate(src);
    src.getMap('nodes').set('k2', 2);
    const u2 = Y.encodeStateAsUpdate(src);
    src.getMap('nodes').set('k3', 3);
    const u3 = Y.encodeStateAsUpdate(src);
    g.pendingQueues.set('p1', [u1, u2, u3]);
    g.persistRetry.set('project:p1', { rung: 0, timer: null });
    let releaseAppend!: () => void;   // Y13 同款：可释放 deferred——append 挂起=锁外 splice 竞态窗的确定性复现
    const appendSpy = vi.spyOn(spool, 'append').mockImplementation(
      () => new Promise<string[]>((resolve) => { releaseAppend = () => resolve(['frame-1']); }),
    );
    const metric = register.getSingleMetric('yjs_store_tail_anomaly_total')!;
    const before = (await metric.get()).values[0]?.value ?? 0;   // V17⑥：metric.get() 公开 API

    const done = (gateway as any).retryPersist('project:p1');   // detached 分支（doc 不活∧队列非空）——首段同步，append 已被调用
    const queue = g.pendingQueues.get('p1') as Uint8Array[];
    const merged = Y.mergeUpdates(queue);   // 挂起窗内白盒折并（锁内取批点 Y7 同款 splice 原地形态——数组身份恒定）
    queue.splice(0, 3, merged);
    releaseAppend();
    await done;
    expect(queue).toHaveLength(1);   // merged 存活（旧实现 splice(0,3) 越界误删未落库内容 → 红）
    expect(queue[0]).toBe(merged);
    expect(((await metric.get()).values[0]?.value ?? 0) - before).toBe(1);   // tail anomaly 计数+1（批留队=可经下次梯子 store 重发）
    expect(g.persistRetry.has('project:p1')).toBe(false);   // leave 无条件+spool.append 成功=本批已落定（cancel 正常收尾）
    appendSpy.mockRestore();
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
