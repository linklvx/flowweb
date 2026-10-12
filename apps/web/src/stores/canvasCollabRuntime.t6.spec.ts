// apps/web/src/stores/canvasCollabRuntime.t6.spec.ts
// Y0b-5 T6：unsyncedDirty 单源（spec §5.7 v2.3 裁定）+diverged 闩锁（裁定 23⑨）+safeReload
// （裁定 20 固定次序/9 处收敛）+persist-status 消费（V15）+T3/T6 接缝（forceSync 契约显式化）。
// 装置承 force-sync/cache.spec：fakeHocuspocusProvider 唯一载体+真 Y.Doc+fake timers。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useCanvasStore } from './canvasStore';
import * as runtime from './canvasCollabRuntime';
import { Origin } from './canvasUndo';
import { QUOTA_DEFAULTS } from '@flowweb/shared';
import { _resetCollabDiagForTest } from '@/utils/collabDiagnostics';
import { _resetUnloadGuardForTest, shouldWarnUnload } from '@/utils/unloadGuard';

vi.mock('@hocuspocus/provider', async () => {
  const { FakeHocuspocusProvider } = await import('@/test/fixtures/fakeHocuspocusProvider');
  return { HocuspocusProvider: FakeHocuspocusProvider };
});

/** T6 质量修复 M2：exportLocalBackup opts 透传观测（importOriginal 包裹转发——行为零改动,
 *  仅记录 tag 面——jsdom 文件名不可断言,观测收参侧） */
const exportOptsLog: Array<{ tag?: string }> = [];
vi.mock('@/collab/canvas-local-backup', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    exportLocalBackup: (d: unknown, opts?: { tag?: string }) => {
      exportOptsLog.push(opts ?? {});
      return (orig.exportLocalBackup as (d: unknown, opts?: { tag?: string }) => unknown)(d, opts);
    },
  };
});

const lastInstance = () => (HocuspocusProvider as any).instances.at(-1) as any;
const reloadSpy = vi.fn();   // jsdom Location [Unforgeable] 不可 spy——vi.stubGlobal('location') 整体替换

const resetStore = () => useCanvasStore.setState({
  connStatus: 'connecting', nodes: [], edges: [], connUi: 'ok', hydration: 'idle',
  collabReadOnly: true, wsAuthNotice: null, writeFrozen: false, collabEscapePending: false,
  connReadOnly: false, quotaOver: false, quotaLimitBytes: 0, quotaTxBytes: 0,
  quotaSoftLimitBytes: 0, quotaResidueBytes: undefined, lastDocStatusRev: 0,
  localDocBytes: 0, localDelta: 0, pendingGenerationReload: 0, wsQuotaTerminal: null,
  canvasDiverged: false, canvasOversized: false, canvasDegraded: false,
  persistUnhealthy: false, syncLagOver60s: false,
});

/** 本地编辑驱动（origin 默认 local-user——本地用户编辑语义原点；null origin=裸 transact 同属本地事务面） */
function localEdit(d: Y.Doc, origin: unknown = Origin.LocalUser, key = 'n-t6'): void {
  d.transact(() => { d.getMap('nodes').set(key, new Y.Map([['id', key]])); }, origin);
}

/** jsdom 无 URL.createObjectURL——静态方法注入（不改 URL 全局形态；测后删除还原） */
function stubBlobUrls(sink: Blob[]): void {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (b: Blob) => { sink.push(b); return `blob:${sink.length}`; },
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
}
function restoreBlobUrls(): void {
  delete (URL as any).createObjectURL;
  delete (URL as any).revokeObjectURL;
}

async function driveToSynced(pid = 'p-t6', meta?: runtime.CollabSessionMeta) {
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
  exportOptsLog.length = 0;
  reloadSpy.mockClear();
  vi.stubGlobal('location', { reload: reloadSpy });
});

