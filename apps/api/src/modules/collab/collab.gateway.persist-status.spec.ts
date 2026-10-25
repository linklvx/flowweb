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
import {
  CLIENT_PROTOCOL_VERSION, type DocLike, type DocMapLike, type TextLike } from '@flowweb/shared';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockRepo } from '../../test-utils/mock-repo';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';   // Y0c T39b 波 2：内部状态访问经 façade（check-collab-test-facade 门禁）
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { pollUntil } from '../../test-utils/poll-until';
import { createLeaseStub } from './test-utils/lease-stub';

/** 真实定时器捕获（模块求值期=useFakeTimers 安装前）：退避梯重试链含真实 fsync IO，fake 推进后需
 *  realSleep 让链在真实事件环落定并在 fake 时钟上排下一档——单 fake 会话设计（切 useRealTimers 杀在途定时器=链断）。 */
const realSetTimeout = setTimeout.bind(globalThis);
const realSleep = (ms: number) => new Promise<void>((r) => realSetTimeout(r, ms));

/** 测试内 Y.Doc→DocLike 适配（历史版本门夹具形态——T18 起版本=PG 列） */
function toDocLike(doc: Y.Doc): DocLike {
  return {
    getMap: (name) => doc.getMap(name) as unknown as DocMapLike,
    createMap: () => new Y.Map() as unknown as DocMapLike,
    createText: () => new Y.Text() as unknown as TextLike,
    // Y1c T16：XML 三工厂（fillDoc 创建 seam——真 Y 实例）
    createXmlFragment: () => new Y.XmlFragment() as never,
    createXmlElement: (name: string) => new Y.XmlElement(name) as never,
    createXmlText: () => new Y.XmlText() as never,
    // Y1c T17：媒体列表 Y.Array 域工厂（fillDoc 创建 seam——真 Y.Array）
    createArray: () => new Y.Array() as never,
  };
}

