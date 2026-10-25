// apps/api/src/modules/collab/collab-metrics-observability.spec.ts
// Y0b-5 T10（spec §5.8②③/E19 回归）——服务端指标面：
// ①E19：yjs_canvas_doc_bytes（projectId gauge——基数无界）退役+yjs_doc_bytes 尺寸直方图
//   （buckets 64KiB/256KiB/1MiB/4MiB/16MiB——E19「改尺寸直方图」原文）+无 projectId 标签断言
//   +yjs_store_payload_bytes（append 增量）+yjs_doc_bytes_over_threshold_total；
// ②真值三锚 observe（装载播种/compact 全量编码/shrink 活文档再编码——既有 docTruth 事件零新增编码，
//   shrink 锚在 collab-shrink.spec）；
// ③awareness_states/awareness_bytes 两 gauge（collect reader——不解码不取字段仅 Σ 编码字节）；
// ④yjs_doc_heap_amplification（装载/卸载边界 heapUsed 差÷编码字节——合成值待标定）；
// ⑤耗时直方图四件（store/compact/load/withdoc）+yjs_compact_deleted_rows+yjs_compact_tombstone_bytes；
// ⑥top-N doc 结构日志（docTruth 单源——零 encode：documents 空即结构性证明）；
// ⑦snapshot-doc-cache 容量上界 32+yjs_snapshot_cache_entries。
// 直构形态=quota-truth.spec 先例（collabState='serving'+createMockRepo+makeSpoolDir+lease stub）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { register } from 'prom-client';
import { Awareness } from 'y-protocols/awareness';
import { CANVAS_DOC_SCHEMA_VERSION } from '@flowweb/shared';
import { CollabGateway, DOC_BYTES_OVER_THRESHOLD_BYTES, TOPN_LOG_INTERVAL_MS, TOPN_LOG_LIMIT, type QuotaConfig } from './collab.gateway';
import { CollabDocumentService } from './collab-document.service';
import { SnapshotDocCache, SNAPSHOT_CACHE_MAX_ENTRIES } from './snapshot-doc-cache';
import { CollabSpoolService } from './collab-spool.service';
import { registerUpdatesRowsReader, unregisterUpdatesRowsReader } from './store.metrics';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';   // Y0c T39b 波 2：内部状态访问经 façade（check-collab-test-facade 门禁）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};
beforeEach(async () => {
  const d = await makeSpoolDir('y0b5-t10-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
});
afterEach(async () => { await spoolCleanup(); vi.restoreAllMocks(); });

/** 直构 gateway（quota-truth 先例）：hydration 受控 state/updates + quota 注入 */
function buildGateway(hydration?: { state: Buffer | null; updates: Buffer[] }, quota?: Partial<QuotaConfig>) {
  const repo = createMockRepo();
  if (hydration) repo.hydrateWithRecovery.mockResolvedValue({ ...hydration, stateSeq: 0n });
  const spool = new CollabSpoolService(spoolDir);
  spool.setOwner('t10-owner');
  const gateway = new CollabGateway(
    {} as any, new EventEmitter2() as any, repo as any, createLeaseStub() as any,
    { resolve: vi.fn() } as any,
    47500 + Math.floor(Math.random() * 2500),
    undefined, undefined, undefined, spool,
    quota,
  );
  gatewayFacade(gateway).forceCollabState('serving');
  return { gateway, repo, spool };
}

/** 装载并返回 doc（loadDocument 直调——truth 播种/直方图锚①唯一落点；W3a：DR 公有化直调
 *  cast 消失——payload 侧 as any=夹具既有合法形态，B1 onStoreDocument 直调先例同款） */
async function loadDoc(gateway: CollabGateway, pid = 'p1'): Promise<Y.Doc> {
  const document = new Y.Doc();
  await gateway.docRegistry.loadDocument({ document, documentName: `project:${pid}` } as any);
  return document;
}

/** histogram count/sum 增量（register 全局单例——测试间累积恒用增量） */
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

/** counter 增量（无 label 形态） */
async function counterDelta(name: string, fn: () => Promise<unknown> | unknown): Promise<number> {
  const metric: any = register.getSingleMetric(name);
  const read = async () => (await metric.get()).values[0]?.value ?? 0;
  const before = await read();
  await fn();
  return (await read()) - before;
}

/** gauge 现值（无 label——collect reader 现算） */
async function gaugeValue(name: string): Promise<number> {
  const metric: any = register.getSingleMetric(name);
  return (await metric.get()).values[0]?.value ?? 0;
}

function stampedDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta').set('schemaVersion', CANVAS_DOC_SCHEMA_VERSION);
  doc.getMap('nodes').set('n1', new Y.Map([['type', 'textInput']]) as any);
  return doc;
}

