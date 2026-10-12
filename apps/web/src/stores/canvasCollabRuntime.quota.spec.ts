// apps/web/src/stores/canvasCollabRuntime.quota.spec.ts
// Y0b-4 T5：doc-status reducer 单源——rev 单调守卫（电平非事件）+conn-status 单源 readOnly
// （authScope 仅初值）+quota 五键下行（Q-I 校准点）+writeFrozen 只置位+generation 代际（T11 消费）。
// Y0b-4 T11：close 4404/4410 终态 quota 独立通道+pendingGenerationReload 消费（clear+提示+reload）。
// mock 形态承 canvasCollabRuntime.t9.spec（库契约：provider 事件面——stateless/authenticated）。
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { message } from 'antd';
import { useCanvasStore } from './canvasStore';
import * as runtime from './canvasCollabRuntime';
import { getUndoManager } from './canvasUndo';
import { getCollabDiagCounters, _resetCollabDiagForTest } from '@/utils/collabDiagnostics';

// Y0b-5 T3：mock 收敛——唯一载体 @/test/fixtures/fakeHocuspocusProvider（裁定 24⑪⑤）。
vi.mock('@hocuspocus/provider', async () => {
  const { FakeHocuspocusProvider } = await import('@/test/fixtures/fakeHocuspocusProvider');
  return { HocuspocusProvider: FakeHocuspocusProvider };
});

const lastInstance = () => (HocuspocusProvider as any).instances.at(-1) as any;
const Mocks = HocuspocusProvider as any;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** 完整健康序到 synced（authenticated scope 可参化——connReadOnly 初值源） */
async function driveToSynced(scope: 'read-write' | 'readonly' = 'read-write', pid = 'p1') {
  const done = runtime.initCollab(pid);
  await tick();
  const p = lastInstance();
  p.emit('status', { status: 'connected' });
  p.isAuthenticated = true;
  p.emit('authenticated', { scope });
  p.isSynced = true;
  p.emit('synced', {});
  await done;
  return p;
}

/** doc-status 快照构造（quota 五键省缺时取基准值——rev/writeFrozen/quota.state 可覆写） */
function docStatus(over: Partial<{ rev: number; writeFrozen: boolean; state: 'over' | 'ok'; bytes: number; generation?: number; residueBytes?: number }>) {
  return JSON.stringify({
    type: 'doc-status',
    rev: over.rev ?? 1,
    writeFrozen: over.writeFrozen ?? false,
    ...(over.generation !== undefined ? { generation: over.generation } : {}),
    quota: {
      state: over.state ?? 'ok',
      bytes: over.bytes ?? 1234,
      limit: 8_388_608,
      maxTxBytes: 262_144,
      softLimitBytes: 6_710_886,
      ...(over.residueBytes !== undefined ? { residueBytes: over.residueBytes } : {}),
    },
  });
}
const connStatus = (readOnly: boolean) => JSON.stringify({ type: 'conn-status', readOnly });

const resetStore = () => useCanvasStore.setState({
  connStatus: 'connecting', nodes: [], edges: [], connUi: 'ok', hydration: 'idle',
  collabReadOnly: true, wsAuthNotice: null, writeFrozen: false, collabEscapePending: false,
  connReadOnly: false, quotaOver: false, quotaLimitBytes: 0, quotaTxBytes: 0,
  quotaSoftLimitBytes: 0, quotaResidueBytes: undefined, lastDocStatusRev: 0,
  localDocBytes: 0, localDelta: 0, pendingGenerationReload: 0, wsQuotaTerminal: null,
});

