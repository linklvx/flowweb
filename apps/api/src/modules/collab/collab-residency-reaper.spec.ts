// apps/api/src/modules/collab/collab-residency-reaper.spec.ts
// Y0c T16（片 A2——spec :521 reaper 段）：reaper 三条件+heap 闸常驻旁路修法（Z126）+双层约束
// （Z106/Z142）+store 失败强制淘汰（Z110/Z129）+驱逐观测（Z93+偏离 24 reason='degraded'）。
// 先红纪律：①heap 闸用例=任务卡指定先红（现判据无 tripped 驱逐分支⇒evicted 零增即红）；
// 其余用例在实现落位前以「reapTick/armIdleTimer 未定义」红。夹具=T15 spec 同款库形态复刻
// （DirectConnection 语义对齐 esm:1134-1171——TD-2 纪律）+reaper 消费面新增读出口 mock。
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import { register } from 'prom-client';
import {
  type DocLike, type DocMapLike } from '@flowweb/shared';
import { CollabResidencyService } from './collab-residency.service';
import {
  unregisterDegradedDocsReader, unregisterResidentReader,
} from './store.metrics';

function toDocLikeFixture(doc: Y.Doc): DocLike {
  return {
    getMap: (name) => doc.getMap(name) as unknown as DocMapLike,
    createMap: () => new Y.Map() as unknown as DocMapLike,
  };
}

/** 计数器现值（register 全局单例——恒用增量断言；label 维度求和或取指定 reason 值） */
async function counterValue(name: string, reason?: string): Promise<number> {
  const m = register.getSingleMetric(name) as any;
  if (!m) return NaN;
  const vals = (await m.get()).values;
  if (reason === undefined) return vals.reduce((s: number, v: any) => s + v.value, 0);
  return vals.find((v: any) => v.labels?.reason === reason)?.value ?? 0;
}

async function gaugeValue(name: string): Promise<number> {
  const m = register.getSingleMetric(name) as any;
  if (!m) return NaN;
  return (await m.get()).values[0]?.value ?? 0;
}

async function histogramCount(name: string): Promise<number> {
  const m = register.getSingleMetric(name) as any;
  return (await m.get()).values.find((v: any) => v.metricName === `${name}_count`)?.value ?? 0;
}

/** 库形态复刻夹具（T15 spec 同款）+reaper 消费面（gateway 读出口/强制淘汰面）mock。 */
function makeFixture() {
  const docs = new Map<string, Y.Doc>();
  const counts = new Map<Y.Doc, number>();
  const persisted = new Map<string, Uint8Array>();
  const disconnectGates = new Map<string, Promise<void>>();
  /** store 失败 doc 集合：disconnect 后仍留驻 docs Map（对齐库 esm:1540-1549 故意不卸载——Z110 unloadDocument 直调的靶形态） */
  const storeFailedStuck = new Set<string>();
  let disconnectCalls = 0;

  const openDirectConnection = vi.fn(async (name: string) => {
    let doc = docs.get(name);
    if (!doc) {
      doc = new Y.Doc();
      doc.getMap('nodes').set('n1', new Y.Map([['type', 'text']]));
      const saved = persisted.get(name);
      if (saved) Y.applyUpdate(doc, saved);
      const created = doc;
      Object.defineProperty(created, 'directConnectionsCount', { get: () => counts.get(created) ?? 0 });
      docs.set(name, doc);
    }
    counts.set(doc, (counts.get(doc) ?? 0) + 1);
    const conn = {
      document: doc as (Y.Doc & { directConnectionsCount?: number }),
      disconnect: vi.fn(async () => {
        disconnectCalls += 1;
        counts.set(doc!, Math.max(0, (counts.get(doc!) ?? 0) - 1));
        const gate = disconnectGates.get(name);
        if (gate) await gate;
        if ((counts.get(doc!) ?? 0) === 0) {
          persisted.set(name, Y.encodeStateAsUpdate(doc!));
          // storeFailedStuck：store 失败 doc 留驻形态（库 esm:1540-1549 故意不卸载——Z110 直调面装置）
          if (!storeFailedStuck.has(name)) docs.delete(name);
        }
      }),
    };
    return conn;
  });

  const gateway: any = {
    isLeaseServing: vi.fn(() => true),
    isVacuuming: vi.fn(() => false),
    isWritableOrDegraded: vi.fn((): 'ok' | 'spool-unwritable' => 'ok'),
    isDocDegraded: vi.fn(() => false),
    // Y0c T16 reaper 消费面（gateway 读出口——生产面待实现，红相=mock 形态先钉契约）
    isHeapPressureTripped: vi.fn((): boolean => false),
    isPgBreakerOpen: vi.fn((): boolean => false),
    hasPendingWrites: vi.fn((): boolean => false),
    hasInFlightStore: vi.fn((): boolean => false),
    docBytesOf: vi.fn((): number => 0),
    storeFailedDocs: new Set<string>(),
    handoffPendingToSpool: vi.fn(async (): Promise<boolean> => true),
    registerResidentSessionReleaser: vi.fn(),   // Y0c T17：residency 构造期注册释放回调（gateway 反向触达面）
    server: { hocuspocus: { openDirectConnection, unloadDocument: vi.fn(async () => {}), documents: docs } },
  };
  const residency = new CollabResidencyService(gateway);
  return {
    residency, gateway, openDirectConnection, docs, counts, persisted, disconnectGates, storeFailedStuck,
    disconnectCallCount: () => disconnectCalls,
    /** 建一个 held∧idle 会话（withSession read 完成即 refCount=0 常驻池化） */
    pool: async (pid: string) => { await residency.withSession(pid, () => 'r', { mode: 'read' }); },
  };
}

