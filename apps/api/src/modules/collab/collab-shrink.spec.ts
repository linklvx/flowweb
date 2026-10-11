// apps/api/src/modules/collab/collab-shrink.spec.ts
// Y0b-4 T8（Q-G）——REST shrink：影子预演（不达标不写活 doc）/TOCTOU 读+算+删同一同步段/
// 纯 recalibrate（空体同语义）/thaw 回灌（truth<0.6×MAX）/全局信号量并发 1+排队超时 503/
// gc pin（gc:false=删除不收壳=瘦身静默失效）/@Throttle 5/min 独立桶。
// 装置：gateway 直构（quota-truth.spec 先例）+真 Y.Doc 手动挂 documents（shutdown.spec
// seedPendingDoc 先例——connections/saveMutex/getConnections 库 Document 形状补齐）；
// withDoc mock 直透 fn(doc) 且守卫回调全同步（withDoc transact 语义——collab-document.service.ts:53）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, ForbiddenException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import * as Y from 'yjs';
import { register } from 'prom-client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CANVAS_DOC_SCHEMA_VERSION, QUOTA_DEFAULTS, readRecordsFromMaps } from '@flowweb/shared';
import { CollabGateway, TRUTH_COOLDOWN_MS, type QuotaConfig } from './collab.gateway';
import { toDocLike } from './doc-like.util';
import { CollabShrinkService, SHRINK_QUEUE_TIMEOUT_MS } from './collab-shrink.service';
import { CollabNotServingFilter } from './collab-not-serving.filter';
import { CollabSpoolService } from './collab-spool.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const MiB = 1024 * 1024;

let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};
beforeEach(async () => {
  const d = await makeSpoolDir('y0b4-shrink-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
});
afterEach(async () => { await spoolCleanup(); vi.restoreAllMocks(); });

/** 直构 gateway（quota-truth.spec 先例）：quota 注入受控 maxDocBytes */
function buildGateway(quota?: Partial<QuotaConfig>): CollabGateway {
  const repo = createMockRepo();
  const spool = new CollabSpoolService(spoolDir);
  spool.setOwner('shrink-owner');
  const gateway = new CollabGateway(
    {} as any, new EventEmitter2() as any, repo as any, createLeaseStub() as any,
    { resolve: vi.fn() } as any,
    46500 + Math.floor(Math.random() * 2500),
    undefined, undefined, undefined, spool,
    quota,
  );
  (gateway as any).collabState = 'serving';
  return gateway;
}

/** 库 Document 形状补齐+挂载（shutdown.spec seedPendingDoc 先例）——thawQuota 经 documents.get 取 doc */
function attachDoc(gateway: CollabGateway, doc: Y.Doc, pid: string, conns: Array<Record<string, any>> = []): void {
  Object.assign(doc, {
    saveMutex: { runExclusive: <T,>(fn: () => Promise<T>) => fn() },
    connections: new Map(conns.map((c) => [c, null])),
    getConnections: () => conns.map((c) => ({ socketId: c.socketId })),
  });
  gateway.server.hocuspocus.documents.set(`project:${pid}`, doc as any);
}

function makeConn(): Record<string, any> {
  return {
    readOnly: false,
    socketId: 'sock-' + Math.random().toString(36).slice(2, 8),
    sendStateless: vi.fn(),
    send: vi.fn(),
    messageAddress: 'project:p1',
    webSocket: { close: vi.fn() },
    context: {},
  };
}

function seedDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta').set('schemaVersion', CANVAS_DOC_SCHEMA_VERSION);
  return doc;
}

function addNode(doc: Y.Doc, id: string, payloadBytes = 0): void {
  const m = new Y.Map();
  m.set('type', 'videoGen');
  const data = new Y.Map();
  if (payloadBytes > 0) data.set('blob', 'x'.repeat(payloadBytes));
  m.set('data', data);
  doc.getMap('nodes').set(id, m);
}

function addEdge(doc: Y.Doc, id: string, source: string, target: string): void {
  const m = new Y.Map();
  m.set('source', source);
  m.set('target', target);
  doc.getMap('edges').set(id, m);
}

/** service 直构：perm mock+withDoc 真透传（守卫回调全同步——TOCTOU 契约）。
 *  T9：canvas/prisma 默认 mock（exportFresh 消费——源元数据 {name:'源画布',teamId:'t1',folderId:'f1'}
 *  /新 project 'p-new'）+docsByPid 可选多 doc 路由（源/新副本分档——缺省全透传 doc）。 */