describe('Y0b-4 T5 doc-status reducer（rev 守卫+单源 readOnly）', () => {
  beforeEach(() => {
    Mocks.instances.length = 0;
    _resetCollabDiagForTest();
    resetStore();
  });
  afterEach(async () => {
    await runtime.destroyCollab();
    vi.restoreAllMocks();
  });

  it('reducer：rev>lastDocStatusRev 才消费——乱序/重复/迟到旧快照全免疫（电平非事件）', async () => {
    const p = await driveToSynced();
    p.emit('stateless', { payload: docStatus({ rev: 2, bytes: 2000 }) });
    expect(useCanvasStore.getState().lastDocStatusRev).toBe(2);
    expect(useCanvasStore.getState().localDocBytes).toBe(2000);
    p.emit('stateless', { payload: docStatus({ rev: 1, bytes: 999 }) });      // 迟到旧快照
    p.emit('stateless', { payload: docStatus({ rev: 2, bytes: 888 }) });      // 重复同 rev
    const s = useCanvasStore.getState();
    expect(s.lastDocStatusRev).toBe(2);
    expect(s.localDocBytes).toBe(2000);                                        // 两帧均被守卫丢弃
    p.emit('stateless', { payload: docStatus({ rev: 5, bytes: 5000 }) });     // 单调前进照常消费
    expect(useCanvasStore.getState().lastDocStatusRev).toBe(5);
    expect(useCanvasStore.getState().localDocBytes).toBe(5000);
  });

  it('authenticated 复位 lastDocStatusRev=0（doc 卸载重连 rev 从 1 重来——防旧值弃新快照，Q-A v3）', async () => {
    const p = await driveToSynced();
    p.emit('stateless', { payload: docStatus({ rev: 5 }) });
    expect(useCanvasStore.getState().lastDocStatusRev).toBe(5);
    p.emit('authenticated', { scope: 'read-write' });                          // 重连认证成功——rev 生命周期复位
    expect(useCanvasStore.getState().lastDocStatusRev).toBe(0);
    p.emit('stateless', { payload: docStatus({ rev: 1, bytes: 777 }) });      // 新 epoch rev 1 起步照常消费
    const s = useCanvasStore.getState();
    expect(s.lastDocStatusRev).toBe(1);
    expect(s.localDocBytes).toBe(777);
  });

  it('collabReadOnly=connReadOnly || quotaOver || writeFrozen（v5——conn-status 单源；反例：authScope 不参与判定；解冻快照不误解除 VIEWER 只读）', async () => {
    const p = await driveToSynced('read-write');                              // connReadOnly 初值=false（scope）
    expect(useCanvasStore.getState().collabReadOnly).toBe(false);
    p.emit('stateless', { payload: connStatus(true) });                       // 连接级真值翻只读（如降级 VIEWER）
    expect(useCanvasStore.getState().connReadOnly).toBe(true);
    expect(useCanvasStore.getState().collabReadOnly).toBe(true);
    // 反例断言：authScope（read-write）不得参与 doc-status 消费重算——若 scope 参与会把 collabReadOnly 误判 false
    p.emit('stateless', { payload: docStatus({ rev: 1, state: 'ok', writeFrozen: false }) });
    expect(useCanvasStore.getState().collabReadOnly).toBe(true);              // conn-status 单源保持只读（B-1 红相）
    // quotaOver 臂：connReadOnly=false+over 快照 → 只读
    p.emit('stateless', { payload: connStatus(false) });
    p.emit('stateless', { payload: docStatus({ rev: 2, state: 'over' }) });
    const s1 = useCanvasStore.getState();
    expect(s1.quotaOver).toBe(true);
    expect(s1.collabReadOnly).toBe(true);
    // 解冻快照（ok/writeFrozen:false）不会误解除 VIEWER 只读——connReadOnly 仍是权威分量
    p.emit('stateless', { payload: connStatus(true) });
    p.emit('stateless', { payload: docStatus({ rev: 3, state: 'ok', writeFrozen: false }) });
    expect(useCanvasStore.getState().collabReadOnly).toBe(true);
  });

  it('connReadOnly 初值=authenticated scope（首推前 VIEWER 不 fail-open）+doc-status 到达不翻写权限', async () => {
    const p = await driveToSynced('readonly');                                // VIEWER scope
    const s = useCanvasStore.getState();
    expect(s.connReadOnly).toBe(true);
    expect(s.collabReadOnly).toBe(true);                                      // 首推前即只读（不 fail-open）
    p.emit('stateless', { payload: docStatus({ rev: 1, state: 'ok', writeFrozen: false }) });
    expect(useCanvasStore.getState().collabReadOnly).toBe(true);              // ok 快照不解除 scope 只读
  });

  it('writeFrozen 只置位不复位（复位=重连 authenticated 链路）', async () => {
    const p = await driveToSynced();
    p.emit('stateless', { payload: docStatus({ rev: 1, writeFrozen: true }) });
    expect(useCanvasStore.getState().writeFrozen).toBe(true);
    p.emit('stateless', { payload: docStatus({ rev: 2, writeFrozen: false }) });   // 解冻经重连——快照不单侧清位
    expect(useCanvasStore.getState().writeFrozen).toBe(true);
    p.emit('authenticated', { scope: 'read-write' });                         // 重连认证成功=非 drain——复位链路
    expect(useCanvasStore.getState().writeFrozen).toBe(false);
  });

  it('quota.bytes 到达 → localDocBytes 覆盖+delta 清零（Q-I 校准点）+五键全落位+quotaResidueBytes 可选透传', async () => {
    const p = await driveToSynced();
    useCanvasStore.setState({ localDocBytes: 42, localDelta: 999 });          // 本地累计漂移形态
    p.emit('stateless', { payload: docStatus({ rev: 1, bytes: 65_536, residueBytes: 4096 }) });
    const s = useCanvasStore.getState();
    expect(s.localDocBytes).toBe(65_536);                                     // 权威覆盖（非累加）
    expect(s.localDelta).toBe(0);                                             // 校准点清零
    expect(s.quotaOver).toBe(false);
    expect(s.quotaLimitBytes).toBe(8_388_608);
    expect(s.quotaTxBytes).toBe(262_144);
    expect(s.quotaSoftLimitBytes).toBe(6_710_886);
    expect(s.quotaResidueBytes).toBe(4096);
    // over 快照 → quotaOver+write_reject diag（quota-soft）
    p.emit('stateless', { payload: docStatus({ rev: 2, state: 'over' }) });
    expect(useCanvasStore.getState().quotaOver).toBe(true);
    expect(getCollabDiagCounters().get('write_reject')).toBe(1);
  });

  it('conn-status 分支：{type:conn-status,readOnly} → connReadOnly 覆盖+collabReadOnly 重算', async () => {
    const p = await driveToSynced('read-write');
    p.emit('stateless', { payload: connStatus(true) });
    const s1 = useCanvasStore.getState();
    expect(s1.connReadOnly).toBe(true);
    expect(s1.collabReadOnly).toBe(true);
    // 重算消费既有 quotaOver——conn-status 解除不越权赦免 doc 级 over
    p.emit('stateless', { payload: docStatus({ rev: 1, state: 'over' }) });
    p.emit('stateless', { payload: connStatus(false) });
    const s2 = useCanvasStore.getState();
    expect(s2.connReadOnly).toBe(false);
    expect(s2.collabReadOnly).toBe(true);                                     // quotaOver 分量保持
  });

  it('generation 跳变 → pendingGenerationReload 置位（T11 消费——vacuum 代际）；同代重复不重置', async () => {
    const p = await driveToSynced();
    p.emit('stateless', { payload: docStatus({ rev: 1, generation: 5 }) });
    expect(useCanvasStore.getState().pendingGenerationReload).toBe(5);
    p.emit('stateless', { payload: docStatus({ rev: 2, generation: 5 }) });   // 同代新快照——非跳变
    expect(useCanvasStore.getState().pendingGenerationReload).toBe(5);
    p.emit('stateless', { payload: docStatus({ rev: 3, generation: 9 }) });   // 跳变
    expect(useCanvasStore.getState().pendingGenerationReload).toBe(9);
  });

  it('通用 stateless 通道容错：坏 JSON/未知 type 静默忽略不抛（write-frozen 退役后仅 conn-status/doc-status 两型）', async () => {
    const p = await driveToSynced();
    expect(() => p.emit('stateless', { payload: 'not-json{{' })).not.toThrow();
    p.emit('stateless', { payload: JSON.stringify({ type: 'persist-status', healthy: false }) });   // 既有通告通道照旧透传不消费
    p.emit('stateless', { payload: JSON.stringify({ type: 'doc-status', rev: 'x' }) });             // 形状不符=拒
    const s = useCanvasStore.getState();
    expect(s.lastDocStatusRev).toBe(0);
    expect(s.quotaOver).toBe(false);
  });
});

