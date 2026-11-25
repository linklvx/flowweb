// apps/web/src/stores/canvasCollabRuntime.t8.spec.ts
// Y0b-5 T8 历史面（Y5 T14 手术后台账）：
//   保留＝Σpending 流控（runPendingBacklogTick）、IDB 全交互降级 → local-cache-degraded、cacheDisabled fail-closed；
//   删除＝旧 per-tab 快照适配器的写路径面（trailing 落盘/结构性提前到期/E36 回放帧、diverged 记录闩锁
//   三例、尺寸闸周期复检（local.spec T11 ⑥ 同形态覆盖）、pagehide/visibilitychange flush、dirty 守卫遥测、
//   容量 ring）——旧 per-tab 快照适配器已随 T14 整层退役；docBytes 遥测口径迁入 runDocSizeGate
//   （覆盖在 canvasCollabRuntime.local.spec.ts T11 ⑥ 同 tick 断言）。
// 装置：fakeHocuspocusProvider+真 Y.Doc+fake timers+最小 IDB stub（仅降级路径需要：无 IDBKeyRange）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useCanvasStore } from './canvasStore';
import * as runtime from './canvasCollabRuntime';
import { Origin } from './canvasUndo';
import { createFakeIndexedDb, type FakeIndexedDbFactory } from '@/test/fakeIndexedDb';
import { getRecentCollabDiag, _resetCollabDiagForTest } from '@/utils/collabDiagnostics';
import { _resetUnloadGuardForTest } from '@/utils/unloadGuard';

vi.mock('@hocuspocus/provider', async () => {
  const { FakeHocuspocusProvider } = await import('@/test/fixtures/fakeHocuspocusProvider');
  return { HocuspocusProvider: FakeHocuspocusProvider };
});

const META = { collabGeneration: 3, collabSchemaVersion: 2, viewerUid: 'u1' };
const lastInstance = () => (HocuspocusProvider as any).instances.at(-1) as any;

let kit: FakeIndexedDbFactory;

const resetStore = () => useCanvasStore.setState({
  connStatus: 'connecting', nodes: [], edges: [], connUi: 'ok', hydration: 'idle',
  collabReadOnly: true, wsAuthNotice: null, writeFrozen: false, collabEscapePending: false,
  connReadOnly: false, quotaOver: false, quotaLimitBytes: 0, quotaTxBytes: 0,
  quotaSoftLimitBytes: 0, quotaResidueBytes: undefined, lastDocStatusRev: 0,
  localDocBytes: 0, localDelta: 0, pendingGenerationReload: 0, wsQuotaTerminal: null,
  localCacheReady: false, canvasDiverged: false, canvasOversized: false, canvasDegraded: false,
  persistUnhealthy: false, syncLagOver60s: false, pendingBacklog: false,
});

const localEdit = (d: Y.Doc, key = 'n-t8', payload: unknown = 1): void => {
  d.transact(() => { d.getMap('m').set(key, payload); }, Origin.LocalUser);
};

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

beforeEach(() => {
  vi.useFakeTimers();
  (HocuspocusProvider as any).instances.length = 0;
  _resetCollabDiagForTest();
  _resetUnloadGuardForTest();
  resetStore();
  kit = createFakeIndexedDb();
  vi.stubGlobal('indexedDB', kit.fake);
  vi.stubGlobal('navigator', {
    ...navigator,
    onLine: true,
    storage: { persist: vi.fn(async () => true), estimate: vi.fn(async () => ({ usage: 1, quota: 1_000_000 })) },
  });
  vi.stubGlobal('location', { reload: vi.fn() });
});

afterEach(async () => {
  await runtime.destroyCollab();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ══════════ Σpending 流控（裁定 23⑷ 吸收——E36 又一道保险） ══════════
describe('T8 Σpending 流控', () => {
  it('未上行增量>1MB→forceSync()+pendingBacklog 置位（永不阻塞输入）；确认归零自动消', async () => {
    const p = await driveToSynced();
    expect(useCanvasStore.getState().pendingBacklog).toBe(false);
    p.unsyncedChanges = 1;   // 断连形态：确认帧不到——dirty 悬置
    p.isSynced = false;
    localEdit(runtime.getDoc()!, 'blob', 'x'.repeat(1_048_577));   // >UNSYNCED_MAX_BYTES(1MB)
    await vi.advanceTimersByTimeAsync(5_000);
    expect(p.forceSync).toHaveBeenCalled();
    expect(useCanvasStore.getState().pendingBacklog).toBe(true);
    // 确认归零：3s tick 清 dirty（Σpending 累计器同亡）→5s tick 消档
    p.isSynced = true;
    p.unsyncedChanges = 0;
    await vi.advanceTimersByTimeAsync(6_000);
    expect(useCanvasStore.getState().pendingBacklog).toBe(false);
  });
});

// ══════════ IDB 全交互降级（旧层退役后仍成立：新层文档库开不了 ⇒ 纯服务端水合） ══════════
describe('T8 IDB 全交互降级', () => {
  it('IDB 全交互降级（Y5 T10 新链：文档库不可开）→initCollab 正常完成+ws_status reason="local-cache-degraded" 遥测+localCacheReady=false（协作主链零影响）', async () => {
    // 本文件装置无 IDBKeyRange（旧最小 stub）⇒ 新链开文档库能力前置判 open-reject：
    // names 先写成功、库开不了，本会话改纯服务端水合 + 降级遥测（异常不冒泡=协作初始化成功）。
    localStorage.setItem('collab:history-id', 'h-t8-degrade');
    try {
      const p = await driveToSynced('p1', META);   // 不抛=主链无恙
      expect(getRecentCollabDiag().some((e) => e.type === 'ws_status' && (e.detail as any)?.reason === 'local-cache-degraded')).toBe(true);
      expect(useCanvasStore.getState().localCacheReady).toBe(false);
      expect(useCanvasStore.getState().hydration).toBe('ready');
      void p;
    } finally {
      localStorage.removeItem('collab:history-id');
    }
  });
});

// ══════════ cacheDisabled fail-closed 零回归（T5 语义——T8 不越界） ══════════
describe('T8 fail-closed', () => {
  it('meta 缺失（cacheDisabled）→零 IDB 交互（零 open——本地缓存整体旁路）', async () => {
    const openSpy = vi.spyOn(kit.fake, 'open');
    await driveToSynced('p1', {} as runtime.CollabSessionMeta);   // 三元缺失=cacheDisabled（默认参数陷阱：传 undefined 会落 META 默认）
    expect(openSpy).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().localCacheReady).toBe(false);
  });
});