function buildSvc(
  gateway: CollabGateway,
  doc: Y.Doc,
  opts?: { canvas?: any; prisma?: any; docsByPid?: Map<string, Y.Doc> },
) {
  const perm = { assertEditorWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' }) };
  const docs = {
    withDoc: vi.fn(async (_pid: string, fn: (d: Y.Doc) => unknown) => {
      const r = fn(opts?.docsByPid?.get(_pid) ?? doc);
      if (r instanceof Promise) throw new Error('withDoc 回调必须全同步（TOCTOU 契约——transact 同步段语义）');
      return r;
    }),
  };
  const canvas = opts?.canvas ?? {
    create: vi.fn(async () => ({ projectId: 'p-new', name: '源画布(瘦身副本)', teamId: 't1' })),
  };
  const prisma = opts?.prisma ?? {
    canvasProject: { findUnique: vi.fn(async () => ({ id: 'p1', name: '源画布', teamId: 't1', templates: [{ folderId: 'f1' }] })) },
  };
  const svc = new CollabShrinkService(perm as any, docs as any, gateway, canvas, prisma);
  return { svc, perm, docs, canvas, prisma };
}

/** prom-client 计数增量断言（quota-truth.spec 同款） */
async function counterDelta(name: string, labels: Record<string, string>, fn: () => Promise<unknown> | unknown): Promise<number> {
  const metric: any = register.getSingleMetric(name);
  const countOf = async () =>
    (await metric.get()).values.find((s: any) => Object.entries(labels).every(([k, v]) => s.labels[k] === v))?.value ?? 0;
  const before = await countOf();
  await fn();
  return (await countOf()) - before;
}

/** histogram _count 观测增量（collab_doc_shrink_duration_seconds） */
async function histogramCountDelta(name: string, fn: () => Promise<unknown> | unknown): Promise<number> {
  const metric: any = register.getSingleMetric(name);
  const countOf = async () => (await metric.get()).values.find((v: any) => v.metricName === `${name}_count`)?.value ?? 0;
  const before = await countOf();
  await fn();
  return (await countOf()) - before;
}

const nextTick = () => new Promise<void>((r) => setImmediate(() => r()));

describe('POST /api/collab/doc/:projectId/shrink（Q-G）', () => {
  it('EDITOR 403/未登录 401/预演超限→422 {bytes,limit} 活 doc 零变更（影子先算不达标不写——预演超限不写活 doc）', async () => {
    const gateway = buildGateway({ maxDocBytes: 2048 });
    const doc = seedDoc();
    addNode(doc, 'n1', 64);
    addNode(doc, 'n2', 4096);   // 保留侧大内容——删 n1 后编码仍 >2048
    addEdge(doc, 'e1', 'n1', 'n2');
    const { svc, perm, docs } = buildSvc(gateway, doc);

    // ① 权限拒绝（VIEWER/未登录同门——assertEditorWithTeam 恒先于 doc 访问）：403 且 withDoc 零调用
    perm.assertEditorWithTeam.mockRejectedValueOnce(new ForbiddenException('无项目编辑权限'));
    await expect(svc.shrink('p1', 'u-viewer', { deleteNodeIds: ['n1'] })).rejects.toThrow(ForbiddenException);
    expect(docs.withDoc).not.toHaveBeenCalled();
    // 未登录 401 由全局 AuthGuard 承载（/api/collab 不在 PUBLIC_PREFIXES——默认受保护，见 controller 源文本锚用例）

    // ② 预演超限：422 {code,bytes,limit}+活 doc 零变更（不删 n1/e1、不校准 truth、不 thaw）
    const thawSpy = vi.spyOn(gateway, 'thawQuota');
    const before = Y.encodeStateAsUpdate(doc);
    let err: any;
    const stillOver = await counterDelta('collab_doc_shrink_total', { result: 'still-over' }, async () => {
      err = await svc.shrink('p1', 'u1', { deleteNodeIds: ['n1'] }).catch((e) => e);
    });
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(422);
    expect(err.getResponse()).toMatchObject({ code: 'SHRINK_STILL_OVER', limit: 2048 });
    expect(typeof err.getResponse().bytes).toBe('number');   // 预演编码值（影子 doc 实测）
    expect(stillOver).toBe(1);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);      // 活 doc 零变更（字节级）
    expect((gateway as any).docTruth.has('p1')).toBe(false); // 未校准（calibrateTruth 未被触达——docTruth 无键）
    expect(thawSpy).not.toHaveBeenCalled();
  });

  it('body 校验：deleteNodeIds 与 keepNodeIds 都传→400（二选一）', async () => {
    const gateway = buildGateway();
    const doc = seedDoc();
    const { svc } = buildSvc(gateway, doc);
    await expect(svc.shrink('p1', 'u1', { deleteNodeIds: ['n1'], keepNodeIds: ['n2'] })).rejects.toThrow(BadRequestException);
  });

  it('TOCTOU：读+算+删同一同步事务段（并发新增边/节点不留悬挂——事务外 victims 重算=红相；断言 withDoc 回调全同步）', async () => {
    const gateway = buildGateway();
    const doc = seedDoc();
    addNode(doc, 'n1', 32);
    addNode(doc, 'n2', 32);
    addEdge(doc, 'e1', 'n1', 'n2');
    const { svc, docs } = buildSvc(gateway, doc);

    // keepNodeIds 反推：victims=fn 内读到的全集−keep。withDoc mock 在调 fn 前一刻塞并发新增（n3+悬挂边）
    // ——同步段内不可达的并发写以"fn 开始前最后落 doc"形态模拟；victims 若在事务外预解析（红相）
    // 则只含 n1，会漏 n3/悬挂边 e2 留在活 doc。
    const originalWithDoc = docs.withDoc.getMockImplementation()!;
    docs.withDoc.mockImplementationOnce(async (_pid: string, fn: (d: Y.Doc) => unknown) => {
      addNode(doc, 'n3', 32);            // 并发新增节点（keep 反推必须纳入——fn 内重算）
      addEdge(doc, 'e2', 'n1', 'n3');    // 并发新增边（引用 victim n1——悬挂边防护）
      addEdge(doc, 'e3', 'n3', 'n2');    // 并发新增边（n3 本身也是 victim——同删）
      return originalWithDoc(_pid, fn);
    });

    const r = await svc.shrink('p1', 'u1', { keepNodeIds: ['n2'] });
    expect(r.result).toBe('ok');
    expect(new Set(r.deletedIds)).toEqual(new Set(['n1', 'n3']));   // victims=fn 内最新全集−keep
    const nodes = doc.getMap('nodes');
    const edges = doc.getMap('edges');
    expect(nodes.has('n1')).toBe(false);
    expect(nodes.has('n3')).toBe(false);
    expect(nodes.has('n2')).toBe(true);
    expect(edges.size).toBe(0);           // e1 不存在（装置未加）+e2/e3 全删——零悬挂边
    // withDoc 回调全同步由 buildSvc 默认实现守卫（fn 返回 Promise 即 throw）——本用例走同守卫
    // 透传（originalWithDoc），shrink 成功即证同步段契约成立。
  });

  it('纯 recalibrate：body {recalibrate:true} 或空体——不删内容也校准+滞回评估（假冻结出口：truth≥softExit 不 thaw）', async () => {
    // 档一：truth<softExit 且未冻结 → thawed=false（T8 外审 Concern ①：thaw 冻结前置——未冻结
    // doc 校准成功≠冻结出口，不得触发 thawQuota）；body {recalibrate:true}
    const gateway = buildGateway({ maxDocBytes: 1 * MiB });
    const doc = seedDoc();
    addNode(doc, 'n1', 4096);
    (gateway as any).docTruth.set('p1', 12345);   // 预置陈旧 truth——校准应覆写
    (gateway as any).docDelta.set('p1', 999);
    const { svc } = buildSvc(gateway, doc);
    const expectWatermark = Y.encodeStateAsUpdate(doc).byteLength;
    let r1: any;
    const recalibrated = await counterDelta('collab_doc_shrink_total', { result: 'recalibrated' }, async () => {
      r1 = await svc.shrink('p1', 'u1', { recalibrate: true });
    });
    expect(r1.result).toBe('recalibrated');
    expect(r1.watermark).toBe(expectWatermark);
    expect(r1.deletedIds).toEqual([]);
    expect(doc.getMap('nodes').has('n1')).toBe(true);                    // 不删内容
    expect((gateway as any).docTruth.get('p1')).toBe(expectWatermark);   // 校准=truth 覆写
    expect((gateway as any).docDelta.get('p1')).toBe(0);                 // delta 归零
    expect(recalibrated).toBeGreaterThan(0);
    expect(r1.thawed).toBe(false);                                       // 未冻结 doc——thaw 冻结前置（Concern ①）后无出口

    // 档二：空体（三字段全无）=纯 recalibrate 同语义
    const r2 = await svc.shrink('p1', 'u1', {});
    expect(r2.result).toBe('recalibrated');

    // 档三：假冻结出口——truth≥softExit（大 doc 校准）thawed=false 且 thawQuota 零调用
    const gw2 = buildGateway({ maxDocBytes: 8 * 1024 });   // softExit=0.6×8KB=4915
    const big = seedDoc();
    addNode(big, 'big', 8192);
    (gw2 as any).docTruth.set('p1', 1);   // 装载播种态（真实路径 withDoc 装载播种——校准覆写前提，T3"未装载不复活"守卫）
    const s2 = buildSvc(gw2, big);
    const thawSpy = vi.spyOn(gw2, 'thawQuota');
    const r3 = await s2.svc.shrink('p1', 'u1', {});
    expect(r3.result).toBe('recalibrated');
    expect(r3.watermark!).toBeGreaterThan(Math.floor(8 * 1024 * QUOTA_DEFAULTS.softExitRatio));
    expect(r3.thawed).toBe(false);          // 滞回带/以上——不 thaw（假冻结出口）
    expect(thawSpy).not.toHaveBeenCalled();

    // 档四：noop——显式空 delete 集（deleteNodeIds:[]）非 recalibrate：不校准直接返回
    const noop = await counterDelta('collab_doc_shrink_total', { result: 'noop' }, () =>
      s2.svc.shrink('p1', 'u1', { deleteNodeIds: [] }));
    const r4 = await s2.svc.shrink('p1', 'u1', { deleteNodeIds: [] });
    expect(r4.result).toBe('noop');
    expect(r4.thawed).toBe(false);
    expect(noop).toBeGreaterThan(0);
    expect((gw2 as any).docTruth.get('p1')).toBe(r3.watermark);   // noop 不校准（truth 保持上次值）
  });

  it('成功：truth=活文档再编码（白名单点③）+thaw（truth<0.6×MAX 时 SyncStep1 回灌）+广播 rev++/ok/deletedIds', async () => {
    const gateway = buildGateway({ maxDocBytes: 1 * MiB });
    const doc = seedDoc();
    addNode(doc, 'n1', 500 * 1024);   // 大节点——删除后 truth 显著 <softExit
    addNode(doc, 'n2', 2048);
    addEdge(doc, 'e1', 'n1', 'n2');
    addEdge(doc, 'e2', 'n2', 'n1');
    const conn = makeConn();
    attachDoc(gateway, doc, 'p1', [conn]);
    const g = gateway as any;
    g.docTruth.set('p1', 1);   // 装载播种态（真实路径 withDoc 装载播种——校准覆写前提，T3"未装载不复活"守卫）
    (g as any).freezeQuota('p1');    // 预冻结：broadcast over+setImmediate 落地（quotaFrozenDocs+readOnly）
    await nextTick();
    expect(g.quotaFrozenDocs.has('p1')).toBe(true);
    expect(conn.readOnly).toBe(true);
    const overRev = g.docStatusRev.get('p1');
    expect(overRev).toBe(2);   // 无装载播种（直构）——首翻 over：SEED(1)+1

    const { svc } = buildSvc(gateway, doc);
    let r: any;
    const okDelta = await counterDelta('collab_doc_shrink_total', { result: 'ok' }, async () => {
      r = await svc.shrink('p1', 'u1', { deleteNodeIds: ['n1'] });
    });
    expect(okDelta).toBe(1);

    // 删除语义：n1+两关联边删、n2 留、零悬挂
    expect(doc.getMap('nodes').has('n1')).toBe(false);
    expect(doc.getMap('nodes').has('n2')).toBe(true);
    expect(doc.getMap('edges').size).toBe(0);

    // truth=活文档再编码（白名单③——非预演值）+校准落地
    const liveBytes = Y.encodeStateAsUpdate(doc).byteLength;
    expect(r.watermark).toBe(liveBytes);
    expect(g.docTruth.get('p1')).toBe(liveBytes);
    expect(g.docDelta.get('p1')).toBe(0);
    expect(liveBytes).toBeLessThan(Math.floor(1 * MiB * QUOTA_DEFAULTS.softExitRatio));   // 前置：出口阈值内

    // thaw：冻结解除+readOnly 复位+SyncStep1 回灌帧+广播 ok（rev++）
    expect(r.thawed).toBe(true);
    expect(g.quotaFrozenDocs.has('p1')).toBe(false);
    expect(conn.readOnly).toBe(false);
    expect(conn.send).toHaveBeenCalledTimes(1);   // thaw 回灌一帧 SyncStep1（writeFirstSyncStepFor）
    const okBroadcasts = conn.sendStateless.mock.calls
      .map((c: any[]) => JSON.parse(c[0]))
      .filter((m: any) => m?.type === 'doc-status' && m?.quota?.state === 'ok');
    expect(okBroadcasts.length).toBeGreaterThanOrEqual(1);
    expect(okBroadcasts[0].rev).toBe(overRev + 1);   // 翻转自增
    expect(g.docStatusRev.get('p1')).toBe(overRev + 1);

    // deletedIds 响应携带（客户端 undoManager.clear 数据源——Q-G）
    expect(r.deletedIds).toEqual(['n1']);
  });

  it('thaw 冻结前置（Concern ①）：未冻结 doc shrink 成功 → thawQuota 零调用+exit 计数零增量+零 SyncStep1+冷却窗零污染；冻结 doc → 照常 thaw', async () => {
    // 臂一：未冻结 doc（truth<softExit 的成功删除）——原实现无条件 thawQuota=exit 虚高+全连接
    // 冗余 SyncStep1+thawCooldown 30s 污染（活 doc+真连接形态——thawQuota 的 !document 早退不救）
    const gateway = buildGateway({ maxDocBytes: 1 * MiB });
    const doc = seedDoc();
    addNode(doc, 'n1', 4096);
    const conn = makeConn();
    attachDoc(gateway, doc, 'p1', [conn]);
    (gateway as any).docTruth.set('p1', 12345);
    const { svc } = buildSvc(gateway, doc);
    const thawSpy = vi.spyOn(gateway, 'thawQuota');
    let r1: any;
    const exitDelta = await counterDelta('collab_quota_soft_threshold_total', { action: 'exit' }, async () => {
      r1 = await svc.shrink('p1', 'u1', { deleteNodeIds: ['n1'] });
    });
    expect(r1.result).toBe('ok');
    expect(r1.thawed).toBe(false);                                  // 未冻结——无 thaw 出口
    expect(thawSpy).not.toHaveBeenCalled();                         // thawQuota 零调用
    expect(exitDelta).toBe(0);                                      // soft_threshold{exit} 零增量
    expect(conn.send).not.toHaveBeenCalled();                       // 冗余 SyncStep1 零往返
    expect((gateway as any).thawCooldown.has('p1')).toBe(false);    // 30s 冷却窗零污染
    expect((gateway as any).quotaFrozenDocs.has('p1')).toBe(false);

    // 臂二：冻结 doc → 照常 thaw（exit 计数配对+冷却窗播种——enter/exit 对账不虚高）
    (gateway as any).freezeQuota('p1');
    await nextTick();
    expect((gateway as any).quotaFrozenDocs.has('p1')).toBe(true);
    let r2: any;
    const exitDelta2 = await counterDelta('collab_quota_soft_threshold_total', { action: 'exit' }, async () => {
      r2 = await svc.shrink('p1', 'u1', { recalibrate: true });
    });
    expect(r2.thawed).toBe(true);
    expect(thawSpy).toHaveBeenCalledWith('p1');
    expect(exitDelta2).toBe(1);                                     // 冻结出口——配对计数
    expect((gateway as any).thawCooldown.has('p1')).toBe(true);
    expect((gateway as any).quotaFrozenDocs.has('p1')).toBe(false);
  });

  it('thaw 冻结前置收窄（T8 外审 Minor）：freezePending 确认窗内 shrink 达标 → thawQuota 零调用（真冻结 quotaFrozenDocs 才 thaw）+pending 定时器自收敛（到期实测<soft→calibrate+ok，不 freezeQuota）', async () => {
    vi.useFakeTimers();   // fake timers 下 buildGateway/attachDoc 先例=auth-defense.spec I-1/I-2
    try {
      const gateway = buildGateway({ maxDocBytes: 1 * MiB });
      const doc = seedDoc();
      addNode(doc, 'n1', 64);   // shrink 删 n1 后 truth 极小 <softExit——达标语境
      const conn = makeConn();
      attachDoc(gateway, doc, 'p1', [conn]);   // pending 定时器到期 documents.get 可达+连接可观测
      (gateway as any).docTruth.set('p1', 999_000);   // 陈旧大 truth（账面触阈语境）
      const { svc } = buildSvc(gateway, doc);
      const thawSpy = vi.spyOn(gateway, 'thawQuota');
      const g = gateway as any;
      g.scheduleFreezePending('p1');   // 账面触阈：broadcast over+挂 2s 确认定时器（两态分离——未冻结）
      expect(g.freezePending.has('p1')).toBe(true);
      expect(g.quotaFrozenDocs.has('p1')).toBe(false);

      let r: any;
      const exitDelta = await counterDelta('collab_quota_soft_threshold_total', { action: 'exit' }, async () => {
        r = await svc.shrink('p1', 'u1', { deleteNodeIds: ['n1'] });
      });
      expect(r.result).toBe('ok');
      expect(r.thawed).toBe(false);                   // 红相：改前 isQuotaFrozen=quotaStateOf 含 freezePending → thawed=true
      expect(thawSpy).not.toHaveBeenCalled();         // thawQuota 零调用（真冻结才 thaw）
      expect(exitDelta).toBe(0);                      // 无 enter 不出 exit——计数配对干净
      expect(g.freezePending.has('p1')).toBe(true);   // shrink 不碰 pending——定时器自收敛（下方推进验证）

      await vi.advanceTimersByTimeAsync(TRUTH_COOLDOWN_MS);   // pending 定时器自收敛
      expect(g.freezePending.has('p1')).toBe(false);
      expect(g.quotaFrozenDocs.has('p1')).toBe(false);        // 未 freezeQuota（实测<soft→calibrate+ok 分支）
      expect(conn.readOnly).toBe(false);                      // 全程未冻结——连接可写
    } finally {
      vi.useRealTimers();
    }
  });

  it('shrink 成功未 thaw force 广播 bytes（偏差③）：truth 实际变化 → 跳过 dedup rev++/bytes=watermark；truth 未变 → 不广播；滞回带冻结 doc → over 态 force 广播', async () => {
    // 臂一：未冻结 doc 删除成功（truth 变化）——上次广播同态（dedup 键 {state}:{frozen} 命中，
    // 非 force 会被吞——其他客户端 localDocBytes 拿不到新 truth 即红相）
    const gateway = buildGateway({ maxDocBytes: 1 * MiB });
    const doc = seedDoc();
    addNode(doc, 'n1', 64 * 1024);
    addNode(doc, 'n2', 2048);
    const conn = makeConn();
    attachDoc(gateway, doc, 'p1', [conn]);
    const g = gateway as any;
    g.docTruth.set('p1', Y.encodeStateAsUpdate(doc).byteLength);   // prevTruth=删除前真值
    g.docStatusRev.set('p1', 1);            // 装载播种形态
    g.docStatusState.set('p1', 'ok:false'); // 上次广播同态（state/frozen 均未变——dedup 命中面）
    const rev0 = g.docStatusRev.get('p1');
    const { svc } = buildSvc(gateway, doc);
    const r = await svc.shrink('p1', 'u1', { deleteNodeIds: ['n1'] });
    expect(r.result).toBe('ok');
    expect(r.thawed).toBe(false);                                 // 未冻结（Concern ①）——走 force 广播支
    expect(g.docStatusRev.get('p1')).toBe(rev0 + 1);              // 跳过 dedup——rev++（无 force 时被吞=rev 不变）
    const statuses = conn.sendStateless.mock.calls
      .map((c: any[]) => JSON.parse(c[0]))
      .filter((m: any) => m?.type === 'doc-status');
    expect(statuses.length).toBe(1);
    expect(statuses[0].quota.state).toBe('ok');
    expect(statuses[0].quota.bytes).toBe(r.watermark);            // 新 truth（滞回带/未冻结客户端的校准源）

    // 臂二：truth 未变（recalibrate 校准同值）→ 不广播（bytes 无变化——dedup 语义反而正确）
    const rev1 = g.docStatusRev.get('p1');
    conn.sendStateless.mockClear();
    const r2 = await svc.shrink('p1', 'u1', { recalibrate: true });
    expect(r2.result).toBe('recalibrated');
    expect(r2.watermark).toBe(r.watermark);                       // truth 未变（同 doc 再编码同值）
    expect(g.docStatusRev.get('p1')).toBe(rev1);                  // 零 rev 变化
    expect(conn.sendStateless).not.toHaveBeenCalled();            // 零广播

    // 臂三：滞回带冻结 doc——shrink 成功落在 [softExit, softEnter) → 不 thaw+over 态 force 广播新 bytes
    const gw2 = buildGateway({ maxDocBytes: 8192 });   // softExit=4915/softEnter=6553
    const doc2 = seedDoc();
    addNode(doc2, 'big', 6400);
    addNode(doc2, 'keep', 5500);
    const conn2 = makeConn();
    attachDoc(gw2, doc2, 'p2', [conn2]);
    const g2 = gw2 as any;
    g2.docTruth.set('p2', Y.encodeStateAsUpdate(doc2).byteLength);
    g2.freezeQuota('p2');
    await nextTick();
    expect(g2.quotaFrozenDocs.has('p2')).toBe(true);
    const overRev = g2.docStatusRev.get('p2');   // freeze 的 over 广播后（dedup 态=over:true）
    conn2.sendStateless.mockClear();
    const s2 = buildSvc(gw2, doc2);
    const r3 = await s2.svc.shrink('p2', 'u1', { deleteNodeIds: ['big'] });
    expect(r3.result).toBe('ok');
    expect(r3.watermark!).toBeGreaterThanOrEqual(Math.floor(8192 * QUOTA_DEFAULTS.softExitRatio));
    expect(r3.watermark!).toBeLessThan(Math.floor(8192 * QUOTA_DEFAULTS.softEnterRatio));   // 滞回带
    expect(r3.thawed).toBe(false);                    // 冻结但 truth≥softExit——不 thaw（假冻结出口保持）
    expect(g2.quotaFrozenDocs.has('p2')).toBe(true);  // 冻结不解除
    expect(conn2.readOnly).toBe(true);
    expect(conn2.send).not.toHaveBeenCalled();        // 无 thaw——零 SyncStep1
    expect(g2.docStatusRev.get('p2')).toBe(overRev + 1);   // over 态 force（dedup 键未变——非 force 被吞）
    const st3 = conn2.sendStateless.mock.calls
      .map((c: any[]) => JSON.parse(c[0]))
      .filter((m: any) => m?.type === 'doc-status');
    expect(st3.length).toBe(1);
    expect(st3[0].quota.state).toBe('over');
    expect(st3[0].quota.bytes).toBe(r3.watermark);    // 冻结期客户端也拿到新 truth
  });

  it('全局信号量并发 1：第二并发 shrink 请求等待（非 429——排队）+时长直方图可见', async () => {
    const gateway = buildGateway();
    const doc = seedDoc();
    addNode(doc, 'n1', 64);
    const { svc, docs } = buildSvc(gateway, doc);

    // withDoc 注入 30ms 延迟：第一请求在 async 间隙（openDirectConnection 等价窗）时第二请求排队
    const order: string[] = [];
    docs.withDoc.mockImplementation(async (_pid: string, fn: (d: Y.Doc) => unknown) => {
      order.push('enter');
      await new Promise((r) => setTimeout(r, 30));
      const r = fn(doc);
      if (r instanceof Promise) throw new Error('fn must be sync');
      order.push('exit');
      return r;
    });
    const observed = await histogramCountDelta('collab_doc_shrink_duration_seconds', () =>
      Promise.all([svc.shrink('p1', 'u1', {}), svc.shrink('p1', 'u1', {})]));
    expect(order).toEqual(['enter', 'exit', 'enter', 'exit']);   // 串行——第二请求等待而非拒绝
    expect(observed).toBe(2);   // 时长直方图可见（两次同步段各 observe 一次——排队等待不计入）
  });

  it('排队 10s 超时→503 {code:SHRINK_BUSY}+Retry-After（超时请求不占队列执行位）', async () => {
    const gateway = buildGateway();
    const doc = seedDoc();
    const { svc, docs } = buildSvc(gateway, doc);
    expect(SHRINK_QUEUE_TIMEOUT_MS).toBe(10_000);

    vi.useFakeTimers();
    try {
      let releaseFirst!: (v: unknown) => void;
      docs.withDoc.mockImplementationOnce(() => new Promise((r) => { releaseFirst = r; }));   // 第一请求占位挂起
      const p1 = svc.shrink('p1', 'u1', {});
      const p2 = svc.shrink('p1', 'u1', {});   // 排队
      const p2caught = p2.catch((x) => x);     // 立即挂 handler（reject 发生在下一断言前——防 unhandled rejection 窗）
      await vi.advanceTimersByTimeAsync(0);    // flush microtasks：p2 完成 perm await 后进入等待队列
      await vi.advanceTimersByTimeAsync(SHRINK_QUEUE_TIMEOUT_MS);
      const e = await p2caught;
      expect(e).toBeInstanceOf(ServiceUnavailableException);
      expect(e.getResponse()).toMatchObject({ code: 'SHRINK_BUSY' });
      // 超时请求不占执行位：释放第一请求后队列已空（p2 未执行 withDoc——零第二进入）
      releaseFirst({ result: 'recalibrated', thawed: false });
      await expect(p1).resolves.toMatchObject({ result: 'recalibrated' });
      expect(docs.withDoc).toHaveBeenCalledTimes(1);   // p2 从未进 withDoc（不占执行位）
    } finally {
      vi.useRealTimers();
    }

    // Retry-After 头：CollabNotServingFilter 认 SHRINK_BUSY 码（COLLAB_NOT_SERVING 同族——503 语义化）
    const res = { status: vi.fn().mockReturnThis(), setHeader: vi.fn().mockReturnThis(), json: vi.fn() };
    const host: any = { switchToHttp: () => ({ getResponse: () => res }) };
    const body = { code: 'SHRINK_BUSY', retryAfterSeconds: 10 };
    new CollabNotServingFilter().catch(Object.assign(new ServiceUnavailableException(body), { getResponse: () => body }) as any, host);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '10');
    expect(res.json).toHaveBeenCalledWith(body);
  });

  it('gc pin：本 spec 读回 yDocOptions:{gc:true}（gc:false=删除不收壳=瘦身静默失效）', () => {
    const gateway = buildGateway();
    const yDocOptions = (gateway.server.configuration as any).yDocOptions;
    expect(yDocOptions.gc).toBe(true);   // 库默认 true——显式 pin 防升级翻转（P24 文档锚先例）
    expect(yDocOptions.gcFilter).toBeInstanceOf(Function);
    expect(yDocOptions.gcFilter()).toBe(true);
  });

  it('@Throttle 5/min 独立桶+未登录面全局 AuthGuard 承载（源文本锚——video-work.controller.spec 先例）', () => {
    const src = readFileSync(resolve(__dirname, 'collab-doc.controller.ts'), 'utf8');
    expect(src).toContain('@Throttle({ default: { limit: 5, ttl: 60_000 } })');   // 独立桶覆盖全局 300/min
    expect(src).not.toContain('@SkipThrottle');                                    // 不豁免全局限流
    expect(src).toContain("@Controller('api/collab/doc')");                        // 路由前缀（PUBLIC_PREFIXES 外=默认受保护——401 由全局 AuthGuard 承载）
  });
});

