// apps/api/src/modules/collab/collab-doc-lifecycle.spec.ts
// Y0c T41 W2（片 B·B2 前置穷举单测——设计报告 t41-b2-design.md §6.1 七维表/§6.2 清理点普查表/
// §6.3-2/3/4）：doc 生命周期语义钉住（DR 域——B2 起 DocRegistry 单一所有者的跃迁穷举对象）。
// 性质=**语义钉住用例**（对现状写、当场全绿）：任何用例红 ⇒ 现状语义与设计理解不符 ⇒ 停下上报，
// 禁改断言迁就。内部状态访问一律经 test-utils/collab-gateway-test-facade（check-collab-test-facade
// 门禁——本 spec 零违规；façade 缺面按操作化归并扩，禁 1:1 成员暴露）。
// 覆盖：①物化（装载播种+四门拒绝+connected 真空 terminal）②真空（setVacuuming 幂等+beginVacuumEra
// 纪元序）③配额（ok→pending→frozen→ok 全跃迁+freezeQuota 双调/scheduleFreezePending 去重两幂等）
// ④降级（真实写点 hydration deferred+清理）⑤store 失败（Z110 真卸载终态）⑥常驻（委托位未 attach
// 语义三断言+attach 缝+Z65 域视角复断言=Z105 WS-only 口径）⑦代际（装载播种+三入口清理）。
// 清理点普查表三入口逐键全断言+**键集差异逐键钉死**（防「补齐清理」式行为漂移）：
//   vacuumingDocs=仅 projectsGone 清（:1157 兜底——service finally 双保险）；autoVacuumLastAt=仅
//   purgeDocState 清（:1436 Z66）；storeFailedDocs=仅 afterUnloadDocument 清（:2043 Z110）；
//   writeFreeze/overPush=仅 purgeDocState 经 applyWriteFreeze 单源解除（:1438-1442）；
//   lastCompactAt/persistUnhealthy/pendingQueues=purge+projectsGone 清（persistence 侧）、afterUnload 不清。
// 计数口径披露（纪律：设计报告与源码实测不符以源码为准——上报不改设计）：§6.2 记 afterUnload「12 键
// +1 persistence 委托」与同句「:2039-2056 实测 15 delete+1 timer clear」自相矛盾，源码实测=15 容器
// （14 DR 键+storeFailedDocs persistence 台账）+1 timer 族+锚结算；「onProjectGoneStateCleanup 14 键」
// 源码实测 :1140-1157=15 容器（14+vacuumingDocs 兜底——与 §6.1 ②「仅 projectsGone 清」自洽）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { messageYjsUpdate } from 'y-protocols/sync';
import { register } from 'prom-client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CollabGateway, TRUTH_COOLDOWN_MS } from './collab.gateway';
import { CollabSpoolService } from './collab-spool.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { gatewayFacade, type GatewayTestFacade } from './test-utils/collab-gateway-test-facade';   // 内部状态访问经 façade（门禁）
import { CollabAuthReason, CollabCloseCode, DOC_STATUS_REV_SEED, DOC_VACUUMING_TERMINAL_REASON, QUOTA_DEFAULTS } from '@flowweb/shared';
import type { TryReleaseMotive, TryReleaseOutcome } from './collab-residency.service';
import { resetHeapPressure } from './heap-pressure';

/** 小值配额（构造注入位 11——quota-gate QUOTA_SMALL 同款手法；softEnter=819/softExit=614） */
const QUOTA_SMALL = { maxDocBytes: 1024, maxTxBytes: 512, msgRate: 200, bytesRate: 2_097_152 };
const SOFT_ENTER = Math.floor(QUOTA_SMALL.maxDocBytes * QUOTA_DEFAULTS.softEnterRatio);

interface FakeConn {
  socketId: string;
  document: { name: string };
  readOnly?: boolean;
  context: Record<string, unknown>;
  sendStateless: ReturnType<typeof vi.fn>;
  webSocket: { close: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
}
function makeConn(socketId: string, documentName: string): FakeConn {
  return {
    socketId,
    document: { name: documentName },
    readOnly: false,
    context: {},
    sendStateless: vi.fn(),
    webSocket: { close: vi.fn(), send: vi.fn() },
  };
}

let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};
beforeEach(async () => {
  const d = await makeSpoolDir('y0c-t41-lifecycle-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
  resetHeapPressure();   // heap 谓词迟滞模块态复位（auth-defense 先例——装载/auth 两闸恒不 tripped）
});
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); await spoolCleanup(); });

function buildGateway() {
  const repo = createMockRepo();
  const emitter = new EventEmitter2();
  const lease = createLeaseStub({ tryAcquireFast: vi.fn(async () => false), isServing: vi.fn(() => false) });   // fast=false——onModuleInit 用例不 listen
  const spool = new CollabSpoolService(spoolDir);
  spool.setOwner('test-owner');
  const gateway = new CollabGateway(
    {} as any, emitter as any, repo as any, lease as any,
    {} as any, 49300 + Math.floor(Math.random() * 600),
    undefined, undefined, undefined, spool, QUOTA_SMALL,   // 位 11=quota 注入（尾参真可选先例）
  );
  const gf = gatewayFacade(gateway);
  gf.forceCollabState('serving');   // 装载/serving 门用例前置（façade 白盒装置——生产写点唯一 transition）
  return { gateway, gf, repo, emitter, spool };
}

/** 真 Y.Doc 播种进库 documents Map（measureTruth/freezeQuota/thawQuota 消费真 doc——name/connections 补齐） */
function seedRealDoc(gateway: CollabGateway, pid: string, opts: { big?: boolean; conns?: FakeConn[] } = {}): Y.Doc {
  const doc = new Y.Doc();
  if (opts.big) doc.getMap('nodes').set('big', 'x'.repeat(2000));   // 编码 >softEnter(819)（③确认实测≥soft 分支）
  const connections = new Map<FakeConn, { clients: Set<number> }>();
  for (const c of opts.conns ?? []) connections.set(c, { clients: new Set() });
  const name = `project:${pid}`;
  Object.assign(doc, { name, connections });   // 库 Document 结构面补齐（name/connections——guardSyncFrame/freezeQuota 消费）
  (gateway.server.hocuspocus.documents as Map<string, any>).set(name, doc);
  return doc;
}