afterEach(async () => {
  await runtime.destroyCollab();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ══════════ unsyncedDirty 单源（spec §5.7 v2.3） ══════════
describe('Y0b-5 T6：unsyncedDirty 单源', () => {
  it('唯一置位=本地 origin update（doc.on("update",_,origin)——origin 为本地事务即置位）；远端 apply（origin=provider 实例）不置位', async () => {
    await driveToSynced();
    const d = runtime.getDoc()!;
    localEdit(d, Origin.LocalUser);
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(true);
    expect(shouldWarnUnload()).toBe(true);       // 单源置位联动 beforeunload reason 武装
    // 远端形态：origin=provider 实例（y-protocols readSyncMessage 第 4 参 / suppress-origin 同形态）
    await runtime.destroyCollab();
    const q = await driveToSynced('p-t6-remote');
    const d2 = runtime.getDoc()!;
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d), lastInstance());
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(false);
    void q;
  });

  it('唯一清零=3s tick 判 provider.hasUnsyncedChanges===false && isSynced——断连（isSynced false）不清；计数未归零不清；双条件合取才清。★合取 isSynced 论据见 runtime 注释（防"简化"掉）', async () => {
    const p = await driveToSynced();
    const d = runtime.getDoc()!;
    localEdit(d);
    // 断连期：isSynced=false——确认帧永不到达，tick 不得清
    p.isSynced = false;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(true);
    // 重连但确认未归零：isSynced=true∧hasUnsyncedChanges=true——仍不清（合取项左值）
    p.isSynced = true;
    p.unsyncedChanges = 1;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(true);
    // 双条件合取成立→清（beforeunload reason 随集合同步解除）
    p.unsyncedChanges = 0;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(false);
    expect(shouldWarnUnload()).toBe(false);
  });

  it('自持标记绑定 doc 实例（supervisor terminal 重建换 provider 不失效）+rebuildPending 并入单源置位（无编辑重建亦保守武装）', async () => {
    const p = await driveToSynced();
    const d = runtime.getDoc()!;
    localEdit(d);
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(true);
    p.isAttached = false;                        // 终态判据（T3b isAttached 单判据）
    await runtime.recovery.recoverConnection();  // 终态重建：新 provider 同 doc
    expect(lastInstance()).not.toBe(p);
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(true);   // doc 绑定——换 provider 不失效
    // rebuildPending 并入：无本地编辑的重建窗口同样武装（旧实例计数不可读——保守）
    await runtime.destroyCollab();
    const q = await driveToSynced('p-t6-rebuild');
    q.isAttached = false;
    await runtime.recovery.recoverConnection();
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(true);
  });

  it('★T3/T6 接缝：断连期连续编辑（unsyncedChanges 单调递增且零确认帧）→重连 authenticated 后必须经 forceSync() 归零（隐性契约显式化——两 Task 接缝锁死）', async () => {
    const p = await driveToSynced();
    const d = runtime.getDoc()!;
    p.emit('status', { status: 'disconnected' });
    p.isSynced = false;
    localEdit(d, Origin.LocalUser, 'n1');
    localEdit(d, Origin.LocalUser, 'n2');
    localEdit(d, Origin.LocalUser, 'n3');
    p.unsyncedChanges = 3;                       // 断连期计数单调递增形态（真库 documentUpdateHandler 同构）
    await vi.advanceTimersByTimeAsync(3_000);
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(true);   // 零确认帧——永不清
    // 重连 authenticated：带未同步编辑 → forceSync 必被调（SS2 差分上行=计数归零唯一路由）
    expect(p.forceSync).not.toHaveBeenCalled();
    p.emit('status', { status: 'connected' });
    p.isAuthenticated = true;
    p.emit('authenticated', { scope: 'read-write' });
    expect(p.forceSync).toHaveBeenCalledTimes(1);
  });

  it('健康重连（无未同步编辑）authenticated 不 forceSync（零编辑零代价——接缝契约不误伤常态）', async () => {
    const p = await driveToSynced();
    p.emit('status', { status: 'disconnected' });
    p.emit('status', { status: 'connected' });
    p.isAuthenticated = true;
    p.emit('authenticated', { scope: 'read-write' });
    expect(p.forceSync).not.toHaveBeenCalled();
  });
});

// ══════════ diverged 闩锁（裁定 23⑨——T6+T7+T8 组合发散防御） ══════════
describe('Y0b-5 T6：diverged 标记三出边', () => {
  it('置位判据=客户端已知 readOnly（collabReadOnly）∧本地新 update——不引 wire 层 SyncStatus 解析；非 readOnly 编辑不标记', async () => {
    await driveToSynced();
    const d = runtime.getDoc()!;
    localEdit(d, Origin.LocalUser, 'n-ok');
    expect(useCanvasStore.getState().canvasDiverged).toBe(false);   // 正常编辑不标记
    useCanvasStore.setState({ collabReadOnly: true });
    localEdit(d, Origin.LocalUser, 'n-diverged');
    expect(useCanvasStore.getState().canvasDiverged).toBe(true);
  });

  it('出边②放弃：discardLocalDiverged 同时清 diverged+unsyncedDirty 解除闩锁（否则 beforeunload 永久确认框）', async () => {
    await driveToSynced();
    const d = runtime.getDoc()!;
    useCanvasStore.setState({ collabReadOnly: true });
    localEdit(d);
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(true);
    expect(useCanvasStore.getState().canvasDiverged).toBe(true);
    runtime.discardLocalDiverged();
    expect(useCanvasStore.getState().canvasDiverged).toBe(false);
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(false);
  });

  it('出边③服务端最终接受：readOnly 解除∧synced∧计数归零 → 3s tick 清 diverged（接受前不清）', async () => {
    const p = await driveToSynced();
    const d = runtime.getDoc()!;
    useCanvasStore.setState({ collabReadOnly: true });
    localEdit(d);
    expect(useCanvasStore.getState().canvasDiverged).toBe(true);
    // readOnly 未解除——tick 不清（diverged 期编辑未获服务端接受；fake 计数形态下仍被 collabReadOnly 拦）
    p.isSynced = true; p.unsyncedChanges = 0;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(useCanvasStore.getState().canvasDiverged).toBe(true);
    // readOnly 解除+编辑被接受（确认帧归零）→tick 清
    useCanvasStore.setState({ collabReadOnly: false });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(useCanvasStore.getState().canvasDiverged).toBe(false);
  });
});

