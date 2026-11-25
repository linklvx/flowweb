// apps/web/src/stores/canvasCollabRuntime.t18.spec.ts
// Y1c T18：单 UndoManager 收口+per-tab 缓存——runtime 侧接线用例：
//   ①boot mergeUpdates 并集（多标签离线草稿——spec §3.4 v5-11 场景 A）
//   ②同步成功删己（3s tick 单源清零同点——他 tab 记录不受波及）
//   ③savedSeq 口径（偏离 36：只由服务端持久化回执推进——provider synced 恒不推进）
//   ④换代清整族禁静默丢（generation 跳变→族 dirty 草稿先导出后 purge——顺序锚）
// 装置承 t8.spec（fakeHocuspocusProvider+真 Y.Doc+fake timers+fakeIndexedDb）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { CANVAS_DOC_SCHEMA_VERSION } from '@flowweb/shared';
import { useCanvasStore } from './canvasStore';
import * as runtime from './canvasCollabRuntime';
import { Origin } from './canvasUndo';
import { buildLocalCacheKey } from '@/collab/local-cache-key';
import { getCollabTabId, type LocalCacheRecord } from '@/collab/local-collab-cache';
import { createFakeIndexedDb, type FakeIndexedDbFactory } from '@/test/fakeIndexedDb';
import { _resetUnloadGuardForTest } from '@/utils/unloadGuard';
import { getRecentCollabDiag, _resetCollabDiagForTest } from '@/utils/collabDiagnostics';

vi.mock('@hocuspocus/provider', async () => {
  const { FakeHocuspocusProvider } = await import('@/test/fixtures/fakeHocuspocusProvider');
  return { HocuspocusProvider: FakeHocuspocusProvider };
});

// purge 面 mock（挂点/顺序断言——真实行为归 local-cache-key.test）；exportRawYjsBackup spy
// （换代族草稿导出收参侧可观测——记录原始字节+帧头供内容断言）
const familyExportLog: Array<{ yjs: Uint8Array; header: { schemaVersion: number; historyToken: string }; tag?: string }> = [];
vi.mock('@/collab/canvas-local-backup', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    exportRawYjsBackup: (yjs: Uint8Array, header: { schemaVersion: number; historyToken: string }, opts?: { tag?: string }) => {
      familyExportLog.push({ yjs, header, tag: opts?.tag });
      return (orig.exportRawYjsBackup as (y: Uint8Array, h: { schemaVersion: number; historyToken: string }, o?: { tag?: string }) => number | null)(yjs, header, opts);
    },
  };
});
vi.mock('@/collab/local-cache-key', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/collab/local-cache-key')>()),
  purgeForeignCaches: vi.fn().mockResolvedValue(undefined),
}));
import { purgeForeignCaches } from '@/collab/local-cache-key';

const META = { collabGeneration: 3, collabSchemaVersion: 2, viewerUid: 'u1' };
const KEY = buildLocalCacheKey({ uid: 'u1', pid: 'p1', generation: 3, schemaVersion: 2 });
const OLD_GEN_KEY = buildLocalCacheKey({ uid: 'u1', pid: 'p1', generation: 1, schemaVersion: 2 });
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
});

/** 快照构造（t8.spec 同款：单节点+schemaVersion 盖戳+docShape 合形） */
function snapshotOf(build: (d: Y.Doc) => void): Uint8Array {
  const d = new Y.Doc();
  d.getMap('meta').set('schemaVersion', CANVAS_DOC_SCHEMA_VERSION);
  build(d);
  return Y.encodeStateAsUpdate(d);
}
const seedNode = (id: string): Y.Map<any> => new Y.Map<any>([
  ['type', 'textInput'],
  ['position', new Y.Map([['x', 0], ['y', 0]])],
  ['data', new Y.Map([['v', id]])],
]);
const REC = (over: Partial<LocalCacheRecord> = {}): LocalCacheRecord => ({
  tabId: 'seed', snapshot: new Uint8Array([1]), stateVector: new Uint8Array([1]), savedSeq: 0,
  unsyncedDirty: false, diverged: false, at: 1_000, ...over,
});

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

