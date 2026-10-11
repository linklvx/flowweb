// apps/web/src/stores/canvasCollabRuntime.quota.spec.ts
// Y0b-4 T5：doc-status reducer 单源——rev 单调守卫（电平非事件）+conn-status 单源 readOnly
// （authScope 仅初值）+quota 五键下行（Q-I 校准点）+writeFrozen 只置位+generation 代际（T11 消费）。
// mock 形态承 canvasCollabRuntime.t9.spec（库契约：provider 事件面——stateless/authenticated）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useCanvasStore } from './canvasStore';
import * as runtime from './canvasCollabRuntime';
import { getCollabDiagCounters, _resetCollabDiagForTest } from '@/utils/collabDiagnostics';

vi.mock('@hocuspocus/provider', () => {
  class MockProvider {
    static instances: MockProvider[] = [];
    isAuthenticated = false;
    isSynced = false;
    isAttached = true;
    unsyncedChanges = 0;
    destroyCalls = 0;
    handlers: Record<string, Array<(payload: any) => void>> = {};
    configuration: any;
    awareness: any;
    constructor(cfg: any = {}) {
      MockProvider.instances.push(this);
      const clientId = cfg?.document?.clientID ?? 0;
      this.awareness = {
        clientID: clientId,
        meta: new Map(),
        localState: null as any,
        setLocalState: vi.fn((s: any) => { this.awareness.localState = s; }),
        getLocalState: () => this.awareness.localState,
      };
      this.configuration = {
        websocketProvider: { shouldConnect: true, connect: vi.fn(), disconnect: vi.fn(() => { this.configuration.websocketProvider.shouldConnect = false; }) },
      };
    }
    get hasUnsyncedChanges() { return this.unsyncedChanges > 0; }
    on(event: string, cb: (payload: any) => void) { (this.handlers[event] ??= []).push(cb); }
    off(event: string, cb: (payload: any) => void) {
      const arr = this.handlers[event];
      if (!arr) return;
      const i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    }
    emit(event: string, payload: any) { for (const cb of [...this.handlers[event] ?? []]) cb(payload); }
    async destroy() { this.destroyCalls++; this.handlers = {}; }
  }
  return { HocuspocusProvider: MockProvider };
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
  localDocBytes: 0, localDelta: 0, pendingGenerationReload: 0,
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