describe('Y0b-5 T10：E19 尺寸直方图+yjs_canvas_doc_bytes 退役', () => {
  it('yjs_doc_bytes=Histogram（buckets 64KiB/256KiB/1MiB/4MiB/16MiB+Inf）无 projectId 标签；yjs_canvas_doc_bytes 不再注册（重复注册即红——E54② 双指标拆分）', async () => {
    const h: any = register.getSingleMetric('yjs_doc_bytes');
    expect(h).toBeTruthy();
    expect(DOC_BYTES_OVER_THRESHOLD_BYTES).toBe(16 * 1024 * 1024);
    h.observe(70_000);   // 无 label 调用——若实现误带 projectId 标签此行即 throw（B8 功能性同款）
    const buckets = ((await h.get()).values as any[])
      .filter((v) => v.metricName === 'yjs_doc_bytes_bucket').map((v) => v.labels.le);
    expect(buckets).toEqual([65536, 262144, 1048576, 4194304, 16777216, '+Inf']);
    expect(register.getSingleMetric('yjs_canvas_doc_bytes')).toBeUndefined();   // E19 退役（重注册→prom-client throw/此断言红）
  });

  it('锚①装载播种：load（cheap 档）→ yjs_doc_bytes observe truth 值（零新增编码——cheap 即既有播种值）', async () => {
    const src = stampedDoc();
    const state = Buffer.from(Y.encodeStateAsUpdate(src));
    const { gateway } = buildGateway({ state, updates: [] });
    const d = await histogramDelta('yjs_doc_bytes', () => loadDoc(gateway));
    expect(d.count).toBe(1);
    expect(d.sum).toBe(state.length);   // cheap=|state|（updates/spool 空）——与 docTruth 播种值同源
    expect(gatewayFacade(gateway).docTruthOf('p1')).toBe(state.length);
  });

  it('锚②compact 全量编码：maybeCompact 成功 → yjs_doc_bytes/deleted_rows/tombstone_bytes/duration 四 observe+over_threshold（>16MiB 才计）', async () => {
    const { gateway, repo } = buildGateway();
    await loadDoc(gateway);
    gatewayFacade(gateway).clearLastCompactAt('p1');   // 绕时间门
    repo.compact.mockResolvedValue({ compacted: true, snapshotBytes: 4242, deletedRows: 7, tombstoneBytes: 99 });
    const dDoc = await histogramDelta('yjs_doc_bytes', () => gateway.persistence.maybeCompact('p1'));
    expect(dDoc.count).toBe(1);
    expect(dDoc.sum).toBe(4242);
    const dRows = await histogramDelta('yjs_compact_deleted_rows', async () => {
      gatewayFacade(gateway).clearLastCompactAt('p1');
      await gateway.persistence.maybeCompact('p1');
    });
    expect(dRows.count).toBe(1);
    expect(dRows.sum).toBe(7);
    const dTomb = await histogramDelta('yjs_compact_tombstone_bytes', async () => {
      gatewayFacade(gateway).clearLastCompactAt('p1');
      await gateway.persistence.maybeCompact('p1');
    });
    expect(dTomb.count).toBe(1);
    expect(dTomb.sum).toBe(99);
    const dDur = await histogramDelta('yjs_compact_duration_seconds', async () => {
      gatewayFacade(gateway).clearLastCompactAt('p1');
      await gateway.persistence.maybeCompact('p1');
    });
    expect(dDur.count).toBe(1);   // 每次 repo.compact 实跑一次计时
    expect(dDur.sum).toBeGreaterThanOrEqual(0);   // ms 粒度瞬时完成可为 0——计数即计时证据
    // over_threshold：4242 < 16MiB 不计；17MiB 计 1
    const dUnder = await counterDelta('yjs_doc_bytes_over_threshold_total', async () => {
      gatewayFacade(gateway).clearLastCompactAt('p1');
      await gateway.persistence.maybeCompact('p1');
    });
    expect(dUnder).toBe(0);
    repo.compact.mockResolvedValue({ compacted: true, snapshotBytes: DOC_BYTES_OVER_THRESHOLD_BYTES + 1, deletedRows: 1, tombstoneBytes: 1 });
    const dOver = await counterDelta('yjs_doc_bytes_over_threshold_total', async () => {
      gatewayFacade(gateway).clearLastCompactAt('p1');
      await gateway.persistence.maybeCompact('p1');
    });
    expect(dOver).toBe(1);
  });

  it('compact throw → yjs_compact_duration_seconds 仍 observe（采集挂 finally——最该被看见的慢尾不丢样本）', async () => {
    const { gateway, repo } = buildGateway();
    await loadDoc(gateway);
    gatewayFacade(gateway).clearLastCompactAt('p1');   // 绕时间门
    repo.compact.mockRejectedValueOnce(new Error('boom'));
    const dDur = await histogramDelta('yjs_compact_duration_seconds', () =>
      gateway.persistence.maybeCompact('p1').catch(() => {}));   // 生产调用点（store/断连 finalize）自有 catch+compact_failure 计数
    expect(dDur.count).toBe(1);   // throw 路径同样计时（时长面非成功面）
  });

  it('yjs_store_payload_bytes：store append 成功路径逐片 observe（chunk payload 字节——切批口径）', async () => {
    const src = stampedDoc();
    const state = Buffer.from(Y.encodeStateAsUpdate(src));
    const { gateway, repo } = buildGateway({ state, updates: [] });
    const document = await loadDoc(gateway);
    const w = new Y.Doc();
    w.getMap('x').set('k', 'v'.repeat(2048));
    const u = Y.encodeStateAsUpdate(w);
    Y.applyUpdate(document, u);   // update 监听入队（非 replaying 窗；装载戳 update 同队——批=stamp+u）
    const d = await histogramDelta('yjs_store_payload_bytes', () =>
      gateway.persistence.storeDocumentUnlocked({ document, documentName: 'project:p1' }));
    // Y1c T9 新表形态：appendBatch(pid,[rows])——payload=rows[0].update（单帧行）；observe 在
    // actor/fallback PG 腿逐行（yjsStorePayloadBytes——同参同值）
    const rows = repo.appendBatch.mock.calls[0][1] as Array<{ update: Uint8Array }>;
    expect(d.count).toBeGreaterThanOrEqual(1);   // 小批=单片直通（PERSIST_MERGE_MAX_BYTES 内不拆）
    expect(d.sum).toBeGreaterThanOrEqual(rows[0].update.byteLength);   // observe 值≥实落行 payload 字节（批含装载戳帧）
  });

  it('耗时直方图：load/store 路径 observe（成功/失败均计时——时长面非成功面）', async () => {
    const { gateway } = buildGateway();
    const dLoad = await histogramDelta('yjs_load_duration_seconds', () => loadDoc(gateway));
    expect(dLoad.count).toBe(1);
    expect(dLoad.sum).toBeGreaterThanOrEqual(0);   // ms 粒度瞬时完成可为 0——计数即计时证据
    const document = new Y.Doc();
    await gateway.docRegistry.loadDocument({ document, documentName: 'project:p2' } as any);   // 注册队列（W3a：DR 公有化直调）
    const w = new Y.Doc();
    w.getMap('x').set('k', 'z'.repeat(32));
    Y.applyUpdate(document, Y.encodeStateAsUpdate(w));
    const dStore = await histogramDelta('yjs_store_duration_seconds', () =>
      gateway.persistence.storeDocumentUnlocked({ document, documentName: 'project:p2' }));
    expect(dStore.count).toBe(1);
    expect(dStore.sum).toBeGreaterThanOrEqual(0);
  });

  it('noop 空转档不 observe store duration（readCanvas 空转近 0 样本稀释直方图）', async () => {
    const state = Buffer.from(Y.encodeStateAsUpdate(stampedDoc()));   // 带戳装载：无 stamp 自愈入队（replay 抑制窗）→ 队列真空
    const { gateway } = buildGateway({ state, updates: [] });
    const document = new Y.Doc();
    await gateway.docRegistry.loadDocument({ document, documentName: 'project:p4' } as any);   // 队列注册且空+spool 空（W3a：DR 公有化直调）
    const dStore = await histogramDelta('yjs_store_duration_seconds', () =>
      gateway.persistence.storeDocumentUnlocked({ document, documentName: 'project:p4' }));
    expect(dStore.count).toBe(0);   // noop 早退不计时（yjs_store_drain_total{noop} 照常计数）
  });
});

