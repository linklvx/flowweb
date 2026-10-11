// apps/web/src/stores/canvasIntents.quota.spec.ts
// Y0b-4 T9a Step 3（4a 出口 D-14）：canApplyIntent 判据①-③ + runCommand precheck 骨架。
// Y0b-4 T10 扩：判据④（快照+delta 插值+软限）+ dispatch 兜底 + 漂移实测双路径 + redo precheck
// ——④插值/漂移用例走 runtime 集成（rich provider mock + initCollab：插值器生产挂载点）。
// 装置：纯函数直测 + store 直构（openRwWindow 同 canvasIntents.spec.ts——canEdit 真窗口；
// 无 doc 时 dispatchProjectionDiff 零 intents 早退，runCommand 照旧路径零副作用）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// canvasIntents→canvasCollabRuntime 顶层 import HocuspocusProvider——rich mock（承 canvasCollabRuntime.quota.spec：
// ④插值/漂移用例需 initCollab 真 doc——空 mock 不够）
vi.mock('@hocuspocus/provider', () => {
  class MockProvider {
    static instances: MockProvider[] = [];
    isAuthenticated = false;
    isSynced = false;
    isAttached = true;
    unsyncedChanges = 0;
    handlers: Record<string, Array<(payload: any) => void>> = {};
    configuration: any;
    awareness: any;
    constructor(cfg: any = {}) {
      MockProvider.instances.push(this);
      this.awareness = {
        clientID: cfg?.document?.clientID ?? 0,
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
    async destroy() { this.handlers = {}; }
  }
  return { HocuspocusProvider: MockProvider };
});
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import type { DocNodeRecord } from '@flowweb/shared';
import { QUOTA_DEFAULTS, utf8Bytes } from '@flowweb/shared';
import { message } from 'antd';
import { useCanvasStore } from './canvasStore';
import * as runtime from './canvasCollabRuntime';
import { getDoc } from './canvasCollabRuntime';
import { canApplyIntent, dispatchCanvasIntent, _setIntentDocForTest, type CanvasIntent } from './canvasIntents';
import { undoCanvas, redoCanvas, getUndoManager, Origin } from './canvasUndo';
import { getRecentCollabDiag, _resetCollabDiagForTest } from '@/utils/collabDiagnostics';

vi.mock('@/api/videoProjectApi', () => ({ deleteProjectByNode: vi.fn().mockResolvedValue(undefined) }));

const rec = (id: string, data: Record<string, unknown> = { content: 'hi' }): DocNodeRecord => ({
  id, type: 'textInput', data,
});

/** canEdit 真（hydration ready + 非 readOnly + 无 terminal）——runCommand canEdit 门放行；
 *  T10 扩：quota 字段族同点复位（跨用例污染免疫——④消费 store 字段） */
function openRwWindow() {
  useCanvasStore.setState({
    nodes: [], edges: [], hydration: 'ready', collabReadOnly: false, wsAuthNotice: null, projectId: 'p1',
    localDocBytes: 0, localDelta: 0, quotaSoftLimitBytes: 0, quotaTxBytes: 0,
  });
}

// ── runtime 集成装置（canvasCollabRuntime.quota.spec 同款）──
const lastInstance = () => (HocuspocusProvider as any).instances.at(-1) as any;
const Mocks = HocuspocusProvider as any;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

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

function docStatus(o: Partial<{ rev: number; writeFrozen: boolean; state: 'over' | 'ok'; bytes: number; softLimitBytes: number; generation?: number; residueBytes?: number }>) {
  return JSON.stringify({
    type: 'doc-status',
    rev: o.rev ?? 1,
    writeFrozen: o.writeFrozen ?? false,
    ...(o.generation !== undefined ? { generation: o.generation } : {}),
    quota: {
      state: o.state ?? 'ok',
      bytes: o.bytes ?? 1234,
      limit: 8_388_608,
      maxTxBytes: 262_144,
      softLimitBytes: o.softLimitBytes ?? 6_710_886,
      ...(o.residueBytes !== undefined ? { residueBytes: o.residueBytes } : {}),
    },
  });
}

/** requestIdleCallback 测试 stub（jsdom 无——捕获回调手动触发） */
let idleCbs: Array<() => void> = [];
function stubIdle() {
  idleCbs = [];
  vi.stubGlobal('requestIdleCallback', (cb: () => void) => { idleCbs.push(cb); return idleCbs.length; });
}
function fireIdle() { const cbs = idleCbs; idleCbs = []; for (const cb of cbs) cb(); }

/** 远端写入帧构造（模拟 B 不知情的对端写入——单 transact 单 update） */
function remoteUpdate(totalBytes: number, prefix = 'r'): Uint8Array {
  const rd = new Y.Doc();
  const content = 'x'.repeat(10_000);
  const n = Math.ceil(totalBytes / (content.length + 120));
  rd.transact(() => {
    for (let i = 0; i < n; i++) {
      rd.getMap('nodes').set(`${prefix}${i}`, new Y.Map([
        ['type', 'textInput'], ['data', new Y.Map([['content', content]])],
      ]));
    }
  }, 'remote-peer');
  return Y.encodeStateAsUpdate(rd);
}

describe('Y0b-4 T9a D-14：canApplyIntent 判据①-③（Q-I 前三判据——④插值器归 T10）', () => {
  beforeEach(() => {
    openRwWindow();
    _resetCollabDiagForTest();
  });

  it('①key-too-large 先判（中文 utf8 3× 量纲）：单键超 256KB 拒——嵌套 data 字段递归命中且先于②', () => {
    // 中文 3B/字（.length===1 的量纲分歧核心）：构造超 maxKeyBytes 的单串
    const zhChars = Math.ceil((QUOTA_DEFAULTS.maxKeyBytes + 1) / 3) + 1;
    const big = '中'.repeat(zhChars);
    expect(utf8Bytes(big)).toBeGreaterThan(QUOTA_DEFAULTS.maxKeyBytes);
    expect(big.length).toBeLessThan(utf8Bytes(big)); // 量纲分歧锚：码元数 < 字节数
    // 嵌套 data 字段（updateNodeData.patch.content）——iterStringValues 递归命中
    const intent: CanvasIntent = { type: 'updateNodeData', id: 'n1', patch: { content: big } };
    // ①先于②：该 intent 整体 JSON 同样超 tx 限（超 tx 的单串必超 key 限——①⊆②包含关系），
    // 期望抢答 reason=key-too-large 而非 tx-too-large
    expect(utf8Bytes(JSON.stringify(intent))).toBeGreaterThan(QUOTA_DEFAULTS.maxTxBytes);
    expect(canApplyIntent([intent])).toEqual({ ok: false, reason: 'key-too-large' });
    // addNode.node.data 嵌套形态同构命中
    expect(canApplyIntent([{ type: 'addNode', node: rec('n2', { content: big }) }]))
      .toEqual({ ok: false, reason: 'key-too-large' });
  });

  it('②tx-too-large（Σ utf8Bytes(JSON) 超 256KB）——单键均低于①限+①⊆②量纲关系锚', () => {
    // ASCII 1B/字：单键 90KB < maxKeyBytes(256KB)——①不触发；3 个累计 >270KB 超 maxTxBytes
    const mid = 'a'.repeat(90_000);
    expect(utf8Bytes(mid)).toBeLessThan(QUOTA_DEFAULTS.maxKeyBytes);
    const intents: CanvasIntent[] = [0, 1, 2].map((k) => ({
      type: 'addNode', node: rec(`n${k}`, { content: mid }),
    }));
    const txBytes = intents.reduce((n, i) => n + utf8Bytes(JSON.stringify(i)), 0);
    expect(txBytes).toBeGreaterThan(QUOTA_DEFAULTS.maxTxBytes);
    expect(canApplyIntent(intents)).toEqual({ ok: false, reason: 'tx-too-large' });
    // ①⊆② 子集关系注释锚（QUOTA_DEFAULTS 锁定）：maxKeyBytes ≤ maxTxBytes ⇒ 任一单串超 tx 限
    // 必已超 key 限 ⇒ ①先判抢答——②只在"多键累计"形态独立触发（①判存在的理由）
    expect(QUOTA_DEFAULTS.maxKeyBytes).toBeLessThanOrEqual(QUOTA_DEFAULTS.maxTxBytes);
  });

  it('③too-many-nodes（addNode > 2000）——最小形态 tx 字节低于②限防抢答', () => {
    const many: CanvasIntent[] = Array.from({ length: QUOTA_DEFAULTS.maxNodesPerTx + 1 }, (_, i) => ({
      type: 'addNode', node: rec(`n${i}`, {}),
    }));
    // 前提锚：①②均不触发（最小 addNode 形态累计 ~140KB < 256KB）——③独立命中
    const txBytes = many.reduce((n, i) => n + utf8Bytes(JSON.stringify(i)), 0);
    expect(txBytes).toBeLessThanOrEqual(QUOTA_DEFAULTS.maxTxBytes);
    expect(canApplyIntent(many)).toEqual({ ok: false, reason: 'too-many-nodes' });
  });

  it('runCommand precheck 拒=fn 零调用+write_reject diag 记录；无 precheck/ok:true 照旧调用', () => {
    // 拒路径：canEdit 真（前置锚）→ precheck 拒 → fn 零调用 + diag 末条 write_reject
    expect(useCanvasStore.getState().hydration).toBe('ready');
    const fn = vi.fn();
    useCanvasStore.getState().runCommand(fn, () => ({ ok: false, reason: 'tx-too-large' }));
    expect(fn).not.toHaveBeenCalled();
    const diag = getRecentCollabDiag();
    expect(diag[diag.length - 1]?.type).toBe('write_reject');
    expect(diag[diag.length - 1]?.detail).toEqual({ reason: 'tx-too-large' });
    // 无 precheck 照旧（既有调用方零迁移——可选参数不破坏）
    const fn2 = vi.fn();
    useCanvasStore.getState().runCommand(fn2);
    expect(fn2).toHaveBeenCalledTimes(1);
    // precheck ok:true 放行
    const fn3 = vi.fn();
    useCanvasStore.getState().runCommand(fn3, () => ({ ok: true }));
    expect(fn3).toHaveBeenCalledTimes(1);
  });

  it('全部通过=ok（混合类型小集合 + ③边界：恰 2000 addNode 不拒——`>` 才拒）', () => {
    const mixed: CanvasIntent[] = [
      { type: 'addNode', node: rec('n1') },
      { type: 'updateNodeData', id: 'n1', patch: { content: 'x' } },
      { type: 'moveNode', id: 'n1', position: { x: 1, y: 2 } },
      { type: 'updateNodeEnvelope', id: 'n1', patch: { width: 100 } },
      { type: 'upsertEdge', edge: { id: 'e1', source: 'n1', target: 'n2' } },
      { type: 'deleteNode', id: 'n2' },
      { type: 'deleteEdge', id: 'e1' },
    ];
    expect(canApplyIntent(mixed)).toEqual({ ok: true });
    // ③边界锚：恰好 maxNodesPerTx 个 addNode 放行（tx ~130KB < 256KB 前提同③用例）
    const exactly: CanvasIntent[] = Array.from({ length: QUOTA_DEFAULTS.maxNodesPerTx }, (_, i) => ({
      type: 'addNode', node: rec(`n${i}`, {}),
    }));
    expect(canApplyIntent(exactly)).toEqual({ ok: true });
    // it.todo('④（T10）：快照+delta 插值+软限滞回判定——插值器归 T10 后补全量+分块粘贴')
  });
});

describe('Y0b-4 T10：canApplyIntent 判据④（Q-I v5——快照+delta 插值+软限）', () => {
  beforeEach(() => {
    openRwWindow();
    _resetCollabDiagForTest();
  });
  afterEach(() => {
    _setIntentDocForTest(null);
    vi.restoreAllMocks();
  });

  it('顺序：④最后——key-too-large→tx-too-large→too-many-nodes 先判（④并存形态抢答验证）', () => {
    useCanvasStore.setState({ localDocBytes: 7_000_000 });   // ④ 同时会拒的并存形态
    // ①抢答（单串 300KB 超 maxKeyBytes；整 tx 也超——①⊆②先报）
    expect(canApplyIntent([{ type: 'updateNodeData', id: 'n1', patch: { content: 'z'.repeat(300_000) } }]))
      .toEqual({ ok: false, reason: 'key-too-large' });
    // ②抢答（Σ 270KB > 256KB；单键 90KB 均 < 256KB——①不触发）
    const mid = 'a'.repeat(90_000);
    const txIntents: CanvasIntent[] = [0, 1, 2].map((k) => ({ type: 'addNode', node: rec(`n${k}`, { content: mid }) }));
    expect(canApplyIntent(txIntents)).toEqual({ ok: false, reason: 'tx-too-large' });
    // ③抢答（2001 addNode，最小形态 tx ~140KB < 256KB——②不触发）
    const many: CanvasIntent[] = Array.from({ length: QUOTA_DEFAULTS.maxNodesPerTx + 1 }, (_, i) => ({
      type: 'addNode', node: rec(`m${i}`, {}),
    }));
    expect(canApplyIntent(many)).toEqual({ ok: false, reason: 'too-many-nodes' });
  });

  it('④独立命中：localDocBytes+localDelta+txBytes > softLimit → doc-over-budget（缺省回退=6.7MB 软阈；服务端下发软阈同尺）', () => {
    // 缺省回退（quotaSoftLimitBytes=0）：Math.floor(8MB×0.8)=6,710,886——禁回退硬限（恒 undefined⇒NaN 恒 false=gate 失效）
    useCanvasStore.setState({ localDocBytes: 6_500_000, localDelta: 250_000 });
    expect(canApplyIntent([{ type: 'addNode', node: rec('n1') }]))
      .toEqual({ ok: false, reason: 'doc-over-budget' });   // 6.5M+0.25M+ε > 6.71M
    // 服务端下发软阈口径（快照五键——客户端可用上限=软阈，文案与拦截点一致）
    useCanvasStore.setState({ localDocBytes: 0, localDelta: 0, quotaSoftLimitBytes: 10 });
    expect(canApplyIntent([{ type: 'addNode', node: rec('n2') }]))
      .toEqual({ ok: false, reason: 'doc-over-budget' });   // tx ~60B > 10B 软阈
    // 边界内放行锚：远低于软阈
    useCanvasStore.setState({ localDocBytes: 1_000, localDelta: 500, quotaSoftLimitBytes: 0 });
    expect(canApplyIntent([{ type: 'addNode', node: rec('n3') }])).toEqual({ ok: true });
  });

  it('拒=store 与 doc 双不变（runCommand precheck 先于 captureStoreProjection）+diag 恰一次+toast', () => {
    const doc = new Y.Doc();
    _setIntentDocForTest(doc);
    useCanvasStore.setState({ localDocBytes: 7_000_000 });
    const beforeStoreNodes = useCanvasStore.getState().nodes;
    const beforeDoc = Y.encodeStateAsUpdate(doc);
    const fn = vi.fn();
    const warn = vi.spyOn(message, 'warning');
    useCanvasStore.getState().runCommand(fn, () => canApplyIntent([{ type: 'addNode', node: rec('n1') }]));
    expect(fn).not.toHaveBeenCalled();                                 // fn 零调用=store 零污染
    expect(useCanvasStore.getState().nodes).toBe(beforeStoreNodes);    // 引用不变
    expect(Y.encodeStateAsUpdate(doc)).toEqual(beforeDoc);             // doc 双不变
    const rejects = getRecentCollabDiag().filter((e) => e.type === 'write_reject');
    expect(rejects).toHaveLength(1);                                   // diag 恰一次
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('画布已达容量上限（约 6.4MB），请瘦身或删除内容');   // 缺省回退 6710886/1048576=6.4（1024 基——动态容量文案）
  });

  it('dispatch 兜底断言：canApplyIntent 拒 ⇒ diag via:dispatch-fallback+doc/store 双零写（触发=seam 前置设计漏洞）', () => {
    const doc = new Y.Doc();
    _setIntentDocForTest(doc);
    const beforeStoreNodes = useCanvasStore.getState().nodes;
    const mid = 'a'.repeat(90_000);
    const intents: CanvasIntent[] = [0, 1, 2].map((k) => ({ type: 'addNode', node: rec(`n${k}`, { content: mid }) }));
    dispatchCanvasIntent(intents, Origin.LocalUser);
    expect(doc.getMap('nodes').size).toBe(0);                          // doc 零写
    expect(useCanvasStore.getState().nodes).toBe(beforeStoreNodes);    // store 零写（投影未达）
    const diag = getRecentCollabDiag();
    expect(diag[diag.length - 1]).toMatchObject({
      type: 'write_reject',
      detail: { reason: 'tx-too-large', via: 'dispatch-fallback' },
    });
  });
});

describe('Y0b-4 T10：判据④插值+漂移实测双路径（runtime 集成——插值器生产挂载）', () => {
  beforeEach(() => {
    Mocks.instances.length = 0;
    _resetCollabDiagForTest();
    useCanvasStore.setState({
      nodes: [], edges: [], connStatus: 'connecting', connUi: 'ok', hydration: 'idle',
      collabReadOnly: true, wsAuthNotice: null, writeFrozen: false, collabEscapePending: false,
      connReadOnly: false, quotaOver: false, quotaLimitBytes: 0, quotaTxBytes: 0,
      quotaSoftLimitBytes: 0, quotaResidueBytes: undefined, lastDocStatusRev: 0,
      localDocBytes: 0, localDelta: 0, pendingGenerationReload: 0, projectId: 'p1',
    });
  });
  afterEach(async () => {
    await runtime.destroyCollab();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('判据④插值：远端写入（B 不知情）经 doc.on(update) 全 origin 计入 localDelta → B 侧也拒（v1 serverWatermark 双口径红相）', async () => {
    const p = await driveToSynced();
    p.emit('stateless', { payload: docStatus({ rev: 1, bytes: 6_500_000, softLimitBytes: 6_710_886 }) });
    const d = getDoc()!;
    Y.applyUpdate(d, remoteUpdate(300 * 1024), 'remote-peer');
    expect(useCanvasStore.getState().localDelta).toBeGreaterThan(200_000);   // 远端帧计入（全 origin）
    expect(canApplyIntent([{ type: 'updateNodeData', id: 'n1', patch: { content: 'x' } }]))
      .toEqual({ ok: false, reason: 'doc-over-budget' });   // 6.5M+~0.3M+ε > 6.71M——B 侧快照不知情也拒
  });

  it('漂移实测·常规路径：localDelta>1MB 调度 requestIdleCallback({timeout:2000})（单飞）——触发前不校准，触发后实测覆盖+delta 清零', async () => {
    stubIdle();
    await driveToSynced();
    const d = getDoc()!;
    Y.applyUpdate(d, remoteUpdate(1.2 * 1024 * 1024), 'remote-peer');
    const deltaAfter = useCanvasStore.getState().localDelta;
    expect(deltaAfter).toBeGreaterThan(1_048_576);          // >1MB 阈值锚
    expect(idleCbs.length).toBe(1);                         // 调度恰一次
    Y.applyUpdate(d, remoteUpdate(50 * 1024, 'q'), 'remote-peer');   // 在途窗再累计——单飞不重入
    expect(idleCbs.length).toBe(1);
    expect(useCanvasStore.getState().localDocBytes).toBe(0); // 未触发不校准（快照值不被覆盖）
    fireIdle();
    expect(useCanvasStore.getState().localDocBytes).toBe(Y.encodeStateAsUpdate(d).byteLength);   // 实测真值覆盖
    expect(useCanvasStore.getState().localDelta).toBe(0);   // 校准点清零
  });

  it('漂移实测·超大路径：localDelta>4×maxTx 同步实测一次——真值放行（v4 pending-measure 静默丢用户动作红相修正）', async () => {
    stubIdle();   // idle 不触发——同步实测路径独立于 idle 在途窗
    await driveToSynced();
    const d = getDoc()!;
    Y.applyUpdate(d, remoteUpdate(1.2 * 1024 * 1024), 'remote-peer');   // localDelta≈1.2MB > 4×256KB=1MB
    expect(useCanvasStore.getState().localDelta).toBeGreaterThan(4 * QUOTA_DEFAULTS.maxTxBytes);
    // 实测真值≈1.2MB << 缺省软阈 6.7MB——按真值放行（非静默丢动作）
    expect(canApplyIntent([{ type: 'addNode', node: rec('n9') }])).toEqual({ ok: true });
  });

  it('漂移实测·超大路径：实测后按真值拒绝——measured+tx > softLimit ⇒ doc-over-budget', async () => {
    stubIdle();
    const p = await driveToSynced();
    p.emit('stateless', { payload: docStatus({ rev: 1, bytes: 0, softLimitBytes: 100_000 }) });
    const d = getDoc()!;
    Y.applyUpdate(d, remoteUpdate(1.2 * 1024 * 1024), 'remote-peer');   // localDelta≈1.2MB > 1MB（快照 bytes=0 陈旧——实测纠正）
    expect(canApplyIntent([{ type: 'addNode', node: rec('n9') }]))
      .toEqual({ ok: false, reason: 'doc-over-budget' });   // measured≈1.2MB+tx > 100KB
  });

  it('undo/redo 覆盖：redo 回放前 precheck 拒（undo 不拦——只减尺寸）；拒=redoStack 不减+diag；放行回放后 localDelta 增', async () => {
    const p = await driveToSynced();
    const d = getDoc()!;
    dispatchCanvasIntent(
      { type: 'addNode', node: { id: 'n1', type: 'textInput', data: { content: 'y'.repeat(20_000) } } },
      Origin.LocalUser,
    );
    expect(d.getMap('nodes').size).toBe(1);
    expect(getUndoManager()!.undoStack.length).toBe(1);
    await undoCanvas();                                     // undo 不拦（只减尺寸）
    expect(d.getMap('nodes').size).toBe(0);
    expect(getUndoManager()!.redoStack.length).toBe(1);
    // 拒：快照推至软阈边缘——localDocBytes+localDelta+回放帧字节（~20KB）> softLimit
    p.emit('stateless', { payload: docStatus({ rev: 1, bytes: 6_705_000, softLimitBytes: 6_710_886 }) });
    await redoCanvas();
    expect(getUndoManager()!.redoStack.length).toBe(1);     // 未消费
    expect(d.getMap('nodes').size).toBe(0);                 // doc 不变
    const diag = getRecentCollabDiag();
    expect(diag[diag.length - 1]).toMatchObject({
      type: 'write_reject',
      detail: { reason: 'doc-over-budget', via: 'redo-precheck' },
    });
    // 放行：快照回落——redo 回放后 localDelta 增（回放事务 origin=UndoManager——插值器全 origin 计入）
    p.emit('stateless', { payload: docStatus({ rev: 2, bytes: 0, softLimitBytes: 6_710_886 }) });
    await redoCanvas();
    expect(d.getMap('nodes').size).toBe(1);
    expect(useCanvasStore.getState().localDelta).toBeGreaterThan(0);
  });
});
