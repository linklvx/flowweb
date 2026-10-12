// apps/web/src/stores/canvasCollabRuntime.t7.spec.ts
// Y0b-5 T7：E40 分叉自检——unsyncedDirty 在五合取健康态（connected∧!writeFrozen∧!quotaOver
// ∧!collabReadOnly∧dirty）下持续>60s → syncLagOver60s=true（SyncBanner syncLag 档电平——
// T6 单链已接文案位）+ws_status{reason:'unsynced-lag'}上沿一次遥测；瞬态/只读期不计窗
//（误诊防线：服务端对拒帧回 SyncStatus(false) 被静默丢弃——unsyncedDirty 永不归零，缺
// collabReadOnly 判据=把"服务端拒绝"误诊为"同步慢"）；条件失效横幅自动消。
// 装置承 t6 spec：fakeHocuspocusProvider 唯一载体+真 Y.Doc+fake timers。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useCanvasStore } from './canvasStore';
import * as runtime from './canvasCollabRuntime';
import { Origin } from './canvasUndo';
import { getRecentCollabDiag, _resetCollabDiagForTest } from '@/utils/collabDiagnostics';
import { _resetUnloadGuardForTest } from '@/utils/unloadGuard';

vi.mock('@hocuspocus/provider', async () => {
  const { FakeHocuspocusProvider } = await import('@/test/fixtures/fakeHocuspocusProvider');
  return { HocuspocusProvider: FakeHocuspocusProvider };
});

const lastInstance = () => (HocuspocusProvider as any).instances.at(-1) as any;

const resetStore = () => useCanvasStore.setState({
  connStatus: 'connecting', nodes: [], edges: [], connUi: 'ok', hydration: 'idle',
  collabReadOnly: true, wsAuthNotice: null, writeFrozen: false, collabEscapePending: false,
  connReadOnly: false, quotaOver: false, quotaLimitBytes: 0, quotaTxBytes: 0,
  quotaSoftLimitBytes: 0, quotaResidueBytes: undefined, lastDocStatusRev: 0,
  localDocBytes: 0, localDelta: 0, pendingGenerationReload: 0, wsQuotaTerminal: null,
  canvasDiverged: false, canvasOversized: false, canvasDegraded: false,
  persistUnhealthy: false, syncLagOver60s: false,
});

/** 本地编辑（origin=LocalUser——T6 单源置位路径；markDocUnsyncedDirty 同点记 dirty 起点时刻） */
function localEdit(d: Y.Doc, key = 'n-t7'): void {
  d.transact(() => { d.getMap('nodes').set(key, new Y.Map([['id', key]])); }, Origin.LocalUser);
}

/** 遥测计数（ring 面——ws_status{reason:'unsynced-lag'} 上沿次数断言） */
const unsyncedLagEvents = () => getRecentCollabDiag()
  .filter((e) => e.type === 'ws_status' && (e.detail as Record<string, unknown> | undefined)?.reason === 'unsynced-lag');

/** t6 driveToSynced + 'message' 入站（inboundAttemptId 代际确认——connStatus 唯一写点判
 *  'connected'，五合取第①项就位；t6 spec 无 message 事件故 connStatus 停在 connecting） */
async function driveToSynced(pid = 'p-t7') {
  const done = runtime.initCollab(pid);
  await vi.advanceTimersByTimeAsync(0);
  const p = lastInstance();
  p.emit('status', { status: 'connected' });
  p.isAuthenticated = true;
  p.emit('authenticated', { scope: 'read-write' });
  p.isSynced = true;
  p.emit('synced', {});
  p.emit('message', {});
  await done;
  return p;
}

beforeEach(() => {
  vi.useFakeTimers();
  (HocuspocusProvider as any).instances.length = 0;
  _resetCollabDiagForTest();
  _resetUnloadGuardForTest();
  resetStore();
});

afterEach(async () => {
  await runtime.destroyCollab();
  vi.useRealTimers();
});

