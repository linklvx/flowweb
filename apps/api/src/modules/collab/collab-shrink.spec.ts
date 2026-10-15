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
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
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

/** vacuum 族连接（writeFreeze 条目按 conn.document.name 取 pid——purge/abort 按键过滤依赖） */
function makeVacuumConn(pid: string): Record<string, any> {
  const c = makeConn();
  c.document = { name: `project:${pid}` };
  return c;
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
  const svc = new CollabShrinkService(perm as any, docs as any, gateway, canvas, prisma, createMockRepo() as any);
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

/** histogram count/sum 双增量（Y0b-5 T10——yjs_doc_bytes 锚③断言用） */
async function histogramDelta(name: string, fn: () => Promise<unknown> | unknown): Promise<{ count: number; sum: number }> {
  const metric: any = register.getSingleMetric(name);
  const read = async () => {
    const vs = (await metric.get()).values;
    return {
      count: vs.find((v: any) => v.metricName === `${name}_count`)?.value ?? 0,
      sum: vs.find((v: any) => v.metricName === `${name}_sum`)?.value ?? 0,
    };
  };
  const before = await read();
  await fn();
  const after = await read();
  return { count: after.count - before.count, sum: after.sum - before.sum };
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

  it('Y0b-5 T10 锚③：shrink 活文档再编码 → yjs_doc_bytes observe truth 值（白名单点③同一编码——零新增）', async () => {
    const gateway = buildGateway({ maxDocBytes: 1 * MiB });
    const doc = seedDoc();
    addNode(doc, 'n1', 64);
    addNode(doc, 'n2', 128);
    const { svc } = buildSvc(gateway, doc);
    let watermark = 0;
    const d = await histogramDelta('yjs_doc_bytes', async () => {
      const r = await svc.shrink('p1', 'u1', { deleteNodeIds: ['n1'] });
      watermark = r.watermark!;
    });
    expect(d.count).toBe(1);
    expect(d.sum).toBe(watermark);   // observe 值=活文档再编码真值（与 calibrateTruth 同值同点）
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

  // T9 质量审查遗留①：latch 失败契约——失败终态必须完全清账（两并发者同错误+键已清+重试可达）
  it('latch 失败契约：create reject → 两并发者同错误 → exportInFlight 键已清 → 重试可达（create 第二次调用成功）', async () => {
    const gateway = buildGateway();
    const doc = seedDoc();
    addNode(doc, 'n1', 64);
    let calls = 0;
    let release!: () => void;
    const canvas = {
      create: vi.fn(() => {
        calls += 1;
        return new Promise<any>((res, rej) => {
          if (calls === 1) { setTimeout(() => rej(new Error('boom')), 10); }   // 首次延迟失败——p2 可命中 latch
          else release = () => res({ projectId: 'p-new', name: '源画布(瘦身副本)', teamId: 't1' });
        });
      }),
    };
    const { svc } = buildSvc(gateway, doc, { canvas });
    const p1 = svc.exportFresh('p1', 'u1');
    await nextTick();                          // p1 挂上 latch（perm await 后 set）
    const p2 = svc.exportFresh('p1', 'u1');   // 在飞窗内——复用同 Promise
    const [e1, e2] = await Promise.allSettled([p1, p2]);
    expect(e1.status).toBe('rejected');
    expect(e2.status).toBe('rejected');                       // 两并发者同错误（复用同 Promise）
    expect((e1 as PromiseRejectedResult).reason.message).toBe('boom');
    expect((svc as any).exportInFlight.size).toBe(0);         // finally 清键——失败终态完全清账
    const retry = svc.exportFresh('p1', 'u1');
    await nextTick();
    release();
    const r = await retry;
    expect(r.result).toBe('ok');                              // 重试可达
    expect(canvas.create).toHaveBeenCalledTimes(2);           // create 第二次调用
  });
});

// ===== Y0b-4 T9a（Q-U v6）：vacuum 文档代际替换 =====
// 装置：gateway 直构（buildGateway 复用）+prisma mock（canvasDoc/canvasDocUpdate/$transaction
// 直透回调——canvas-doc-update.repository.spec 先例）+真 Y.Doc 手动挂 documents（attachDoc 复用）。
// 真连形态（SV 代际门三向/terminal close/WS serving 门）在 collab-quota-gate.spec。

/** vacuum 专用 repo mock：④ 装载读（loadForHydration——契约 1 唯一入口）+⑥ 代际替换事务桩 */
function buildVacuumRepo(state: Buffer | null, updates: Buffer[] = []) {
  const vacuumReplace = vi.fn(async (_pid: string, _state: Buffer, _sv: Buffer, _n: number) => ({ generation: 1 }));
  const repo = {
    loadForHydration: vi.fn(async () => ({ state, updates, stateSeq: 0n })),
    vacuumReplace,
  };
  return { repo, vacuumReplace };
}

/** vacuum ⑥ 事务 prisma mock（tx 直透——canvas-doc-update.repository.spec:37 先例；事务纪律
 *  测试以真 CanvasDocUpdateRepository 包裹消费） */
function buildVacuumPrismaTx(rows: Array<{ id: string; seq: bigint }>) {
  const upsert = vi.fn(async (_args: unknown) => ({}));
  const updateDeleteMany = vi.fn(async (_where: unknown) => ({ count: rows.length }));
  const txExecRaw = vi.fn(async (..._q: unknown[]) => 1);
  const tx = {
    $executeRaw: txExecRaw,
    canvasDocUpdate: { findMany: vi.fn(async () => rows), deleteMany: updateDeleteMany },
    canvasDoc: { findUnique: vi.fn(async () => ({ stateSeq: 0n, generation: 0 })), upsert },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
  };
  return { prisma, upsert, updateDeleteMany, txExecRaw };
}

/** vacuum 专用 service 直构（buildSvc 的 docs mock 缺 invalidateSnapshotCache——本族需要；
 *  repo=④/⑥ 消费面〔契约 1/10：repository 单源〕） */
function buildVacuumSvc(gateway: CollabGateway, repo: any) {
  const perm = { assertEditorWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' }) };
  const docs = {
    withDoc: vi.fn(async (_pid: string, fn: (d: Y.Doc) => unknown) => fn(new Y.Doc())),
    invalidateSnapshotCache: vi.fn(),
  };
  const svc = new CollabShrinkService(perm as any, docs as any, gateway, {} as any, {} as any, repo);
  return { svc, perm, docs };
}

/** exec 根条目写入（writeExecStatus 形态——nodeId→Y.Map 逐键） */
function addExecEntry(doc: Y.Doc, nodeId: string, patch: Record<string, unknown>): void {
  const m = new Y.Map();
  for (const [k, v] of Object.entries(patch)) m.set(k, v);
  doc.getMap('exec').set(nodeId, m);
}

describe('POST /api/collab/doc/:projectId/vacuum（Q-U v6——七步协议 try/finally+SV 代际门）', () => {
  it('红门⑦ 代际一致性：vacuum 完成→重连写入新编辑→再重载⇒全部 keys 完整+pendingStructs/pendingDs==null+meta.schemaVersion===2（stamp 保留）+exec 条目保留（写入后 exec 可读回）', async () => {
    const gateway = buildGateway();
    const src = seedDoc();
    addNode(src, 'n1', 64);
    addNode(src, 'n2', 128);
    addEdge(src, 'e1', 'n1', 'n2');
    addExecEntry(src, 'node-a', { status: 'done', attempts: 1, result: 'ok-text' });
    const state = Buffer.from(Y.encodeStateAsUpdate(src));
    const { repo, vacuumReplace } = buildVacuumRepo(state);
    const { svc } = buildVacuumSvc(gateway, repo);

    const r = await svc.vacuum('p1', 'u1');
    expect(r.result).toBe('ok');
    expect(r.generation).toBe(1);                       // ⑥ generation n+1（n=0）
    expect(vacuumReplace).toHaveBeenCalledTimes(1);
    const vacuumed: Buffer = vacuumReplace.mock.calls[0]![1];   // 真空编码落库（⑥ 第二参）
    expect(vacuumed.length).toBeGreaterThan(0);

    // 模拟新代装载（旧代已卸载——直构无库：直接清 documents 后经 loadDocument 装载）
    gateway.server.hocuspocus.documents.delete('project:p1');
    (gateway as any).repo.hydrateWithRecovery.mockResolvedValueOnce({ state: vacuumed, updates: [] as Buffer[], stateSeq: 5n });
    const reloaded = new Y.Doc();
    await (gateway as any).loadDocument({ document: reloaded, documentName: 'project:p1' });
    expect(reloaded.store.pendingStructs).toBe(null);      // 因果链干净（真空重建——红门⑦ 核心）
    expect(reloaded.store.pendingDs).toBe(null);
    expect(reloaded.getMap('meta').get('schemaVersion')).toBe(CANVAS_DOC_SCHEMA_VERSION);   // stamp 保留（U-1）
    expect([...reloaded.getMap('nodes').keys()].sort()).toEqual(['n1', 'n2']);
    expect([...reloaded.getMap('edges').keys()]).toEqual(['e1']);
    const execEntry = reloaded.getMap('exec').get('node-a') as Y.Map<any>;   // exec 条目保留（U-2）
    expect(execEntry).toBeInstanceOf(Y.Map);
    expect(execEntry.get('status')).toBe('done');
    expect(execEntry.get('attempts')).toBe(1);

    // 重连写入新编辑（新 clientID）→再重载⇒新旧 keys 全在（模拟 store 落 PG 后的装载重放）
    reloaded.getMap('nodes').set('post-vac', new Y.Map([['type', 'videoGen']]));
    const q = (gateway as any).pendingQueues.get('p1') as Uint8Array[];
    expect(q.length).toBe(1);                             // update 监听收帧（装载后监听已挂）
    const editFrame = q[0];
    gateway.server.hocuspocus.documents.delete('project:p1');
    reloaded.destroy();
    (gateway as any).repo.hydrateWithRecovery.mockResolvedValueOnce({ state: vacuumed, updates: [Buffer.from(editFrame)], stateSeq: 6n });
    const again = new Y.Doc();
    await (gateway as any).loadDocument({ document: again, documentName: 'project:p1' });
    expect(again.store.pendingStructs).toBe(null);
    expect([...again.getMap('nodes').keys()].sort()).toEqual(['n1', 'n2', 'post-vac']);   // 新旧编辑共存
    expect(again.getMap('exec').get('node-a')).toBeInstanceOf(Y.Map);                     // exec 跨重载保留
  });

  it('全根复制断言：vacuum 后 doc.share 根类型集合与源完全一致（nodes/edges/meta/exec+未知 Map 根——未来新增根 map 不可能被静默丢弃）；构造 Y.Text 型根 ⇒ result=unsupported-root 拒绝且 DB 零变更', async () => {
    const gateway = buildGateway();
    const src = seedDoc();
    addNode(src, 'n1', 32);
    src.getMap('exec');                       // exec 根（空）
    src.getMap('extra').set('k', 'v');        // 未知 Map 根——必须随行（全根复制断言）
    // 根集合断言口径=键名集合（yjs wire 重建后根为 AbstractType 占位——类型不随 wire 承载，
    // constructor 不可比；类型保型由 rebuild 全 Y.Map 重建结构性保证——规约化后逐根 Y.Map）
    const shapeOf = (d: Y.Doc) => [...d.share.keys()].sort().join('|');
    const { repo, vacuumReplace } = buildVacuumRepo(Buffer.from(Y.encodeStateAsUpdate(src)));
    const { svc } = buildVacuumSvc(gateway, repo);

    const r = await svc.vacuum('p1', 'u1');
    expect(r.result).toBe('ok');
    const vacuumed: Buffer = vacuumReplace.mock.calls[0]![1];
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, new Uint8Array(vacuumed));
    // 有内容的根全随行（nodes/extra/meta——src 的 exec 根为空，yjs 空根不随 wire 传播=无信息
    // 损失，装载侧 getMap 按需重建）；vacuum 后 src 读侧建了空 edges 根（readRecords 副作用）
    // ——fresh 解码侧无（同为空根），断言取内容根集合。
    expect(shapeOf(fresh)).toBe('extra|meta|nodes');
    expect(fresh.getMap('extra').get('k')).toBe('v');     // 未知 Map 根内容随行
    expect(fresh.getMap('extra')).toBeInstanceOf(Y.Map);  // 规约化后 Map 型
    expect(fresh.getMap('exec')).toBeInstanceOf(Y.Map);   // 空根按需重建（getMap 即 Map 视图）

    // 臂二：Y.Text 型根 ⇒ unsupported-root+DB 零变更（upsert/deleteMany 零调用）
    const gw2 = buildGateway();
    const src2 = seedDoc();
    addNode(src2, 'n1', 32);
    src2.getText('weird').insert(0, 'text-root');         // 非 Map 根——vacuum 不支持（降级导出通道）
    const m2 = buildVacuumRepo(Buffer.from(Y.encodeStateAsUpdate(src2)));
    const s2 = buildVacuumSvc(gw2, m2.repo);
    const r2 = await s2.svc.vacuum('p1', 'u1');
    expect(r2.result).toBe('unsupported-root');
    expect(m2.vacuumReplace).not.toHaveBeenCalled();      // DB 零变更
  });

  it('等价断言扩全根：readRecords 深比+根类型集合相等+exec 键集合相等+meta.schemaVersion===2；stub rebuild 缺内容 ⇒ equivalence-failed+DB 零变更', async () => {
    const gateway = buildGateway();
    const src = seedDoc();
    addNode(src, 'n1', 64);
    addNode(src, 'n2', 32);
    addExecEntry(src, 'node-a', { status: 'done', attempts: 2 });
    const { repo, vacuumReplace } = buildVacuumRepo(Buffer.from(Y.encodeStateAsUpdate(src)));
    const { svc } = buildVacuumSvc(gateway, repo);

    // 等价断言四条在成功路径的隐式验证（ok 即证 readRecords 深比+根集合+exec 键集+meta 戳全过）
    const ok = await svc.vacuum('p1', 'u1');
    expect(ok.result).toBe('ok');

    // stub rebuildVacuumDoc 复制后丢 n1 ⇒ readRecords 不等 ⇒ equivalence-failed+DB 零变更
    const gw2 = buildGateway();
    const src2 = seedDoc();
    addNode(src2, 'n1', 64);
    addNode(src2, 'n2', 32);
    const m2 = buildVacuumRepo(Buffer.from(Y.encodeStateAsUpdate(src2)));
    const s2 = buildVacuumSvc(gw2, m2.repo);
    const orig = (gw2 as any).rebuildVacuumDoc.bind(gw2);
    vi.spyOn(gw2 as any, 'rebuildVacuumDoc').mockImplementation((...args: any[]) => {
      const d = orig(...args);
      d.getMap('nodes').delete('n1');      // 把信任 fillDoc 变成验证 fillDoc——复制缺内容必须被截获
      return d;
    });
    const r2 = await s2.svc.vacuum('p1', 'u1');
    expect(r2.result).toBe('equivalence-failed');
    expect(m2.vacuumReplace).not.toHaveBeenCalled();      // DB 零变更（中止先于 ⑥）
  });

  it('quiesce 红门+硬前置：pending 队列有未 store 编辑 ⇒ 等待（不吞）；卸载超时 30s ⇒ result=quiesce-timeout 中止（禁降级继续）', async () => {
    // 臂一（Y0c T17 Z104 后改写——等待动因=三态滞后度）：doc 挂载+pending 批非空 ⇒ vacuum 等待；
    // 批清（doc 保持挂载——不再等 documents.has 翻转）⇒ 续走
    vi.useFakeTimers();
    try {
      const gateway = buildGateway();
      const src = seedDoc();
      addNode(src, 'n1', 32);
      attachDoc(gateway, src, 'p1');        // documents.has=true（常驻钉住形态——不再是 quiesce 动因）
      (gateway as any).pendingQueues.set('p1', [new Uint8Array([1, 2, 3])]);   // 未 store 编辑——三态滞后
      const { repo } = buildVacuumRepo(Buffer.from(Y.encodeStateAsUpdate(src)));
      const { svc } = buildVacuumSvc(gateway, repo);
      let settled: string | null = null;
      const vac = svc.vacuum('p1', 'u1').then((r) => { settled = r.result; return r; });
      await vi.advanceTimersByTimeAsync(200);           // ⓪①②③轮询若干拍
      expect(settled).toBe(null);                        // 等待中（不吞队列帧不降级）
      (gateway as any).pendingQueues.set('p1', [new Uint8Array([4, 5])]);   // 批仍在（新编辑形态）——仍等
      await vi.advanceTimersByTimeAsync(500);
      expect(settled).toBe(null);
      (gateway as any).pendingQueues.delete('p1');       // 批已落（模拟 store 完成；doc 仍挂载）
      await vi.advanceTimersByTimeAsync(200);
      const r = await vac;
      expect(r.result).toBe('ok');                       // 条件齐备后续走（doc 挂载不阻塞）
      expect(settled).toBe('ok');

      // 臂二（Y0c T17 Z104 改写——常驻下活锁根修先红）：doc 恒挂载（常驻会话钉住形态）+三态滞后度
      // 全空 ⇒ 不再等 documents.has 翻转——及时通过（改造前 isPersistedComplete 含 documents.has 恒
      // false⇒30s 必 quiesce-timeout=红；doc 常驻判定已归 tryRelease+isDocResident 独立谓词）
      const gw2 = buildGateway();
      const src2 = seedDoc();
      addNode(src2, 'n1', 32);
      attachDoc(gw2, src2, 'p1');
      const m2 = buildVacuumRepo(Buffer.from(Y.encodeStateAsUpdate(src2)));
      const s2 = buildVacuumSvc(gw2, m2.repo);
      const vac2 = s2.svc.vacuum('p1', 'u1');
      let done2: string | null = null;
      vac2.then((r) => { done2 = r.result; });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(done2).toBe('ok');                          // 批空+spool 空+无在飞 ⇒ 及时通过（doc 挂载不再是动因）
      expect(m2.vacuumReplace).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('quiesce 重排（I-3/I-4）：三态空才调 tryRelease——rejected（在飞读）不 break 下轮重试、released 才 break 走真空（旧代常驻 doc 不跨 vacuumReplace）；三态非空（批恒在）全轮零调用（release_with_pending 计数不放大）', async () => {
    vi.useFakeTimers();
    try {
      // 臂一（I-3）：批在（三态非空）⇒不调释放；批清+首轮 rejected（在飞读）⇒不 break；次轮 released ⇒ break 走 ⑥
      const gateway = buildGateway();
      const src = seedDoc();
      addNode(src, 'n1', 32);
      attachDoc(gateway, src, 'p1');                               // 常驻钉住形态（旧代 doc 在——释放义务的靶）
      (gateway as any).pendingQueues.set('p1', [new Uint8Array([1, 2, 3])]);
      const { repo, vacuumReplace } = buildVacuumRepo(Buffer.from(Y.encodeStateAsUpdate(src)));
      const { svc } = buildVacuumSvc(gateway, repo);
      const relSpy = vi.spyOn(gateway, 'tryReleaseResidentSession')
        .mockResolvedValueOnce('rejected-pending' as never)        // 首调：在飞读（refCount>0）拒绝——不 break
        .mockResolvedValueOnce('released' as never);               // 次调：静默达成——break
      const vac = svc.vacuum('p1', 'u1');
      await vi.advanceTimersByTimeAsync(200);                      // 批在——三态非空全轮零调用
      expect(relSpy).not.toHaveBeenCalled();                       // 旧形态=先调再判（首调即发生）即红
      (gateway as any).pendingQueues.delete('p1');                 // 批清（三态空——释放轮开启）
      await vi.advanceTimersByTimeAsync(100);
      expect(relSpy).toHaveBeenCalledTimes(1);                     // 首调 rejected——未 break（vacuumReplace 未走）
      expect(vacuumReplace).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      expect(relSpy).toHaveBeenCalledTimes(2);                     // 次调 released——break
      const r = await vac;
      expect(r.result).toBe('ok');
      expect(vacuumReplace).toHaveBeenCalledTimes(1);              // released 后才走 ⑥（旧代常驻 doc 不跨真空——效果不被旧代 merge 吸收）

      // 臂二（I-4）：批恒在 30s 全程——tryRelease 零调用（旧形态=每轮先调≈300 次：
      // release_with_pending{vacuum}×轮数+idleTimer 重置×轮数——「稳态 0」判据被打爆）
      const gw2 = buildGateway();
      const src2 = seedDoc();
      addNode(src2, 'n1', 32);
      attachDoc(gw2, src2, 'p1');
      (gw2 as any).pendingQueues.set('p1', [new Uint8Array([1])]);   // 批恒在——三态永不空
      const m2 = buildVacuumRepo(Buffer.from(Y.encodeStateAsUpdate(src2)));
      const s2 = buildVacuumSvc(gw2, m2.repo);
      const relSpy2 = vi.spyOn(gw2, 'tryReleaseResidentSession').mockResolvedValue('released' as never);
      const vac2 = s2.svc.vacuum('p1', 'u1');
      await vi.advanceTimersByTimeAsync(31_000);
      const r2 = await vac2;
      expect(r2.result).toBe('quiesce-timeout');                   // 在飞持续到 deadline⇒超时（quiesce=等静默——语义不变）
      expect(relSpy2).not.toHaveBeenCalled();                      // 三态非空全轮零调用（≤临界轮数=0）
    } finally {
      vi.useRealTimers();
    }
  });

  it('中止恢复：equivalence-failed/unsupported-root/quiesce-timeout 三路中止 ⇒ vacuuming 门解除（isVacuuming false）+freeze 已恢复可写——比不 vacuum 更糟的状态不允许存在', async () => {
    // 臂一：equivalence-failed（① freeze+close 连接）。Y0c T17 Z104 后 quiesce 首轮即过（doc 挂载
    // 不再是等待动因）⇒全程快进——freeze 中间态断言结构性不可达（原 nextTick+readOnly=true 时点
    // 在改造前=quiesce 等待窗内），freeze 生效由「close 后 writeFreeze 清理+readOnly 恢复」终态承载。
    {
      const gateway = buildGateway();
      const src = seedDoc();
      addNode(src, 'n1', 64);
      const conn = makeVacuumConn('p1');
      attachDoc(gateway, src, 'p1', [conn]);
      const { repo } = buildVacuumRepo(Buffer.from(Y.encodeStateAsUpdate(src)));
      const { svc } = buildVacuumSvc(gateway, repo);
      const orig = (gateway as any).rebuildVacuumDoc.bind(gateway);
      vi.spyOn(gateway as any, 'rebuildVacuumDoc').mockImplementation((...args: any[]) => {
        const d = orig(...args);
        d.getMap('nodes').delete('n1');
        return d;
      });
      const vac = svc.vacuum('p1', 'u1');
      await nextTick();                                               // ⓪①② 同步段完成（未冻结——无 thaw 等待）
      const r = await vac;
      expect(r.result).toBe('equivalence-failed');
      expect(gateway.isVacuuming('p1')).toBe(false);                   // 门解除（否则 503 永久）
      expect(conn.readOnly).toBe(false);                               // freeze 恢复可写（中止恢复终态）
      expect((gateway as any).writeFreeze.has(conn)).toBe(false);
    }
    // 臂二：unsupported-root
    {
      const gateway = buildGateway();
      const src = seedDoc();
      addNode(src, 'n1', 32);
      src.getText('weird').insert(0, 'x');
      const conn = makeVacuumConn('p1');
      attachDoc(gateway, src, 'p1', [conn]);
      const { repo } = buildVacuumRepo(Buffer.from(Y.encodeStateAsUpdate(src)));
      const { svc } = buildVacuumSvc(gateway, repo);
      const vac = svc.vacuum('p1', 'u1');
      await nextTick();
      gateway.server.hocuspocus.documents.delete('project:p1');
      const r = await vac;
      expect(r.result).toBe('unsupported-root');
      expect(gateway.isVacuuming('p1')).toBe(false);
      expect(conn.readOnly).toBe(false);
    }
    // 臂三：quiesce-timeout（Y0c T17 Z104 后超时动因=三态滞后度——批恒在（去抖窗永不排空形态）；
    // doc 挂载不再是超时动因）
    vi.useFakeTimers();
    try {
      const gateway = buildGateway();
      const src = seedDoc();
      addNode(src, 'n1', 32);
      const conn = makeVacuumConn('p1');
      attachDoc(gateway, src, 'p1', [conn]);
      (gateway as any).pendingQueues.set('p1', [new Uint8Array([1, 2, 3])]);   // 批恒在——30s 内永不排空
      const { repo } = buildVacuumRepo(Buffer.from(Y.encodeStateAsUpdate(src)));
      const { svc } = buildVacuumSvc(gateway, repo);
      const vac = svc.vacuum('p1', 'u1');
      await vi.advanceTimersByTimeAsync(31_000);
      const r = await vac;
      expect(r.result).toBe('quiesce-timeout');
      expect(gateway.isVacuuming('p1')).toBe(false);
      expect(conn.readOnly).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('事务纪律：⑥ 单事务首行取 pg_advisory_xact_lock(hashtext(pid))（与 append/compact 同键）+取号基准=被删行最大 seq（非 0 非 GREATEST）+preVacuumSv/generation 同事务落列+按实读行 id deleteMany+行集漂移守卫', async () => {
    const gateway = buildGateway();
    const src = seedDoc();
    addNode(src, 'n1', 64);
    const update = Buffer.from(Y.encodeStateAsUpdate(src));
    const rows = [
      { id: 'row-1', seq: 3n },
      { id: 'row-2', seq: 5n },
      { id: 'row-3', seq: 7n },
    ];
    // ⑥ 走真 CanvasDocUpdateRepository.vacuumReplace（契约 1/10——repository 单源）：prisma $transaction
    // 直透 mock（repository.spec:37 先例）；④ 装载读 mock（state+三真实帧——CRDT 幂等重复 apply 无害）
    const { prisma, upsert, updateDeleteMany, txExecRaw } = buildVacuumPrismaTx(rows);
    const docRepo = new CanvasDocUpdateRepository(prisma as any);
    const repo = {
      loadForHydration: vi.fn(async () => ({ state: update, updates: [update, update, update], stateSeq: 0n })),
      vacuumReplace: (pid: string, st: Buffer, sv: Buffer, n: number) => docRepo.vacuumReplace(pid, st, sv, n),
    };
    const { svc } = buildVacuumSvc(gateway, repo);

    const r = await svc.vacuum('p1', 'u1');
    expect(r.result).toBe('ok');
    // 事务首行=同键咨询锁（P23/V26——与 append/compact lockProject 同键单源）
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const firstCall = txExecRaw.mock.calls[0]!;
    expect(String(firstCall[0])).toContain('pg_advisory_xact_lock(hashtext');
    expect(String(firstCall[1])).toBe('p1');
    const allSql = txExecRaw.mock.calls.map((c) => String(c[0])).join(';');
    expect(allSql).not.toContain('GREATEST');            // insert-ratchet 红线——禁 GREATEST 包装
    // 取号基准=被删行最大 seq（非 0——取号基准错=stateSeq 谎话）
    const upsertArg = upsert.mock.calls[0]![0] as any;
    expect(upsertArg.update.stateSeq).toBe(7n);
    expect(upsertArg.update.stateSeq).not.toBe(0n);
    expect(upsertArg.update.generation).toBe(1);         // n+1 同事务落列
    expect(upsertArg.update.preVacuumSv).toBeInstanceOf(Buffer);   // 真空前 SV 同事务落列
    expect(upsertArg.update.preVacuumSv.length).toBeGreaterThan(0);
    // 按实读行 id 精确删除（compact 同式）
    expect(updateDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ['row-1', 'row-2', 'row-3'] } } });

    // 行集漂移守卫：④ 读 3 行⇒锁内 4 行（④ 读后有并发 append）⇒ throw（DB 零变更——upsert 未再调）
    const drifted = buildVacuumPrismaTx([...rows, { id: 'row-4', seq: 9n }]);
    const docRepo2 = new CanvasDocUpdateRepository(drifted.prisma as any);
    const g2 = buildGateway();
    const src2 = seedDoc();
    addNode(src2, 'n1', 32);
    const s2 = buildVacuumSvc(g2, {
      loadForHydration: vi.fn(async () => ({ state: Buffer.from(Y.encodeStateAsUpdate(src2)), updates: [update, update, update], stateSeq: 0n })),
      vacuumReplace: (pid: string, st: Buffer, sv: Buffer, n: number) => docRepo2.vacuumReplace(pid, st, sv, n),
    });
    const caught = s2.svc.vacuum('p1', 'u1').catch((e) => e);   // 立即挂 handler（快路径 reject 窗口的 unhandled 防护）
    await nextTick();
    g2.server.hocuspocus.documents.delete('project:p1');
    expect(await caught).toMatchObject({ vacuumRowsDrifted: true });   // 漂移 throw（error 档计数+REST 500——重试安全）
    expect(drifted.upsert).not.toHaveBeenCalled();       // 锁内守卫先于 upsert——DB 零变更
  });

  it('共享状态普查（I-1 反射式——防漏方向倒转）：vacuum 完成后枚举 gateway 自有属性中值类型 Map/Set 的容器均无该 pid 键（新增容器默认纳入——pid 与 project:pid 两键形态）+SnapshotDocCache 失效（防旧代记账污染新代）', async () => {
    const gateway = buildGateway();
    const src = seedDoc();
    addNode(src, 'n1', 64);
    const conn = makeVacuumConn('p1');
    attachDoc(gateway, src, 'p1', [conn]);
    const g = gateway as any;
    // 预播种全部按 pid 键控状态（模拟长期运行后的记账面）
    g.docTruth.set('p1', 1234);
    g.docDelta.set('p1', 56);
    g.truthMeasuredAt.set('p1', Date.now());
    g.degradedDocs.add('p1');
    g.quotaFrozenDocs.add('p1');
    g.freezePending.add('p1');
    g.recheckRounds.set('p1', 9);
    g.thawCooldown.set('p1', Date.now());
    g.docStatusRev.set('p1', 7);
    g.docStatusState.set('p1', 'over:true');
    g.docGeneration.set('p1', 3);
    g.docResidue.set('p1', 999);
    g.preVacuumSvCache.set('p1', new Map([[1, 1]]));
    g.lastCompactAt.set('p1', Date.now());
    g.overPush.set(conn.socketId, { count: 5, bytes: 100, firstAt: 1, lastAt: 2 });
    const { repo } = buildVacuumRepo(Buffer.from(Y.encodeStateAsUpdate(src)));
    const { svc, docs } = buildVacuumSvc(gateway, repo);

    const vac = svc.vacuum('p1', 'u1');
    await nextTick();                                            // ⓪（thaw——settled 零等待）①② 完成
    gateway.server.hocuspocus.documents.delete('project:p1');    // ① close 的卸载后果（直构模拟）
    const r = await vac;
    expect(r.result).toBe('ok');
    // 普查表（反射式）：豁免表=非 pid 键控容器（键型注明——新增豁免必须给理由）；
    // 其余 Map/Set 一律受检（两键形态——documentName 键控的陈旧电平/退避梯同受 project:p1 检）。
    const NON_PID_CONTAINERS = new Set([
      'writeFreeze',          // conn 键（条目值含 pid——purge 逐原因解除，下方单独断言）
      'overPush',             // socketId 键（purge 经 writeFreeze 条目 pid 反查连带清，下方单独断言）
      'refusalCache',         // 拒绝缓存：token 键
      'authAttemptBuckets',   // 认证尝试桶：ip/身份键
      'connEstablishedAt',    // socketId 键
      'clientIdOwner',        // clientId（number）键
      'ownedClientIds',       // socketId 键
      'socketIdentity',       // socketId 键
      'awarenessDriftLogged', // socketId 键（漂移去重——断连清理）
      'docStuckRounds',       // documentName 键观测轮次——非代际敏感态（stuck 判定 n≥2 自清），不属旧代记账污染面
    ]);
    const checked: string[] = [];
    for (const [name, v] of Object.entries(g)) {
      if (!(v instanceof Map || v instanceof Set) || NON_PID_CONTAINERS.has(name)) continue;
      checked.push(name);
      expect((v as Map<string, unknown>).has('p1'), `${name} 应无该 pid 键`).toBe(false);
      expect((v as Map<string, unknown>).has('project:p1'), `${name} 应无该 documentName 键`).toBe(false);
    }
    // 防退化锚：已知 pid 键控族必须全部出现在反射枚举中（改名/移除→此处红，豁免表滥用同红）
    for (const must of ['docTruth', 'docDelta', 'truthMeasuredAt', 'degradedDocs', 'quotaFrozenDocs', 'freezePending',
      'freezePendingTimers',
      'recheckRounds', 'thawCooldown', 'docStatusRev', 'docStatusState', 'docGeneration', 'docResidue',
      'preVacuumSvCache', 'lastCompactAt', 'vacuumingDocs', 'pendingQueues', 'inFlightProjects', 'flushScheduled',
      'deletedProjects', 'persistUnhealthy', 'persistRetry', 'retryingPersistDocs']) {
      expect(checked, `反射枚举应覆盖 ${must}（改名或误入豁免表=红）`).toContain(must);
    }
    expect(g.overPush.has(conn.socketId)).toBe(false);   // writeFreeze 条目 pid 过滤连带清
    expect(g.writeFreeze.has(conn)).toBe(false);
    expect(docs.invalidateSnapshotCache).toHaveBeenCalledWith('p1');   // SnapshotDocCache 该 pid 条目（TTL 30s 否则供旧代投影）
  });

  it('REST 出口与权限门：perm 先行（VIEWER 403）+成功响应 {result,generation,bytes}+collab_doc_vacuum_total{result=ok} 计数', async () => {
    const gateway = buildGateway();
    const src = seedDoc();
    addNode(src, 'n1', 64);
    const { repo } = buildVacuumRepo(Buffer.from(Y.encodeStateAsUpdate(src)));
    const { svc, perm } = buildVacuumSvc(gateway, repo);

    perm.assertEditorWithTeam.mockRejectedValueOnce(new ForbiddenException('无项目编辑权限'));
    await expect(svc.vacuum('p1', 'u-viewer')).rejects.toThrow(ForbiddenException);   // 权限恒先于 vacuum 协议

    let res: any;
    const okDelta = await counterDelta('collab_doc_vacuum_total', { result: 'ok' }, async () => {
      res = await svc.vacuum('p1', 'u1');
    });
    expect(okDelta).toBe(1);                              // 结果审计计数
    expect(res.result).toBe('ok');
    expect(res.generation).toBe(1);
    expect(typeof res.bytes).toBe('number');              // 真空编码字节（新代尺寸）
    expect(res.bytes).toBeGreaterThan(0);
  });
});
