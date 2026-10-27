// apps/web/src/stores/canvasCollabRuntime.t25.spec.ts
// Y1c T25（plan v1.7 Task 25——spec v5.4 §8.1 拒帧恢复+4410 三分+恢复模式）runtime 接线用例：
//   ★红①4411 毒帧拒后恢复=resync-full（同代 fresh doc——禁同 doc 重连重放被拒本地增量
//     「修复」服务器态：CRDT 单调性反例，被拒内容经 DraftEnvelope 类型化导出保全归用户裁定）；
//   ★红②g_client>g_server（server-restored）=只读 recovery+草稿导出——禁静默 purge+reload
//     （现状 consumeGenerationJump 双向同路=导出→reload 缺接受路径）；
//   ③4412/4413/4406 档客户端消费（resolveRecoveryAction 分派——修正 #7 禁 backoff 吞）；
//   ④重复 DENY 逃生口（N=3 次 4411 后 recovery 模式粘住+多标签 BroadcastChannel 通告）；
//   ⑤客户端半链：docName #g 世代载体（T12）+auth-receipt historyId 持久化+h= 参数上行（T9 服务端已落）；
//   ★closeout 批（Controller T25 双评审裁定——2026-10-27）：
//     C-1(quality) resync 排程同步取消（导出窗内零 connectOnce）/C-1(spec) generation-stale 方向分档
//     （g_db<g_client→server-restored 非 purge+reload）/I-1+I-2 4406 面 purge-on-bump+清 h
//     /I-4 4413 supervisor timer 面可红化断言/M-2 恢复三入口互斥（reload timer 清+initCollab kind 守卫）。
// 装置承 t18.spec（fakeHocuspocusProvider+真 Y.Doc+fake timers+fakeIndexedDb）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useCanvasStore } from './canvasStore';
import * as runtime from './canvasCollabRuntime';
import { buildLocalCacheKey } from '@/collab/local-cache-key';
import { createFakeIndexedDb, type FakeIndexedDbFactory } from '@/test/fakeIndexedDb';
import { _resetUnloadGuardForTest } from '@/utils/unloadGuard';
import { getRecentCollabDiag, _resetCollabDiagForTest } from '@/utils/collabDiagnostics';
import { FakeHocuspocusProvider } from '@/test/fixtures/fakeHocuspocusProvider';
import { setSupervisorJitterForTest } from '@/collab/connection-supervisor';
import { loadPersistedHistoryId } from '@/collab/rejected-recovery';

vi.mock('@hocuspocus/provider', async () => {
  const { FakeHocuspocusProvider } = await import('@/test/fixtures/fakeHocuspocusProvider');
  return { HocuspocusProvider: FakeHocuspocusProvider };
});

vi.mock('@/collab/local-cache-key', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/collab/local-cache-key')>()),
  purgeForeignCaches: vi.fn().mockResolvedValue(undefined),
  // closeout I-1+I-2：purge-on-bump 消费面（真实删除行为归 local-cache-key.test 既有覆盖——此处断言调用面）
  purgePidCaches: vi.fn().mockResolvedValue(undefined),
}));
import { purgeForeignCaches, purgePidCaches } from '@/collab/local-cache-key';

/** closeout C-1：信封导出窗测试闸（挂起 buildDraftEnvelope——模拟导出/IDB 删的异步窗；
 *  默认不挂=直通〔其余用例零扰动〕）。T25b 扩展：calls=M-R2 镜像腿导出观测；failWith=
 *  M-R4 export 抛错注入（doc 并发销毁竞态形态）。vi.hoisted：vi.mock 工厂提升后闭包可达。 */
const exportGate = vi.hoisted(() => ({
  gate: null as null | { promise: Promise<void>; release: () => void },
  calls: [] as unknown[][],
  failWith: null as null | Error,
}));
vi.mock('@/collab/rejected-recovery', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/collab/rejected-recovery')>();
  return {
    ...orig,
    buildDraftEnvelope: async (...args: Parameters<typeof orig.buildDraftEnvelope>) => {
      exportGate.calls.push(args);
      if (exportGate.failWith) { const e = exportGate.failWith; exportGate.failWith = null; throw e; }
      if (exportGate.gate) await exportGate.gate.promise;
      return orig.buildDraftEnvelope(...args);
    },
  };
});

/** T25b M-R2：接收侧 BroadcastChannel harness——bindReevaluateOnce 模块级一次挂（首个 initCollab
 *  构造唯一接收实例），文件级注册表跨用例可达（per-test 局部类捕获不到首挂实例）。 */