/** 库形态最小 fake doc（isDocResident/closeTeamDocuments 读面——不需真 Y.Doc 的用例） */
function seedFakeDoc(gateway: CollabGateway, name: string, opts: { conns?: FakeConn[]; direct?: number } = {}) {
  const connections = new Map<FakeConn, { clients: Set<number> }>();
  for (const c of opts.conns ?? []) connections.set(c, { clients: new Set() });
  (gateway.server.hocuspocus.documents as Map<string, any>).set(name, { name, connections, isLoading: false, directConnectionsCount: opts.direct ?? 0 });
}

/** beforeSync 驱动（配额执法唯一落点 guardSyncFrame 的公有钩子面——hooks.beforeSync 直调，禁私有 cast） */
function syncUpdate(gateway: CollabGateway, doc: Y.Doc, conn: FakeConn, bytes = 200) {
  return gateway.hooks.beforeSync({ type: messageYjsUpdate, payload: new Uint8Array(bytes), document: doc, connection: conn } as any);
}

/** prom-client 计数增量断言（register 全局单例——恒用增量；quota-gate 同款） */
async function counterOf(name: string, labels: Record<string, string> = {}): Promise<number> {
  const metric = register.getSingleMetric(name) as any;
  if (!metric) throw new Error(`metric ${name} 未定义（红相）`);
  return (await metric.get()).values.find((s: any) => Object.entries(labels).every(([k, v]) => s.labels[k] === v))?.value ?? 0;
}
async function metricDelta(name: string, labels: Record<string, string>, fn: () => Promise<unknown> | unknown): Promise<number> {
  const before = await counterOf(name, labels);
  await fn();
  return (await counterOf(name, labels)) - before;
}

/** 清理点普查播种（pid 键控容器全量——三入口 D1/D2/D3 共用；键集=§6.2 普查表源码实测） */
function seedAllPidState(gateway: CollabGateway, gf: GatewayTestFacade, pid: string, conn: FakeConn): void {
  gf.seedDocTruth(pid, 100);
  gf.seedDocDelta(pid, 10);
  gf.seedTruthMeasuredAt(pid, Date.now());
  gf.addDegradedDoc(pid);
  gf.addQuotaFrozen(pid);
  gf.addFreezePending(pid);
  gf.seedFreezePendingTimer(pid, setTimeout(() => {}, 60_000));   // 在飞确认定时器（被测入口负责 clear）
  gf.seedRecheckRounds(pid, 3);
  gf.seedThawCooldown(pid, Date.now());
  gf.seedDocStatusRev(pid, 5);
  gf.seedDocStatusState(pid, 'ok:false');
  gf.seedDocGeneration(pid, 2);
  gf.seedDocResidue(pid, 50);
  gf.seedPreVacuumSv(pid, new Map([[1, 2]]));
  gf.seedAutoVacuumLastAt(pid, Date.now());
  gateway.setVacuuming(pid, true);          // 公有写点（setVacuuming=service vacuumGate 同款）
  gateway.storeFailedDocs.add(pid);         // 公有 getter=persistence 台账真实 Set 引用（B1 委托位④）
  gf.seedWriteFreeze(conn, pid, ['quota']);
  gf.seedOverPush(conn.socketId, { count: 5, bytes: 500, firstAt: Date.now(), lastAt: Date.now() });
  gf.backdateLastCompactAt(pid, 1);
  gf.addPersistUnhealthy(`project:${pid}`);
  gf.seedPendingQueue(pid, []);
}

