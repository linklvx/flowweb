// apps/api/src/modules/collab/collab-residency.service.spec.ts
// Y0c T15（片 A2 常驻化首任务——spec :519 目标形态 1）：会话表+钉住谓词+读写二分。
// 全部用例经生产面驱动（CollabDocumentService.readCanvas/readServerSV/withSession+CollabDocWriterService.
// writeBatch——residency 实例经 doc service 惰性自建面触达），红相=真实行为红（读改写抖动/卸载抖动），
// 非纯编译红。五主题：
// ① Z128 采样断言「常驻 pid 恒 1 条 direct」——读改写抖动即红（同时是 Z81 关停断言护栏：
//    零 disconnect=零 storeDocumentHooks 抖动）；
// ② Z83 释放窗口——releaseSessionFor 进行中并发 acquire：有限等待释放完成后新开可见，
//    零静默丢弃/无双条目/同 pid acquire 永不因 releasing 无界等待；
// ③ Z109 硬超时——releaseSessionFor 5s zombie 档+acquire 有限等待超时新开（两计数各自可见）；
// ④ Z111 degraded 阻断——装载降级 doc 不入会话池（退化为每次装载旧行为+用完即断）；
// ⑤ Z113 try/finally+周期对账——releaseSessionFor 异常 conn 引用必清理+reconcileSessions
//    漂移 WARN+计数（held 恒健康零漂移/zombie-releasing 档例外豁免）。
// 夹具=库形态复刻（@hocuspocus/server 4.6.0 DirectConnection 行为对齐——TD-2 纪律）：
// openDirectConnection=addDirectConnection（esm:1134）+缺 doc 时新建（mini-PG 重放模拟 hydration）；
// disconnect=removeDirectConnection **先于 await**（esm:1148 库序——Z113 对账例外档的机制依据）
// →挂起门→count===0 时持久化+卸载（esm:1156-1170 零连接卸载语义）。钉住谓词（Z59）载体面=
// conn 持有期间 count≥1→卸载分支结构性不可达（fixture 断言 docs Map 恒保有实例）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import { register } from 'prom-client';
import { SERVER_TRANSACT_ORIGIN, stampDocSchema, type DocLike, type DocMapLike } from '@flowweb/shared';
import { CollabDocumentService } from './collab-document.service';
import { CollabDocWriterService } from './collab-doc-writer.service';
import {
  registerDegradedDocsReader, unregisterDegradedDocsReader,
} from './store.metrics';
import { toDocLike } from './doc-like.util';

function toDocLikeFixture(doc: Y.Doc): DocLike {
  return {
    getMap: (name) => doc.getMap(name) as unknown as DocMapLike,
    createMap: () => new Y.Map() as unknown as DocMapLike,
  };
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r as (v: T) => void; });
  return { promise, resolve };
}

/** 计数器现值（register 全局单例——恒用增量断言） */
async function counterValue(name: string): Promise<number> {
  const m = register.getSingleMetric(name) as any;
  if (!m) return NaN;   // 红相：指标未注册——NaN≠任何期望值（红证据可读）
  return (await m.get()).values.reduce((s: number, v: any) => s + v.value, 0);
}

async function histogramCount(name: string): Promise<number> {
  const m = register.getSingleMetric(name) as any;
  return (await m.get()).values.find((v: any) => v.metricName === `${name}_count`)?.value ?? 0;
}