const bcHarness = vi.hoisted(() => ({ instances: [] as Array<{ onmessage: unknown }> }));
class HarnessBroadcastChannel {
  onmessage: unknown = null;
  constructor() { bcHarness.instances.push(this); }
  postMessage() {}
  close() {}
}

const META = { collabGeneration: 3, collabSchemaVersion: 2, viewerUid: 'u1' };
const lastInstance = () => (HocuspocusProvider as any).instances.at(-1) as any;
const reloadSpy = vi.fn();

let kit: FakeIndexedDbFactory;

const resetStore = () => useCanvasStore.setState({
  connStatus: 'connecting', nodes: [], edges: [], connUi: 'ok', hydration: 'idle',
  collabReadOnly: true, wsAuthNotice: null, writeFrozen: false, collabEscapePending: false,
  connReadOnly: false, quotaOver: false, quotaLimitBytes: 0, quotaTxBytes: 0,
  quotaSoftLimitBytes: 0, quotaResidueBytes: undefined, lastDocStatusRev: 0,
  localDocBytes: 0, localDelta: 0, pendingGenerationReload: 0, wsQuotaTerminal: null,
  localCacheReady: false, canvasDiverged: false, canvasOversized: false, canvasDegraded: false,
  persistUnhealthy: false, syncLagOver60s: false, pendingBacklog: false,
  recoveryPending: null,
});

const seedNode = (id: string): Y.Map<any> => new Y.Map<any>([
  ['type', 'textInput'],
  ['position', new Y.Map([['x', 0], ['y', 0]])],
  ['data', new Y.Map([['v', id]])],
]);

/** jsdom 无 URL.createObjectURL——静态方法注入（t8/t18.spec 同款；测后删除还原） */
function stubBlobUrls(): void {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:mock' });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
}
function restoreBlobUrls(): void {
  delete (URL as any).createObjectURL;
  delete (URL as any).revokeObjectURL;
}

async function driveToSynced(pid = 'p1', meta: runtime.CollabSessionMeta = META) {
  const done = runtime.initCollab(pid, meta);
  await vi.advanceTimersByTimeAsync(0);
  const p = lastInstance();
  p.emit('status', { status: 'connected' });
  p.isAuthenticated = true;
  p.emit('authenticated', { scope: 'read-write' });
  p.isSynced = true;
  p.emit('synced', {});
  await done;
  return p;
}

const docStatus = (rev: number, generation?: number) => JSON.stringify({
  type: 'doc-status', rev, writeFrozen: false,
  ...(generation !== undefined ? { generation } : {}),
  quota: { state: 'ok', bytes: 1234, limit: 8_388_608, maxTxBytes: 262_144, softLimitBytes: 6_710_886 },
});

const diagReasons = () => getRecentCollabDiag()
  .filter((e: any) => e.type === 'ws_status')
  .map((e: any) => e.detail?.reason);

beforeEach(() => {
  vi.useFakeTimers();
  (HocuspocusProvider as any).instances.length = 0;
  _resetUnloadGuardForTest();
  _resetCollabDiagForTest();
  resetStore();
  reloadSpy.mockClear();
  vi.mocked(purgeForeignCaches).mockClear();
  vi.mocked(purgePidCaches).mockClear();
  exportGate.gate = null;
  exportGate.failWith = null;
  exportGate.calls.length = 0;
  FakeHocuspocusProvider.resetSockets();
  kit = createFakeIndexedDb();
  vi.stubGlobal('indexedDB', kit.fake);
  vi.stubGlobal('navigator', {
    ...navigator,
    onLine: true,
    storage: { persist: vi.fn(async () => true), estimate: vi.fn(async () => ({ usage: 1, quota: 1_000_000 })) },
  });
  vi.stubGlobal('location', { reload: reloadSpy });
  vi.stubGlobal('BroadcastChannel', HarnessBroadcastChannel);   // M-R2：首挂接收实例可观测（send 侧各用例局部类覆盖不扰）
  stubBlobUrls();
});
afterEach(async () => {
  exportGate.gate = null;   // 释放挂起闸（防跨用例泄漏挂起 promise）
  setSupervisorJitterForTest(null);
  await runtime.destroyCollab();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreBlobUrls();
});

