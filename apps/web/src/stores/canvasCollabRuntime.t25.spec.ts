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
 *  默认不挂=直通〔其余用例零扰动〕）。vi.hoisted：vi.mock 工厂提升后闭包可达。 */
const exportGate = vi.hoisted(() => ({
  gate: null as null | { promise: Promise<void>; release: () => void },
}));
vi.mock('@/collab/rejected-recovery', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/collab/rejected-recovery')>();
  return {
    ...orig,
    buildDraftEnvelope: async (...args: Parameters<typeof orig.buildDraftEnvelope>) => {
      if (exportGate.gate) await exportGate.gate.promise;
      return orig.buildDraftEnvelope(...args);
    },
  };
});

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
  FakeHocuspocusProvider.resetSockets();
  kit = createFakeIndexedDb();
  vi.stubGlobal('indexedDB', kit.fake);
  vi.stubGlobal('navigator', {
    ...navigator,
    onLine: true,
    storage: { persist: vi.fn(async () => true), estimate: vi.fn(async () => ({ usage: 1, quota: 1_000_000 })) },
  });
  vi.stubGlobal('location', { reload: reloadSpy });
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