function buildGateway() {
  const prisma = {
    systemHistory: { findUnique: vi.fn().mockResolvedValue({ historyId: 'spec-history-id' }) },  // Y1c T9（T8 接线）：listenCollab requireSystemHistory fail-closed 读面 mock

    session: {
      findUnique: vi.fn().mockResolvedValue({ user: { id: 'u1', name: '张三' }, userId: 'u1', expiresAt: new Date(Date.now() + 24 * 3600 * 1000) }),
      update: vi.fn(async (args: any) => ({ user: { id: 'u1', name: '张三' }, userId: 'u1', expiresAt: args.data.expiresAt })),
    },
    canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1' }) },
    teamMember: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER', userId: 'u1' }) },
  };
  // Y0a-1：repo stub 收敛 mock-repo 工厂（快照经 hydrateWithRecovery 喂——装载读唯一入口）
  // Q-M1：mock 签名对齐新表形态 appendBatch(pid, rows[])——返回 {ok,rows}（Y1c T9 批行契约；
  // 旧签名 u:Uint8Array+{ok,seq} 形为 T9 前残帧，实收 rows 数组死装置）
  const repo = createMockRepo({
    appendBatch: vi.fn(async (_pid: string, rows: ReadonlyArray<{ update: Uint8Array }> = []) => ({ ok: true as const, rows: rows.length })),
  });
  const lease = createLeaseStub();   // Y0a-3 T5：租约 stub（isServing 恒 true）
  const spool = new CollabSpoolService(spoolDir);   // 同一实例注入 gateway——peek 才看得见 gateway 写入的帧
  spool.setOwner('test-owner');                     // R3：写路径必先 setOwner（Z13 fail-closed）
  const gateway = new CollabGateway(
    prisma as any, new EventEmitter2() as any, repo as any, lease as any,
    // Y0b-3 T3：F-3 换轨后 authenticateInner 判据走 resolveWithTeam——stub 双方法齐备（否则 TypeError 折 db-unavailable）
    { resolve: vi.fn(), resolveWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' }) } as any,
    44500 + Math.floor(Math.random() * 2000),
    undefined, undefined, undefined, spool,
  );
  gatewayFacade(gateway).forceCollabState('serving');   // Y0a-3：纯态门下直构网关须显式播种放行态（生产由 onModuleInit 状态机驱动）
  return { gateway, repo, spool };
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
    repo.appendBatch.mockRejectedValueOnce(new Error('db down'));

    await expect(gateway.persistence.storeDocumentSerialized({ document: doc as any, documentName: 'project:p1' } as any, 'maintenance'))
      .resolves.toBe(false);   // Y0a-2 契约 3 反转：任何路径不 throw（旧断言 rejects.toThrow 必红点）
    expect(bcSpy).toHaveBeenCalledWith(JSON.stringify({ type: 'persist-status', healthy: false }));
    expect(gatewayFacade(gateway).persistUnhealthyHas('project:p1')).toBe(true);

    await vi.advanceTimersByTimeAsync(1_000);   // 1s 后第一档重试触发
    // Y0a-2：重试帧通道 peek/append/confirm 走真实 fs IO（异步于 fake timer 触发点）——真实窗口等其落定
    await vi.useRealTimers();
    await pollUntil(() => repo.appendBatch.mock.calls.length >= 2, 2_000);
    vi.useFakeTimers();
    expect(repo.appendBatch).toHaveBeenCalledTimes(2);   // 失败 1 + 重试成功 1
    expect(bcSpy).toHaveBeenCalledWith(JSON.stringify({ type: 'persist-status', healthy: true }));
    expect(gatewayFacade(gateway).persistUnhealthyHas('project:p1')).toBe(false);
    expect(gatewayFacade(gateway).persistRetryEntry('project:p1')).toBeUndefined();
  });

  it('退避无上限：梯子永不耗尽——5 档走完后 60s 封顶档仍排程重试（数据留 spool 帧等下次 load 回灌；梯子只加速恢复）', async () => {
    const { gateway, repo, spool } = buildGateway();
    const doc = registerDoc(gateway, 'project:p1');
    vi.spyOn(doc, 'broadcastStateless').mockImplementation(() => {});
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);
    doc.getMap('nodes').set('n1', 1);
    repo.appendBatch.mockRejectedValue(new Error('db down'));

    await gateway.persistence.storeDocumentSerialized({ document: doc as any, documentName: 'project:p1' } as any, 'maintenance').catch(() => {});
    // Y0a-2 Task 4（耗尽语义→永续语义，plan Step 3 首用例+V17⑤ 形态）：重试链含真实 fsync IO——全梯在
    // **单一 fake 会话**内推进（切 useRealTimers 会杀在途 fake 定时器=链断裂）；每轮 60s 推进恒覆盖链式
    // 定时器到期（各档 ≤60s 封顶），realSleep 让链落定并在 fake 时钟上排下一档。链可能级联超跑 → rung 断言下界。
    const g = gatewayFacade(gateway);
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
      await realSleep(50);
      repo.appendBatch.mockClear();
    }
    expect(g.persistRetryEntry('project:p1')?.rung).toBeGreaterThanOrEqual(5);   // 5 档全走完
    const entry = g.persistRetryEntry('project:p1')!;
    clearTimeout(entry.timer!); entry.timer = null;   // V17⑤：作废在途定时器后，在当前时钟断言重排（不清则 schedule 早退=恒真绿）；非空断言=偏离 62⑥ 同款（any 时代 null 可传——运行时语义零变化）
    g.schedulePersistRetry('project:p1');
    expect(g.persistRetryEntry('project:p1')!.timer).toBeTruthy();   // rung≥5 → 60s 封顶档（旧实现 :603 耗尽 cancel → timer null=红）
    repo.appendBatch.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    await realSleep(50);
    expect(repo.appendBatch).toHaveBeenCalledTimes(1);   // 第 6 次重试仍触发（永不耗尽；旧实现无第 6 档 → 红）
    expect(await spool.peek('p1')).toHaveLength(1);   // Y0a-2：数据仍在 spool 帧（内存 unflushed 退役——清单 A peek 替换；:89 装置随 V4 换键）
  });

  it('持续失败不刷屏：退避梯多级推进（1+5 次失败）→ unhealthy 广播恰 1 次（电平翻转才广播）', async () => {
    const { gateway, repo } = buildGateway();
    const doc = registerDoc(gateway, 'project:p1');
    const bcSpy = vi.spyOn(doc, 'broadcastStateless').mockImplementation(() => {});
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);
    doc.getMap('nodes').set('n1', 1);
    repo.appendBatch.mockRejectedValue(new Error('db down'));

    await gateway.persistence.storeDocumentSerialized({ document: doc as any, documentName: 'project:p1' } as any, 'maintenance').catch(() => {});
    for (const delay of [1_000, 2_000, 5_000, 15_000, 30_000]) {
      await vi.advanceTimersByTimeAsync(delay);
    }
    const unhealthy = JSON.stringify({ type: 'persist-status', healthy: false });
    const unhealthyCalls = bcSpy.mock.calls.filter(([payload]) => payload === unhealthy);
    expect(unhealthyCalls).toHaveLength(1);   // 首次失败翻转电平广播 1 次；5 档重试全失败不再广播
    expect(gatewayFacade(gateway).persistUnhealthyHas('project:p1')).toBe(true);   // 电平保持 unhealthy
  });

  it('两阶段·detached：doc 已不在内存（卸载）→ 重试经 spool 帧通道直写 repo.appendBatch，帧回收', async () => {
    const { gateway, repo, spool } = buildGateway();
    // 不 registerDoc——doc 不在 server.documents（卸载形态）
    const doc = new Document('project:p1');   // Y0a-2：真 Document（disconnect 走 storeDocumentSerialized——saveMutex 需真锁载体）
    await gateway.hooks.onLoadDocument({ document: doc, documentName: 'project:p1' } as any);
    doc.getMap('nodes').set('n1', 1);
    repo.appendBatch.mockRejectedValueOnce(new Error('db down'));
    await gateway.hooks.onDisconnect({ document: doc, documentName: 'project:p1' } as any);   // flush 失败 → 批入 spool（契约 3 不抛）
    expect(await spool.peek('p1')).toHaveLength(1);   // Y0a-2：失败批已入 spool（fsync 落定）

    await vi.advanceTimersByTimeAsync(1_000);   // 触发 1s 档
    // Y0a-2：帧通道 peek/append/confirm 走真实 fs IO——真实窗口等其落定再断言
    await vi.useRealTimers();
    await pollUntil(() => repo.appendBatch.mock.calls.length >= 2, 2_000);
    vi.useFakeTimers();
    expect(repo.appendBatch).toHaveBeenCalledTimes(2);   // 帧直写（projectId 级二阶段——X5 detached 帧通道）
    expect(await spool.peek('p1')).toHaveLength(0);   // confirm → 段回收
  });

  it('成功转折由有机 store 也能关闭：用户继续编辑触发的 store 成功 → 定时器撤销 + healthy 广播', async () => {
    const { gateway, repo } = buildGateway();
    const doc = registerDoc(gateway, 'project:p1');
    const bcSpy = vi.spyOn(doc, 'broadcastStateless').mockImplementation(() => {});
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);
    doc.getMap('nodes').set('n1', 1);
    repo.appendBatch.mockRejectedValueOnce(new Error('db down'));
    await gateway.persistence.storeDocumentSerialized({ document: doc as any, documentName: 'project:p1' } as any, 'maintenance').catch(() => {});
    expect(gatewayFacade(gateway).persistRetryHas('project:p1')).toBe(true);

    doc.getMap('nodes').set('n2', 2);
    await gateway.persistence.storeDocumentSerialized({ document: doc as any, documentName: 'project:p1' } as any, 'maintenance');   // 有机重试成功
    expect(gatewayFacade(gateway).persistRetryHas('project:p1')).toBe(false);   // 定时器撤销
    expect(bcSpy).toHaveBeenCalledWith(JSON.stringify({ type: 'persist-status', healthy: true }));

    await vi.advanceTimersByTimeAsync(60_000);
    expect(repo.appendBatch).toHaveBeenCalledTimes(2);   // 撤销后无额外定时器触发
  });

  it('新连接补推：unhealthy 电平期新鉴权连接收到 sendStateless(persist-status healthy:false)', async () => {
    const { gateway, repo } = buildGateway();
    const doc = registerDoc(gateway, 'project:p1');
    vi.spyOn(doc, 'broadcastStateless').mockImplementation(() => {});
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);
    doc.getMap('nodes').set('n1', 1);
    repo.appendBatch.mockRejectedValue(new Error('db down'));
    await gateway.persistence.storeDocumentSerialized({ document: doc as any, documentName: 'project:p1' } as any, 'maintenance').catch(() => {});   // → unhealthy（此时无连接，广播零对象）

    repo.appendBatch.mockResolvedValue(undefined);
    // unhealthy 电平期一条新连接进入（真 Document 的 flush/broadcast 读写 messageAddress/send——fake 补齐库形状）
    const conn = { messageAddress: 'project:p1', send: vi.fn(), sendStateless: vi.fn(), webSocket: { close: vi.fn() } };
    (doc.connections as Map<any, any>).set(conn, { clients: new Set() });
    await gateway.hooks.onAuthenticate({
      requestParameters: new URLSearchParams(`token=tok&csv=${CLIENT_PROTOCOL_VERSION}`),   // Y0b-3 T5 版本门：装置带当前协议版
      requestHeaders: new Headers({ cookie: 'flowweb.session_token=tok' }),   // Y0b-3 T2 cookie-only：token 只来自 cookie
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
    repo.appendBatch.mockRejectedValue(new Error('db down'));
    await gateway.persistence.storeDocumentSerialized({ document: doc as any, documentName: 'project:p1' } as any, 'maintenance').catch(() => {});

    await gateway.onApplicationShutdown();
    const calls = repo.appendBatch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(repo.appendBatch.mock.calls.length).toBe(calls);   // 无重试触发
  });

  it('I-1 红相：retryPersist doc 级通道消费布尔返回——store 失败须走 catch 梯（批滞留时禁 cancel+healthy 广播）', async () => {
    const { gateway, repo } = buildGateway();
    const doc = registerDoc(gateway, 'project:p1');
    const bcSpy = vi.spyOn(doc, 'broadcastStateless').mockImplementation(() => {});
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);
    doc.getMap('nodes').set('n1', 1);
    repo.appendBatch.mockRejectedValue(new Error('db down'));
    await gateway.persistence.storeDocumentSerialized({ document: doc as any, documentName: 'project:p1' } as any, 'maintenance').catch(() => {});   // 首败：批入 spool+电平 unhealthy+梯 rung0
    doc.getMap('nodes').set('n2', 2);   // 再编辑 → 队列非空（doc 级通道前提：doc 活跃∧队列非空）
    expect(gatewayFacade(gateway).persistUnhealthyHas('project:p1')).toBe(true);   // 前置：电平已 unhealthy

    await gatewayFacade(gateway).retryPersist('project:p1');   // 白盒直调一轮（既有梯子用例同形）
    const entry = gatewayFacade(gateway).persistRetryEntry('project:p1');
    expect(entry).toBeDefined();                     // 旧实现尾部无条件 cancel → undefined → 红
    expect(entry?.timer).toBeTruthy();               // 重试定时器真值（刚排的梯未被杀）
    expect(entry?.rung).toBe(1);                     // rung 推进按既有 catch 形态（失败恰一次）
    expect(gatewayFacade(gateway).persistUnhealthyHas('project:p1')).toBe(true);   // 电平不翻 healthy（旧实现 false → 红）
    expect(bcSpy).not.toHaveBeenCalledWith(JSON.stringify({ type: 'persist-status', healthy: true }));   // 无虚假 healthy 广播
  });

  it('I-2 批尾锚（detached 队列通道）：spool.append 挂起窗内折并改写队列前缀 → splice 跳过（merged 留队重发）+tail anomaly 计数+1', async () => {
    const { gateway, spool } = buildGateway();
    const g = gatewayFacade(gateway);
    // 装置：detached 形态（不 registerDoc——doc 不在 server.documents）+梯子 entry+队列 3 条真 Y update
    const src = new Y.Doc();
    src.getMap('nodes').set('k1', 1);
    const u1 = Y.encodeStateAsUpdate(src);
    src.getMap('nodes').set('k2', 2);
    const u2 = Y.encodeStateAsUpdate(src);
    src.getMap('nodes').set('k3', 3);
    const u3 = Y.encodeStateAsUpdate(src);
    g.seedPendingQueue('p1', [u1, u2, u3]);
    g.seedPersistRetry('project:p1', { rung: 0, timer: null });
    let releaseAppend!: () => void;   // Y13 同款：可释放 deferred——append 挂起=锁外 splice 竞态窗的确定性复现
    const appendSpy = vi.spyOn(spool, 'appendBatch').mockImplementation(
      () => new Promise<Array<{ frameId: string; walSeq: bigint }>>((resolve) => { releaseAppend = () => resolve([{ frameId: 'seg:0', walSeq: 1n }]); }),
    );
    const metric = register.getSingleMetric('yjs_store_tail_anomaly_total')!;
    const before = (await metric.get()).values[0]?.value ?? 0;   // V17⑥：metric.get() 公开 API

    const done = g.retryPersist('project:p1');   // detached 分支（doc 不活∧队列非空）
    // Y1c T9：维护通道经 actor drain（微任务合批后同步段触达 appendBatch spy）——先落 microtask 再取队列
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(typeof releaseAppend).toBe('function');   // appendBatch 已被调用（挂起窗就位）
    const queue = g.pendingQueueRef('p1')!;   // 真实数组引用——折并 splice 原地语义承载面（身份契约）
    const merged = Y.mergeUpdates(queue);   // 挂起窗内白盒折并（锁内取批点 Y7 同款 splice 原地形态——数组身份恒定）
    queue.splice(0, 3, merged);
    releaseAppend();
    await done;
    expect(queue).toHaveLength(1);   // merged 存活（旧实现 splice(0,3) 越界误删未落库内容 → 红）
    expect(queue[0]).toBe(merged);
    expect(((await metric.get()).values[0]?.value ?? 0) - before).toBe(1);   // tail anomaly 计数+1（批留队=可经下次梯子 store 重发）
    expect(g.persistRetryHas('project:p1')).toBe(false);   // leave 无条件+spool.append 成功=本批已落定（cancel 正常收尾）
    appendSpy.mockRestore();
  });
});