// ══════════ ★红①4411 毒帧拒后恢复（CRDT 单调性反例——resync-full 禁重放） ══════════
describe('T25 拒帧恢复：4411/4412 resync-full（同代 fresh doc）', () => {
  it('★红①4411 close→恢复=重建 provider+fresh doc（被拒本地增量不随重连重放「修复」服务器态）+信封导出保全', async () => {
    const p = await driveToSynced();
    // 客户端本地毒增量：节点写入未上行确认（服务端 4411 拒的形态——重连重放即「修复」服务器态）
    const d1 = p.cfg.document as Y.Doc;
    d1.getMap('nodes').set('n-poison', seedNode('poison'));
    expect(d1.getMap('nodes').size).toBe(1);

    p.emit('close', { event: { code: 4411, reason: 'frame-malformed' } });
    await vi.advanceTimersByTimeAsync(50);

    // 绿形断言①：恢复=新 provider 实例 + fresh doc（旧 doc 被拒增量结构性不随重连上行）
    const p2 = lastInstance();
    expect(p2).not.toBe(p);
    expect(p2.cfg.document).not.toBe(d1);
    expect((p2.cfg.document as Y.Doc).getMap('nodes').size).toBe(0);
    // 绿形断言②：恢复动作遥测（resync-full——诊断面可观测）
    expect(diagReasons()).toContain('recovery-resync');
    // 绿形断言③：未达阈值不进 recovery 模式（1 次 deny=瞬态可能）
    expect(useCanvasStore.getState().recoveryPending).toBeNull();
  });

  it('4412 resync-required 同路（pending 区间拒绝——轻量 resync 同形+计数不进逃生口）', async () => {
    const p = await driveToSynced();
    const d1 = p.cfg.document as Y.Doc;
    d1.getMap('nodes').set('n-pending', seedNode('pending'));
    p.emit('close', { event: { code: 4412, reason: 'resync-required' } });
    await vi.advanceTimersByTimeAsync(50);
    const p2 = lastInstance();
    expect(p2).not.toBe(p);
    expect(p2.cfg.document).not.toBe(d1);
    expect(diagReasons()).toContain('recovery-resync');
    expect(useCanvasStore.getState().recoveryPending).toBeNull();
  });

  it('synced 到达=deny 计数清零（sync-ok——1-2 次瞬态重置重新起算）', async () => {
    const p = await driveToSynced();
    p.emit('close', { event: { code: 4411, reason: 'frame-malformed' } });
    await vi.advanceTimersByTimeAsync(50);
    const p2 = lastInstance();
    p2.emit('status', { status: 'connected' });
    p2.isAuthenticated = true;
    p2.emit('authenticated', { scope: 'read-write' });
    p2.isSynced = true;
    p2.emit('synced', {});
    // 再两次 4411（共 3 次但首次已清零——计数=2 < 3 不进 recovery 模式）
    p2.emit('close', { event: { code: 4411, reason: 'frame-malformed' } });
    await vi.advanceTimersByTimeAsync(50);
    const p3 = lastInstance();
    p3.emit('close', { event: { code: 4411, reason: 'frame-malformed' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(useCanvasStore.getState().recoveryPending).toBeNull();
  });
});

// ══════════ ★红②server-restored（g_client>g_server）=只读 recovery 禁静默 purge ══════════
describe('T25 4410 三分：server-restored 只读 recovery（禁导出→reload 静默丢）', () => {
  it('★红②doc-status 世代下跳（g_server<g_client=PITR 回退形态）→不 reload 不 purge+只读 recovery+信封导出', async () => {
    const p = await driveToSynced();   // META.collabGeneration=3（g_client=3）
    p.emit('stateless', { payload: docStatus(1, 3) });   // 基线建立（首见代）
    await vi.advanceTimersByTimeAsync(0);
    p.emit('stateless', { payload: docStatus(2, 1) });   // 下跳：g_server=1 < g_client=3
    await vi.advanceTimersByTimeAsync(2_500);             // 旧 consumeGenerationJump 1.5s reload 窗

    // 绿形断言：不自动 reload、不清缓存（server-restored=不清缓存——§8.1/裁定 v5-14）
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(vi.mocked(purgeForeignCaches)).not.toHaveBeenCalled();
    const st = useCanvasStore.getState();
    expect(st.recoveryPending).toMatchObject({ kind: 'server-restored' });
    expect(diagReasons()).toContain('recovery-server-restored');
  });

  it('4410 close reason=server-restored 同档（不清缓存+只读 recovery——非 wsAuthNotice 泛终态）', async () => {
    const p = await driveToSynced();
    p.emit('stateless', { payload: JSON.stringify({ code: 4410, reason: 'server-restored' }) });
    p.emit('close', { event: { code: 4410, reason: 'server-restored' } });
    await vi.advanceTimersByTimeAsync(2_500);
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(vi.mocked(purgeForeignCaches)).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().recoveryPending).toMatchObject({ kind: 'server-restored' });
  });

  it('4410 上跳（doc-vacuuming/generation-stale）维持既有换代通道（导出→purge→reload 不回退）', async () => {
    const p = await driveToSynced();
    p.emit('stateless', { payload: docStatus(1, 3) });
    await vi.advanceTimersByTimeAsync(0);
    p.emit('stateless', { payload: docStatus(2, 4) });   // 上跳=主动换代
    await vi.advanceTimersByTimeAsync(2_500);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});

// ══════════ ③4413/4406 档客户端消费（修正 #7——Y1c 四码先走 recovery 分派） ══════════
describe('T25 4413/4406 客户端消费', () => {
  it('4413 maintenance-freeze→重连消费 retryAfterMs（supervisor timer 面可红化断言：30s 窗内零 connect+30s 档重排触发）', async () => {
    setSupervisorJitterForTest(() => 0);   // 短档 full jitter 归零——1s 基值确定性化（I-4 修形）
    const p = await driveToSynced();
    const before = FakeHocuspocusProvider.socketsConstructed();
    p.emit('stateless', { payload: JSON.stringify({ code: 4413, reason: 'maintenance-freeze', retryAfterMs: 30_000 }) });
    p.emit('close', { event: { code: 4413, reason: 'maintenance-freeze' } });
    // 1s short 档默认窗内零 connect（修前=short 档 timer 1s 即连——重连循环反复撞冻结门）
    await vi.advanceTimersByTimeAsync(3_000);
    expect(FakeHocuspocusProvider.socketsConstructed()).toBe(before);
    expect(lastInstance()).toBe(p);   // 未重建未断（4413 非终态——provider 存活）
    // retryAfterMs=30s 档重排：越过 30s 后恰一次 connectOnce（Retry-After 语义非指数阶梯）
    await vi.advanceTimersByTimeAsync(27_500);
    expect(FakeHocuspocusProvider.socketsConstructed()).toBe(before + 1);
    expect(diagReasons()).toContain('recovery-retry-after');
  });

  it('4406 client-outdated→强刷通道（handleVersionTerminal——非 wsAuthNotice 泛终态挂死）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ collabProtocolVersion: '1', reason: '' }) })));
    const p = await driveToSynced();
    p.emit('close', { event: { code: 4406, reason: 'client-outdated' } });
    await vi.advanceTimersByTimeAsync(6_000);   // 探测 5s 超时窗
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});

// ══════════ ④重复 DENY 逃生口（N=3 次 4411→recovery 模式粘住+BroadcastChannel） ══════════
describe('T25 重复 DENY 逃生口', () => {
  it('连续 3 次 4411→recovery 模式（导出→重置→用户裁定——禁无限重连循环）', async () => {
    let p = await driveToSynced();
    for (let i = 0; i < 3; i++) {
      p.emit('close', { event: { code: 4411, reason: 'frame-malformed' } });
      await vi.advanceTimersByTimeAsync(50);
      p = lastInstance();
    }
    const st = useCanvasStore.getState();
    expect(st.recoveryPending).toMatchObject({ kind: 'deny-escape' });
    expect(diagReasons()).toContain('recovery-deny-escape');
  });
});

// ══════════ ⑤客户端半链：#g docName+historyId h= 上行 ══════════
describe('T25 客户端半链（T12 #g 载体+T9 historyId）', () => {
  it('provider docName=canvasDocName(pid,g)（#g 世代段——META.collabGeneration=3）', async () => {
    const p = await driveToSynced('p1', META);
    expect(p.cfg.name).toBe('project:p1#g3');
  });

  it('auth-receipt historyId 持久化→重建 provider URL 带 h=<historyId>（首连放行-回执-次连携带）', async () => {
    const p = await driveToSynced();
    p.emit('stateless', { payload: JSON.stringify({ type: 'auth-receipt', historyId: 'h-t25-1', protocolVersion: 1, schemaVersion: 3 }) });
    p.emit('close', { event: { code: 4411, reason: 'frame-malformed' } });   // 触发重建（resync-full）
    await vi.advanceTimersByTimeAsync(50);
    const p2 = lastInstance();
    expect(new URL(p2.cfg.url).searchParams.get('h')).toBe('h-t25-1');
  });
});

// ══════════ ★closeout 批（Controller T25 双评审裁定 2026-10-27）════════════════════════
// C-1(quality) resync 排程同步取消 / C-1(spec) generation-stale 方向分档 / I-1+I-2 4406
// purge-on-bump / M-2 恢复三入口互斥——断言差红先行（修前实跑留档）。
describe('T25 收口批 C-1(quality)：resync-full 毒帧重连窗（排程同步取消）', () => {
  it('★closeout-1 4411 close→信封导出窗内零 connectOnce（jitter=0——修前 1s short 档 timer 在异步导出窗内触发=旧 provider 同 doc 重连 SS2 上行毒增量「修复」复活）', async () => {
    setSupervisorJitterForTest(() => 0);
    const p = await driveToSynced();
    const d1 = p.cfg.document as Y.Doc;
    d1.getMap('nodes').set('n-poison', seedNode('poison'));
    // 挂起信封导出（resyncFull 异步窗打开——导出/IDB 删未完成、重建未达）
    let release!: () => void;
    exportGate.gate = { promise: new Promise<void>((r) => { release = r; }), release: () => release() };
    const before = FakeHocuspocusProvider.socketsConstructed();
    p.emit('close', { event: { code: 4411, reason: 'frame-malformed' } });
    await vi.advanceTimersByTimeAsync(1_100);   // 1s short 档窗（jitter=0）——修前 timer 触发 connectOnce
    // 窗内零 connect（导出仍挂起=旧 provider 未拆——任何 connect 都是同 doc 毒重放面）
    expect(FakeHocuspocusProvider.socketsConstructed()).toBe(before);
    expect(lastInstance()).toBe(p);   // 重建未达（导出窗内）
    // 释放闸→resync 完成（fresh doc 重建——新 provider connectOnce 恰一次）
    exportGate.gate.release();
    exportGate.gate = null;
    // 窗内零 timer（排程已同步取消）——advanceTimersByTimeAsync 无 timer 即无微任务冲刷点：
    // 先 advance(0) 冲刷 gate-release 微任务链，再放宽窗（0ms 档 + 1s 兜底）
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    const p2 = lastInstance();
    expect(p2).not.toBe(p);
    expect(p2.cfg.document).not.toBe(d1);
  });
});

describe('T25 收口批 C-1(spec)：generation-stale 方向分档（PITR 主路径禁 purge+reload）', () => {
  it('★closeout-2c auth generation-stale+REST g_db(3)<g_client(5)→server-restored 只读 recovery（非 purge+reload——回退态未裁定禁开放写）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ code: 0, data: { collabGeneration: 3 } }) })));   // DB 真值 g=3
    const p = await driveToSynced('p1', { ...META, collabGeneration: 5 });   // g_client=5（长存活 tab）
    p.emit('authenticationFailed', { reason: 'generation-stale' });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(reloadSpy).not.toHaveBeenCalled();                                  // 修前：无条件 safeReload（红）
    expect(vi.mocked(purgeForeignCaches)).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().recoveryPending).toMatchObject({ kind: 'server-restored' });
    expect(diagReasons()).toContain('recovery-server-restored');
  });

  it('g_db(7)>g_client(5) 维持换代通道（上跳=主动换代——信封导出→purge→reload 不回退）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ code: 0, data: { collabGeneration: 7 } }) })));
    const p = await driveToSynced('p1', { ...META, collabGeneration: 5 });
    p.emit('authenticationFailed', { reason: 'generation-stale' });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});

describe('T25 收口批 I-1+I-2：4406 面 purge-on-bump（h 失效路径+boot 旧纪元回灌防御）', () => {
  it('★closeout-4 4406 client-outdated→清持久化 h+purge 本 pid 缓存族+BroadcastChannel history-bump 通告他 tab（次连=首连放行档收新回执——旧纪元 IDB 记录不随 boot 回灌）', async () => {
    const posted: Array<Record<string, unknown>> = [];
    class CapBroadcastChannel {
      onmessage: unknown = null;
      postMessage(m: Record<string, unknown>) { posted.push(m); }
      close() {}
    }
    vi.stubGlobal('BroadcastChannel', CapBroadcastChannel);
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ collabProtocolVersion: '1', reason: '' }) })));
    const p = await driveToSynced();
    p.emit('stateless', { payload: JSON.stringify({ type: 'auth-receipt', historyId: 'h-old-epoch', protocolVersion: 1, schemaVersion: 3 }) });
    expect(loadPersistedHistoryId()).toBe('h-old-epoch');   // 前置：旧纪元 h 在位

    p.emit('close', { event: { code: 4406, reason: 'client-outdated' } });   // historyId bump 后旧 h 撞门
    await vi.advanceTimersByTimeAsync(6_500);   // handleVersionTerminal 探测 5s 超时窗+处理
    expect(loadPersistedHistoryId()).toBeNull();                                        // 修前：h 残留=全项目锁死（红）
    expect(vi.mocked(purgePidCaches)).toHaveBeenCalledWith('u1', 'p1');                 // 修前：零调用（红）
    expect(posted.some((m) => m?.type === 'collab-recovery' && m?.kind === 'history-bump')).toBe(true);   // 修前：无通告（红）
  });
});