describe('POST /api/collab/doc/:projectId/export-fresh（Q-H——真实签名/团队归属/latch）', () => {
  it('真实签名 create(name, folderId, userId, teamId)：显式传源 teamId/folderId/派生名——不传 teamId=落默认团队（协作者失访=红相：断言 create 第四参===源项目 teamId）', async () => {
    const gateway = buildGateway();
    const doc = seedDoc();
    addNode(doc, 'n1', 64);
    const canvas = { create: vi.fn(async () => ({ projectId: 'p-new', name: '源画布(瘦身副本)', teamId: 't1' })) };
    const { svc, prisma } = buildSvc(gateway, doc, { canvas });
    const r = await svc.exportFresh('p1', 'u1');
    expect(prisma.canvasProject.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p1' } }));
    expect(canvas.create).toHaveBeenCalledTimes(1);
    // 四参真实签名（canvas.service.ts:17）：派生名〈原名〉(瘦身副本)/源 folderId（template 行）/发起人/源项目 teamId
    expect(canvas.create).toHaveBeenCalledWith('源画布(瘦身副本)', 'f1', 'u1', 't1');
    expect(r.result).toBe('ok');
    expect(r.projectId).toBe('p-new');
  });

  it('fillDoc(doc, records, edges) 干净编码（墓碑场景：新 doc 编码显著小于源+records 等价——真实签名 fillDoc 三参数）+落地后编码校验（超限 warning 不阻断——响应带 warning 字段）', async () => {
    // 墓碑主导源：反复写删（gc:true 删除收壳但 delete set/GC 壳随事务线性累积 ~19.7B/事务——
    // v4 实测口径；探针校准：200 对+2×512B keep ⇒ src≈4.7KB / fillFresh≈1.2KB，余量 ~50%）
    const makeSrc = (): Y.Doc => {
      const src = seedDoc();
      for (let i = 0; i < 200; i++) {
        addNode(src, 'tmp' + i, 64);
        src.getMap('nodes').delete('tmp' + i);
      }
      addNode(src, 'keep1', 512);
      addNode(src, 'keep2', 512);
      return src;
    };
    const bytesOf = (d: Y.Doc) => Y.encodeStateAsUpdate(d).byteLength;

    // 档一：限内——干净编码（墓碑不随行）+records 等价（readRecordsFromMaps 单源互证）+零 warning
    const gw1 = buildGateway({ maxDocBytes: 1 * MiB });
    const src1 = makeSrc();
    const fresh1 = new Y.Doc();
    const s1 = buildSvc(gw1, src1, { docsByPid: new Map([['p1', src1], ['p-new', fresh1]]) });
    const r1 = await s1.svc.exportFresh('p1', 'u1');
    expect(r1.result).toBe('ok');
    expect(r1.bytes).toBe(bytesOf(fresh1));                      // 落地编码校验值=新 doc 真实编码
    expect(r1.bytes).toBeLessThan(bytesOf(src1) / 2);            // 新 doc 编码显著小于源
    expect(readRecordsFromMaps(toDocLike(fresh1))).toEqual(readRecordsFromMaps(toDocLike(src1)));   // records 等价
    expect(r1.warning).toBeUndefined();                          // 限内无 warning

    // 档二：新副本编码仍超限（内容真大）——不阻断+响应带 warning 字段
    const gw2 = buildGateway({ maxDocBytes: 1024 });
    const src2 = makeSrc();
    const fresh2 = new Y.Doc();
    const s2 = buildSvc(gw2, src2, { docsByPid: new Map([['p1', src2], ['p-new', fresh2]]) });
    const r2 = await s2.svc.exportFresh('p1', 'u1');
    expect(r2.result).toBe('ok');                                // 超限不阻断
    expect(r2.bytes).toBeGreaterThan(1024);                      // 前置：确实超限
    expect(typeof r2.warning).toBe('string');                    // warning 字段（Q-H——超限告知不阻断）
    expect(r2.projectId).toBe('p-new');
  });

  it('in-flight latch：并发两请求新 project 数=1（第二请求复用同 Promise——create 调用数=1 不变量；指标分列 ok/in-flight 各一）', async () => {
    const gateway = buildGateway();
    const doc = seedDoc();
    addNode(doc, 'n1', 64);
    let release!: () => void;
    const canvas = {
      create: vi.fn(() => new Promise<any>((r) => {
        release = () => r({ projectId: 'p-new', name: '源画布(瘦身副本)', teamId: 't1' });
      })),
    };
    const { svc } = buildSvc(gateway, doc, { canvas });
    const read = async (result: string) => {
      const m = register.getSingleMetric('collab_doc_export_fresh_total') as any;
      return (await m?.get())?.values.find((s: any) => s.labels.result === result)?.value ?? 0;   // ?. 容错=红阶段指标未注册时红在 exportFresh 缺失本身
    };
    const [ok0, if0] = [await read('ok'), await read('in-flight')];

    const p1 = svc.exportFresh('p1', 'u1');
    const p2 = svc.exportFresh('p1', 'u1');   // 同 user:pid——在飞窗内（p1 挂在 canvas.create）
    await nextTick();                          // p1 过 perm/withDoc/prisma 挂上 create；p2 命中 latch
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(canvas.create).toHaveBeenCalledTimes(1);   // 新 project 数=1（不变量——用户最焦虑时刻不制造垃圾数据）
    expect(r2).toBe(r1);                              // 复用同结果对象（同 Promise）
    expect(await read('ok')).toBe(ok0 + 1);           // 主请求 ok
    expect(await read('in-flight')).toBe(if0 + 1);    // 并发去重命中 in-flight
  });
});