describe('T18 版本门 v2.1 退役（版本判据=CanvasDoc.schemaVersion PG 列——meta.stamp 链整删）', () => {
  it('无戳零节点（空 DB 懒建档形态）→ loadDocument 放行且零 meta 写零 pending 写（原 stamp 自愈分支删除——装载后 pending 恒空）', async () => {
    const { gateway } = buildGateway();
    const doc = registerDoc(gateway, 'project:p1');
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);
    expect(doc.getMap('meta').size).toBe(0);   // T18：meta 零键（版本=PG 列——建行走 @default(3)）
    expect(gatewayFacade(gateway).pendingQueueRefForDoc(doc as any)).toHaveLength(0);   // 零自愈写
    expect(typeof gatewayFacade(gateway).docEpochOf(doc as any)).toBe('number');        // epoch 播种契约保留（批3-4）
  });

  it('装载幂等锚：同 doc 第二实例 load 复用零新增 pending（原「至多一次幂等戳」继任=零写形态）', async () => {
    const { gateway, repo } = buildGateway();
    const doc1 = registerDoc(gateway, 'project:p1');
    await gateway.hooks.onLoadDocument({ document: doc1 as any, documentName: 'project:p1' } as any);
    await gateway.persistence.storeDocumentSerialized({ document: doc1 as any, documentName: 'project:p1' } as any, 'maintenance');
    expect(repo.appendBatch).not.toHaveBeenCalled();   // 空 doc 零写（原 stamp 行落库删除）
    repo.hydrateWithRecovery.mockResolvedValue({ state: null, updates: [], stateSeq: 0n, schemaVersion: null });
    const doc2 = registerDoc(gateway, 'project:p1');
    await gateway.hooks.onLoadDocument({ document: doc2 as any, documentName: 'project:p1' } as any);
    expect(doc2.getMap('meta').size).toBe(0);
    expect(gatewayFacade(gateway).pendingQueueRefForDoc(doc2 as any)).toHaveLength(0);
  });

  it('行 schemaVersion=2（旧档行）→ loadDocument 拒（DOC_SCHEMA_STALE——PG 列门，doc meta 残留不参与判定）', async () => {
    const { gateway, repo } = buildGateway();
    const snap = new Y.Doc();
    snap.getMap('meta').set('schemaVersion', 2);   // 旧档 doc 残留载荷（历史）——非判据
    repo.hydrateWithRecovery.mockResolvedValue({
      state: Buffer.from(Y.encodeStateAsUpdate(snap)), updates: [], stateSeq: 0n, schemaVersion: 2,
    });
    const doc = registerDoc(gateway, 'project:p1');
    await expect(gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any))
      .rejects.toThrow(/CanvasDoc\.schemaVersion=2/);
  });
});