// ════════ Y0b-4 T11：4404/4410 终态档（独立 quota 通道）+pendingGenerationReload 消费 ════════
// fake timers 形态承 t9.spec beginCollabFake（reload 1.5s 定时器推进断言）。
describe('Y0b-4 T11：close 终态 quota 通道+代际跳变消费', () => {
  const reloadSpy = vi.fn();
  let warnSpy: MockInstance<typeof message.warning>;   // 仓内惯例（canvasStore.async-landing.spec 先例）

  beforeEach(() => {
    vi.useFakeTimers();
    Mocks.instances.length = 0;
    _resetCollabDiagForTest();
    resetStore();
    sessionStorage.clear();
    reloadSpy.mockClear();
    vi.stubGlobal('location', { reload: reloadSpy });
    warnSpy = vi.spyOn(message, 'warning');
  });
  afterEach(async () => {
    await runtime.destroyCollab();   // fake interval 清理须在 useRealTimers 前
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function driveToSyncedFake(pid = 'p1') {
    const done = runtime.initCollab(pid);
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

  it('close 4404（doc-over-quota）→wsQuotaTerminal 独立通道（wsAuthNotice 不染——auth 词表钉死）+真停连+无自动 reload', async () => {
    const p = await driveToSyncedFake();
    const wsConnect = vi.spyOn(p.configuration.websocketProvider, 'connect');
    p.emit('close', { event: { code: 4404, reason: 'doc-over-quota' } });
    expect(useCanvasStore.getState().wsQuotaTerminal).toEqual({ code: 4404, reason: 'doc-over-quota' });
    expect(useCanvasStore.getState().wsAuthNotice).toBeNull();                  // 不进 auth reason 词表（plan 钉死）
    expect(p.configuration.websocketProvider.shouldConnect).toBe(false);       // 真开关（terminal 同款停连）
    await vi.advanceTimersByTimeAsync(3_000);
    expect(wsConnect).not.toHaveBeenCalled();                                  // 终态后零重连
    expect(reloadSpy).not.toHaveBeenCalled();                                  // 4404 无自动 reload——手动「重新连接」唯一复位
  });

  it('close (1000, doc-over-quota) 库抹码兜底→同 quota 终态通道（双键分型先于 NORMAL）', async () => {
    const p = await driveToSyncedFake();
    p.emit('close', { event: { code: 1000, reason: 'doc-over-quota' } });
    expect(useCanvasStore.getState().wsQuotaTerminal).toEqual({ code: 4404, reason: 'doc-over-quota' });
    expect(p.configuration.websocketProvider.shouldConnect).toBe(false);
  });

  it('close 4410 doc-vacuuming→wsQuotaTerminal+「正在重建画布历史」提示+1.5s 自动 reload', async () => {
    const p = await driveToSyncedFake();
    p.emit('close', { event: { code: 4410, reason: 'doc-vacuuming' } });
    expect(useCanvasStore.getState().wsQuotaTerminal).toEqual({ code: 4410, reason: 'doc-vacuuming' });
    expect(useCanvasStore.getState().wsAuthNotice).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith('正在重建画布历史，即将自动刷新');
    expect(reloadSpy).not.toHaveBeenCalled();                    // 1.5s 延时——让用户看到提示
    await vi.advanceTimersByTimeAsync(1_500);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('close 4410 doc-generation-stale→同横幅+自动 reload（reload 后空 SV 放行=不循环）', async () => {
    const p = await driveToSyncedFake();
    p.emit('close', { event: { code: 4410, reason: 'doc-generation-stale' } });
    expect(useCanvasStore.getState().wsQuotaTerminal).toEqual({ code: 4410, reason: 'doc-generation-stale' });
    expect(warnSpy).toHaveBeenCalledWith('正在重建画布历史，即将自动刷新');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('pendingGenerationReload 消费：generation 跳变→undoManager.clear+提示+reload；基线（首见代）不触发（防循环）', async () => {
    const p = await driveToSyncedFake();
    const um = getUndoManager();
    expect(um).toBeTruthy();                                     // initCollab 已 attach（attachUndoManager）
    const clearSpy = vi.spyOn(um!, 'clear');
    p.emit('stateless', { payload: docStatus({ rev: 1, generation: 5 }) });   // 基线建立
    expect(useCanvasStore.getState().pendingGenerationReload).toBe(5);        // T5 字段照旧（信息位）
    await vi.advanceTimersByTimeAsync(2_000);
    expect(clearSpy).not.toHaveBeenCalled();                     // 首见代≠跳变——reload 循环防线
    expect(reloadSpy).not.toHaveBeenCalled();
    p.emit('stateless', { payload: docStatus({ rev: 2, generation: 9 }) });   // 真跳变（vacuum 代际）
    expect(useCanvasStore.getState().pendingGenerationReload).toBe(9);
    expect(clearSpy).toHaveBeenCalledTimes(1);                    // 撤销栈锚代际失效——清（reload 后重建）
    expect(warnSpy).toHaveBeenCalledWith('正在重建画布历史，即将自动刷新');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('会话起点复位：上一会话 quota 终态不跨会话（initCollab 同 wsAuthNotice 形态清）', async () => {
    useCanvasStore.setState({ wsQuotaTerminal: { code: 4404, reason: 'doc-over-quota' } });
    await driveToSyncedFake('p2');
    expect(useCanvasStore.getState().wsQuotaTerminal).toBeNull();
  });
});