afterEach(() => {
  unregisterDegradedDocsReader();
  unregisterResidentReader();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ═══ 任务卡指定先红：heap 闸常驻旁路修法（Z126①②——现判据下 evicted 零增即红） ═══
describe('Y0c T16 Z126：heap tripped⇒常驻集字节 LRU 驱逐（reason=forced）', () => {
  // Minor-4（名实收窄）：原标题宣称「无 SERVER_OVERLOADED 拒」——fixture 无 refusalCache 面，本 spec
  // 不可验拒载；拒载判据由 gateway :881（REFUSAL_CACHEABLE 落 refusalCache）/ :1008（pgBreaker
  // admitQuery 拒新装载）承载，T16 diff 未动两处（已核）。可验面=tick 不抛+驱逐发生。
  it('tripped=true+常驻会话在表⇒tick⇒evicted{forced}+1 ∧ 条目移除（releaseSessionFor 生效）∧ tick 自身不抛+驱逐发生', async () => {
    const fx = makeFixture();
    (fx.residency as any).maxResidentBytes = 512;   // Σbytes(1024)>限——heap 驱逐目标=回落字节主约束内
    await fx.pool('p1');
    fx.gateway.docBytesOf.mockReturnValue(1024);
    const before = await counterValue('yjs_doc_evicted_total', 'forced');
    fx.gateway.isHeapPressureTripped.mockReturnValue(true);   // 注入 tripped（纯读数——非 heapPressureSample）

    await expect((fx.residency as any).reapTick()).resolves.toBeUndefined();   // tick 无拒抛（驱逐=释放资源非拒绝服务）

    expect(await counterValue('yjs_doc_evicted_total', 'forced')).toBe(before + 1);
    expect(fx.residency.sessionState('p1')).toBeUndefined();   // 条目移除（经 releaseSessionFor）
    expect(fx.disconnectCallCount()).toBe(1);                  // 释放握手真实发生
  });

  it('未 tripped⇒tick 不驱逐（TTL 未到零逐出——旁路仅压力态生效）', async () => {
    const fx = makeFixture();
    await fx.pool('p1');
    fx.gateway.docBytesOf.mockReturnValue(1024);
    const before = await counterValue('yjs_doc_evicted_total', 'forced');
    await (fx.residency as any).reapTick();
    expect(await counterValue('yjs_doc_evicted_total', 'forced')).toBe(before);
    expect(fx.residency.sessionState('p1')).toBe('held');
  });
});

// ═══ reaper 三条件（Z62/Z141：pendingQueues 空∧无在飞会话写〔inFlightProjects〕∧refCount===0∧held） ═══
describe('Y0c T16：reapOne 判据三条件各自不满足⇒不释放+计时器重置（Z112）', () => {
  it('refCount>0（会话在用）⇒TTL 到期不释放+计时器重置', async () => {
    const fx = makeFixture();
    (fx.residency as any).idleTtlMs = 1_000;
    const hold = new Promise<void>(() => {});                       // 永挂——会话在飞（refCount=1）
    void fx.residency.withSession('p1', () => hold, { mode: 'read' });
    await vi.waitFor(() => expect(fx.residency.holds('p1')).toBe(true));

    const evBefore = await counterValue('yjs_doc_evicted_total');
    (fx.residency as any).reapOne('p1');                            // TTL 到期路径直调（tick ④ 同判据）
    await Promise.resolve();
    expect(fx.residency.sessionState('p1')).toBe('held');           // 不释放
    expect((fx.residency as any).sessions.get('p1').idleTimer).not.toBeNull();   // 计时器重置
    expect(await counterValue('yjs_doc_evicted_total')).toBe(evBefore);
  });

  it('pendingQueues 非空（hasPendingWrites=true）⇒不释放+计时器重置', async () => {
    const fx = makeFixture();
    await fx.pool('p1');
    fx.gateway.hasPendingWrites.mockReturnValue(true);
    const evBefore = await counterValue('yjs_doc_evicted_total');
    (fx.residency as any).reapOne('p1');
    expect(fx.residency.sessionState('p1')).toBe('held');
    expect((fx.residency as any).sessions.get('p1').idleTimer).not.toBeNull();
    expect(await counterValue('yjs_doc_evicted_total')).toBe(evBefore);
  });

  it('inFlightProjects 有（hasInFlightStore=true——取批在飞窗）⇒不释放+计时器重置（Z141：「队列空」≠「批已落定」）', async () => {
    const fx = makeFixture();
    await fx.pool('p1');
    fx.gateway.hasInFlightStore.mockReturnValue(true);
    const evBefore = await counterValue('yjs_doc_evicted_total');
    (fx.residency as any).reapOne('p1');
    expect(fx.residency.sessionState('p1')).toBe('held');
    expect((fx.residency as any).sessions.get('p1').idleTimer).not.toBeNull();
    expect(await counterValue('yjs_doc_evicted_total')).toBe(evBefore);
  });
});

// ═══ TTL 到期逐出+degraded 提前逐出（偏离 24——spec §0.6 表尾） ═══
describe('Y0c T16：TTL/degraded 逐出', () => {
  it('idleTimer 到期⇒三条件满足⇒释放+evicted{ttl}+驻留时长直方图观测（Z93）', async () => {
    vi.useFakeTimers();
    const fx = makeFixture();
    (fx.residency as any).idleTtlMs = 1_000;
    await fx.pool('p1');
    const before = await counterValue('yjs_doc_evicted_total', 'ttl');
    const hBefore = await histogramCount('yjs_doc_evicted_residency_seconds');

    await vi.advanceTimersByTimeAsync(1_000);                       // idleTimer 到期（单会话即时路径）

    expect(await counterValue('yjs_doc_evicted_total', 'ttl')).toBe(before + 1);
    expect(fx.residency.sessionState('p1')).toBeUndefined();
    expect(fx.docs.has('project:p1')).toBe(false);                  // 真卸载（持久化后 docs Map 清键）
    expect(await histogramCount('yjs_doc_evicted_residency_seconds')).toBe(hBefore + 1);
  });

  it('tick 扫描兜底（timer 丢失形态——idleSince 台账仍可逐出）：TTL 已过⇒tick 逐出 reason=ttl', async () => {
    vi.useFakeTimers();
    const fx = makeFixture();
    (fx.residency as any).idleTtlMs = 1_000;
    await fx.pool('p1');
    (fx.residency as any).sessions.get('p1').idleTimer = null;      // timer 丢失注入（tick 兜底义务的靶形态）
    const before = await counterValue('yjs_doc_evicted_total', 'ttl');
    await vi.advanceTimersByTimeAsync(2_000);                       // idleSince 已越 TTL
    await (fx.residency as any).reapTick();
    expect(await counterValue('yjs_doc_evicted_total', 'ttl')).toBe(before + 1);
    expect(fx.residency.sessionState('p1')).toBeUndefined();
  });

  it('degraded 提前逐出（偏离 24）：held∧refCount===0∧isDocDegraded⇒不等 TTL 即释放+evicted{degraded}', async () => {
    const fx = makeFixture();
    (fx.residency as any).idleTtlMs = 600_000;                      // TTL 远未到
    await fx.pool('p1');
    fx.gateway.isDocDegraded.mockReturnValue(true);
    const before = await counterValue('yjs_doc_evicted_total', 'degraded');
    await (fx.residency as any).reapTick();
    expect(await counterValue('yjs_doc_evicted_total', 'degraded')).toBe(before + 1);
    expect(fx.residency.sessionState('p1')).toBeUndefined();
  });

  it('acquire 命中 held⇒清 idleTimer+idleSince（活跃会话不逐出）', async () => {
    vi.useFakeTimers();
    const fx = makeFixture();
    (fx.residency as any).idleTtlMs = 1_000;
    await fx.pool('p1');
    await vi.advanceTimersByTimeAsync(500);
    const hold = new Promise<void>(() => {});                       // 会话在飞——acquire 命中 held（复用）
    void fx.residency.withSession('p1', () => hold, { mode: 'read' });
    await vi.waitFor(() => expect((fx.residency as any).sessions.get('p1').refCount).toBe(1));
    const e = (fx.residency as any).sessions.get('p1');
    expect(e.idleTimer).toBeNull();                                 // 命中即撤销空闲计时
    expect(e.idleSince).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2_000);                       // TTL 远过——在飞不逐出
    expect(fx.residency.sessionState('p1')).toBe('held');
  });
});

// ═══ 双层约束（Z106+Z142：字节主约束 384MiB 显式默认+条目 64 近似——永不拒载 Z55） ═══
describe('Y0c T16 Z106/Z142：双层约束（字节 LRU+条目 LRU+over_limit 计数+永不拒载）', () => {
  it('Σbytes 超限⇒最大者逐出（字节主序 LRU）reason=lru+over_limit 计数；被驱逐者回落至限内即停', async () => {
    const fx = makeFixture();
    (fx.residency as any).maxResidentBytes = 350;
    await fx.pool('p1');
    await fx.pool('p2');
    fx.gateway.docBytesOf.mockImplementation((pid: string) => (pid === 'p1' ? 300 : 100));

    const before = await counterValue('yjs_doc_evicted_total', 'lru');
    const overBefore = await counterValue('yjs_resident_over_limit_total');
    await (fx.residency as any).reapTick();

    expect(await counterValue('yjs_doc_evicted_total', 'lru')).toBe(before + 1);   // 恰 1：Σ 400→100 已回落限内
    expect(fx.residency.sessionState('p1')).toBeUndefined();        // 最大者（300B）被逐
    expect(fx.residency.sessionState('p2')).toBe('held');           // 小者留驻
    expect(await counterValue('yjs_resident_over_limit_total')).toBe(overBefore + 1);
  });

  it('永不拒载（Z55）：超限驱逐后新 acquire 照常成功', async () => {
    const fx = makeFixture();
    (fx.residency as any).maxResidentBytes = 100;
    await fx.pool('p1');
    fx.gateway.docBytesOf.mockReturnValue(300);
    await (fx.residency as any).reapTick();                         // p1 超限被逐
    expect(fx.residency.sessionState('p1')).toBeUndefined();
    await fx.pool('p1');                                            // 永不拒载——重新池化成功
    expect(fx.residency.sessionState('p1')).toBe('held');
    expect(fx.openDirectConnection).toHaveBeenCalledTimes(2);
  });

  it('条目约束：>maxResidentDocs⇒最旧空闲者逐出（reason=lru——Z55「回收最旧空闲非拒载」）', async () => {
    const fx = makeFixture();
    (fx.residency as any).maxResidentDocs = 1;
    await fx.pool('p1');
    await new Promise((r) => setTimeout(r, 5));
    await fx.pool('p2');                                            // p2 更新入池——p1 更旧
    const before = await counterValue('yjs_doc_evicted_total', 'lru');
    await (fx.residency as any).reapTick();
    expect(await counterValue('yjs_doc_evicted_total', 'lru')).toBe(before + 1);
    expect(fx.residency.sessionState('p1')).toBeUndefined();        // 最旧空闲者先出
    expect(fx.residency.sessionState('p2')).toBe('held');
  });

  it('构造器默认值（Z142 显式——env 未设：bytes=384MiB/docs=64/TTL=120s）', async () => {
    vi.stubEnv('COLLAB_SESSION_IDLE_TTL_MS', '');
    vi.stubEnv('COLLAB_MAX_RESIDENT_BYTES', '');
    vi.stubEnv('COLLAB_MAX_LOADED_DOCS', '');
    const fx = makeFixture();
    expect((fx.residency as any).idleTtlMs).toBe(120_000);
    expect((fx.residency as any).maxResidentBytes).toBe(402_653_184);   // 384MiB 显式（Z142——禁默认关闭）
    expect((fx.residency as any).maxResidentDocs).toBe(64);             // Z132②：待实测校准近似（T22 回填）
  });
});

// ═══ store 失败强制淘汰（Z110+Z129 spool 交接义务） ═══
describe('Y0c T16 Z110/Z129：storeFailed 强制淘汰', () => {
  it('storeFailed 标记⇒spool 交接+清会话条目+evicted{forced}+unloadDocument 直调（Z65 唯一调用点）', async () => {
    const fx = makeFixture();
    await fx.pool('p1');
    fx.storeFailedStuck.add('project:p1');   // store 失败留驻形态（库 esm:1540-1549——释放后 doc 仍在，直调的靶）
    fx.gateway.storeFailedDocs.add('p1');
    const before = await counterValue('yjs_doc_evicted_total', 'forced');

    await (fx.residency as any).reapTick();

    expect(fx.gateway.handoffPendingToSpool).toHaveBeenCalledWith('p1');
    expect(fx.residency.sessionState('p1')).toBeUndefined();       // 会话条目已清
    expect(await counterValue('yjs_doc_evicted_total', 'forced')).toBe(before + 1);
    expect(fx.gateway.server.hocuspocus.unloadDocument).toHaveBeenCalledTimes(1);
    expect(fx.disconnectCallCount()).toBe(1);                      // direct 连接计数归零（unload 过库谓词的前提）
  });

  it('交接失败⇒拒绝淘汰该会话（条目保留）+release_handoff_failed 计数+1（Z129/Z143——非放弃；Y0c T17 改道 tryRelease 带批档后计数面从 unload_handoff 迁本表）', async () => {
    const fx = makeFixture();
    await fx.pool('p1');
    fx.gateway.storeFailedDocs.add('p1');
    fx.gateway.handoffPendingToSpool.mockResolvedValue(false);
    const before = await counterValue('yjs_release_handoff_failed_total');
    const evBefore = await counterValue('yjs_doc_evicted_total', 'forced');

    await (fx.residency as any).reapTick();

    expect(await counterValue('yjs_release_handoff_failed_total')).toBe(before + 1);
    expect(fx.residency.sessionState('p1')).toBe('held');          // 条目保留（拒绝淘汰）
    expect(await counterValue('yjs_doc_evicted_total', 'forced')).toBe(evBefore);
    expect(fx.gateway.server.hocuspocus.unloadDocument).not.toHaveBeenCalled();
  });

  it('I-1 并发 TOCTOU：handoff 挂起窗内并发 acquire 命中 held（refCount 0→1）⇒不删条目不断 conn（留表交下轮 tick）', async () => {
    const fx = makeFixture();
    await fx.pool('p1');
    fx.gateway.storeFailedDocs.add('p1');
    let releaseHandoff!: () => void;
    fx.gateway.handoffPendingToSpool.mockImplementation(() => new Promise<boolean>((r) => { releaseHandoff = () => r(true); }));
    const evBefore = await counterValue('yjs_doc_evicted_total', 'forced');

    const tickP = (fx.residency as any).reapTick();
    await vi.waitFor(() => expect(releaseHandoff).toBeDefined());   // handoff await 窗已开（fsync 挂起形态）
    const hold = new Promise<void>(() => {});                       // 并发 withSession：窗内 acquire 命中 held+fn 永挂（refCount 持 1）
    void fx.residency.withSession('p1', () => hold, { mode: 'read' });
    await vi.waitFor(() => expect((fx.residency as any).sessions.get('p1').refCount).toBe(1));
    releaseHandoff();

    await tickP;                                                    // 旧代码无条件 delete+disconnect=拔在用 conn（红相）
    expect(fx.residency.sessionState('p1')).toBe('held');           // 条目保留
    expect((fx.residency as any).sessions.get('p1').refCount).toBe(1);   // 在飞会话引用原样
    expect(fx.disconnectCallCount()).toBe(0);                       // conn 未断
    expect(fx.gateway.server.hocuspocus.unloadDocument).not.toHaveBeenCalled();
    expect(await counterValue('yjs_doc_evicted_total', 'forced')).toBe(evBefore);
  });

  it('PG 熔断开⇒跳过强制淘汰的 disconnect 面（Z110 放大循环防护——条目保留交 heap 闸观测）', async () => {
    const fx = makeFixture();
    await fx.pool('p1');
    fx.gateway.storeFailedDocs.add('p1');
    fx.gateway.isPgBreakerOpen.mockReturnValue(true);
    const evBefore = await counterValue('yjs_doc_evicted_total', 'forced');

    await (fx.residency as any).reapTick();

    expect(fx.residency.sessionState('p1')).toBe('held');
    expect(fx.gateway.handoffPendingToSpool).not.toHaveBeenCalled();
    expect(fx.disconnectCallCount()).toBe(0);                      // 熔断期零 disconnect（不撞 store）
    expect(await counterValue('yjs_doc_evicted_total', 'forced')).toBe(evBefore);
  });

  it('unloadDocument 直调抛错⇒失败计数+1（条目已清——淘汰本身不回滚）', async () => {
    const fx = makeFixture();
    await fx.pool('p1');
    fx.storeFailedStuck.add('project:p1');   // store 失败留驻形态——直调可达（释放后 doc 仍在）
    fx.gateway.storeFailedDocs.add('p1');
    fx.gateway.server.hocuspocus.unloadDocument.mockRejectedValue(new Error('hook rejected'));
    const before = await counterValue('yjs_force_evict_failure_total');

    await expect((fx.residency as any).reapTick()).resolves.toBeUndefined();

    expect(await counterValue('yjs_force_evict_failure_total')).toBe(before + 1);
    expect(fx.residency.sessionState('p1')).toBeUndefined();       // 条目已清（计数告警不回滚淘汰）
  });
});

// ═══ Y0c T17（Z129/Z141/Z143）：统一释放入口 tryRelease——常规档两前置拒绝/带批档 spool 交接 ═══
describe('Y0c T17 Z129/Z141/Z143：tryRelease 统一释放入口', () => {
  /** yjs_release_with_pending_total 按 motive label 取值（fixture counterValue 是 reason 口径） */
  async function pendingByMotive(motive: string): Promise<number> {
    const m = register.getSingleMetric('yjs_release_with_pending_total') as any;
    if (!m) return NaN;
    return (await m.get()).values.find((v: any) => v.labels?.motive === motive)?.value ?? 0;
  }

  it('Z129 指定先红：pendingQueues 有帧（hasPendingWrites=true）+tryRelease(pid,"vacuum") ⇒ releaseSessionFor 未被调用+rejected-pending+release_with_pending{vacuum}+1+idleTimer 重置', async () => {
    const fx = makeFixture();
    await fx.pool('p1');                                            // held+refCount=0+idleTimer 武装
    fx.gateway.hasPendingWrites.mockReturnValue(true);
    const rel = vi.spyOn(fx.residency as any, 'releaseSessionFor');
    const timerBefore = (fx.residency as any).sessions.get('p1').idleTimer;

    const cntBefore = await pendingByMotive('vacuum');
    await expect(fx.residency.tryRelease('p1', 'vacuum')).resolves.toBe('rejected-pending');

    expect(rel).not.toHaveBeenCalled();                             // ★准入拒绝=原语零调用（Z129 先红形态——非「调了没卸」）
    expect(await pendingByMotive('vacuum')).toBe(cntBefore + 1);
    const entry = (fx.residency as any).sessions.get('p1');
    expect(fx.residency.sessionState('p1')).toBe('held');           // 条目保留
    expect(entry.idleTimer).not.toBeNull();
    expect(entry.idleTimer).not.toBe(timerBefore);                  // 重置（新 timer——TTL 判据再等一轮）
    expect(fx.disconnectCallCount()).toBe(0);
  });

  it('Z141 第二项：inFlightProjects 有 pid（队列空）⇒同上拒绝（「队列空」≠「批已落定」）', async () => {
    const fx = makeFixture();
    await fx.pool('p1');
    fx.gateway.hasInFlightStore.mockReturnValue(true);
    const rel = vi.spyOn(fx.residency as any, 'releaseSessionFor');

    const cntBefore = await pendingByMotive('drain');
    await expect(fx.residency.tryRelease('p1', 'drain')).resolves.toBe('rejected-pending');

    expect(rel).not.toHaveBeenCalled();
    expect(await pendingByMotive('drain')).toBe(cntBefore + 1);
    expect(fx.residency.sessionState('p1')).toBe('held');
    expect(fx.disconnectCallCount()).toBe(0);
  });

  it('会话在用（refCount>0）⇒拒绝（释放原语纪律收口——release_inflight 稳态 0 载体）', async () => {
    const fx = makeFixture();
    const hold = new Promise<void>(() => {});
    void fx.residency.withSession('p1', () => hold, { mode: 'read' });   // refCount=1 在飞
    await vi.waitFor(() => expect(fx.residency.holds('p1')).toBe(true));
    const rel = vi.spyOn(fx.residency as any, 'releaseSessionFor');

    const cntBefore = await pendingByMotive('vacuum');
    await expect(fx.residency.tryRelease('p1', 'vacuum')).resolves.toBe('rejected-pending');

    expect(rel).not.toHaveBeenCalled();
    expect(await pendingByMotive('vacuum')).toBe(cntBefore + 1);
    expect((fx.residency as any).sessions.get('p1').refCount).toBe(1);   // 在飞引用原样
    expect(fx.disconnectCallCount()).toBe(0);
  });

  it('常规档放行：两前置满足 ⇒ released+releaseSessionFor 被调（经 doRelease 完整路径——条目移除+真断）', async () => {
    const fx = makeFixture();
    await fx.pool('p1');
    const rel = vi.spyOn(fx.residency as any, 'releaseSessionFor');

    await expect(fx.residency.tryRelease('p1', 'reaper')).resolves.toBe('released');

    expect(rel).toHaveBeenCalledTimes(1);
    expect(fx.residency.sessionState('p1')).toBeUndefined();        // doRelease 完成（条目移除）
    expect(fx.disconnectCallCount()).toBe(1);                       // 释放握手真实发生
    expect(fx.docs.has('project:p1')).toBe(false);                  // 零连接→持久化+真卸载
  });

  it('带批档 shutdown：批非空（常规档必拒）⇒handoff 先行+成功⇒释放；handoff 失败⇒rejected-handoff+条目保留+ERROR 计数——且非放弃（后续会话继续处理）', async () => {
    const fx = makeFixture();
    await fx.pool('p1');
    await fx.pool('p2');
    fx.gateway.hasPendingWrites.mockReturnValue(true);              // 两会话均批非空——带批档消费形态

    // 臂 a：交接成功 ⇒ 允许带批释放（handoff 先行于 disconnect）
    await expect(fx.residency.tryRelease('p1', 'shutdown')).resolves.toBe('released');
    expect(fx.gateway.handoffPendingToSpool).toHaveBeenCalledWith('p1');
    expect(fx.residency.sessionState('p1')).toBeUndefined();
    expect(fx.disconnectCallCount()).toBe(1);

    // 臂 b：交接失败 ⇒ 拒绝该会话（条目保留 hold 交 drain 兜底）+计数——p2 继续处理（Z143 非放弃）
    fx.gateway.handoffPendingToSpool.mockResolvedValue(false);
    const hfBefore = await counterValue('yjs_release_handoff_failed_total');
    await expect(fx.residency.tryRelease('p2', 'shutdown')).resolves.toBe('rejected-handoff');
    expect(await counterValue('yjs_release_handoff_failed_total')).toBe(hfBefore + 1);
    expect(fx.residency.sessionState('p2')).toBe('held');           // 条目保留
  });

  it('I-1 shutdown 档 refCount>0 强释（终局档豁免）：在飞读在⇒仍 released+条目移除+conn 已断+release_inflight 计数照发（M-5 观测语义保留）——rejected 留 direct conn⇒Z81 destroy_timeout 假 ERROR「关停撞在飞读」复发面', async () => {
    const fx = makeFixture();
    const hold = new Promise<void>(() => {});                       // 在飞读（refCount=1）
    void fx.residency.withSession('p1', () => hold, { mode: 'read' });
    await vi.waitFor(() => expect((fx.residency as any).sessions.get('p1').refCount).toBe(1));
    const b = await counterValue('collab_residency_release_inflight_total');

    await expect(fx.residency.tryRelease('p1', 'shutdown')).resolves.toBe('released');   // 豁免强释（修复前=rejected-pending 即红）

    expect(fx.residency.sessionState('p1')).toBeUndefined();        // 条目移除（终局档不留表）
    expect(fx.disconnectCallCount()).toBe(1);                       // direct conn 不残留（Z81 消声面）
    expect(await counterValue('collab_residency_release_inflight_total')).toBe(b + 1);   // WARN+计数由 releaseSessionFor M-5 守卫承载
  });

  it('构造期注册：residency 构造器把 tryRelease 经 gateway.registerResidentSessionReleaser 反向注入（三出口改道的载体面）', async () => {
    const fx = makeFixture();
    expect(fx.gateway.registerResidentSessionReleaser).toHaveBeenCalledTimes(1);
    const registered = (fx.gateway.registerResidentSessionReleaser as ReturnType<typeof vi.fn>).mock.calls[0][0] as (pid: string | null, motive: string) => Promise<unknown>;
    await fx.pool('p1');
    // pid=null=全部常驻会话（drain/self-isolate 出口消费形态）；单 pid=vacuum quiesce 消费形态
    await expect(registered(null, 'drain')).resolves.toBeUndefined();
    expect(fx.residency.sessionState('p1')).toBeUndefined();        // 全部释放已发生
  });

  it('reaper 逐出改道：evictViaRelease 经 tryRelease——evicted{reason} 观测不变（ttl 路径复验）', async () => {
    const fx = makeFixture();
    (fx.residency as any).idleTtlMs = 1_000;
    vi.useFakeTimers();
    await fx.pool('p1');
    const before = await counterValue('yjs_doc_evicted_total', 'ttl');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await counterValue('yjs_doc_evicted_total', 'ttl')).toBe(before + 1);
    expect(fx.residency.sessionState('p1')).toBeUndefined();
  });
});