/** 库形态复刻夹具——返回生产面服务+库状态探针+故障注入面。 */
function makeFixture() {
  const docs = new Map<string, Y.Doc>();                                  // 库 documents Map 语义
  const counts = new Map<Y.Doc, number>();                                // doc.directConnectionsCount
  const persisted = new Map<string, Uint8Array>();                        // mini-PG（卸载持久化/装载重放）
  const disconnectGates = new Map<string, Promise<void>>();               // disconnect 挂起注入（Z83/Z109）
  let disconnectCalls = 0;

  const openDirectConnection = vi.fn(async (name: string) => {
    let doc = docs.get(name);
    if (!doc) {
      doc = new Y.Doc();
      stampDocSchema(toDocLikeFixture(doc));                              // 生产 doc 恒有戳（装载自愈/种子盖章）
      doc.getMap('nodes').set('n1', new Y.Map([['type', 'text']]));       // 种子节点（写守卫 Z4：不存在节点=written:false——夹具对齐生产 doc 有节点形态）
      const saved = persisted.get(name);
      if (saved) Y.applyUpdate(doc, saved);                               // hydration 重放
      // M-4：directConnectionsCount 与 counts Map 同步（getter 形态，最小实现）——库 addDirectConnection
      // 在 doc 上定义该 getter（esm:1134），缺位则 reconcileSessions `count<1` 谓词遇 undefined 假阴（NaN 比较）
      const created = doc;
      Object.defineProperty(created, 'directConnectionsCount', { get: () => counts.get(created) ?? 0 });
      docs.set(name, doc);
    }
    counts.set(doc, (counts.get(doc) ?? 0) + 1);                          // addDirectConnection（esm:1134）
    const conn = {
      document: doc as (Y.Doc & { directConnectionsCount?: number }),
      disconnect: vi.fn(async () => {
        disconnectCalls += 1;
        counts.set(doc!, Math.max(0, (counts.get(doc!) ?? 0) - 1));       // removeDirectConnection 先于 await（库序 esm:1148）
        const gate = disconnectGates.get(name);
        if (gate) await gate;                                             // store/spool fsync 挂起窗（Z109 注入面）
        if ((counts.get(doc!) ?? 0) === 0) {                              // 零连接→持久化+真卸载（esm:1156-1170 语义）
          persisted.set(name, Y.encodeStateAsUpdate(doc!));
          docs.delete(name);
        }
      }),
    };
    return conn;
  });

  const gateway = {
    isLeaseServing: vi.fn(() => true),
    isVacuuming: vi.fn(() => false),
    isWritableOrDegraded: vi.fn((): 'ok' | 'spool-unwritable' => 'ok'),
    isDocDegraded: vi.fn(() => false),
    server: { hocuspocus: { openDirectConnection } },
  };
  const svc = new CollabDocumentService(gateway as any, { readSnapshotOnly: vi.fn() } as any);
  const writer = new CollabDocWriterService(svc);
  /** residency 经 doc service 惰性自建面触达（生产 DI 单例由 module 装配——直构测试同 gateway 兜底惯例） */
  const residency = (): any => (svc as any).residency;
  return { svc, writer, residency, gateway, openDirectConnection, docs, counts, persisted, disconnectGates, disconnectCallCount: () => disconnectCalls };
}