describe('Y0b-5 T10：awareness 两 gauge（collect reader——Σ 编码字节）', () => {
  it('awareness_states=Σ states.size；awareness_bytes=Σ encodeAwarenessUpdate 字节（多 doc 聚合——不解码不取字段）', async () => {
    const { gateway } = buildGateway();
    const d1 = new Y.Doc();
    const aw1 = new Awareness(d1);
    aw1.setLocalState({ presence: true, user: { id: 'u1' } });
    aw1.states.set(999, { presence: true });   // 第二 client（手工播种——meta 同步〔encode 读 meta.clock——生产由 applyAwarenessUpdate 维护〕）
    aw1.meta.set(999, { clock: 1, lastUpdated: Date.now() });
    Object.assign(d1, { awareness: aw1, connections: new Map() });
    const d2 = new Y.Doc();
    const aw2 = new Awareness(d2);
    aw2.setLocalState({ presence: true, cursor: { x: 1 } });
    Object.assign(d2, { awareness: aw2, connections: new Map() });
    gateway.server.hocuspocus.documents.set('project:p1', d1 as any);
    gateway.server.hocuspocus.documents.set('project:p2', d2 as any);
    expect(await gaugeValue('awareness_states')).toBe(3);
    const bytes = await gaugeValue('awareness_bytes');
    expect(bytes).toBeGreaterThan(0);
    // 卸下后回落（collect 现算——无残留）
    gateway.server.hocuspocus.documents.delete('project:p2');
    expect(await gaugeValue('awareness_states')).toBe(2);
  });
});