describe('批3-4 doc epoch + canvas_doc gauge', () => {
  it('onLoadDocument 播种 doc epoch（服务端 WeakMap——重入不换代）', async () => {
    const { gateway } = buildGateway();
    const doc = registerDoc(gateway, 'project:p1');
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);
    const epoch = gatewayFacade(gateway).docEpochOf(doc as any);
    expect(typeof epoch).toBe('number');
    // 重入不换代（同 doc 实例恒定代际）
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);
    expect(gatewayFacade(gateway).docEpochOf(doc as any)).toBe(epoch);
  });

  it('Y0b-5 T10：yjs_canvas_doc_bytes 退役——装载播种进 yjs_doc_bytes 直方图+store 批进 yjs_store_payload_bytes（E54② 双指标拆分读者改造）', async () => {
    const { gateway, repo } = buildGateway();
    const snapDoc = new Y.Doc(); snapDoc.getMap('nodes').set('a', 1);
    const snap = Buffer.from(Y.encodeStateAsUpdate(snapDoc));
    repo.hydrateWithRecovery.mockResolvedValue({ state: snap, updates: [], stateSeq: 0n });
    const doc = registerDoc(gateway, 'project:p1');
    await gateway.hooks.onLoadDocument({ document: doc as any, documentName: 'project:p1' } as any);

    // E19：projectId gauge 已删（重复注册即红）；尺寸分布=yjs_doc_bytes 直方图（装载播种样本=snap 字节）
    const metrics = await register.getMetricsAsJSON();
    expect(metrics.find((m: any) => m.name === 'yjs_canvas_doc_bytes')).toBeUndefined();
    const docBytes = metrics.find((m: any) => m.name === 'yjs_doc_bytes')?.values ?? [];
    expect(docBytes.find((v: any) => v.metricName === 'yjs_doc_bytes_count')?.value).toBeGreaterThanOrEqual(1);
    expect(docBytes.find((v: any) => v.metricName === 'yjs_doc_bytes_sum')?.value).toBeGreaterThanOrEqual(snap.length);

    doc.getMap('nodes').set('b', 2);
    await gateway.persistence.storeDocumentSerialized({ document: doc as any, documentName: 'project:p1' } as any, 'maintenance');
    // Y1c T9 新表形态：appendBatch(pid, rows[])——payload=rows[0].update（维护单帧行）；observe 在
    // actor PG 腿逐行（yjsStorePayloadBytes——含本批）
    const row = (repo.appendBatch.mock.calls[0] as [string, Array<{ update: Uint8Array }>])[1][0];
    const metrics2 = await register.getMetricsAsJSON();
    const payloads = metrics2.find((m: any) => m.name === 'yjs_store_payload_bytes')?.values ?? [];
    expect(payloads.find((v: any) => v.metricName === 'yjs_store_payload_bytes_sum')?.value).toBeGreaterThanOrEqual(row.update.byteLength);
  });
});