afterEach(() => {
  unregisterDegradedDocsReader();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ═══ Z128 采样断言（读改写抖动即红——同时是 Z81 关停断言护栏） ═══
describe('Y0c T15 Z128：常驻 pid 恒 1 条 direct（读路径零抖动零重复 store）', () => {
  it('同一 pid 连续多次读（readCanvas/readServerSV 混合）→ 全程恰 1 次 openDirectConnection+doc 实例恒在（旧 withDoc 路径=N 次抖动即红）', async () => {
    const fx = makeFixture();
    await fx.svc.readCanvas('p1');
    await fx.svc.readServerSV('p1');
    await fx.svc.readCanvas('p1');
    await fx.svc.readServerSV('p1');
    expect(fx.openDirectConnection).toHaveBeenCalledTimes(1);   // 零抖动：四次读恰一次直开
    expect(fx.disconnectCallCount()).toBe(0);                    // 零 disconnect=零 store 冲刷/卸载抖动（Z81 护栏）
    expect(fx.docs.has('project:p1')).toBe(true);                // 钉住谓词载体面：conn 持有→恒不卸载
  });

  it('关页后（无 WS）重复写不再重复装载：写批连发零新开零 disconnect；写值在会话内可见（出口判据）', async () => {
    const fx = makeFixture();
    for (let i = 0; i < 3; i += 1) {
      const r = await fx.writer.writeBatch('p1', [{ op: 'writeNodeData', nodeId: 'n1', patch: { content: `v${i}` } }]);
      expect(r[0]).toMatchObject({ written: true });
    }
    expect(fx.openDirectConnection).toHaveBeenCalledTimes(1);
    expect(fx.disconnectCallCount()).toBe(0);
    expect(fx.docs.has('project:p1')).toBe(true);
  });

  it('refCount 回零不释放（T16 reaper 前常驻）：读完成 refCount=0 后条目仍 held（idleTimer 武装归 T16）', async () => {
    const fx = makeFixture();
    await fx.svc.readCanvas('p1');
    expect(fx.residency().sessionState('p1')).toBe('held');
    expect(fx.residency().holds('p1')).toBe(true);
  });

  it('并发双开钉守（acquireSerialized 串行化面）：openDirectConnection 首调挂门挂起下并发读同一 pid→恰 1 次直开+会话表恰 1 条+两读结果均正确', async () => {
    const fx = makeFixture();
    const inner = fx.openDirectConnection;                       // 夹具原 mock（真实开窗/装载语义载体）
    const secondArrived = deferred<void>();
    const fallback = deferred<void>();
    let entries = 0;
    fx.gateway.server.hocuspocus.openDirectConnection = vi.fn(async (name: string) => {
      entries += 1;
      if (entries === 1) {
        const t = setTimeout(() => fallback.resolve(), 25);      // 防死锁兜底：串行化生效⇒第二请求永不进窗（链尾排队）
        await Promise.race([secondArrived.promise, fallback.promise]);
        clearTimeout(t);
      } else {
        secondArrived.resolve();                                 // 第二并发请求进窗=串行化失效形态（红相：双开）
      }
      return inner(name);
    });

    const [sv, canvas] = await Promise.all([fx.svc.readServerSV('p1'), fx.svc.readCanvas('p1')]);
    expect(sv).toBeTruthy();                                     // 两调用结果均正确
    expect(canvas).toBeTruthy();
    expect(fx.gateway.server.hocuspocus.openDirectConnection).toHaveBeenCalledTimes(1);   // 恰 1 次：后继 acquire 见前驱成果（held 复用）——双开即红
    expect(fx.residency().residentProjectIds()).toEqual(['p1']); // 会话表恰 1 条（覆盖写不吞条目）
  });

  it('写事务 origin=SERVER_TRANSACT_ORIGIN 最外层（会话写面与 withDoc 同款——Z119 经会话保持）', async () => {
    const fx = makeFixture();
    await fx.svc.readCanvas('p1');                               // 池化（doc 就位）
    const doc = fx.docs.get('project:p1')!;
    const captured: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => { captured.push(origin); });
    await fx.writer.writeBatch('p1', [{ op: 'writeNodeData', nodeId: 'n1', patch: { content: 'v1' } }]);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toBe(SERVER_TRANSACT_ORIGIN);
  });
});

// ═══ Z83 释放窗口（Z109 不变量载体：同 pid acquire 永不因 releasing 无界等待） ═══
describe('Y0c T15 Z83：释放窗口并发 acquire', () => {
  it('releaseSessionFor 进行中（releasing）并发写 acquire→有限等待释放完成后新开连接可见：零静默丢弃/无双条目', async () => {
    const fx = makeFixture();
    const fnHold = deferred();
    let wroteK1 = false;
    const s1 = fx.svc.withSession('p1', async (doc: Y.Doc) => {
      doc.getMap('nodes').set('k1', new Y.Map([['type', 'text']]));
      wroteK1 = true;
      await fnHold.promise;                                      // fn 在飞挂起——释放窗开启
      return 's1';
    }, { mode: 'write' });
    await vi.waitFor(() => expect(wroteK1).toBe(true));          // 事务同步段已应用 k1（异步段在事务外 await）

    const gateHold = deferred();
    fx.disconnectGates.set('project:p1', gateHold.promise);
    void fx.residency().releaseSessionFor('p1');                 // 释放开跑→releasing→disconnect 挂起
    expect(fx.residency().sessionState('p1')).toBe('releasing');

    const s2 = fx.writer.writeBatch('p1', [{ op: 'writeNodeData', nodeId: 'n1', patch: { content: 'v1' } }]);   // 并发 acquire 撞 releasing

    fnHold.resolve();                                            // s1 fn 完成（finally refCount-- 落孤儿条目）
    await s1;
    gateHold.resolve();                                          // disconnect 解挂→持久化（含 k1）+卸载→释放完成
    const results = await s2;                                    // acquire 等到释放完成→新开（重放含 k1）→写 k2

    expect(results[0]).toMatchObject({ index: 0, op: 'writeNodeData', written: true });
    const doc2 = fx.docs.get('project:p1')!;
    expect(doc2.getMap('nodes').has('k1')).toBe(true);           // 零静默丢弃：第一会话写经持久化在新实例可见（时点③路径）
    expect(((doc2.getMap('nodes').get('n1') as Y.Map<any>).get('data') as Y.Map<any>).get('content')).toBe('v1');
    expect(fx.residency().residentProjectIds().filter((p: string) => p === 'p1')).toHaveLength(1);   // 会话表无双条目
    expect(fx.residency().sessionState('p1')).toBe('held');
    expect(fx.openDirectConnection).toHaveBeenCalledTimes(2);    // 原 conn+释放完成后新 conn
  });

  it('releaseSessionFor 幂等去重：releasing 中二次调用返回同一在飞 promise（不并发双 disconnect）', async () => {
    const fx = makeFixture();
    await fx.svc.readCanvas('p1');
    const gateHold = deferred();
    fx.disconnectGates.set('project:p1', gateHold.promise);
    const r1 = fx.residency().releaseSessionFor('p1');
    const r2 = fx.residency().releaseSessionFor('p1');
    expect(fx.openDirectConnection).toHaveBeenCalledTimes(1);
    gateHold.resolve();
    await Promise.all([r1, r2]);
    expect(fx.residency().sessionState('p1')).toBeUndefined();   // 释放完成条目移除
  });
});

// ═══ Z109 硬超时（zombie 档+acquire 有限等待） ═══
describe('Y0c T15 Z109：释放/获取硬超时', () => {
  it('releaseSessionFor 5s 硬超时→zombie 档+release_timeout 计数；新 acquire 即时新开不等待（懒重建替换条目）', async () => {
    vi.useFakeTimers();
    const fx = makeFixture();
    await fx.svc.readCanvas('p1');                               // 池化 held（open#1）
    const gateHold = deferred();
    fx.disconnectGates.set('project:p1', gateHold.promise);      // disconnect 永挂（fsync 挂起形态）
    const toBefore = await counterValue('collab_write_session_release_timeout_total');
    const rel = fx.residency().releaseSessionFor('p1');
    expect(fx.residency().sessionState('p1')).toBe('releasing');

    await vi.advanceTimersByTimeAsync(5_000);
    await rel;
    expect(fx.residency().sessionState('p1')).toBe('zombie');
    expect(await counterValue('collab_write_session_release_timeout_total')).toBe(toBefore + 1);

    const out = await fx.svc.readCanvas('p1');                   // 新 acquire：zombie→新开（不等待挂起释放）
    expect(out).toBeTruthy();
    expect(fx.residency().sessionState('p1')).toBe('held');      // 新条目替换 zombie
    expect(fx.openDirectConnection).toHaveBeenCalledTimes(2);

    gateHold.resolve();                                          // 挂起 disconnect 终将 settle→身份守卫自清理旧条目（不误删新条目）
    await vi.advanceTimersByTimeAsync(0);
    expect(fx.residency().sessionState('p1')).toBe('held');
  });

  it('acquire 遇 releasing 有限等待 5s 超时→acquire_wait_timeout 计数+新开成功（不变量：永不无界等待）', async () => {
    vi.useFakeTimers();
    const fx = makeFixture();
    await fx.svc.readCanvas('p1');
    const gateHold = deferred();
    fx.disconnectGates.set('project:p1', gateHold.promise);
    void fx.residency().releaseSessionFor('p1');                 // releasing 挂起（gate 不解）
    const wBefore = await counterValue('acquire_wait_timeout_total');

    const s2 = fx.svc.readCanvas('p1');                          // acquire 撞 releasing→有限等待
    await vi.advanceTimersByTimeAsync(5_000);                    // release 界到→zombie（releaseSettled 仍挂——disconnect 未 settle）
    await vi.advanceTimersByTimeAsync(1);                        // acquire 界到（后于 release 界调度）→超时即新开
    await s2;                                                    // 超时即新开——不无界等待

    expect(await counterValue('acquire_wait_timeout_total')).toBe(wBefore + 1);
    expect(fx.residency().sessionState('p1')).toBe('held');
    expect(fx.openDirectConnection).toHaveBeenCalledTimes(2);
  });
});

// ═══ Z111 degraded 阻断常驻 ═══
describe('Y0c T15 Z111：degraded 不入池', () => {
  it('装载双查命中形态（isDocDegraded）→ 不建会话条目+每次独立装载（旧行为）+用完即断', async () => {
    const fx = makeFixture();
    fx.gateway.isDocDegraded.mockReturnValue(true);
    await fx.svc.readCanvas('p1');
    expect(fx.residency().residentProjectIds()).toEqual([]);     // 不入常驻集合
    expect(fx.disconnectCallCount()).toBe(1);                    // 即用即断
    await fx.svc.readCanvas('p1');
    expect(fx.openDirectConnection).toHaveBeenCalledTimes(2);    // 每次装载（退化为旧行为）
    expect(fx.residency().residentProjectIds()).toEqual([]);
  });

  it('yjs_degraded_docs gauge：reader 注册 collect 现算（gateway 注册惯例——积压面可见）', async () => {
    registerDegradedDocsReader(() => 2);
    expect(await (async () => {
      const m = register.getSingleMetric('yjs_degraded_docs') as any;
      if (!m) return NaN;
      return (await m.get()).values[0]?.value ?? 0;
    })()).toBe(2);
    unregisterDegradedDocsReader();
    const m = register.getSingleMetric('yjs_degraded_docs') as any;
    expect(((await m.get()).values[0]?.value) ?? 0).toBe(0);
  });
});

// ═══ Z113 try/finally+周期对账 ═══
describe('Y0c T15 Z113：releaseSessionFor 异常清理+reconcileSessions 对账', () => {
  it('disconnect 抛错→条目必清理（conn 引用零泄漏——#846/#895/#954 形态）且不向上抛', async () => {
    const fx = makeFixture();
    await fx.svc.readCanvas('p1');
    const entry = fx.residency().sessions.get('p1');
    entry.conn.disconnect = vi.fn(async () => { throw new Error('spool fsync exploded'); });
    await expect(fx.residency().releaseSessionFor('p1')).resolves.toBeUndefined();   // 吞错（WARN+计数面外置）
    expect(fx.residency().sessionState('p1')).toBeUndefined();   // 条目已清理
  });

  it('reconcileSessions：held 健康零漂移；held 漂移注入（conn.document 丢失）→计数+1；zombie 档例外豁免', async () => {
    const fx = makeFixture();
    await fx.svc.readCanvas('p1');
    const dBefore = await counterValue('collab_residency_reconcile_drift_total');
    fx.residency().reconcileSessions();
    expect(await counterValue('collab_residency_reconcile_drift_total')).toBe(dBefore);   // 健康零漂移

    const entry = fx.residency().sessions.get('p1');
    entry.conn.document = null;                                  // 泄漏形态注入（release 完成未删条目）
    fx.residency().reconcileSessions();
    expect(await counterValue('collab_residency_reconcile_drift_total')).toBe(dBefore + 1);

    entry.state = 'zombie';                                      // zombie/releasing 档例外：disconnect 已 removeDirectConnection（esm:1148）——count 恒 0 非漂移
    fx.residency().reconcileSessions();
    expect(await counterValue('collab_residency_reconcile_drift_total')).toBe(dBefore + 1);   // 不再累加
  });

  it('reconcileSessions count 分支执法（M-4）：count=0∧document 在（conn 泄漏形态）→对账计漂移（夹具 directConnectionsCount 同步后 count 谓词可探测）', async () => {
    const fx = makeFixture();
    await fx.svc.readCanvas('p1');
    const dBefore = await counterValue('collab_residency_reconcile_drift_total');
    fx.residency().reconcileSessions();
    expect(await counterValue('collab_residency_reconcile_drift_total')).toBe(dBefore);   // 健康基线：getter 同步 count=1 真实过门（非 undefined<1 假阴）

    fx.counts.set(fx.docs.get('project:p1')!, 0);                // 泄漏形态注入：document 在但 count 归零（removeDirectConnection 已走、条目未删）
    fx.residency().reconcileSessions();
    expect(await counterValue('collab_residency_reconcile_drift_total')).toBe(dBefore + 1);
  });

  it('releaseSessionFor refCount>0 入口守卫（M-5 仅可见性）：计数+1 且释放照常完成（不 return 不改行为——调用方纪律归 T17 tryRelease 收口）', async () => {
    const fx = makeFixture();
    await fx.svc.readCanvas('p1');
    const entry = fx.residency().sessions.get('p1');
    entry.refCount = 2;                                          // 纪律违规形态注入（判据：释放仅对 refCount===0∧held 发起——上移 T16）
    const b = await counterValue('collab_residency_release_inflight_total');
    expect(b).not.toBeNaN();                                     // 指标已注册防线（未注册 NaN 经 Object.is 假绿——counterValue 红相注释的 NaN≡NaN 盲区）
    await fx.residency().releaseSessionFor('p1');
    expect(await counterValue('collab_residency_release_inflight_total')).toBe(b + 1);
    expect(fx.residency().sessionState('p1')).toBeUndefined();   // 行为不变：释放照常完成
  });
});

// ═══ I-3 最小关停钩子（控制方裁决 a——T18 步骤 0 全形态前置） ═══
describe('Y0c T15 收尾：最小关停钩子（I-3——假 destroy_timeout 消声；T18 全形态〔预算核算+Σdirect===0 断言〕到时替换）', () => {
  it('建会话→onApplicationShutdown⇒会话表空+conn.disconnect 被调', async () => {
    const fx = makeFixture();
    await fx.svc.readCanvas('p1');                               // 池化 held
    expect(fx.residency().residentProjectIds()).toEqual(['p1']);
    await fx.residency().onApplicationShutdown();
    expect(fx.residency().residentProjectIds()).toEqual([]);     // 表空
    expect(fx.disconnectCallCount()).toBe(1);                    // conn.disconnect 被调（unloadImmediately 路径）
  });
});

// ═══ 受理门（语义对齐 withDoc）+开窗观测 ═══
describe('Y0c T15：withSession 受理门+新开观测', () => {
  it('受理门三档对齐 withDoc：lease 失守 503/vacuuming 503/invalid doc name', async () => {
    const fx = makeFixture();
    fx.gateway.isLeaseServing.mockReturnValue(false);
    await expect(fx.svc.readCanvas('p1')).rejects.toMatchObject({ status: 503 });
    fx.gateway.isLeaseServing.mockReturnValue(true);
    fx.gateway.isVacuuming.mockReturnValue(true);
    await expect(fx.svc.readCanvas('p1')).rejects.toMatchObject({ status: 503 });
    fx.gateway.isVacuuming.mockReturnValue(false);
    await expect(fx.svc.readCanvas('a$b')).rejects.toMatchObject({ reason: 'invalid-doc-name' });
    expect(fx.openDirectConnection).not.toHaveBeenCalled();      // 三档皆不触直开
  });

  it('mode 二分：read 不加 degraded 写门（spool-unwritable 下照常成功）；write 走 assertWriteAdmitted（503）', async () => {
    const fx = makeFixture();
    fx.gateway.isWritableOrDegraded.mockReturnValue('spool-unwritable');
    await expect(fx.svc.readCanvas('p1')).resolves.toBeTruthy();
    await expect(fx.writer.writeBatch('p1', [{ op: 'writeNodeData', nodeId: 'n1', patch: { content: 'v1' } }]))
      .rejects.toMatchObject({ status: 503 });
    expect(fx.openDirectConnection).toHaveBeenCalledTimes(1);    // 写门早退零直开（读会话池化在先）
  });

  it('会话新开 observe yjs_withdoc_open_duration_seconds（装载段耗时可见——复用零观测）', async () => {
    const fx = makeFixture();
    const before = await histogramCount('yjs_withdoc_open_duration_seconds');
    await fx.svc.readCanvas('p1');
    await fx.svc.readCanvas('p1');                               // 复用——零新开零观测
    expect(await histogramCount('yjs_withdoc_open_duration_seconds')).toBe(before + 1);
  });
});
