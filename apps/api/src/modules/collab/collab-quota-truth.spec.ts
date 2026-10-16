// apps/api/src/modules/collab/collab-quota-truth.spec.ts
// Y0b-4 T3——Q-B cheap 播种+Q-O 不拒行+pendingStructs/pendingDs 双断言；真红门②=累积漂移不误冻
// （T3 形态：truth=实测编码值非 delta 累加值）、④=病态行不锁死（照读+deferred 计数+degraded 标记）。
// 直构形态=collab-heap-gate.spec 先例（collabState='serving'+createMockRepo+makeSpoolDir+lease stub）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { register } from 'prom-client';
import { CANVAS_DOC_SCHEMA_VERSION, QUOTA_DEFAULTS, SERVER_TRANSACT_ORIGIN } from '@flowweb/shared';
import { CollabGateway, TRUTH_COOLDOWN_MS, type QuotaConfig } from './collab.gateway';
import { CollabSpoolService } from './collab-spool.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';   // Y0c T39b 波 2：内部状态访问经 façade（check-collab-test-facade 门禁）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const MiB = 1024 * 1024;
/** spool merge 切批上限（Q-O 产生侧对齐——与实现常量同值） */
const PERSIST_MERGE_MAX_BYTES = 1_048_576;

let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};
beforeEach(async () => {
  const d = await makeSpoolDir('y0b4-truth-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
});
afterEach(async () => { await spoolCleanup(); vi.restoreAllMocks(); });

/** 直构 gateway（heap-gate 先例）：repo mock 受控 state/updates + quota 注入 */
function buildGateway(hydration: { state: Buffer | null; updates: Buffer[] }, quota?: Partial<QuotaConfig>) {
  const repo = createMockRepo();
  repo.hydrateWithRecovery.mockResolvedValue({ ...hydration, stateSeq: 0n });
  const spool = new CollabSpoolService(spoolDir);
  spool.setOwner('truth-owner');
  const gateway = new CollabGateway(
    {} as any, new EventEmitter2() as any, repo as any, createLeaseStub() as any,
    { resolve: vi.fn() } as any,
    45500 + Math.floor(Math.random() * 2500),
    undefined, undefined, undefined, spool,
    quota,
  );
  gatewayFacade(gateway).forceCollabState('serving');
  return { gateway, repo, spool };
}

/** 装载并返回 doc（loadDocument 直调——装载路径=truth 播种+双断言唯一落点） */
async function loadDoc(gateway: CollabGateway, pid = 'p1'): Promise<Y.Doc> {
  const document = new Y.Doc();
  await (gateway as any).loadDocument({ document, documentName: `project:${pid}` });
  return document;
}

/** prom-client 计数增量断言（register 全局单例——测试间累积，恒用增量；heap-gate 同款） */
async function metricDelta(name: string, labels: Record<string, string>, fn: () => Promise<unknown> | unknown): Promise<number> {
  const metric: any = register.getSingleMetric(name);
  const countOf = async () =>
    (await metric.get()).values.find((s: any) => Object.entries(labels).every(([k, v]) => s.labels[k] === v))?.value ?? 0;
  const before = await countOf();
  await fn();
  return (await countOf()) - before;
}

/** 生成 set+delete 对（uSet 携带真实字节——源 doc 同步删=diff 只剩 GC 壳不携带内容，故分两条 diff） */
function makePair(src: Y.Doc, m: Y.Map<any>, key: string, size: number): [Buffer, Buffer] {
  const sv1 = Y.encodeStateVector(src);
  m.set(key, 'x'.repeat(size));
  const uSet = Buffer.from(Y.encodeStateAsUpdate(src, sv1));
  const sv2 = Y.encodeStateVector(src);
  m.delete(key);
  const uDel = Buffer.from(Y.encodeStateAsUpdate(src, sv2));
  return [uSet, uDel];
}

describe('Y0b-4 T3：docTruth 真值单变量（Q-B v3）', () => {
  it('cheap 上界播种：|state|+Σ|updates|+Σspool <soft 时直接当 truth（跳过编码——truth===cheap 且装载期 apply 不进 delta）', async () => {
    // 装置：state 带存活内容+一对 set/del 更新——GC 后编码值 < cheap（两值可区分，断言 === 即证未编码）
    const src = new Y.Doc();
    const m = src.getMap('g');
    m.set('live', 'a'.repeat(50_000));
    const [uSet, uDel] = makePair(src, m, 'k', 30_000);
    const state = Buffer.from(Y.encodeStateAsUpdate(src));
    const { gateway } = buildGateway({ state, updates: [uSet, uDel] }, { maxDocBytes: 1 * MiB });   // soft=838860 > cheap
    const cheap = state.length + uSet.length + uDel.length;
    const document = await loadDoc(gateway);
    expect(gatewayFacade(gateway).docTruthOf('p1')).toBe(cheap);   // truth=cheap 上界（非编码值）
    expect(gatewayFacade(gateway).docDeltaOf('p1')).toBe(0);       // 装载期 replay/spool 帧 apply 不进 delta（播种内容双计防线）
    expect(gatewayFacade(gateway).truthMeasuredAtOf('p1')).toBeGreaterThan(0);   // 冷却窗基线播种（T4 消费）
    // 编码值 ≠ cheap（apply 即 GC）——若实现误走编码，truth 必 ≠ cheap
    expect(Y.encodeStateAsUpdate(document).byteLength).toBeLessThan(cheap);
    // T0 探针⑦定标常量（8MB 编码 p95≈80.6ms 本机——2s 窗 duty≈4%）
    expect(TRUTH_COOLDOWN_MS).toBe(2_000);
  });

  it('cheap ≥soft 时付费实测（apply 即 GC——truth=编码值非求和值，<soft 不触冻结线）', async () => {
    // 200KB 存活 state + 30 对 100KB set/del（cheap≈3.2MB ≥ soft(1MB×0.8)）——墓碑全 GC
    const src = new Y.Doc();
    src.getMap('meta').set('schemaVersion', CANVAS_DOC_SCHEMA_VERSION);   // nodes 有内容 ⇒ 版本门需戳（无戳∧有节点=拒载）
    const m = src.getMap('nodes');
    m.set('live', 'a'.repeat(200_000));
    const updates: Buffer[] = [];
    for (let i = 0; i < 30; i++) updates.push(...makePair(src, m, 'k' + i, 100_000));
    const state = Buffer.from(Y.encodeStateAsUpdate(src));
    const cheap = state.length + updates.reduce((s, u) => s + u.length, 0);
    const soft = Math.floor(1 * MiB * QUOTA_DEFAULTS.softEnterRatio);
    expect(cheap).toBeGreaterThanOrEqual(soft);   // 装置自检：确实走付费实测档
    const { gateway } = buildGateway({ state, updates }, { maxDocBytes: 1 * MiB });
    await loadDoc(gateway);
    const truth = gatewayFacade(gateway).docTruthOf('p1')!;
    expect(truth).toBeGreaterThan(150_000);        // 存活 200KB 内容保留
    expect(truth).toBeLessThan(400_000);           // =实测编码值（≈201KB）非求和值（3.2MB）
    expect(truth).toBeLessThan(soft);              // 真实量级在软阈下——不触冻结线
  });

  it('update 监听累加 docDelta（全路径触发器——监听=唯一写者）', async () => {
    const src = new Y.Doc();
    src.getMap('g').set('live', 'a'.repeat(10_000));
    const state = Buffer.from(Y.encodeStateAsUpdate(src));
    const { gateway } = buildGateway({ state, updates: [] }, { maxDocBytes: 1 * MiB });
    const document = await loadDoc(gateway);
    const truthBefore = gatewayFacade(gateway).docTruthOf('p1');
    // 装载后的任意写（非 replaying 窗口）→ delta 按帧字节累加
    const w = new Y.Doc();
    w.getMap('x').set('k', 'v'.repeat(2048));
    const u = Y.encodeStateAsUpdate(w);
    Y.applyUpdate(document, u);
    expect(gatewayFacade(gateway).docDeltaOf('p1')).toBe(u.byteLength);
    expect(gatewayFacade(gateway).docTruthOf('p1')).toBe(truthBefore);   // truth 不随 delta 漂移（单变量分离）
  });

  it('compact 校准仅 pending 空时生效（newSnapshot=持久化真值口径——非空跳过下次）', async () => {
    const src = new Y.Doc();
    src.getMap('g').set('live', 'a'.repeat(10_000));
    const { gateway, repo } = buildGateway({ state: Buffer.from(Y.encodeStateAsUpdate(src)), updates: [] }, { maxDocBytes: 1 * MiB });
    await loadDoc(gateway);
    repo.compact.mockResolvedValue({ compacted: true, snapshotBytes: 4242, deletedRows: 0, tombstoneBytes: 0 });
    gatewayFacade(gateway).clearLastCompactAt('p1');   // 绕时间门（loadDocument 已播种基线）
    gatewayFacade(gateway).pendingQueueRef('p1')!.push(new Uint8Array(16));   // 活 doc 含未 store delta（真实数组引用——原地 push）
    await gateway.persistence.maybeCompact('p1');   // B1（T40）：公有化兑现=cast 消失（偏离 64② 预告的核销形态）
    expect(gatewayFacade(gateway).docTruthOf('p1')).not.toBe(4242);   // 非空跳过——newSnapshot 非活 doc 真值
    gatewayFacade(gateway).pendingQueueRef('p1')!.splice(0);           // 队列排空（原地 splice——身份语义保留）
    gatewayFacade(gateway).clearLastCompactAt('p1');
    await gateway.persistence.maybeCompact('p1');
    expect(gatewayFacade(gateway).docTruthOf('p1')).toBe(4242);       // 采纳=truth 校准
    expect(gatewayFacade(gateway).docDeltaOf('p1')).toBe(0);          // delta 归零（重测口径）
  });

  it('真红门②：真实 200KB+累计 update 10MB——truth≈200KB（不随 delta 累加漂移；默认 8MB 阈）', async () => {
    // T0 探针⑨形态：200KB 存活+100 对 100KB set/del=10MB 增量行——cheap≈10.2MB ≥ soft(6.7MB) → 付费实测
    const src = new Y.Doc();
    src.getMap('meta').set('schemaVersion', CANVAS_DOC_SCHEMA_VERSION);   // nodes 有内容 ⇒ 版本门需戳
    const m = src.getMap('nodes');
    m.set('live', 'a'.repeat(200_000));
    const updates: Buffer[] = [];
    for (let i = 0; i < 100; i++) updates.push(...makePair(src, m, 'k' + i, 100_000));
    const state = Buffer.from(Y.encodeStateAsUpdate(src));
    const cheap = state.length + updates.reduce((s, u) => s + u.length, 0);
    expect(cheap).toBeGreaterThan(10 * MiB * 0.9);   // 装置自检：累计 10MB 量级
    const { gateway } = buildGateway({ state, updates });   // 默认 quota（maxDocBytes=8MB——生产形态）
    await loadDoc(gateway);
    const truth = gatewayFacade(gateway).docTruthOf('p1')!;
    expect(truth).toBeGreaterThan(150_000);          // ≈200KB（存活内容保留）
    expect(truth).toBeLessThan(500_000);             // 绝非 cheap（10.2MB）——真值口径=实测编码
    expect(truth).toBeLessThan(Math.floor(QUOTA_DEFAULTS.maxDocBytes * QUOTA_DEFAULTS.softEnterRatio));   // 不触软阈=不冻结的前置
  });

  it('真红门④：缺依赖行照读（Q-O 不拒行）→装载后 pendingStructs 非空 ⇒ deferred{structs}+1+degraded 标记', async () => {
    // 探针⑨构造：U2 依赖 U1 的 item，装载只喂 U2 → 因果悬置进 pendingStructs（现状静默=红相）
    const src = new Y.Doc();
    const m = src.getMap('m');
    m.set('k', 'v');
    const sv1 = Y.encodeStateVector(src);
    m.set('k2', 'v2');
    const u2 = Buffer.from(Y.encodeStateAsUpdate(src, sv1));   // 只含依赖悬置 item（左 origin 指向缺失 struct）
    const { gateway } = buildGateway({ state: null, updates: [u2] }, { maxDocBytes: 1 * MiB });
    let document!: Y.Doc;
    const inc = await metricDelta('collab_hydration_deferred_total', { field: 'structs' }, async () => {
      document = await loadDoc(gateway);   // 照读不拒——装载成功
    });
    expect(inc).toBe(1);                                  // 降级可观测（现状 deferred 恒 0 静默=红相）
    expect(document.store.pendingStructs).not.toBeNull(); // 病理确认：悬置确实发生
    expect(document.store.pendingDs).toBeNull();          // 未触发 ds 档（双查分列）
    expect(gatewayFacade(gateway).degradedDocsHas('p1')).toBe(true);
  });

  it('pendingDs 断言：只含删除的跳行（依赖缺失的 delete set）→ deferred 计数 field=ds（双查——Q-O v5）', async () => {
    // 构造：源 doc set→sv→delete 的 diff=纯 delete set（引用装载侧不存在的 struct）→ 只触发 pendingDs
    const src = new Y.Doc();
    const m = src.getMap('m');
    m.set('k', 'v');
    const sv1 = Y.encodeStateVector(src);
    m.delete('k');
    const udel = Buffer.from(Y.encodeStateAsUpdate(src, sv1));
    const { gateway } = buildGateway({ state: null, updates: [udel] }, { maxDocBytes: 1 * MiB });
    let document!: Y.Doc;
    const inc = await metricDelta('collab_hydration_deferred_total', { field: 'ds' }, async () => {
      document = await loadDoc(gateway);
    });
    expect(inc).toBe(1);
    expect(document.store.pendingDs).not.toBeNull();        // 只含删除的跳行——独立字段
    expect(document.store.pendingStructs).toBeNull();       // structs 档不误触（分列不混）
    expect(gatewayFacade(gateway).degradedDocsHas('p1')).toBe(true);
  });

  it('卸载清理归位（I-1 修复）：取消卸载（beforeUnload 钩子窗）四件套保留；真卸载（afterUnloadDocument）清理+gauge 回落', async () => {
    // 装置：deferred 构造（依赖缺失行）——四件套全真路径播种（truth/delta/measuredAt+degraded 标记）
    const src = new Y.Doc();
    const m = src.getMap('m');
    m.set('k', 'v');
    const sv1 = Y.encodeStateVector(src);
    m.set('k2', 'v2');
    const u2 = Buffer.from(Y.encodeStateAsUpdate(src, sv1));
    const { gateway } = buildGateway({ state: null, updates: [u2] }, { maxDocBytes: 1 * MiB });
    const document = await loadDoc(gateway);
    const name = 'project:p1';
    const gauge: any = register.getSingleMetric('yjs_loaded_doc_bytes');
    const read = async () => (await gauge.get()).values[0]?.value ?? 0;
    // ① 取消卸载：库时序=beforeUnload 钩子后复检 return（esm:1586-1589）——钩子窗内不得清理（复用 doc
    //    不重跑 loadDocument，truth 族必须延续）。旧实现的 !documents.get 守卫在本窗恒 false=死路径，
    //    四件套永不清理（gauge 随进程寿命漂移=红相）
    await (gateway as any).unloadDocument({ document, documentName: name });   // 直调族——B1-B3 公有化后 cast 消失（偏离 64②）
    expect(gatewayFacade(gateway).docTruthHas('p1')).toBe(true);
    expect(gatewayFacade(gateway).docDeltaHas('p1')).toBe(true);
    expect(gatewayFacade(gateway).truthMeasuredAtHas('p1')).toBe(true);
    expect(gatewayFacade(gateway).degradedDocsHas('p1')).toBe(true);
    expect(await read()).toBeGreaterThan(0);   // gauge 仍反映当前装载 doc
    // ② 真卸载：库 documents.delete+destroy（esm:1590-1591）之后才调 afterUnloadDocument（esm:1592）
    //    ——必然真卸载无需守卫；直构形态直接调 gateway 钩子函数
    await gateway.hooks.afterUnloadDocument({ instance: gateway.server.hocuspocus, documentName: name });
    expect(gatewayFacade(gateway).docTruthHas('p1')).toBe(false);
    expect(gatewayFacade(gateway).docDeltaHas('p1')).toBe(false);
    expect(gatewayFacade(gateway).truthMeasuredAtHas('p1')).toBe(false);
    expect(gatewayFacade(gateway).degradedDocsHas('p1')).toBe(false);
    expect(await read()).toBe(0);              // Σ(truth+delta) 回落——容量观测面不随进程寿命漂向"Σ曾装载"
  });

  it('yjs_loaded_doc_bytes=Σ(truth+delta)（插值上界口径——delta 写入即时可见）', async () => {
    const src = new Y.Doc();
    src.getMap('g').set('live', 'a'.repeat(10_000));
    const { gateway } = buildGateway({ state: Buffer.from(Y.encodeStateAsUpdate(src)), updates: [] }, { maxDocBytes: 1 * MiB });
    const document = await loadDoc(gateway);
    const gauge: any = register.getSingleMetric('yjs_loaded_doc_bytes');
    const read = async () => (await gauge.get()).values[0]?.value ?? 0;
    const truth = gatewayFacade(gateway).docTruthOf('p1')!;
    expect(await read()).toBe(truth);   // 装载后=truth
    const w = new Y.Doc();
    w.getMap('x').set('k', 'y'.repeat(4096));
    const u = Y.encodeStateAsUpdate(w);
    Y.applyUpdate(document, u);
    expect(await read()).toBe(truth + u.byteLength);   // delta 累加即时反映（collect 现算）
  });

  it('spool merge 产生侧切批 ≤1MB（Q-O）：卸载交接 3×400KB 队列 → 多帧且每帧 ≤1MB（超限行结构性不可产生）', async () => {
    const src = new Y.Doc();
    src.getMap('g').set('live', 'a'.repeat(10_000));
    const { gateway, spool } = buildGateway({ state: Buffer.from(Y.encodeStateAsUpdate(src)), updates: [] }, { maxDocBytes: 1 * MiB });
    const document = await loadDoc(gateway);
    const q = gatewayFacade(gateway).pendingQueueRef('p1')!;   // 真实数组引用——push 原地累积
    for (let i = 0; i < 3; i++) {
      const d = new Y.Doc();
      d.getMap('g').set('k' + i, 'z'.repeat(400_000));
      q.push(Y.encodeStateAsUpdate(d));   // 模拟故障期累积（现状单次 merge=1.2MB 帧=红相）
    }
    await (gateway as any).unloadDocument({ document, documentName: 'project:p1' });   // 真卸载路径+队列交接落 spool
    const frames = await spool.peek('p1');
    expect(frames.length).toBeGreaterThanOrEqual(2);   // 现状单帧（1.2MB）必红
    for (const f of frames) expect(f.payload.byteLength).toBeLessThanOrEqual(PERSIST_MERGE_MAX_BYTES);
  });
});

// ── Y0c T10（Z119 锚②）：docDelta 按 origin 分流——服务端写事务不计客户端配额口径；持久化
// 不变式（pendingQueues push/pendingSince/软阈）全 origin 不变。装置=真 gateway loadDocument
// （真实监听代码路径+真实 docDelta Map——quota-truth 既有夹具），Y.applyUpdate 第三参=事务
// origin（yjs 契约：update 事件 origin=最外层事务 origin，与生产 withDoc doc.transact 同面）。 ──
describe('Y0c T10：docDelta 按 origin 分流（Z119 锚②）', () => {
  /** 装载后活 doc+全零 delta 基线（复用 T3 夹具——src 预盖 v2 戳=生产形态：无 stamp 自愈帧污染队列，
   *  装载后 pendingQueues 空——测试断言以「恰一次本帧 push」为判据） */
  async function loadWithZeroDelta(quota?: Partial<QuotaConfig>) {
    const src = new Y.Doc();
    src.getMap('meta').set('schemaVersion', CANVAS_DOC_SCHEMA_VERSION);
    src.getMap('g').set('live', 'a'.repeat(10_000));
    const { gateway } = buildGateway({ state: Buffer.from(Y.encodeStateAsUpdate(src)), updates: [] }, quota);
    const document = await loadDoc(gateway);
    expect(gatewayFacade(gateway).docDeltaOf('p1')).toBe(0);              // 装置自检：装载播种零 delta
    expect(gatewayFacade(gateway).pendingQueueRef('p1')).toHaveLength(0); // 装置自检：装载零队帧（stamp 前置于装载）
    return { gateway, document };
  }

  /** 装载后增量帧（2KB 写——独立源 doc diff） */
  function frameOf(bytes: number): Uint8Array {
    const w = new Y.Doc();
    w.getMap('x').set('k', 'v'.repeat(bytes));
    return Y.encodeStateAsUpdate(w);
  }

  it('红·服务端写：SERVER_TRANSACT_ORIGIN 事务写 ⇒ docDelta 不增（现状全 origin 累加）；pendingQueues 照 push+pendingSince 播种（X10 持久化不变式——全 origin 不变）', async () => {
    const { gateway, document } = await loadWithZeroDelta({ maxDocBytes: 1 * MiB });
    const u = frameOf(2048);

    Y.applyUpdate(document, u, SERVER_TRANSACT_ORIGIN);   // 生产 withDoc 最外层同 origin 形态

    expect(gatewayFacade(gateway).docDeltaOf('p1')).toBe(0);                  // 现状红：=u.byteLength（不区分 origin）
    expect(gatewayFacade(gateway).pendingQueueRef('p1')).toHaveLength(1);     // 持久化不变式：服务端写照 push
    expect(gatewayFacade(gateway).pendingQueueRef('p1')![0]).toEqual(u);      // push 的就是本帧（事务 update 与 apply 内容同——yjs 发射事务编码帧）
    expect(gatewayFacade(gateway).pendingSinceOf('p1')).toBeGreaterThan(0);   // 空→非空转变=未 flush 窗口起点（全 origin 播种）
  });

  it('守卫例·客户端写：{source:\'connection\'} 形态 origin ⇒ docDelta 仍累加（防过度排除——判据只翻转服务端写分类，null/其他 origin 维持计数）', async () => {
    const { gateway, document } = await loadWithZeroDelta({ maxDocBytes: 1 * MiB });
    const u = frameOf(2048);

    Y.applyUpdate(document, u, { source: 'connection' });   // WS 客户端写 origin 形态模拟

    expect(gatewayFacade(gateway).docDeltaOf('p1')).toBe(u.byteLength);      // 客户端写照计（配额口径不变）
    expect(gatewayFacade(gateway).pendingQueueRef('p1')).toHaveLength(1);    // 持久化不变式同守
  });
});