// ══════════ safeReload（裁定 20 固定次序+9 处收敛单出口） ══════════
describe('Y0b-5 T6：safeReload', () => {
  it('unsyncedDirty 真→导出对话框（collabEscapePending）+return 禁直接 reload；假→location.reload()', async () => {
    const p = await driveToSynced();
    localEdit(runtime.getDoc()!);
    runtime.safeReload('generic');
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().collabEscapePending).toBe(true);
    // 单源清零后（tick 双条件）→reload 放行
    p.unsyncedChanges = 0;                       // fake 计数面（置位侧 fake 库不自增）
    await vi.advanceTimersByTimeAsync(3_000);
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(false);
    useCanvasStore.setState({ collabEscapePending: false });
    runtime.safeReload('generic');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('generation 固定次序（裁定 20）=导出（标注旧代）→purge→reload；调度时刻闭包捕获 key+tag（T5 Minor①/T6 M2——执行时不读现刻 session/store）', async () => {
    const blobs: Blob[] = [];
    stubBlobUrls(blobs);
    try {
      await driveToSynced('p-t6-gen', { collabGeneration: 3, collabSchemaVersion: 2, viewerUid: 'u1' });
      // 调度时刻捕获 key+tag（consumeGenerationJump 形态——执行窗口内 session/store 变化不影响）
      setTimeout(() => runtime.safeReload('generation', { generationCacheKey: 'k-gen-3', generationTag: 3 }), 1_500);
      await vi.advanceTimersByTimeAsync(1_500);
      await vi.advanceTimersByTimeAsync(0);
      expect(blobs).toHaveLength(2);                                           // 双产物先于 reload
      expect(blobs[0].type).toBe('application/octet-stream');                  // .yjs（标注旧代）
      expect(blobs[1].type).toBe('application/json');                          // doc 反投影
      expect(exportOptsLog).toEqual([{ tag: 'oldgen3' }]);                     // M2：tag 调度时刻快照透传
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    } finally { restoreBlobUrls(); }
  });

  it('generation 且 unsyncedDirty 真→escape+return（purge 与 reload 都不发生——未同步编辑禁被 purge/reload 吞）', async () => {
    await driveToSynced('p-t6-gen2', { collabGeneration: 3, collabSchemaVersion: 2, viewerUid: 'u1' });
    localEdit(runtime.getDoc()!);
    runtime.safeReload('generation', { generationCacheKey: 'k' });
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().collabEscapePending).toBe(true);
  });

  it('T6 质量修复 C1：escape 分叉自动复位路①——dirty 清零（3s tick 双条件）→collabEscapePending 随单源复位（escape 横幅消失,用户可再触发 reload）', async () => {
    const p = await driveToSynced();
    localEdit(runtime.getDoc()!);
    runtime.safeReload('generic');
    expect(useCanvasStore.getState().collabEscapePending).toBe(true);
    p.unsyncedChanges = 0;                       // fake 计数面（置位侧 fake 库不自增）
    await vi.advanceTimersByTimeAsync(3_000);
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(false);
    expect(useCanvasStore.getState().collabEscapePending).toBe(false);   // 自动复位（禁手动）
  });

  it('T6 质量修复 C1：escape 分叉自动复位路②——escapeWithLocalExport 导出完成→复位（导出后不自动 reload——用户显式第二次动作）', async () => {
    await driveToSynced();
    localEdit(runtime.getDoc()!);
    runtime.safeReload('generic');
    expect(useCanvasStore.getState().collabEscapePending).toBe(true);
    const blobs: Blob[] = [];
    stubBlobUrls(blobs);
    try {
      runtime.escapeWithLocalExport();
      expect(blobs).toHaveLength(2);                                  // 导出确实完成
      expect(useCanvasStore.getState().collabEscapePending).toBe(false);
      expect(reloadSpy).not.toHaveBeenCalled();
    } finally { restoreBlobUrls(); }
  });

  it('T6 质量修复 I1：dirty→destroyCollab（路由跳 /works）→unsynced reason 解除——doc 已销毁 dirty 语义消亡,关标签禁弹假确认框', async () => {
    await driveToSynced();
    localEdit(runtime.getDoc()!);
    expect(shouldWarnUnload()).toBe(true);
    await runtime.destroyCollab();
    expect(shouldWarnUnload()).toBe(false);
  });
});