describe('Y0b-5 T7：E40 60s 同步延迟窗（五合取）', () => {
  it('unsyncedDirty>60s ∧ connStatus=connected ∧ !writeFrozen ∧ !quotaOver ∧ !collabReadOnly →syncLagOver60s=true+ws_status{reason:"unsynced-lag"}上沿一次（禁 5s 重复发）', async () => {
    const p = await driveToSynced();
    const d = runtime.getDoc()!;
    expect(useCanvasStore.getState().connStatus).toBe('connected');   // 五合取第①项前提就位
    localEdit(d);
    p.unsyncedChanges = 1;   // 库计数面：编辑未确认（3s tick 双条件不满足——dirty 持续）
    await vi.advanceTimersByTimeAsync(59_000);
    expect(useCanvasStore.getState().syncLagOver60s).toBe(false);      // 60s 窗未满
    await vi.advanceTimersByTimeAsync(2_000);                          // 满窗上沿（tick 落 60s 整点）
    expect(useCanvasStore.getState().syncLagOver60s).toBe(true);
    expect(unsyncedLagEvents()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);                         // 横幅期持续 dirty——遥测不重复（电平非事件）
    expect(unsyncedLagEvents()).toHaveLength(1);
    expect(useCanvasStore.getState().syncLagOver60s).toBe(true);
  });

  it('★collabReadOnly 反向（裁定 23⑩）：viewer/spool 连接级 readOnly 不在 writeFrozen/quotaOver 两字段——缺此判据=把"服务端拒绝"误诊为"同步慢"（拒帧回 SyncStatus(false) 静默丢弃、unsyncedDirty 永不归零）→横幅不出现+零遥测', async () => {
    const p = await driveToSynced();
    const d = runtime.getDoc()!;
    useCanvasStore.setState({ collabReadOnly: true });
    localEdit(d);
    p.unsyncedChanges = 1;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(useCanvasStore.getState().syncLagOver60s).toBe(false);
    expect(unsyncedLagEvents()).toHaveLength(0);
  });

  it('瞬态冻结（writeFrozen）/quota readOnly 期间抑制（N3 粘滞反向——横幅不出现）；解除后重新起算', async () => {
    const p = await driveToSynced();
    const d = runtime.getDoc()!;
    localEdit(d);
    p.unsyncedChanges = 1;
    useCanvasStore.setState({ writeFrozen: true });
    await vi.advanceTimersByTimeAsync(120_000);                        // 冻结期全程不计窗
    expect(useCanvasStore.getState().syncLagOver60s).toBe(false);
    expect(unsyncedLagEvents()).toHaveLength(0);
    useCanvasStore.setState({ writeFrozen: false });                   // 解除——重新起算
    await vi.advanceTimersByTimeAsync(55_000);
    expect(useCanvasStore.getState().syncLagOver60s).toBe(false);      // 55s<60s
    await vi.advanceTimersByTimeAsync(10_000);
    expect(useCanvasStore.getState().syncLagOver60s).toBe(true);       // 满窗
    expect(unsyncedLagEvents()).toHaveLength(1);
    useCanvasStore.setState({ quotaOver: true });                      // quota readOnly——条件失效横幅自动消
    await vi.advanceTimersByTimeAsync(5_000);
    expect(useCanvasStore.getState().syncLagOver60s).toBe(false);
    useCanvasStore.setState({ quotaOver: false });
    await vi.advanceTimersByTimeAsync(65_000);                         // 再满窗——第二次上沿
    expect(useCanvasStore.getState().syncLagOver60s).toBe(true);
    expect(unsyncedLagEvents()).toHaveLength(2);
  });

  it('连接不健康不计窗（断线期不算 60s——恢复重新起算）；dirty 归零（编辑被服务端接受）横幅自动消', async () => {
    const p = await driveToSynced();
    const d = runtime.getDoc()!;
    localEdit(d);
    p.unsyncedChanges = 1;
    useCanvasStore.setState({ connStatus: 'offline' });
    await vi.advanceTimersByTimeAsync(120_000);                        // 断线 120s——全程不计窗
    expect(useCanvasStore.getState().syncLagOver60s).toBe(false);
    expect(unsyncedLagEvents()).toHaveLength(0);
    useCanvasStore.setState({ connStatus: 'connected' });              // 恢复——从恢复重新起算
    await vi.advanceTimersByTimeAsync(55_000);
    expect(useCanvasStore.getState().syncLagOver60s).toBe(false);      // 55s<60s（断线期 120s 不累计）
    await vi.advanceTimersByTimeAsync(10_000);
    expect(useCanvasStore.getState().syncLagOver60s).toBe(true);
    p.unsyncedChanges = 0;                                             // 确认帧归零——3s tick 清 dirty
    await vi.advanceTimersByTimeAsync(3_000 + 5_000);
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(false);
    expect(useCanvasStore.getState().syncLagOver60s).toBe(false);      // 条件失效横幅自动消
  });
});