// ══════════ T25b M-R1（Controller 硬化追加）：resync 相位守卫 ══════════
// kickNow（visibilitychange/online）与 assertHealthy（3s watchdog）在 resyncing 相位让位
// （不重排旧 provider——导出/重建窗内任何 kick 都是同 doc SS2 毒重放面）；teardownSession
// 的 await 缝（supervisor.teardown→provider.destroy await 间 module provider 仍旧实例）同覆盖。
describe('T25b M-R1：resync 相位守卫（kickNow/assertHealthy 让位+teardown await 缝）', () => {
  it('★mr1-1 4411 resync 导出窗内回前台 kick（visibilitychange→kickNow）零 connectOnce——修前 kick 排程连旧 provider（红）', async () => {
    setSupervisorJitterForTest(() => 0);
    const p = await driveToSynced();
    (p.cfg.document as Y.Doc).getMap('nodes').set('n-poison', seedNode('poison'));
    let release!: () => void;
    exportGate.gate = { promise: new Promise<void>((r) => { release = r; }), release: () => release() };
    const before = FakeHocuspocusProvider.socketsConstructed();
    p.emit('close', { event: { code: 4411, reason: 'frame-malformed' } });
    await vi.advanceTimersByTimeAsync(50);
    // 导出窗内（旧 provider 未拆）：回前台 kick——修前 phase 无 resyncing 档=kickNow 排程
    // 0-3s jitter timer（jitter=0 即刻）→connectOnce 连旧 provider=同 doc 毒重放面
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(3_500);
    expect(FakeHocuspocusProvider.socketsConstructed()).toBe(before);   // 修前：+1（红）
    expect(lastInstance()).toBe(p);
    release();
    exportGate.gate = null;
    // 释放后 resync 重建照常（守卫不吞新 provider 首连——重建完成形态归 closeout-1/红① 既有断言；
    // 此处不追加尾断言：sha256 真实异步在满池载下微任务冲刷窗不稳定=脆弱断言面）
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
  }, 20_000);

  it('★mr1-2 watchdog assertHealthy 在 resyncing 相位让位（offline 电平下零排程）', async () => {
    setSupervisorJitterForTest(() => 0);
    const p = await driveToSynced();
    (p.cfg.document as Y.Doc).getMap('nodes').set('n-poison', seedNode('poison'));
    let release!: () => void;
    exportGate.gate = { promise: new Promise<void>((r) => { release = r; }), release: () => release() };
    const before = FakeHocuspocusProvider.socketsConstructed();
    p.emit('close', { event: { code: 4411, reason: 'frame-malformed' } });
    await vi.advanceTimersByTimeAsync(50);
    useCanvasStore.setState({ connStatus: 'offline' });   // watchdog 出手前置（assertHealthy 谓词）
    await vi.advanceTimersByTimeAsync(3_500);             // 3s watchdog tick 窗
    expect(FakeHocuspocusProvider.socketsConstructed()).toBe(before);   // 修前：stalled 排程 connectOnce（红）
    useCanvasStore.setState({ connStatus: 'connecting' });
    release();
    exportGate.gate = null;
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
  }, 20_000);   // 满池并行载下 fake-timer 冲刷窗真实耗时超 vitest 默认 5s（隔离绿为凭）
});