describe('Y0b-5 T10：heap 倍率（装载/卸载边界——合成值待标定）', () => {
  it('装载边界：heapUsed 差÷编码字节（spy heapUsedNow 两点——delta>0 才 set）', async () => {
    const src = stampedDoc();
    const state = Buffer.from(Y.encodeStateAsUpdate(src));
    const { gateway } = buildGateway({ state, updates: [] });
    const heaps = [1000, 6000];
    let i = 0;
    gatewayFacade(gateway).spyHeapUsedNow().mockImplementation(() => heaps[i++]);
    await loadDoc(gateway);
    expect(await gaugeValue('yjs_doc_heap_amplification')).toBeCloseTo(5000 / state.length, 5);
  });

  it('卸载边界：beforeUnload 播种+afterUnload 结算（freed>0 才 set；≤0 噪声跳过）', async () => {
    const src = stampedDoc();
    const state = Buffer.from(Y.encodeStateAsUpdate(src));
    const { gateway } = buildGateway({ state, updates: [] });
    const document = await loadDoc(gateway);   // 真 heapUsedNow 装载（可能自带噪声样本——register 全局共享，恒用增量/对照基线）
    const baseline = await gaugeValue('yjs_doc_heap_amplification');
    const heaps = [6000, 1000];
    let i = 0;
    gatewayFacade(gateway).spyHeapUsedNow().mockImplementation(() => heaps[i++]);
    await gateway.hooks.beforeUnloadDocument({ document, documentName: 'project:p1' } as any);   // 播种（不结算）——T40 B1「不搬」裁决：hooks 接线同一函数对象等价驱动（cast 消失零公有化）
    expect(await gaugeValue('yjs_doc_heap_amplification')).toBe(baseline);   // beforeUnload 只播种——值未动
    await gateway.hooks.afterUnloadDocument({ instance: gateway.server.hocuspocus, documentName: 'project:p1' });
    expect(await gaugeValue('yjs_doc_heap_amplification')).toBeCloseTo(5000 / state.length, 5);   // freed=5000÷truth 结算
    // 噪声跳过：freed ≤ 0 不 set（GC 时延——负值/零差非信息，保持上一次有效样本）
    const doc2 = new Y.Doc();
    await gateway.docRegistry.loadDocument({ document: doc2, documentName: 'project:p3' } as any);   // W3a：DR 公有化直调
    const afterLoad2 = await gaugeValue('yjs_doc_heap_amplification');   // doc2 装载（真采样）后的基线
    let j = 0;
    const flat = [5000, 5000];
    gatewayFacade(gateway).spyHeapUsedNow().mockImplementation(() => flat[j++]);
    await gateway.hooks.beforeUnloadDocument({ document: doc2, documentName: 'project:p3' } as any);   // T40 B1「不搬」裁决：hooks 等价驱动
    await gateway.hooks.afterUnloadDocument({ instance: gateway.server.hocuspocus, documentName: 'project:p3' });
    expect(await gaugeValue('yjs_doc_heap_amplification')).toBe(afterLoad2);   // 零差跳过——未动
  });
});