// ═══ 周期挂载+观测（tick ⑤ reconcileSessions / gauge 供数 / 指标注册面） ═══
describe('Y0c T16：tick 周期挂载+观测', () => {
  it('reconcileSessions 在 tick 内被调（T15 挂载义务——漂移注入经 tick 可见）', async () => {
    const fx = makeFixture();
    await fx.pool('p1');
    const before = await counterValue('collab_residency_reconcile_drift_total');
    (fx.residency as any).sessions.get('p1').conn.document = null;   // 漂移形态注入（T15 spec 同款）
    await (fx.residency as any).reapTick();
    expect(await counterValue('collab_residency_reconcile_drift_total')).toBe(before + 1);
  });

  it('gauge 供数：yjs_resident_bytes=Σbytes（tick 刷新）/yjs_resident_docs=条目数（reader 注册模式）', async () => {
    const fx = makeFixture();
    await fx.pool('p1');
    await fx.pool('p2');
    fx.gateway.docBytesOf.mockImplementation((pid: string) => (pid === 'p1' ? 300 : 100));
    await (fx.residency as any).reapTick();                          // bytes 缓存刷新（tick 供数前刷新）
    expect(await gaugeValue('yjs_resident_bytes')).toBe(400);
    expect(await gaugeValue('yjs_resident_docs')).toBe(2);
  });

  it('Minor-3 口径统一：releasing 档不计 yjs_resident_docs+条目判据同口径（mass-zombie 期不虚高不空转驱逐）', async () => {
    const fx = makeFixture();
    (fx.residency as any).maxResidentDocs = 1;
    await fx.pool('p1');
    await fx.pool('p2');
    (fx.residency as any).sessions.get('p1').state = 'releasing';    // 过渡档注入（gauge/条目判据纯读 state——白盒同款 :362 漂移注入）
    const overBefore = await counterValue('yjs_resident_over_limit_total');
    const evBefore = await counterValue('yjs_doc_evicted_total', 'lru');

    await (fx.residency as any).reapTick();

    expect(await gaugeValue('yjs_resident_docs')).toBe(1);           // 仅 p2 held（旧口径 sessions.size=2=红相）
    expect(await counterValue('yjs_resident_over_limit_total')).toBe(overBefore);   // held 1≤限——无空 WARN/虚计
    expect(await counterValue('yjs_doc_evicted_total', 'lru')).toBe(evBefore);      // 无对 held idle 条目的无效驱逐
    expect(fx.residency.sessionState('p2')).toBe('held');            // p2 不被误逐
  });

  it('全部新指标注册可见（出口判据④——五枚：两 gauge+over_limit+evicted{reason 四值}+驻留直方图）', async () => {
    expect(register.getSingleMetric('yjs_resident_bytes')).toBeTruthy();
    expect(register.getSingleMetric('yjs_resident_docs')).toBeTruthy();
    expect(register.getSingleMetric('yjs_resident_over_limit_total')).toBeTruthy();
    const ev = register.getSingleMetric('yjs_doc_evicted_total') as any;
    expect(ev).toBeTruthy();
    expect(ev.labelNames).toEqual(['reason']);
    expect(register.getSingleMetric('yjs_doc_evicted_residency_seconds')).toBeTruthy();
    expect(register.getSingleMetric('yjs_force_evict_failure_total')).toBeTruthy();
  });
});