beforeEach(() => {
  vi.useFakeTimers();
  (HocuspocusProvider as any).instances.length = 0;
  _resetUnloadGuardForTest();
  _resetCollabDiagForTest();
  resetStore();
  reloadSpy.mockClear();
  familyExportLog.length = 0;
  vi.mocked(purgeForeignCaches).mockClear();
  kit = createFakeIndexedDb();
  vi.stubGlobal('indexedDB', kit.fake);
  vi.stubGlobal('navigator', {
    ...navigator,
    onLine: true,
    storage: { persist: vi.fn(async () => true), estimate: vi.fn(async () => ({ usage: 1, quota: 1_000_000 })) },
  });
  vi.stubGlobal('location', { reload: reloadSpy });
});
afterEach(async () => {
  await runtime.destroyCollab();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ══════════ ①boot mergeUpdates 并集（已删除——Y5 T10 读路径改五维 y-indexeddb 库） ══════════
// 删除理由（行为已不在本 build）：旧四例（双 tab 并集/legacy 'snapshot' 迁移/Q-I-1 坏记录隔离/
// diverged 族隔离）钉的是 runtim 对 LocalCollabCache.loadAll() 返回的 per-tab 记录做
// Y.mergeUpdates 并集再 Y.applyUpdate 的读放大面。Y5 T10 把水合次序倒转为「单一 y-indexeddb
// update 日志直接装载进 doc」——`loadAll` 生产面零调用（grep 实证），该行为结构性不存在。
// 等价需求面在新链：库内 CRDT 合并在库自身事务内完成（T2 trim 补丁测试锚）、差分口径=
// canvasCollabRuntime.local.spec.ts ③、多标签跨会话存活=同库 update 日志回放。

// ══════════ ②同步成功删己（3s tick 单源清零同点） ══════════
describe('T18 per-tab：同步成功删己', () => {
  it('★编辑→落盘→3s tick 同步确认：本 tab 记录删除+legacy 迁移清——他 tab dirty 记录存活（删己≠删族）', async () => {
    const p = await driveToSynced();
    // 他 tab 离线 dirty 记录在盘（本会话不可删——其内容未由本连接确认）
    // Y5 T10：新水合序不读旧层——旧适配器库只在首次写时创建，本用例需库已在盘上
    if (!kit.data.has(KEY)) kit.data.set(KEY, new Map());
    kit.data.get(KEY)!.set('tab-other', REC({
      tabId: 'tab-other',
      snapshot: snapshotOf((d) => { d.getMap('nodes').set('node-other', seedNode('o')); }),
      unsyncedDirty: true,
    }));
    const d = runtime.getDoc()!;
    d.transact(() => { d.getMap('m').set('t18-del', 1); }, Origin.LocalUser);
    await vi.advanceTimersByTimeAsync(1_000);   // trailing 落盘（本 tab 键）
    expect(kit.data.get(KEY)!.has(getCollabTabId())).toBe(true);   // 前置锚：本 tab 记录在盘
    p.unsyncedChanges = 0;   // 确认帧到齐（fake 默认 0——显式钉死语义）
    await vi.advanceTimersByTimeAsync(3_500);   // 越过一个 3s tick → dirty 清零同点删己
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(false);
    expect(kit.data.get(KEY)!.has(getCollabTabId())).toBe(false);   // 删己
    expect(kit.data.get(KEY)!.has('tab-other')).toBe(true);         // 他 tab dirty 记录存活
  });
});

// ══════════ ③savedSeq 口径（偏离 36） ══════════
describe('T18 savedSeq：只由服务端持久化回执推进（偏离 36——provider synced 恒不推进）', () => {
  it('★driveToSynced（provider synced/authenticated 全真）后 savedSeq=0——同步显示不推进；durable watermark（pgSeq 回执）推进+单调；watermark 载荷形状非法（非 string pgSeq）/坏 JSON 静默忽略（记录级坏 snapshot 载荷隔离=Q-I-1 用例，非本用例面）', async () => {
    const p = await driveToSynced();
    expect(runtime.getSavedSeq()).toBe(0);   // synced/连接/认证全真仍 0——「已保存」只认持久化回执
    p.emit('stateless', { payload: JSON.stringify({ type: 'durable', pgSeq: '42' }) });
    expect(runtime.getSavedSeq()).toBe(42);
    p.emit('stateless', { payload: JSON.stringify({ type: 'durable', pgSeq: '7' }) });   // 回退载荷
    expect(runtime.getSavedSeq()).toBe(42);   // 单调——只前进
    p.emit('stateless', { payload: JSON.stringify({ type: 'durable', pgSeq: 99 }) });    // 非法形状（非 string）
    expect(runtime.getSavedSeq()).toBe(42);
    p.emit('stateless', { payload: 'not-json' });   // 坏 JSON 静默
    expect(runtime.getSavedSeq()).toBe(42);
  });

  it('★savedSeq 随 per-tab 记录落盘（dirty 期 flush 的记录携带回执水位）', async () => {
    const p = await driveToSynced();
    p.emit('stateless', { payload: JSON.stringify({ type: 'durable', pgSeq: '5' }) });
    const d = runtime.getDoc()!;
    d.transact(() => { d.getMap('m').set('t18-seq', 1); }, Origin.LocalUser);
    await vi.advanceTimersByTimeAsync(1_000);   // trailing 落盘
    const rec = kit.data.get(KEY)!.get(getCollabTabId()) as LocalCacheRecord;
    expect(rec.savedSeq).toBe(5);
    expect(rec.stateVector.byteLength).toBeGreaterThan(0);   // 记录七要素：stateVector 同点快照
    expect(rec.tabId).toBe(getCollabTabId());
  });
});

// ══════════ ④换代清整族禁静默丢（spec §3.4） ══════════
describe('T18 换代清整族：先保存可恢复脏草稿再清（禁静默丢）', () => {
  it('★generation 跳变→族 dirty 记录（异代库——boot 不读面）并集导出 exportRawYjsBackup（可回灌内容+oldgen-family 标注）→purgeForeignCaches→reload', async () => {
    // 族语料（全在异代库——当前会话 boot 不读=保持干净可 reload；当前代他 tab 离线草稿走
    // boot 并集+escape 导出路径——本用例锚定清族前的盘上草稿保全）：
    //   旧代库 g1：dirty（per-tab 键）+dirty（legacy 键）+clean（不导出）+坏记录（Q-I-1 隔离——不毒化族导出）
    const goodOldGen = snapshotOf((d) => { d.getMap('nodes').set('fam-old', seedNode('o')); });
    kit.data.set(OLD_GEN_KEY, new Map<string, LocalCacheRecord>([
      ['tab-old', REC({ tabId: 'tab-old', snapshot: goodOldGen, unsyncedDirty: true })],
      ['snapshot', REC({ snapshot: snapshotOf((d) => { d.getMap('nodes').set('fam-legacy', seedNode('lg')); }), diverged: true })],
      ['tab-old-clean', REC({ tabId: 'tab-old-clean', snapshot: snapshotOf((d) => { d.getMap('nodes').set('fam-clean', seedNode('c')); }) })],
      ['tab-old-bad', REC({ tabId: 'tab-old-bad', snapshot: goodOldGen.slice(0, 10), unsyncedDirty: true })],
    ]));
    const p = await driveToSynced();
    p.emit('stateless', { payload: docStatus(1, 5) });   // 基线建立
    p.emit('stateless', { payload: docStatus(2, 9) });   // 真跳变→consumeGenerationJump→safeReload('generation')
    await vi.advanceTimersByTimeAsync(1_500);
    // 族 dirty/diverged 并集导出（他 tab 草稿保全——禁静默丢；坏记录逐条隔离不一票否决全族）：
    // 可回灌字节含两好 dirty 记录节点、不含 clean 记录专属节点/坏记录内容
    expect(familyExportLog.length).toBe(1);
    expect(familyExportLog[0]!.tag).toContain('oldgen');   // oldgen-family 标注（世代被超的编辑）
    // Y5 T6b：族导出带当前会话帧头（META.schemaVersion=2；未收 auth-receipt=空纪元串）
    expect(familyExportLog[0]!.header).toEqual({ schemaVersion: 2, historyToken: '' });
    const tmp = new Y.Doc();
    Y.applyUpdate(tmp, familyExportLog[0]!.yjs);           // 可回灌（importLocalBackup 同格式）
    expect(tmp.getMap('nodes').get('fam-old')).toBeTruthy();       // 旧代库 dirty 草稿
    expect(tmp.getMap('nodes').get('fam-legacy')).toBeTruthy();   // 旧代库 diverged 草稿（readOnly 期编辑同禁静默丢）
    expect(tmp.getMap('nodes').get('fam-clean')).toBeUndefined();   // clean 记录不进导出（服务端已确认）
    expect(purgeForeignCaches).toHaveBeenCalledWith(KEY);
    expect(reloadSpy).toHaveBeenCalledTimes(1);   // purge 完成→reload
  });
});