// ══════════ persist-status 消费（V15——静默透传终结） ══════════
describe('Y0b-5 T6：persist-status 通道', () => {
  const docStatus = (rev: number) => JSON.stringify({
    type: 'doc-status', rev, writeFrozen: false,
    quota: { state: 'ok', bytes: 1234, limit: QUOTA_DEFAULTS.maxDocBytes, maxTxBytes: QUOTA_DEFAULTS.maxTxBytes, softLimitBytes: 6_710_886 },
  });

  it('{healthy:false}→persistUnhealthy=true（单链 persist 档数据源）；{healthy:true}→自动消（电平非事件）', async () => {
    const p = await driveToSynced();
    p.emit('stateless', { payload: JSON.stringify({ type: 'persist-status', healthy: false }) });
    expect(useCanvasStore.getState().persistUnhealthy).toBe(true);
    p.emit('stateless', { payload: JSON.stringify({ type: 'persist-status', healthy: true }) });
    expect(useCanvasStore.getState().persistUnhealthy).toBe(false);
  });

  it('doc-status 快照与 persist-status 两通道独立字段互不覆盖（rev 单调守卫只辖 doc-status 族）', async () => {
    const p = await driveToSynced();
    p.emit('stateless', { payload: JSON.stringify({ type: 'persist-status', healthy: false }) });
    p.emit('stateless', { payload: docStatus(1) });   // doc-status 到达
    expect(useCanvasStore.getState().persistUnhealthy).toBe(true);    // 不被 doc-status 覆盖
    expect(useCanvasStore.getState().lastDocStatusRev).toBe(1);       // doc-status 照常入账
    p.emit('stateless', { payload: docStatus(2) });
    expect(useCanvasStore.getState().persistUnhealthy).toBe(true);
  });
});

// ══════════ importLocalBackup（裁定 25⑷ 导入路径修正） ══════════
describe('Y0b-5 T6：importLocalBackup', () => {
  it('applyUpdate 以 provider 为 origin（抑制 Update 帧回发 esm:762）+forceSync()（上行改走 SS2 差分）+显式置 unsyncedDirty（suppress-origin 同时抑制 unsyncedChanges 计数——禁"已缓存"文案撒谎）', async () => {
    const p = await driveToSynced();
    const d = runtime.getDoc()!;
    const src = new Y.Doc();
    src.transact(() => { src.getMap('nodes').set('n-imp', new Y.Map([['id', 'n-imp']])); });
    const bin = Y.encodeStateAsUpdate(src);
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(false);
    expect(runtime.importLocalBackup(bin)).toBe(true);
    expect(d.getMap('nodes').get('n-imp')).toBeDefined();       // 已回灌
    expect(p.forceSync).toHaveBeenCalledTimes(1);                // SS2 差分上行
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(true);       // 显式置位（suppress-origin 下库不计数——显式标记兜住）
    expect(shouldWarnUnload()).toBe(true);
  });

  it('超上限（>maxDocBytes 同源判据）明示拒绝：不 apply 不 forceSync 返回 false——「该备份会使画布超过单文档上限」（merge 端点=Y5 必做；评估输入=Y.encodeStateAsUpdate(doc,sv) SV 分区公开 API）', async () => {
    const p = await driveToSynced();
    const d = runtime.getDoc()!;
    const big = new Uint8Array(QUOTA_DEFAULTS.maxDocBytes + 1);
    const nodesBefore = d.getMap('nodes').size;
    expect(runtime.importLocalBackup(big)).toBe(false);
    expect(d.getMap('nodes').size).toBe(nodesBefore);            // 未回灌
    expect(p.forceSync).not.toHaveBeenCalled();
  });
});

// ══════════ escapeWithLocalExport 重写（导出双产物+不自动 reload） ══════════
describe('Y0b-5 T6：escapeWithLocalExport 重写', () => {
  it('导出 .yjs 二进制（可回灌——hydration failed 时 store 为空=现导出空画布的根修）+doc 反投影 JSON（禁 store 投影）；导出后不自动 reload（reload=用户显式第二次动作）', async () => {
    await driveToSynced();
    localEdit(runtime.getDoc()!, Origin.LocalUser, 'n-esc');
    const blobs: Blob[] = [];
    stubBlobUrls(blobs);
    try {
      runtime.escapeWithLocalExport();
      expect(blobs).toHaveLength(2);
      expect(blobs[0].type).toBe('application/octet-stream');    // .yjs
      expect(blobs[1].type).toBe('application/json');            // doc 反投影
      expect(reloadSpy).not.toHaveBeenCalled();                  // 不自动 reload
    } finally { restoreBlobUrls(); }
  });
});
