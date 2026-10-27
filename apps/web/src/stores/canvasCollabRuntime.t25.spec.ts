// apps/web/src/stores/canvasCollabRuntime.t25.spec.ts
// Y1c T25（plan v1.7 Task 25——spec v5.4 §8.1 拒帧恢复+4410 三分+恢复模式）runtime 接线用例：
//   ★红①4411 毒帧拒后恢复=resync-full（同代 fresh doc——禁同 doc 重连重放被拒本地增量
//     「修复」服务器态：CRDT 单调性反例，被拒内容经 DraftEnvelope 类型化导出保全归用户裁定）；
//   ★红②g_client>g_server（server-restored）=只读 recovery+草稿导出——禁静默 purge+reload
//     （现状 consumeGenerationJump 双向同路=导出→reload 缺接受路径）；
//   ③4412/4413/4406 档客户端消费（resolveRecoveryAction 分派——修正 #7 禁 backoff 吞）；
//   ④重复 DENY 逃生口（N=3 次 4411 后 recovery 模式粘住+多标签 BroadcastChannel 通告）；
//   ⑤客户端半链：docName #g 世代载体（T12）+auth-receipt historyId 持久化+h= 参数上行（T9 服务端已落）。
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

vi.mock('@hocuspocus/provider', async () => {
  const { FakeHocuspocusProvider } = await import('@/test/fixtures/fakeHocuspocusProvider');
  return { HocuspocusProvider: FakeHocuspocusProvider };
});

vi.mock('@/collab/local-cache-key', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/collab/local-cache-key')>()),
  purgeForeignCaches: vi.fn().mockResolvedValue(undefined),
}));
import { purgeForeignCaches } from '@/collab/local-cache-key';

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
  it('4413 maintenance-freeze→重连消费 retryAfterMs（非泛 backoff——重连循环反复撞冻结门）', async () => {
    const p = await driveToSynced();
    p.emit('stateless', { payload: JSON.stringify({ code: 4413, reason: 'maintenance-freeze', retryAfterMs: 30_000 }) });
    p.emit('close', { event: { code: 4413, reason: 'maintenance-freeze' } });
    // 1s short 档窗口内不应重连（Retry-After=30s——泛 backoff 1s 即撞门）
    await vi.advanceTimersByTimeAsync(3_000);
    const p2 = lastInstance();
    expect(p2).toBe(p);   // 未重建未重连（30s 后才应恢复——supervisor 短档被 Retry-After 覆盖）
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