describe('Y0b-5 T10：withDoc 耗时直方图', () => {
  it('yjs_withdoc_duration_seconds：withDoc 完成路径（含 disconnect）计时一次', async () => {
    const { gateway } = buildGateway();
    const service = new CollabDocumentService(gateway, { readSnapshotOnly: vi.fn(), readWatermark: vi.fn().mockResolvedValue(null) } as any);   // Y1c T12：readWatermark canonical 名读面（null=gen0 裸名）
    const doc = stampedDoc();
    const fakeConn = { document: doc, transact: async (fn: (d: Y.Doc) => unknown) => fn(doc), disconnect: async () => {} };   // Y0c T10：withDoc 直开 document 事务——mock 对齐真实 DirectConnection 形状
    vi.spyOn(gateway.server.hocuspocus, 'openDirectConnection').mockResolvedValue(fakeConn as any);
    const d = await histogramDelta('yjs_withdoc_duration_seconds', () => service.withDoc('p1', () => 'x'));   // Y0c T15：readCanvas 改道会话（不再计 withDoc 全路径）——载体改直调 withDoc
    expect(d.count).toBe(1);
    expect(d.sum).toBeGreaterThanOrEqual(0);
  });
});

describe('Y0b-5 T10：top-N doc 结构日志（docTruth 单源——零 encode）', () => {
  it('logDocTopN：truth+delta 降序 top10 结构化输出；documents 空=结构性零 encode（数据源仅 Map 读）', async () => {
    const { gateway } = buildGateway();
    expect(gateway.server.hocuspocus.documents.size).toBe(0);   // 结构前提：无 doc 可编码
    for (let k = 0; k < 12; k++) {
      gatewayFacade(gateway).seedDocTruth(`p${k}`, (k + 1) * 1000);
      gatewayFacade(gateway).seedDocDelta(`p${k}`, 500);
    }
    const logSpy = gatewayFacade(gateway).spyLogger('log');
    gateway.docRegistry.logDocTopN();   // W3a：DR 公有化直调（cast 消失——偏离 64② 直调族核销兑现）
    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.event).toBe('yjs_doc_topn');
    expect(parsed.docs).toHaveLength(TOPN_LOG_LIMIT);   // top10（12 个条目截断）
    expect(parsed.docs[0]).toEqual({ project: 'p11', bytes: 12_000 + 500 });   // truth+delta 降序（p11=(11+1)×1000）
    expect(parsed.docs[9]).toEqual({ project: 'p2', bytes: 3000 + 500 });
    expect(TOPN_LOG_INTERVAL_MS).toBe(5 * 60_000);   // 5min 日志节律（非指标——唯一豁免定时器）
  });
});