// ══════════ T25b M-R4：4406 恢复序列逐档降级（export 抛错不得跳过清 h/purge/通告） ══════════
describe('T25b M-R4：handleClientOutdatedRecovery 逐档降级', () => {
  it('★mr4-1 export 抛错（doc 并发销毁竞态形态）→清 h+purge+history-bump 通告+reload 序列照常——修前 export throw 短路后续全步（红）', async () => {
    const posted: Array<Record<string, unknown>> = [];
    class CapBroadcastChannel {
      onmessage: unknown = null;
      postMessage(m: Record<string, unknown>) { posted.push(m); }
      close() {}
    }
    vi.stubGlobal('BroadcastChannel', CapBroadcastChannel);
    // 协议版本取唯一值：sessionStorage reload 键跨用例残留（前序 4406 用例已写 :1 键——同键会走
    // collabEscapePending 分支不 reload）
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ collabProtocolVersion: 'mr4-unique', reason: '' }) })));
    exportGate.failWith = new Error('doc destroyed');   // 首次 buildDraftEnvelope reject（竞态形态注入）
    const p = await driveToSynced();
    p.emit('stateless', { payload: JSON.stringify({ type: 'auth-receipt', historyId: 'h-mr4', protocolVersion: 1, schemaVersion: 3 }) });
    expect(loadPersistedHistoryId()).toBe('h-mr4');
    p.emit('close', { event: { code: 4406, reason: 'client-outdated' } });
    await vi.advanceTimersByTimeAsync(6_500);
    // 修前：exportRecoveryEnvelope throw →knownHistoryId/localStorage/purge/broadcast 全部短路（红）
    expect(loadPersistedHistoryId()).toBeNull();
    expect(vi.mocked(purgePidCaches)).toHaveBeenCalledWith('u1', 'p1');
    expect(posted.some((m) => m?.type === 'collab-recovery' && m?.kind === 'history-bump')).toBe(true);
    expect(reloadSpy).toHaveBeenCalledTimes(1);   // handleVersionTerminal 强刷照常达
  }, 20_000);   // AbortSignal.timeout 真实钟+满池并行载——vitest 默认 5s 池载超限（隔离绿为凭）
});