// ═══ ①物化维+⑦代际维：装载播种与四门拒绝（§6.1 表①⑦行——写点=loadDocument :982） ═══
describe('T41 W2 ①物化+⑦代际：loadDocument 播种/门族/connected 真空 terminal（钩子公有面驱动）', () => {
  it('装载成功播种六键：docTruth=cheap 上界/docDelta=0/truthMeasuredAt/docStatusRev=SEED(1)/docEpoch；无 preVacuumSv/generation 不播种', async () => {
    const { gateway, gf, repo } = buildGateway();
    repo.hydrateWithRecovery.mockResolvedValueOnce({ state: null, updates: [], stateSeq: 0n });
    const doc = new Y.Doc();
    await gateway.hooks.onLoadDocument({ document: doc, documentName: 'project:p-load', socketId: 's-load' } as any);
    expect(gf.docTruthOf('p-load')).toBe(0);   // cheap=|state|+Σ|updates|+Σspool=0 <soft ⇒ 直接当 truth（零新增编码）
    expect(gf.docDeltaOf('p-load')).toBe(0);
    expect(gf.truthMeasuredAtHas('p-load')).toBe(true);   // 冷却窗基线（T4 判据④消费）
    expect(gf.docStatusRevOf('p-load')).toBe(DOC_STATUS_REV_SEED);   // 装载播种 1（初值 0 被客户端 rev 守卫丢首快照）
    expect(gf.docEpochOf(doc)).toBeTypeOf('number');   // doc 代际 WeakMap 播种（:1043）
    expect(gf.preVacuumSvOf('p-load')).toBeUndefined();   // 无 preVacuumSv 行不播种（⑦代际条件写点）
    expect(gf.docGenerationOf('p-load')).toBeUndefined();
  });

  it('⑦代际装载播种：preVacuumSv 解码缓存（SV 代际门数据源）+docGeneration（doc-status 顶层 generation 产生源）', async () => {
    const { gateway, gf, repo } = buildGateway();
    const src = new Y.Doc();
    src.getMap('nodes').set('n1', 'x');
    repo.hydrateWithRecovery.mockResolvedValueOnce({ state: null, updates: [], preVacuumSv: Buffer.from(Y.encodeStateVector(src)), generation: 7, stateSeq: 0n });
    await gateway.hooks.onLoadDocument({ document: new Y.Doc(), documentName: 'project:p-gen', socketId: 's-gen' } as any);
    const sv = gf.preVacuumSvOf('p-gen');
    expect(sv).toBeInstanceOf(Map);
    expect(sv!.size).toBe(1);   // src 的 (client,clock) 播种（:1053 decodeStateVector）
    expect(gf.docGenerationOf('p-gen')).toBe(7);   // :1054 播种
  });

  it('门族①（T19/Z64②）：unloadingDocuments 窗口拒新装载——SUE doc-unloading+瞬态档 LEASE_NOT_READY（B 窗口第二实例风险面守卫）', async () => {
    const { gateway } = buildGateway();
    gateway.server.hocuspocus.unloadingDocuments.set('project:p-unl', {} as any);
    const err = await gateway.hooks.onLoadDocument({ document: new Y.Doc(), documentName: 'project:p-unl', socketId: 's' } as any).then(() => null, (e: unknown) => e);
    expect(err).toBeTruthy();
    expect((err as any).reason).toBe(CollabAuthReason.LEASE_NOT_READY);   // 瞬态档（客户端 backoff 重连）
    expect((err as any).getResponse()).toEqual({ code: 'COLLAB_NOT_SERVING', message: 'doc-unloading' });   // REST 面 503 语义化（CollabNotServingFilter 附 Retry-After）
  });

  it('门族②（T9a serving 门装载面）：真空窗口拒装载——SUE doc-vacuuming（connected close 4410 的结构补位）', async () => {
    const { gateway } = buildGateway();
    gateway.setVacuuming('p-vac', true);
    const err = await gateway.hooks.onLoadDocument({ document: new Y.Doc(), documentName: 'project:p-vac', socketId: 's' } as any).then(() => null, (e: unknown) => e);
    expect((err as any).reason).toBe(CollabAuthReason.LEASE_NOT_READY);
    expect((err as any).getResponse()).toEqual({ code: 'COLLAB_NOT_SERVING', message: 'doc-vacuuming' });
  });

  it('门族③（P0-1 三入口②/V12）：非 serving 态拒装载——lease not held（collabState 派生单源）', async () => {
    const { gateway, gf } = buildGateway();
    gf.forceCollabState('isolated');
    const err = await gateway.hooks.onLoadDocument({ document: new Y.Doc(), documentName: 'project:p-lease', socketId: 's' } as any).then(() => null, (e: unknown) => e);
    expect((err as any).reason).toBe(CollabAuthReason.LEASE_NOT_READY);
    expect((err as any).message).toBe('collab lease not held');
  });

  it('门族④（T9a serving 门 WS 面）：connected 真空窗口 terminal close 4410 doc-vacuuming+早退（doc-status 补推不发生；寿命台账播种先于门）', async () => {
    const { gateway, gf } = buildGateway();
    gateway.setVacuuming('p-c', true);
    const conn = makeConn('s-c', 'project:p-c');
    await gateway.hooks.connected({ socketId: 's-c', connection: conn, documentName: 'project:p-c' } as any);
    expect(conn.webSocket.close).toHaveBeenCalledWith(CollabCloseCode.GENERATION_SUPERSEDED, DOC_VACUUMING_TERMINAL_REASON);   // 4410 terminal（T11 reload 通道）
    expect(conn.sendStateless).not.toHaveBeenCalled();   // 早退——buildDocStatus 补推不达
    expect(gf.connEstablishedAtHas('s-c')).toBe(true);   // 寿命台账播种=钩子首行（门检查之前 :467）
  });
});

// ═══ ②真空维：状态跃迁+纪元开启序（§6.1 表②行） ═══
describe('T41 W2 ②真空维：setVacuuming 幂等+beginVacuumEra 纪元序（门先开→thaw 回灌→freeze+terminal close）', () => {
  it('¬vacuuming→vacuuming→¬vacuuming：双 add/双 delete 幂等（Set 语义——重复置位不漂移）', () => {
    const { gateway } = buildGateway();
    expect(gateway.isVacuuming('p-v')).toBe(false);
    gateway.setVacuuming('p-v', true);
    gateway.setVacuuming('p-v', true);   // 幂等重入
    expect(gateway.isVacuuming('p-v')).toBe(true);
    gateway.setVacuuming('p-v', false);
    gateway.setVacuuming('p-v', false);   // 重复 delete 幂等
    expect(gateway.isVacuuming('p-v')).toBe(false);
  });

  it('beginVacuumEra：冻结 doc 先 thaw（U-5 回灌保命）+thawCooldown 播种→serving 门开→全连接 freeze+terminal close 4410', async () => {
    const { gateway, gf } = buildGateway();
    gf.addQuotaFrozen('p-ve');
    const conn = makeConn('s-ve', 'project:p-ve');
    seedRealDoc(gateway, 'p-ve', { conns: [conn] });
    await gateway.beginVacuumEra('p-ve');
    expect(gateway.isVacuuming('p-ve')).toBe(true);   // ② serving 门先开（竞态窗关闭）
    expect(gf.quotaFrozenHas('p-ve')).toBe(false);   // ⓪ thaw 回灌先行（冻结期编辑靠 SyncStep1 保命）
    expect(gf.thawCooldownHas('p-ve')).toBe(true);   // thaw 30s 复冻冷却播种
    expect(conn.readOnly).toBe(true);   // ① freeze 全连接（applyWriteFreeze 单源——close 前拦在飞写帧）
    expect(conn.webSocket.close).toHaveBeenCalledWith(CollabCloseCode.GENERATION_SUPERSEDED, DOC_VACUUMING_TERMINAL_REASON);
  });
});