describe('Y0b-5 T10：snapshot-doc-cache 容量上界+entries gauge', () => {
  it('条目上限 32：第 33 条驱逐最旧；命中刷新新近度（LRU 语义）', async () => {
    const cache = new SnapshotDocCache(30_000);
    expect(SNAPSHOT_CACHE_MAX_ENTRIES).toBe(32);
    const calls: Record<string, { n: number }> = {};
    const load = (pid: string) => {
      calls[pid] ??= { n: 0 };
      const c = calls[pid];
      return async () => { c.n += 1; return { nodes: [{ id: pid }], edges: [] }; };
    };
    for (let k = 0; k < 32; k++) await cache.get(`p${k}`, load(`p${k}`));
    expect(cache.size).toBe(32);
    await cache.get('p0', load('p0'));         // 命中刷新新近度（p0 不再是最旧）
    expect(calls['p0'].n).toBe(1);             // 命中=loader 不重跑
    await cache.get('p32', load('p32'));       // 第 33 条 → 驱逐最旧=p1（p0 已刷新——若命中不刷新则误驱逐 p0）
    expect(cache.size).toBe(32);
    await cache.get('p1', load('p1'));         // p1 被驱逐 → miss 重跑
    expect(calls['p1'].n).toBe(2);
    await cache.get('p0', load('p0'));         // p0 仍在（LRU 刷新生效的对照断言）
    expect(calls['p0'].n).toBe(1);
  });

  it('yjs_snapshot_cache_entries：service 构造注册 reader（collect 现算 cache.size）', async () => {
    const { gateway } = buildGateway();
    const service = new CollabDocumentService(gateway, { readSnapshotOnly: vi.fn(), readWatermark: vi.fn().mockResolvedValue(null) } as any);   // Y1c T12：readWatermark canonical 名读面（null=gen0 裸名）
    const cache = (service as any).snapshotCache as SnapshotDocCache;
    expect(await gaugeValue('yjs_snapshot_cache_entries')).toBe(cache.size);
    await cache.get('p1', async () => ({ nodes: [], edges: [] }));
    expect(await gaugeValue('yjs_snapshot_cache_entries')).toBe(1);
  });
});

// Y0c T29-II（Z125-5/Z148④）：canvasDocUpdate 总行数 gauge——观测项非机制项（不强制 compact；
// 行数门归 Y1c-3 再裁）。reader 注册模式=registerDegradedDocsReader 同款（gateway 注册 prisma
// count 回调，metrics 文件不 import gateway——反向依赖禁止）；reader 为 async（prisma count）——
// prom-client collect 支持 promise（register.metrics()/get() 等待）。
describe('Y0c T29-II（Z125-5）：yjs_updates_rows_total gauge（reader 注册=degradedDocs 惯例）', () => {
  afterEach(() => { unregisterUpdatesRowsReader(); });

  it('gauge 已注册（无 reader 折 0——worker 进程同款语义）', async () => {
    expect(register.getSingleMetric('yjs_updates_rows_total')).toBeDefined();
    expect(await gaugeValue('yjs_updates_rows_total')).toBe(0);
  });

  it('async reader（prisma count 形态）collect 现算；reader 抛错折 0；unregister 折 0', async () => {
    registerUpdatesRowsReader(async () => 7);
    expect(await gaugeValue('yjs_updates_rows_total')).toBe(7);
    registerUpdatesRowsReader(async () => { throw new Error('pg down'); });
    expect(await gaugeValue('yjs_updates_rows_total')).toBe(0);
    unregisterUpdatesRowsReader();
    expect(await gaugeValue('yjs_updates_rows_total')).toBe(0);
  });
});