// ═══ Y0c T18（Z81/Z38 硬前置+Z143 双计数+Σdirect===0 断言）：关停步骤 0 releaseAllSessions 全形态 ═══
describe('Y0c T18：releaseAllSessions 全形态（逐会话 300ms/总 2s 预算+Σdirect===0 断言）', () => {
  /** yjs_release_budget_exceeded_total 按 scope label 取值（Z143 双拒绝分离的第三面：超预算）。 */
  async function budgetByScope(scope: 'session' | 'total'): Promise<number> {
    const m = register.getSingleMetric('yjs_release_budget_exceeded_total') as any;
    if (!m) return NaN;
    return (await m.get()).values.find((v: any) => v.labels?.scope === scope)?.value ?? 0;
  }
  const hangGate = new Promise<void>(() => {});   // disconnect 永挂（fsync 挂起形态——Z109 同款注入面）

  it('T18-1 逐会话预算：disconnect 段挂起 >300ms ⇒ budget_exceeded{session}+1+ERROR 点名+条目留表（zombie 档自延续——5s 未到不置）；count 已被 removeDirectConnection 先行扣减 ⇒ 无泄漏', async () => {
    vi.useFakeTimers();
    const fx = makeFixture();
    await fx.pool('p1');
    fx.disconnectGates.set('project:p1', hangGate);
    const errSpy = vi.spyOn((fx.residency as any).logger, 'error');
    const before = await budgetByScope('session');
    const leakBefore = await counterValue('yjs_shutdown_direct_leak_total');

    const rel = fx.residency.releaseAllSessions('shutdown');
    await vi.advanceTimersByTimeAsync(300);   // 300ms 逐会话预算界
    await rel;

    expect(await budgetByScope('session')).toBe(before + 1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('project:p1'));   // 超预算点名
    expect(fx.residency.sessionState('p1')).toBe('releasing');   // 留表（非 zombie——5s 档自延续）
    expect(fx.disconnectCallCount()).toBe(1);
    expect(await counterValue('yjs_shutdown_direct_leak_total')).toBe(leakBefore);   // Σdirect=0（count 先扣）——零泄漏
  });

  it('T18-2 总预算：wall 时钟破总预算 ⇒ 剩余会话逐个点名+budget_exceeded{total}+留 hold（Z143「继续 hold 交步骤 4」）+被跳过会话 direct conn 残留 ⇒ Σdirect 断言 ERROR+direct_leak 计数（Z81 泄漏与预算两口径分离）', async () => {
    vi.useFakeTimers();
    const fx = makeFixture();
    await fx.pool('p1');
    await fx.pool('p2');
    await fx.pool('p3');
    for (const p of ['p1', 'p2', 'p3']) fx.disconnectGates.set(`project:${p}`, hangGate);
    const errSpy = vi.spyOn((fx.residency as any).logger, 'error');
    const sBefore = await budgetByScope('session');
    const tBefore = await budgetByScope('total');
    const leakBefore = await counterValue('yjs_shutdown_direct_leak_total');

    const rel = fx.residency.releaseAllSessions('shutdown', { perSessionMs: 100, totalMs: 150 });
    await vi.advanceTimersByTimeAsync(100);   // s1：session 预算破
    await vi.advanceTimersByTimeAsync(100);   // s2（elapsed 100<150 放行）：session 预算破
    await rel;                                 // s3：elapsed 200≥150 ⇒ 跳过（total 档）

    expect(await budgetByScope('session')).toBe(sBefore + 2);
    expect(await budgetByScope('total')).toBe(tBefore + 1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('project:p3'));   // 剩余会话点名
    expect(fx.residency.sessionState('p3')).toBe('held');    // 留 hold（未被处理——交 drainAllDocuments 兜底）
    expect(fx.disconnectCallCount()).toBe(2);                // s1/s2 各一次
    expect(await counterValue('yjs_shutdown_direct_leak_total')).toBe(leakBefore + 1);   // s3 conn 在 ⇒ Σdirect=1 ⇒ ERROR+计数
  });

  it('T18-3 Z143①：spool 交接慢（>300ms）但 disconnect 快 ⇒ 不算超预算（计时只裹 disconnect 段——交接段不计入）', async () => {
    vi.useFakeTimers();
    const fx = makeFixture();
    await fx.pool('p1');
    fx.gateway.hasPendingWrites.mockReturnValue(true);   // 带批形态（shutdown 档 handoff 激活面）
    let releaseHandoff!: (v: boolean) => void;
    fx.gateway.handoffPendingToSpool.mockImplementation(() => new Promise<boolean>((r) => { releaseHandoff = r; }));
    const before = await budgetByScope('session');

    const rel = fx.residency.releaseAllSessions('shutdown');
    await vi.advanceTimersByTimeAsync(500);   // 交接段 500ms>300ms——预算未起跑（交接不计时）
    releaseHandoff(true);                      // 交接完成 → disconnect（快）→ released
    await vi.advanceTimersByTimeAsync(0);
    await rel;

    expect(await budgetByScope('session')).toBe(before);   // 交接耗时不计 disconnect 预算
    expect(fx.residency.sessionState('p1')).toBeUndefined();   // released（条目移除）
    expect(fx.disconnectCallCount()).toBe(1);
  });

  it('T18-4 交接失败 ⇒ release_handoff_failed（T17 既有）+条目留 hold+Σdirect 断言 ERROR+direct_leak 计数（Z81 硬失败口径——泄漏非预算）', async () => {
    const fx = makeFixture();
    await fx.pool('p1');
    fx.gateway.handoffPendingToSpool.mockResolvedValue(false);   // 交接失败（spool 不可写形态）
    const errSpy = vi.spyOn((fx.residency as any).logger, 'error');
    const hfBefore = await counterValue('yjs_release_handoff_failed_total');
    const leakBefore = await counterValue('yjs_shutdown_direct_leak_total');

    await fx.residency.releaseAllSessions('shutdown');

    expect(await counterValue('yjs_release_handoff_failed_total')).toBe(hfBefore + 1);
    expect(fx.residency.sessionState('p1')).toBe('held');   // 留 hold 交 drainAllDocuments 兜底
    expect(fx.disconnectCallCount()).toBe(0);
    expect(await counterValue('yjs_shutdown_direct_leak_total')).toBe(leakBefore + 1);   // Σdirect=1>0
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('direct leak'));        // ERROR 点名
  });

  it('T18-8 self-isolate 出口同蒙预算：注册回调 (null,"self-isolate") 路由 releaseAllSessions——挂起会话 300ms 有界返回（失租紧急路径 WS 关闭时延有界；旧 T17 逐会话无界等待=红）；Σdirect 断言仅 shutdown 档（selfIsolate 面归 T19）', async () => {
    vi.useFakeTimers();
    const fx = makeFixture();
    const registered = (fx.gateway.registerResidentSessionReleaser as ReturnType<typeof vi.fn>).mock.calls[0][0] as (pid: string | null, motive: string) => Promise<unknown>;
    await fx.pool('p1');
    fx.disconnectGates.set('project:p1', hangGate);
    const before = await budgetByScope('session');
    const leakBefore = await counterValue('yjs_shutdown_direct_leak_total');

    const rel = registered(null, 'self-isolate');
    await vi.advanceTimersByTimeAsync(300);
    await rel;   // 有界返回——不等待 disconnect 真实 settle

    expect(await budgetByScope('session')).toBe(before + 1);
    expect(fx.residency.sessionState('p1')).toBe('releasing');
    expect(await counterValue('yjs_shutdown_direct_leak_total')).toBe(leakBefore);   // self-isolate 不发 leak 断言
  });

  // ── T18 质量收尾（I-1/I-2/M-1）：双调双烧三缺陷先红用例 ──

  it('T18-9 I-1 双调路径：#1 300ms 预算 budget-exceeded 后复调同 pid（Nest DI 反序钩子 #1+gateway 步骤 0 #2 形态）⇒ 第二次仍 300ms 有界返回+{session} 不双烧+ERROR 点名不重复+released 不虚计', async () => {
    vi.useFakeTimers();
    const fx = makeFixture();
    await fx.pool('p1');
    fx.disconnectGates.set('project:p1', hangGate);
    const errSpy = vi.spyOn((fx.residency as any).logger, 'error');
    const before = await budgetByScope('session');

    const rel1 = fx.residency.releaseAllSessions('shutdown');
    await vi.advanceTimersByTimeAsync(300);   // #1：逐会话预算界
    await rel1;
    expect(await budgetByScope('session')).toBe(before + 1);          // #1 首报
    expect(fx.residency.sessionState('p1')).toBe('releasing');

    const logSpy = vi.spyOn((fx.residency as any).logger, 'log');
    let done = false;
    const rel2 = fx.residency.releaseAllSessions('shutdown').then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(300);   // #2 同 300ms 窗——修复前复调 await 界=doRelease 5s（预算被无视）
    expect(done).toBe(true);                  // 有界返回（修复前=300ms 后仍挂即红）
    await rel2;

    expect(await budgetByScope('session')).toBe(before + 1);          // 计数不双烧（已点名 latch）
    expect(errSpy.mock.calls.filter((c: any[]) => String(c[0]).includes('release budget exceeded (session'))).toHaveLength(1);   // 点名不重复
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('0/1 released'));   // released 不虚计（#2 未把 #1 已点名会话计入 released）
    expect(fx.residency.sessionState('p1')).toBe('releasing');        // 条目留表自延续（不因复调改判）
  });

  it('T18-10 I-1 复调分支预算复守（根修面）：非预算调用方（reaper 常规档直释）遗留 releasing 会话——releaseAllSessions 复调等待同受 300ms 约束+首次点名计 {session}（修复前=await releasePromise 界 5s 预算被无视即红）', async () => {
    vi.useFakeTimers();
    const fx = makeFixture();
    await fx.pool('p1');
    fx.disconnectGates.set('project:p1', hangGate);
    void fx.residency.releaseSessionFor('p1');                        // 非预算调用方在飞释放（未点名形态）
    expect(fx.residency.sessionState('p1')).toBe('releasing');
    const before = await budgetByScope('session');

    let done = false;
    const rel = fx.residency.releaseAllSessions('shutdown').then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(300);
    expect(done).toBe(true);                  // 复调等待 300ms 有界（修复前=await 5s 界）
    await rel;

    expect(await budgetByScope('session')).toBe(before + 1);          // 首次点名照常计数
  });

  it('T18-11 I-2 handoff 永挂（spool fsync 磁盘挂起——Z109 原文复现段）：剩余总预算透传收界⇒有界返回+超时按 rejected-handoff 同路（handoff_failed 计数）+条目留 hold+后续会话 {total} 点名（修复前=控制流永不回循环，步骤 0 整体无限挂即红）', async () => {
    vi.useFakeTimers();
    const fx = makeFixture();
    await fx.pool('p1');
    await fx.pool('p2');
    fx.gateway.handoffPendingToSpool.mockImplementation(() => new Promise<boolean>(() => {}));   // fsync 永挂
    const hfBefore = await counterValue('yjs_release_handoff_failed_total');
    const tBefore = await budgetByScope('total');

    let done = false;
    const rel = fx.residency.releaseAllSessions('shutdown').then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(2_000);   // 总预算窗（fake timers 推进——不断言整段无限挂）
    expect(done).toBe(true);                    // 有界返回（修复前=永挂即红）

    expect(await counterValue('yjs_release_handoff_failed_total')).toBe(hfBefore + 1);   // 超时=交接失败一族同计数
    expect(fx.residency.sessionState('p1')).toBe('held');           // rejected-handoff 条目保留 hold
    expect(await budgetByScope('total')).toBe(tBefore + 1);         // p2 剩余会话点名（total 破——控制流已回循环）
    expect(fx.disconnectCallCount()).toBe(0);                       // 未及 disconnect 段
  });

  it('T18-12 M-1 Σdirect 断言双调去重：leak 场景双调 releaseAllSessions ⇒ direct_leak 恰 +1+「direct leak」ERROR 恰一次（修复前双调双烧 +2/ERROR×2——违反 help「每次关停至多 1」）', async () => {
    const fx = makeFixture();
    await fx.pool('p1');
    fx.gateway.handoffPendingToSpool.mockResolvedValue(false);      // 交接失败留 hold ⇒ Σdirect=1（leak 形态）
    const errSpy = vi.spyOn((fx.residency as any).logger, 'error');
    const leakBefore = await counterValue('yjs_shutdown_direct_leak_total');

    await fx.residency.releaseAllSessions('shutdown');   // #1（residency 钩子——Nest DI 反序先跑）
    await fx.residency.releaseAllSessions('shutdown');   // #2（gateway 步骤 0 显式化）

    expect(await counterValue('yjs_shutdown_direct_leak_total')).toBe(leakBefore + 1);   // 首报 latch——不双烧
    expect(errSpy.mock.calls.filter((c: any[]) => String(c[0]).includes('direct leak'))).toHaveLength(1);   // 双 ERROR 噪音同消
  });
});