// ══════════ T25b M-R2：history-bump 镜像腿（接收端 sibling 尽力导出）——修前零测试 ══════════
describe('T25b M-R2：history-bump 接收端（镜像腿）', () => {
  it('★mr2-1 他 tab history-bump 通告→本 tab 清 h+purge+尽力导出信封（窄双故障窗 sibling 编辑 salvage）——修前接收端零导出（红）', async () => {
    const callsBefore = exportGate.calls.length;
    const p = await driveToSynced();
    const recv = bcHarness.instances[0];   // bindReevaluateOnce 首挂接收实例（模块级一次）
    expect(recv?.onmessage).toEqual(expect.any(Function));   // 修前覆盖基线：接收面在位（zero-test 面即此处）
    p.emit('stateless', { payload: JSON.stringify({ type: 'auth-receipt', historyId: 'h-mirror', protocolVersion: 1, schemaVersion: 3 }) });
    expect(loadPersistedHistoryId()).toBe('h-mirror');
    // sibling 编辑在 doc（窄双故障窗：bump 通告到达时本 tab 尚有未上行内容）
    (p.cfg.document as Y.Doc).getMap('nodes').set('n-sib', seedNode('sib'));
    (recv.onmessage as (ev: { data: unknown }) => void)({ data: { type: 'collab-recovery', pid: 'p1', kind: 'history-bump' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(loadPersistedHistoryId()).toBeNull();                                        // 自清 h（I-1+I-2 既有）
    expect(vi.mocked(purgePidCaches)).toHaveBeenCalledWith('u1', 'p1');                  // IDB 族自清（既有）
    expect(exportGate.calls.length).toBeGreaterThan(callsBefore);   // ★修前：接收端零导出（红）——M-R2 sibling salvage
  });
});

describe('T25 收口批 M-2：恢复三入口互斥（reload timer 清+initCollab kind 守卫）', () => {
  it('★closeout-9a g3→g4→g1 单会话序列：上跳排 reload 后下跳 server-restored 清 pending reload timer（禁 reload 覆盖只读 recovery）', async () => {
    const p = await driveToSynced();   // g_client=3
    p.emit('stateless', { payload: docStatus(1, 3) });
    await vi.advanceTimersByTimeAsync(0);
    p.emit('stateless', { payload: docStatus(2, 4) });   // 上跳→consumeGenerationJump 排 1.5s reload
    p.emit('stateless', { payload: docStatus(3, 1) });   // 下跳→server-restored（PITR 真值）
    await vi.advanceTimersByTimeAsync(2_500);
    expect(reloadSpy).not.toHaveBeenCalled();   // 修前：1.5s reload 已排且 fire（红）
    expect(useCanvasStore.getState().recoveryPending).toMatchObject({ kind: 'server-restored' });
  });

  it('★closeout-9b server-restored 态下 4411 resync 重建不擦除（initCollab 复位 kind 守卫——resyncFull 在飞时下跳到达态保持）', async () => {
    const p = await driveToSynced();
    p.emit('stateless', { payload: docStatus(1, 3) });
    await vi.advanceTimersByTimeAsync(0);
    p.emit('stateless', { payload: docStatus(2, 1) });   // 下跳→server-restored 进入
    await vi.advanceTimersByTimeAsync(50);
    expect(useCanvasStore.getState().recoveryPending?.kind).toBe('server-restored');
    // 竞态形态：同会话 4411 到达（resyncFull→initCollab 重建）——server-restored 态不得被会话复位擦除
    const latest = lastInstance();
    latest.emit('close', { event: { code: 4411, reason: 'frame-malformed' } });
    await vi.advanceTimersByTimeAsync(150);
    expect(useCanvasStore.getState().recoveryPending?.kind).toBe('server-restored');   // 修前：reset null（红）
  });
});

// ══════════ T25b 面 B：deny-escape 信封载体+resumeFromRecovery 出口（B1/B4 接线闭环） ══════════
describe('T25b B1/B4：恢复裁定面数据源+出口', () => {
  it('★b1-1 deny-escape 进入→recoveryPending.envelope 在位（内存副本=裁定面数据源）+envelopeNodeCount 一致——修前电平无 envelope 载体（红）', async () => {
    let p = await driveToSynced();
    for (let i = 0; i < 3; i++) {
      (p.cfg.document as Y.Doc).getMap('nodes').set(`n-draft-${i}`, seedNode(`draft-${i}`));   // 每轮在当期 doc 写内容（resync 重建后 fresh doc——保证第 3 次进入时信封非空）
      p.emit('close', { event: { code: 4411, reason: 'frame-malformed' } });
      await vi.advanceTimersByTimeAsync(50);
      p = lastInstance();   // resync 重建后迭代新实例（④ 用例同款）
    }
    const st = useCanvasStore.getState();
    expect(st.recoveryPending?.kind).toBe('deny-escape');
    expect(st.recoveryPending?.envelopeNodeCount).toBeGreaterThan(0);
    expect(st.recoveryPending?.envelope?.nodes.length).toBe(st.recoveryPending!.envelopeNodeCount);   // 修前：envelope 键缺失（红）
    expect(st.recoveryPending?.envelope?.projectId).toBe('p1');
  });

  it('★b4-1 resumeFromRecovery→recoveryPending 清零+denyTracker 回 normal+supervisor 出 terminal 重连（B4 接线闭环出口）', async () => {
    let p2 = await driveToSynced();
    for (let i = 0; i < 3; i++) {
      p2.emit('close', { event: { code: 4411, reason: 'frame-malformed' } });
      await vi.advanceTimersByTimeAsync(50);
      p2 = lastInstance();
    }
    expect(useCanvasStore.getState().recoveryPending?.kind).toBe('deny-escape');
    const before = FakeHocuspocusProvider.socketsConstructed();
    runtime.resumeFromRecovery();
    await vi.advanceTimersByTimeAsync(50);
    expect(useCanvasStore.getState().recoveryPending).toBeNull();   // 修前：无出口函数（红——import 即红，此处行为锚）
    expect(FakeHocuspocusProvider.socketsConstructed()).toBeGreaterThan(before);   // supervisor.resume+connectOnce（重连预算恢复）
    expect(diagReasons()).toContain('recovery-resumed');
  });
});

// ══════════ T25b B2：boot 合并异常提示接线（不阻断——DRAFT_MERGE_ANOMALY_KINDS 生产接通） ══════════
describe('T25b B2：boot 合并后异常检测', () => {
  const snapshotOf = (build: (d: Y.Doc) => void): Uint8Array => {
    const d = new Y.Doc();
    d.getMap('meta').set('schemaVersion', 2);
    build(d);
    return Y.encodeStateAsUpdate(d);
  };
  const orderNode = (id: string, order: string): Y.Map<any> => new Y.Map<any>([
    ['type', 'textInput'],
    ['position', new Y.Map([['x', 0], ['y', 0]])],
    ['data', new Y.Map([['v', id], ['order', order]])],
  ]);
  const REC = (over: Partial<import('@/collab/local-collab-cache').LocalCacheRecord>): import('@/collab/local-collab-cache').LocalCacheRecord => ({
    tabId: 'seed', snapshot: new Uint8Array([1]), stateVector: new Uint8Array([1]), savedSeq: 0,
    unsyncedDirty: false, diverged: false, at: 1_000, ...over,
  });

  it('★b2-1 双 tab 同层同 order 键合并→draftMergeAnomalies 置位（duplicate-order×2）+boot 照常不阻断（两节点都在）——修前电平恒 null（红）', async () => {
    const KEY = buildLocalCacheKey({ uid: 'u1', pid: 'p1', generation: 3, schemaVersion: 2 });
    kit.data.set(KEY, new Map<string, import('@/collab/local-collab-cache').LocalCacheRecord>([
      ['tab-a', REC({ tabId: 'tab-a', snapshot: snapshotOf((d) => { d.getMap('nodes').set('node-a', orderNode('a', 'o1')); }), unsyncedDirty: true })],
      ['tab-b', REC({ tabId: 'tab-b', snapshot: snapshotOf((d) => { d.getMap('nodes').set('node-b', orderNode('b', 'o1')); }), unsyncedDirty: true })],
    ]));
    await driveToSynced();
    const st = useCanvasStore.getState();
    expect(st.nodes.map((n: any) => n.id)).toContain('node-a');   // 不阻断（并集照常回放——两 tab 节点都在）
    expect(st.nodes.map((n: any) => n.id)).toContain('node-b');
    expect(st.draftMergeAnomalies).toMatchObject({ 'duplicate-order': 2 });   // 修前：恒 null（红）
  });
});