// ═══ ③配额维：冻结状态机全跃迁+两幂等（§6.1 表③行——guardSyncFrame 唯一落点公有钩子驱动） ═══
describe('T41 W2 ③配额维：ok→pending→frozen→ok 全跃迁+freezeQuota 双调/scheduleFreezePending 去重', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('ok→pending（账面触阈冷却窗内上界决策）：freezePending+确认定时器在飞；**pending≠frozen**（G-1 两态分离——readOnly 不碰）；over 广播 rev++', async () => {
    const { gateway, gf } = buildGateway();
    const conn = makeConn('s-q1', 'project:p-q1');
    const doc = seedRealDoc(gateway, 'p-q1', { conns: [conn] });
    gf.seedDocTruth('p-q1', 950);
    gf.seedDocDelta('p-q1', 0);
    gf.seedTruthMeasuredAt('p-q1', Date.now());   // 冷却窗内（④上界决策分支）
    await syncUpdate(gateway, doc, conn);   // 950+0+200>soft(819) 且 >max(1024) ⇒ scheduleFreezePending
    expect(gf.freezePendingHas('p-q1')).toBe(true);
    expect(gf.freezePendingTimersHas('p-q1')).toBe(true);
    expect(gf.quotaFrozenHas('p-q1')).toBe(false);   // 确认窗不算冻结（T8 外审：shrink 达标不 thaw）
    expect(conn.readOnly).toBeFalsy();               // 禁碰 readOnly（v6 G-1——触发帧照常放行）
    expect(gf.docStatusRevOf('p-q1')).toBe(DOC_STATUS_REV_SEED + 1);   // 'over' 首广播 rev=SEED+1
  });

  it('scheduleFreezePending 去重（幂等重入）：在飞确认窗内二次触阈不重播定时器/不重复广播（rev 不爬）', async () => {
    const { gateway, gf } = buildGateway();
    const conn = makeConn('s-q2', 'project:p-q2');
    const doc = seedRealDoc(gateway, 'p-q2', { conns: [conn] });
    gf.seedDocTruth('p-q2', 950);
    gf.seedTruthMeasuredAt('p-q2', Date.now());
    await syncUpdate(gateway, doc, conn);
    const revAfterFirst = gf.docStatusRevOf('p-q2');
    await syncUpdate(gateway, doc, conn);   // 二次触阈（同窗）
    expect(gf.freezePendingTimersHas('p-q2')).toBe(true);
    expect(gf.docStatusRevOf('p-q2')).toBe(revAfterFirst);   // 单 doc 去重（:1723 在飞不重播——无第二次广播）
  });

  it('pending→frozen：确认定时器到期实测≥soft ⇒ freezeQuota 落地（setImmediate 同 turn 冻结连接）+pending/timer 自清', async () => {
    const { gateway, gf } = buildGateway();
    const conn = makeConn('s-q3', 'project:p-q3');
    const doc = seedRealDoc(gateway, 'p-q3', { big: true, conns: [conn] });
    gf.seedDocTruth('p-q3', 950);
    gf.seedTruthMeasuredAt('p-q3', Date.now());
    await syncUpdate(gateway, doc, conn);
    expect(gf.freezePendingHas('p-q3')).toBe(true);
    await vi.advanceTimersByTimeAsync(TRUTH_COOLDOWN_MS);   // 确认定时器 fire（豁免 truthBudget）
    await vi.advanceTimersByTimeAsync(1);                   // freezeQuota 的 setImmediate 落地
    expect(gf.quotaFrozenHas('p-q3')).toBe(true);           // pending→frozen（实测≥soft fail-closed）
    expect(gf.freezePendingHas('p-q3')).toBe(false);
    expect(gf.freezePendingTimersHas('p-q3')).toBe(false);
    expect(conn.readOnly).toBe(true);   // quotaFrozenDocs 与全部连接 readOnly 同一 event-loop-turn
  });

  it('pending→ok：确认实测<soft ⇒ 毫秒级纠错（calibrateTruth 校准+broadcast ok——不出 enter 计数=计数配对不虚高）', async () => {
    const { gateway, gf } = buildGateway();
    const conn = makeConn('s-q4', 'project:p-q4');
    const doc = seedRealDoc(gateway, 'p-q4', { conns: [conn] });   // 小 doc（编码 <819）
    gf.seedDocTruth('p-q4', 950);   // 陈旧账面（虚高）
    gf.seedTruthMeasuredAt('p-q4', Date.now());
    await syncUpdate(gateway, doc, conn);
    const enterDelta = await metricDelta('collab_quota_soft_threshold_total', { action: 'enter' }, async () => {
      await vi.advanceTimersByTimeAsync(TRUTH_COOLDOWN_MS);
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(gf.quotaFrozenHas('p-q4')).toBe(false);   // 未冻结（误冻结归零路径）
    expect(gf.freezePendingHas('p-q4')).toBe(false);
    expect(gf.docTruthOf('p-q4')).toBe(Y.encodeStateAsUpdate(doc).byteLength);   // truth 校准=实测值
    expect(gf.docTruthOf('p-q4')!).toBeLessThan(SOFT_ENTER);
    expect(conn.readOnly).toBeFalsy();
    expect(enterDelta).toBe(0);   // 无 enter 不出 exit（T8 外审 Minor：计数配对）
  });

  it('ok→frozen（硬限首触，冷却窗外实测）：freezeQuota+**放行本帧**（禁静默丢合法帧）+enter 恰 1+连接同 turn 冻结', async () => {
    const { gateway, gf } = buildGateway();
    const conn = makeConn('s-q5', 'project:p-q5');
    const doc = seedRealDoc(gateway, 'p-q5', { big: true, conns: [conn] });
    gf.seedDocTruth('p-q5', 700);   // 账面已过 soft（700+200>819——③快路径不吞帧的生产前置：装载播种/监听累积后才进④）
    gf.seedTruthMeasuredAt('p-q5', Date.now() - TRUTH_COOLDOWN_MS - 1);   // 冷却窗外（④实测分支）
    const enterDelta = await metricDelta('collab_quota_soft_threshold_total', { action: 'enter' }, async () => {
      await syncUpdate(gateway, doc, conn);   // ④窗外实测 measured(≈2005)+bytes(200)>max ⇒ freezeQuota+return（帧放行）
      await vi.advanceTimersByTimeAsync(1);   // setImmediate 落地
    });
    expect(gf.quotaFrozenHas('p-q5')).toBe(true);
    expect(conn.readOnly).toBe(true);
    expect(enterDelta).toBe(1);
    expect(gf.docTruthOf('p-q5')).toBe(Y.encodeStateAsUpdate(doc).byteLength);   // 实测校准三件套（truth/delta=0/measuredAt）
    expect(gf.docDeltaOf('p-q5')).toBe(0);
  });

  it('freezeQuota 双调幂等（T4 Minor：enter 计数移入回调+首行复检=双计根治）：同 tick 直触+确认定时器二次触发 ⇒ enter 恰 1', async () => {
    const { gateway, gf } = buildGateway();
    const conn = makeConn('s-q6', 'project:p-q6');
    const doc = seedRealDoc(gateway, 'p-q6', { big: true, conns: [conn] });
    gf.seedDocTruth('p-q6', 700);   // ③快路径前置（C5 同款——账面过 soft 才进④）
    gf.seedTruthMeasuredAt('p-q6', Date.now() - TRUTH_COOLDOWN_MS - 1);   // 冷却窗外
    const enterDelta = await metricDelta('collab_quota_soft_threshold_total', { action: 'enter' }, async () => {
      await syncUpdate(gateway, doc, conn);   // #1 窗外实测→freezeQuota（immediate 未落地）+truthMeasuredAt 更新
      await syncUpdate(gateway, doc, conn);   // #2 同 tick：冷却窗内账面触阈→scheduleFreezePending（确认定时器挂上）
      expect(gf.freezePendingTimersHas('p-q6')).toBe(true);
      await vi.advanceTimersByTimeAsync(1);   // immediate#1 落地=frozen+enter 1
      expect(gf.quotaFrozenHas('p-q6')).toBe(true);
      await vi.advanceTimersByTimeAsync(TRUTH_COOLDOWN_MS);   // 确认定时器 fire→实测≥soft→freezeQuota 二次调用
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(enterDelta).toBe(1);   // 双调恰计一次（:1748 方法首行幂等+:1751 回调首行复检双层）
    expect(gf.quotaFrozenHas('p-q6')).toBe(true);
    expect(gf.freezePendingHas('p-q6')).toBe(false);   // 确认定时器自清
  });

  it('frozen→ok（thawQuota 公有出口）：冻结解除+overPush 复位（唯一复位点）+thawCooldown 播种+readOnly 复位+exit 恰 1', async () => {
    const { gateway, gf } = buildGateway();
    const conn = makeConn('s-q7', 'project:p-q7');
    const doc = seedRealDoc(gateway, 'p-q7', { big: true, conns: [conn] });
    gf.seedDocTruth('p-q7', 700);   // ③快路径前置（C5 同款）
    gf.seedTruthMeasuredAt('p-q7', Date.now() - TRUTH_COOLDOWN_MS - 1);   // 冷却窗外
    await syncUpdate(gateway, doc, conn);   // 硬限首触→frozen
    await vi.advanceTimersByTimeAsync(1);
    expect(gf.quotaFrozenHas('p-q7')).toBe(true);
    gf.seedOverPush(conn.socketId, { count: 25, bytes: 999_999, firstAt: Date.now(), lastAt: Date.now() });   // 冻结期强推台账
    const exitDelta = await metricDelta('collab_quota_soft_threshold_total', { action: 'exit' }, () => gateway.thawQuota('p-q7'));
    expect(gf.quotaFrozenHas('p-q7')).toBe(false);
    expect(gf.thawCooldownHas('p-q7')).toBe(true);            // 30s 复冻冷却（防贴阈抖动 UI 闪断）
    expect(gf.overPushHas(conn.socketId)).toBe(false);        // overPush 复位唯一出口=thawQuota（freeze 重入不清零）
    expect(conn.readOnly).toBe(false);                        // applyWriteFreeze('quota',false) 单源解除
    expect(gf.writeFreezeHas(conn)).toBe(false);              // 原因集空=条目自动删
    expect(exitDelta).toBe(1);
  });
});

// ═══ 清理点普查表（§6.2——三入口逐键全断言+键集差异逐键钉死） ═══
// 差异矩阵（源码实测——「补齐清理」式行为漂移即红）：
//   vacuumingDocs：afterUnload ✗ / purge ✗ / projectsGone ✓（:1157 兜底——service finally 双保险）
//   autoVacuumLastAt：afterUnload ✗ / purge ✓（:1436 Z66）/ projectsGone ✗
//   storeFailedDocs：afterUnload ✓（:2043 Z110 真卸载终态）/ purge ✗ / projectsGone ✗
//   writeFreeze/overPush：afterUnload ✗ / purge ✓（:1438-1442 经 applyWriteFreeze 单源解除）/ projectsGone ✗
//   lastCompactAt/persistUnhealthy/pendingQueues：afterUnload ✗（beforeUnload finally 已清=persistence
//     onDocumentUnload/recycleEmptyQueue 职责）/ purge ✓（purgePersistenceState+recycleEmptyQueue）/
//     projectsGone ✓（onProjectGone X1 discard+M6 回收）
describe('T41 W2 清理点普查表：三入口逐键全断言+键集差异逐键钉死（防「补齐清理」漂移）', () => {
  it('入口① afterUnloadDocument（真卸载终态）：15 键+锚结算全清；差异键 vacuuming/autoVacuumLastAt/writeFreeze/overPush/persistence 三键**保留**', async () => {
    const { gateway, gf } = buildGateway();
    const conn = makeConn('s-au', 'project:p-au');
    seedAllPidState(gateway, gf, 'p-au', conn);
    // beforeUnload 锚播种（unloadDocument 播种子步 :1989——truth 在 afterUnload 被清所以先存编码字节）
    await gateway.hooks.beforeUnloadDocument({ document: { name: 'project:p-au', connections: new Map() }, documentName: 'project:p-au' } as any);
    const anchor = gf.unloadHeapAnchorOf('p-au');
    expect(anchor).toBeDefined();
    expect(anchor!.truth).toBe(100);   // =seedDocTruth 值（锚携带真值供 destroy 后倍率结算）
    // beforeUnload finally 已清 persistence 侧三键（onDocumentUnload+recycleEmptyQueue 职责）——重播以钉 afterUnload 不清它们
    gf.backdateLastCompactAt('p-au', 1);
    gf.addPersistUnhealthy('project:p-au');
    gf.seedPendingQueue('p-au', []);
    await gateway.hooks.afterUnloadDocument({ documentName: 'project:p-au' } as any);
    // ── 15 键全清（14 DR 键+storeFailedDocs persistence 台账）+锚结算消耗 ──
    expect(gf.docTruthHas('p-au')).toBe(false);
    expect(gf.docDeltaHas('p-au')).toBe(false);
    expect(gf.truthMeasuredAtHas('p-au')).toBe(false);
    expect(gf.degradedDocsHas('p-au')).toBe(false);
    expect(gateway.storeFailedDocs.has('p-au')).toBe(false);   // Z110：淘汰标记随 doc 消亡
    expect(gf.quotaFrozenHas('p-au')).toBe(false);
    expect(gf.freezePendingHas('p-au')).toBe(false);
    expect(gf.freezePendingTimersHas('p-au')).toBe(false);     // 确认定时器随清（防终态后迟到 fire）
    expect(gf.recheckRoundsHas('p-au')).toBe(false);
    expect(gf.thawCooldownHas('p-au')).toBe(false);
    expect(gf.docStatusRevOf('p-au')).toBeUndefined();         // rev 删除=重装载复位新 epoch
    expect(gf.docStatusStateHas('p-au')).toBe(false);
    expect(gf.docGenerationOf('p-au')).toBeUndefined();
    expect(gf.preVacuumSvOf('p-au')).toBeUndefined();
    expect(gateway.docResidueOf('p-au')).toBe(0);
    expect(gf.unloadHeapAnchorOf('p-au')).toBeUndefined();     // 锚结算消耗（:2033-2034）
    // ── 差异键保留（afterUnload 不清——逐键钉死） ──
    expect(gateway.isVacuuming('p-au')).toBe(true);
    expect(gf.autoVacuumLastAtHas('p-au')).toBe(true);
    expect(gf.writeFreezeHas(conn)).toBe(true);
    expect(gf.overPushHas('s-au')).toBe(true);
    expect(gf.lastCompactAtHas('p-au')).toBe(true);
    expect(gf.persistUnhealthyHas('project:p-au')).toBe(true);
    expect(gf.pendingQueueHas('p-au')).toBe(true);   // afterUnload 不回收队列条目
  });

  it('入口② purgeDocState（vacuum ③ 清进程态）：15 键（含 autoVacuumLastAt 专属）+writeFreeze/overPush 经单源解除+persistence 两步+空队列回收；storeFailedDocs/vacuuming **保留**', () => {
    const { gateway, gf } = buildGateway();
    const conn = makeConn('s-pg', 'project:p-pg');
    seedAllPidState(gateway, gf, 'p-pg', conn);
    gateway.purgeDocState('p-pg');
    // ── 15 键全清（14 DR+autoVacuumLastAt 专属清理键 Z66） ──
    expect(gf.docTruthHas('p-pg')).toBe(false);
    expect(gf.docDeltaHas('p-pg')).toBe(false);
    expect(gf.truthMeasuredAtHas('p-pg')).toBe(false);
    expect(gf.degradedDocsHas('p-pg')).toBe(false);
    expect(gf.quotaFrozenHas('p-pg')).toBe(false);
    expect(gf.freezePendingHas('p-pg')).toBe(false);
    expect(gf.freezePendingTimersHas('p-pg')).toBe(false);
    expect(gf.recheckRoundsHas('p-pg')).toBe(false);
    expect(gf.thawCooldownHas('p-pg')).toBe(false);
    expect(gf.docStatusRevOf('p-pg')).toBeUndefined();
    expect(gf.docStatusStateHas('p-pg')).toBe(false);
    expect(gf.docGenerationOf('p-pg')).toBeUndefined();
    expect(gf.preVacuumSvOf('p-pg')).toBeUndefined();
    expect(gateway.docResidueOf('p-pg')).toBe(0);
    expect(gf.autoVacuumLastAtHas('p-pg')).toBe(false);   // **purge 专属**（:1436——afterUnload/projectsGone 均不清）
    // ── SG 缝+persistence 两步+回收 ──
    expect(gf.writeFreezeHas(conn)).toBe(false);          // 经 applyWriteFreeze 逐原因解除（禁绕过单源直删）
    expect(conn.readOnly).toBe(false);                    // readOnly 复位+条目删
    expect(gf.overPushHas('s-pg')).toBe(false);           // socketId 反查连带清（:1441）
    expect(gf.lastCompactAtHas('p-pg')).toBe(false);      // persistence.purgePersistenceState 步①
    expect(gf.persistUnhealthyHas('project:p-pg')).toBe(false);   // 步②
    expect(gf.pendingQueueHas('p-pg')).toBe(false);       // recycleEmptyQueue（quiesce 已保证空）
    // ── 差异键保留 ──
    expect(gateway.storeFailedDocs.has('p-pg')).toBe(true);   // Z110 清点=真卸载专属
    expect(gateway.isVacuuming('p-pg')).toBe(true);           // purge 不含 vacuumingDocs（service finally+projectsGone 双保险）
  });

  it('入口③ handleProjectsGone（project.gone 事件终态）：DR 15 键（含 vacuumingDocs 专属兜底）+persistence 侧清账+终态集登记；storeFailedDocs/autoVacuumLastAt/writeFreeze/overPush **保留**', async () => {
    const { gateway, gf, emitter } = buildGateway();
    await gateway.onModuleInit();   // project.gone 订阅注册（lease stub fast=false——不 listen 不起 collab 面）
    const conn = makeConn('s-gone', 'project:p-gone');
    seedAllPidState(gateway, gf, 'p-gone', conn);
    emitter.emit('project.gone', { projectIds: ['p-gone'] });   // 同步派发（project-gone spec 同款——V11 禁慢操作）
    // ── DR 15 键全清（14+vacuumingDocs 专属兜底 :1157） ──
    expect(gf.docTruthHas('p-gone')).toBe(false);
    expect(gf.docDeltaHas('p-gone')).toBe(false);
    expect(gf.truthMeasuredAtHas('p-gone')).toBe(false);
    expect(gf.degradedDocsHas('p-gone')).toBe(false);
    expect(gf.quotaFrozenHas('p-gone')).toBe(false);
    expect(gf.freezePendingHas('p-gone')).toBe(false);
    expect(gf.freezePendingTimersHas('p-gone')).toBe(false);   // 确认定时器随清（防终态后迟到 fire :1147-1148）
    expect(gf.recheckRoundsHas('p-gone')).toBe(false);
    expect(gf.thawCooldownHas('p-gone')).toBe(false);
    expect(gf.docStatusRevOf('p-gone')).toBeUndefined();
    expect(gf.docStatusStateHas('p-gone')).toBe(false);
    expect(gf.docGenerationOf('p-gone')).toBeUndefined();
    expect(gf.preVacuumSvOf('p-gone')).toBeUndefined();
    expect(gateway.docResidueOf('p-gone')).toBe(0);
    expect(gateway.isVacuuming('p-gone')).toBe(false);   // **projectsGone 专属**（真空窗口中项目消失的兜底——afterUnload/purge 均不清）
    // ── persistence 侧（onProjectGone 子步）──
    expect(gf.deletedProjectsHas('p-gone')).toBe(true);        // 终态集登记（V10）
    expect(gf.lastCompactAtHas('p-gone')).toBe(false);
    expect(gf.persistUnhealthyHas('project:p-gone')).toBe(false);
    expect(gf.pendingQueueHas('p-gone')).toBe(false);          // X1 显式清账+M6 空条目回收
    // ── 差异键保留 ──
    expect(gateway.storeFailedDocs.has('p-gone')).toBe(true);
    expect(gf.autoVacuumLastAtHas('p-gone')).toBe(true);
    expect(gf.writeFreezeHas(conn)).toBe(true);   // 连接态由 closeTeamDocuments 关断后 onDisconnect 常规清（事件处理器不触碰）
    expect(gf.overPushHas('s-gone')).toBe(true);
  });

  it('TD-28 regression：spool 有帧时收割梯按 documentName 键（project:pid）保排+retryPersist 实耗 spool 帧（裸 pid 键=parseDocName 折空串→探空即 cancel→收割梯空转）', async () => {
    const { gateway, gf, repo, spool, emitter } = buildGateway();
    await gateway.onModuleInit();   // project.gone 订阅注册
    const payload = new Uint8Array([1, 2, 3]);
    await spool.append('p-gone2', payload);   // spool 帧播种（onProjectGone :919 hasFrames 判据）
    emitter.emit('project.gone', { projectIds: ['p-gone2'] });
    // 收割梯保排：键=documentName 口径族——与 :918 cancelPersistRetry(`project:${pid}`) 同键
    expect(gf.persistRetryHas('project:p-gone2')).toBe(true);
    expect(gf.persistRetryHas('p-gone2')).toBe(false);   // 裸 pid 键禁（同函数双键分叉即本缺陷形态）
    expect(gf.persistRetryEntry('project:p-gone2')?.timer).toBeTruthy();   // 退避梯真定时器在排
    // 实耗：retryPersist 走 detached spool 帧通道（peek→append→confirm）——帧清+repo 落帧
    await gf.retryPersist('project:p-gone2');
    expect(spool.hasFrames('p-gone2')).toBe(false);
    // Y1c T9 新表形态：帧通道落 PG=appendBatch(pid,[rows])——rows[0].update=payload（单帧行）
    expect(repo.appendBatch).toHaveBeenCalledWith('p-gone2', [expect.objectContaining({ update: payload, actorRanges: expect.anything() })], expect.objectContaining({ newPgSeq: 1n }));   // Y1c T10：applied-driven flusher（行带 actorRanges 真值+水位 CAS/追赶第三参）
  });
});

// ═══ ④降级维：真实写点（hydration deferred）+清理 ═══
describe('T41 W2 ④降级维：¬degraded→degraded（loadDocument :1108 真实写点）→清理', () => {
  it('装载跳行降级（pendingStructs 非空）：degradedDocs.add+isDocDegraded 公有读面真（Q-O 降级可观测非沉默）', async () => {
    const { gateway, repo } = buildGateway();
    // 缺依赖 diff 装置=**单 doc 超前行**形态（library-anchors A7b/quota-truth 真红门④ 已证构造——
    // 左 origin 悬置 ⇒ pendingStructs 非空）；双 doc 整行缺失形态=A7a 已证**不可探测**（pendingStructs
    // 恒 null 但内容缺失）——装置必须用 A7b 形态才是「跳行降级可观测」的真实病理
    const src = new Y.Doc();
    src.getMap('nodes').set('n1', new Y.Map([['type', 'text']]));
    const sv1 = Y.encodeStateVector(src);
    src.getMap('nodes').set('n2', new Y.Map([['type', 'image']]));   // 同 doc 后写（clock 超前 sv1——依赖悬置 item）
    const diff = Y.encodeStateAsUpdate(src, sv1);
    repo.hydrateWithRecovery.mockResolvedValueOnce({ state: Buffer.from(diff), updates: [], stateSeq: 0n });
    expect(gateway.isDocDegraded('p-deg')).toBe(false);
    await gateway.hooks.onLoadDocument({ document: new Y.Doc(), documentName: 'project:p-deg', socketId: 's-deg' } as any);
    expect(gateway.isDocDegraded('p-deg')).toBe(true);   // 公有谓词（residency acquire 阻断常驻判据 Z111）
    expect(gatewayFacade(gateway).degradedDocsHas('p-deg')).toBe(true);
  });

  it('degraded→¬degraded：afterUnloadDocument 清理（真卸载=新 epoch 复位）', async () => {
    const { gateway, gf } = buildGateway();
    gf.addDegradedDoc('p-d2');
    expect(gateway.isDocDegraded('p-d2')).toBe(true);
    await gateway.hooks.afterUnloadDocument({ documentName: 'project:p-d2' } as any);
    expect(gateway.isDocDegraded('p-d2')).toBe(false);
  });
});

// ═══ ⑤store 失败维：Z110 淘汰标记生命周期（persistence 台账+gateway 委托位④读面） ═══
describe('T41 W2 ⑤store 失败维：storeFailedDocs 真卸载终态清理（清点=store 成功+真卸载两点）', () => {
  it('add（append 失败点模拟）→ afterUnloadDocument delete：公有 getter=service 真实 Set 引用（B1 委托位④身份契约）', async () => {
    const { gateway } = buildGateway();
    gateway.storeFailedDocs.add('p-sf');   // 写点=persistence store 失败腿（:332）——此处直 add 模拟台账态
    expect(gateway.storeFailedDocs.has('p-sf')).toBe(true);
    await gateway.hooks.afterUnloadDocument({ documentName: 'project:p-sf' } as any);
    expect(gateway.storeFailedDocs.has('p-sf')).toBe(false);   // :2043 真卸载终态——淘汰标记随 doc 消亡
    // 差异面：purge/projectsGone 不清 storeFailedDocs——钉死在普查表 D2/D3（保留断言）
  });
});

// ═══ ⑥常驻维：委托位未 attach 语义三断言+attach 缝+Z65 域视角复断言（§6.3-4） ═══
describe('T41 W2 ⑥常驻维：residency 委托位（B2 迁 DR 域——本批钉现状语义防搬迁漂移）', () => {
  it('未 attach 三断言：tryReleaseResidentSession→undefined / releaseAllResidentSessions→no-op / probe→0（直构 gateway 无 residency=会话表概念不存在）', async () => {
    const { gateway, gf } = buildGateway();
    await expect(gateway.tryReleaseResidentSession('p-x', 'vacuum')).resolves.toBeUndefined();   // :315-318 注释语义（「会话已不在」）
    await expect(gateway.releaseAllResidentSessions('drain')).resolves.toBeUndefined();          // 未注册=no-op（:325-328）
    expect(gf.residentSessionsProbeCount()).toBe(0);   // 未注册=0（T18 hangReason resident-session-open 档判据同源）
  });

  it('attach 缝（公有注册点——residency 构造期形态）：releaser 透传 outcome（I-3）+pid=null 全量语义+probe 读面接通', async () => {
    const { gateway, gf } = buildGateway();
    const releaser = vi.fn(async (pid: string | null, _motive: TryReleaseMotive): Promise<TryReleaseOutcome | undefined> => (pid === null ? undefined : 'released'));
    gateway.registerResidentSessionReleaser(releaser);
    gateway.registerResidentSessionsProbe(() => 3);
    await expect(gateway.tryReleaseResidentSession('p-y', 'reaper')).resolves.toBe('released');   // outcome 透传（quiesce break 判据）
    expect(releaser).toHaveBeenCalledWith('p-y', 'reaper');
    await gateway.releaseAllResidentSessions('shutdown');
    expect(releaser).toHaveBeenCalledWith(null, 'shutdown');   // pid=null ⇒ 全部常驻会话（drain/隔离/关停出口）
    expect(gf.residentSessionsProbeCount()).toBe(3);
  });

  it('releaser 异常折 undefined（quiesce 循环 deadline 兜底——转发面不抛）', async () => {
    const { gateway } = buildGateway();
    gateway.registerResidentSessionReleaser(vi.fn(async () => { throw new Error('boom'); }));
    await expect(gateway.tryReleaseResidentSession('p-z', 'vacuum')).resolves.toBeUndefined();   // :321 拒绝分支归 undefined
  });

  it('Z65 域视角复断言（Z105 定案口径）：isDocResident=仅 WS 连接数>0——direct（常驻会话）不计入；合计口径不变量宿主=residency spec :375-390 零触碰', () => {
    const { gateway } = buildGateway();
    seedFakeDoc(gateway, 'project:p-r1', { conns: [], direct: 2 });
    expect(gateway.isDocResident('p-r1')).toBe(false);   // 零 WS∧direct 2（常驻持有）=非常驻——Z105：合计计入会把 reconcile 无人项目钉内存
    const wsConn = makeConn('s-r2', 'project:p-r2');
    seedFakeDoc(gateway, 'project:p-r2', { conns: [wsConn], direct: 0 });
    expect(gateway.isDocResident('p-r2')).toBe(true);    // WS 1 条=常驻判定真（Z105 唯一形态 hasActiveWsConnection）
    expect(gateway.isDocResident('p-absent')).toBe(false);   // 无 doc=非常驻
  });
});