// ═══ Y0c T19：selfIsolate/shutdown 释放路径 Σdirect===0（spec :524 A2 验收断言——Z88 出口先行证明义务） ═══
// 语义=「selfIsolate/shutdown 两路径调 closeConnections 时 Σdirect===0」：两路径 closeAllConnections1012
// 只遍历 WS（esm:1357-1364 同族），direct 半面归零全靠 releaseAllResidentSessions 释放先行（selfIsolate
// :1524 await 后 finally closeAll1012/shutdown :3175 步骤 0 后 :3198 closeAll1012——await 返回即 closeConnections
// 时点）。正常路径（无挂起）完成后 Σdirect 必零；异常路径（超预算留 hold）**不断言零**（T18-8 已反钉——留
// hold 由 reaper TTL/drainAllDocuments 兜底；T18-2/T18-4 leak 计数已覆盖异常面）。
describe('Y0c T19：selfIsolate/shutdown 两路径完成后 Σdirect===0（正常路径——graceDirectConnections count() 同款口径）', () => {
  /** Σdirect 生产同款口径（gateway graceDirectConnections :3226 与 releaseAllSessions Σdirect 断言同源：
   *  documents.values() 各 doc 的 directConnectionsCount 求和——fixture 侧 getter 经 defineProperty
   *  运行时注入，类型面用与 conn.document 同款交集 cast）。 */
  const sumDirect = (fx: ReturnType<typeof makeFixture>): number => {
    let n = 0;
    for (const d of fx.docs.values() as Iterable<Y.Doc & { directConnectionsCount?: number }>) n += d.directConnectionsCount ?? 0;
    return n;
  };

  it('shutdown：无挂起两会话 releaseAllSessions("shutdown") 完成 ⇒ 全部 released+Σdirect===0+零 direct_leak（closeAllConnections1012 只遍历 WS——Σdirect 归零=释放出口先行）', async () => {
    const fx = makeFixture();
    await fx.pool('p1');
    await fx.pool('p2');
    expect(sumDirect(fx)).toBe(2);                                 // 前置：两会话各持 1 direct（未释放前非零）
    const leakBefore = await counterValue('yjs_shutdown_direct_leak_total');

    await fx.residency.releaseAllSessions('shutdown');             // 正常路径（无挂起门/无交接失败）

    expect(fx.residency.sessionState('p1')).toBeUndefined();       // 全部 released
    expect(fx.residency.sessionState('p2')).toBeUndefined();
    expect(sumDirect(fx)).toBe(0);                                 // Σdirect===0（两路径调 closeConnections 时点）
    expect(await counterValue('yjs_shutdown_direct_leak_total')).toBe(leakBefore);   // 正常路径零泄漏计数
  });

  it('self-isolate：注册回调 (null,"self-isolate") 路由 releaseAllSessions ⇒ 同 Σdirect===0（selfIsolate 出口同蒙释放全形态）', async () => {
    const fx = makeFixture();
    const registered = (fx.gateway.registerResidentSessionReleaser as ReturnType<typeof vi.fn>).mock.calls[0][0] as (pid: string | null, motive: string) => Promise<unknown>;
    await fx.pool('p1');
    await fx.pool('p2');
    expect(sumDirect(fx)).toBe(2);

    await registered(null, 'self-isolate');                        // selfIsolate :1524 释放出口消费形态（releaseAllResidentSessions 转发）

    expect(sumDirect(fx)).toBe(0);
    expect(fx.residency.sessionState('p1')).toBeUndefined();
    expect(fx.residency.sessionState('p2')).toBeUndefined();
  });
});
