// apps/web/src/stores/canvasCollabRuntime.offline.test.ts
// 离线廉价兜底超时分支（Task 12 审查观察 A/B → 批2-1 修D 重写）：
// 旧绿=超时分支先 destroyCollab 再置 offline+syncFailed（销毁钉死蒙层——Task 12 时代方案）；
// 批2-1 修D（v5.3）=超时不再 destroyCollab——hydration='failed' 驱动蒙层行动，
//   provider/doc 保留（恢复门对象仍在、"断连期编辑仍在 doc"在 failed 态成立——
//   与恢复门互相踩出的"10s 超时↔15s 快线"重建循环随销毁一起消失）。
// Y0b-5 T4：死线 reason 分型（瞬态延长一次/总封顶 25s/终态不延长）+failed→ready 自愈
//  （completeHydration——:78-90 预留用例本批落位）+probeReadyReason 事件驱动单次探测。
// mock 面（最小可行）：HocuspocusProvider 构造记录实例、on 登记 handler、destroy 异步幂等。
// attachUndoManager 用模块自建真实 Y.Doc（非 provider.document），AwarenessBridge 在超时路径
// 不构造——均无需 mock。fake timers 推进 10s 触发超时 resolve。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useCanvasStore } from './canvasStore';
import { canEdit } from './syncStatus';
import { initCollab, getDoc, getAwareness, destroyCollab, probeReadyReason, Origin } from './canvasCollabRuntime';
import { getUndoManager } from './canvasUndo';
import { toDocLike } from '@/collab/ydocBuilder';
import { getRecentCollabDiag, _resetCollabDiagForTest } from '@/utils/collabDiagnostics';

vi.mock('@hocuspocus/provider', () => {
  class MockProvider {
    static instances: MockProvider[] = [];
    config: unknown;
    // 批0a 库契约：isAuthenticated/isSynced 公开布尔（provider 无 status 字段——只有事件）
    isAuthenticated = false;
    isSynced = false;
    // Y0b-5 T6 契约补全：T3/T6 接缝（authenticated 时带未同步编辑 → forceSync）消费面
    forceSync = vi.fn();
    handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    destroyCalls = 0;
    constructor(config: unknown) {
      this.config = config;
      MockProvider.instances.push(this);
    }
    on(event: string, cb: (...args: unknown[]) => void) {
      (this.handlers[event] ??= []).push(cb);
    }
    // 模拟真实 provider.destroy 可观测语义：销毁后 socket 关闭、任何事件不再出站。emit 走监听表。
    async destroy() {
      this.destroyCalls++;
      this.handlers = {};
    }
    emit(event: string, payload: unknown) {
      for (const cb of this.handlers[event] ?? []) cb(payload);
    }
  }
  return { HocuspocusProvider: MockProvider };
});

type MockInst = {
  config: { name: string };
  isAuthenticated: boolean;
  isSynced: boolean;
  handlers: Record<string, Array<(...args: unknown[]) => void>>;
  destroyCalls: number;
  emit(event: string, payload: unknown): void;
};
const lastInstance = () => (HocuspocusProvider as any).instances.at(-1) as MockInst;

describe('initCollab 离线兜底：10s 超时分支（批2-1 修D——超时不销毁）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (HocuspocusProvider as any).instances.length = 0;
    _resetCollabDiagForTest();
    useCanvasStore.setState({ connStatus: 'connecting', nodes: [], edges: [], hydration: 'idle' });
  });
  afterEach(async () => {
    // 修D 后超时路径 provider/心跳仍存活——销毁须在 fake timers 下先清
    await destroyCollab();
    vi.useRealTimers();
  });

  it('超时兜底（修D）：hydration=failed + store 未水合 + provider/doc 仍存活', async () => {
    const p = initCollab('p1'); // 内部先 teardown（provider=null 幂等安全）
    await vi.advanceTimersByTimeAsync(10_000);
    await p;

    const cs = useCanvasStore.getState();
    expect(cs.hydration).toBe('failed'); // 蒙层分型：failed → 重试行动（不再写 connStatus/syncFailed）
    expect(cs.nodes).toEqual([]); // 未 applyDocToStore（不抬 hydrate 门、空 doc 不入 store）
    expect(getDoc()).not.toBeNull(); // 修D：doc 保留——恢复门对象仍在
    expect(lastInstance().destroyCalls).toBe(0); // 修D：provider 保留（现状必红——旧分支 destroyCollab）
    expect(lastInstance().config.name).toBe('project:p1');
  });

  // ── Y0b-5 T4：failed→ready 自愈（原 :78-90 预留用例"completeHydration 单驱动属后续批次"本批落位）──
  // 现状=永久只读死局（setHydration 无守卫单写点+ready 唯一写点在超时 return 后不可再达）。
  it('★failed→ready 自愈（completeHydration）：迟到 synced→applyDocToStore+ready+canEdit 恢复（现状=永久只读死局）', async () => {
    const p = initCollab('p1');
    await vi.advanceTimersByTimeAsync(10_000);   // →failed
    await p;
    expect(useCanvasStore.getState().hydration).toBe('failed');

    // supervisor 恢复路径自然到达：connected→authenticated(read-write)→迟到 synced
    // doc 先落远端内容（stamp 后 DEV 版本门放行——mock 无真 loadDocument 自愈）
    const B = new Y.Doc();
    B.transact(() => {
      const m = new Y.Map(); m.set('type', 'textInput');
      const pos = new Y.Map(); pos.set('x', 1); pos.set('y', 0); m.set('position', pos);
      m.set('data', new Y.Map());
      B.getMap('nodes').set('b1', m);
    }, 'b-edit');
    Y.applyUpdate(getDoc()!, Y.encodeStateAsUpdate(B), 'network');

    const inst = lastInstance();
    inst.emit('status', { status: 'connected' });
    inst.isAuthenticated = true;
    inst.emit('authenticated', { scope: 'read-write' });
    inst.isSynced = true;
    inst.emit('synced', {});                       // 迟到 synced（自愈单驱动）
    expect(useCanvasStore.getState().hydration).toBe('ready');
    expect(useCanvasStore.getState().nodes.map((n: any) => n.id)).toEqual(['b1']);   // applyDocToStore 已投影
    expect(canEdit(useCanvasStore.getState())).toBe(true);   // ★只读死局解除（谓词零改动——hydration 就位即真）
    expect(getAwareness()).not.toBeNull();          // awarenessBridge 非空（成员/光标可见）
  });

  it('★自愈会话非"ready 但冻结"（裁定 23⑦）：自愈后远端编辑→onRemote 投影仍生效（observeDeep 已注册）', async () => {
    const p = initCollab('p1');
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    const inst = lastInstance();
    inst.emit('status', { status: 'connected' });
    inst.isAuthenticated = true;
    inst.emit('authenticated', { scope: 'read-write' });
    inst.isSynced = true;
    inst.emit('synced', {});
    expect(useCanvasStore.getState().hydration).toBe('ready');

    // 自愈后远端写（network origin）→50ms 去抖→apply 周期仍投影——只 applyDocToStore+ready 的
    // 半武装形态（红相）结构性不可达
    const C = new Y.Doc();
    C.transact(() => {
      const m = new Y.Map(); m.set('type', 'textInput');
      const pos = new Y.Map(); pos.set('x', 2); pos.set('y', 0); m.set('position', pos);
      m.set('data', new Y.Map());
      C.getMap('nodes').set('c1', m);
    }, 'c-edit');
    Y.applyUpdate(getDoc()!, Y.encodeStateAsUpdate(C), 'network');
    await vi.advanceTimersByTimeAsync(60);         // 50ms 去抖
    expect(useCanvasStore.getState().nodes.some((n: any) => n.id === 'c1')).toBe(true);
  });

  it('★幂等 latch（裁定 23⑦）：自愈成功路径后再触发 synced 不重复 armSession（projection_duration 恒 1——投影工作量翻倍防线）', async () => {
    const p = initCollab('p1');
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    const inst = lastInstance();
    inst.emit('status', { status: 'connected' });
    inst.isAuthenticated = true;
    inst.emit('authenticated', { scope: 'read-write' });
    inst.isSynced = true;
    inst.emit('synced', {});
    expect(useCanvasStore.getState().hydration).toBe('ready');
    const countAfterHeal = getRecentCollabDiag().filter((e) => e.type === 'projection_duration').length;

    inst.emit('synced', {});   // 重连 re-synced——completeHydration 守卫（非 failed）+armSession latch 双防线
    const countAfterResync = getRecentCollabDiag().filter((e) => e.type === 'projection_duration').length;
    expect(countAfterResync).toBe(countAfterHeal);   // 零重复 applyDocToStore/observeDeep 注册
  });

  it('自愈后 undoManager 不含缓存/装载操作（completeHydration undo clear——本地 update 起点语义，非用户编辑不入 undo 栈）', async () => {
    const p = initCollab('p1');
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    // failed 窗内 LocalUser origin 装载事务（缓存回放/队列 flush 形态）——undoManager trackedOrigins 默认捕获
    getDoc()!.transact(() => {
      const m = new Y.Map(); m.set('type', 'textInput'); m.set('data', new Y.Map());
      getDoc()!.getMap('nodes').set('x1', m);
    }, Origin.LocalUser);
    expect(getUndoManager()?.undoStack.length).toBeGreaterThan(0);   // 前置锚：确被捕（无 clear 必红）

    const inst = lastInstance();
    inst.emit('status', { status: 'connected' });
    inst.isAuthenticated = true;
    inst.emit('authenticated', { scope: 'read-write' });
    inst.isSynced = true;
    inst.emit('synced', {});
    expect(useCanvasStore.getState().hydration).toBe('ready');
    expect(getUndoManager()?.undoStack.length).toBe(0);   // ★clear——装载不留在 undo 栈
  });

  // ── Y0b-5 T4：hydration 死线 reason 分型（瞬态延长一次/总封顶 25s/终态不延长）──
  it('瞬态 authFailed 且 hydration pending→死线延长：10s 不死、25s（BASE 10_000+GRACE 15_000）才 failed；★总封顶=25s（多次瞬态不无限重排——"禁死 spinner"由封顶保证）', async () => {
    const p = initCollab('p1');
    await vi.advanceTimersByTimeAsync(5_000);
    lastInstance().emit('authenticationFailed', { reason: 'server-overloaded' });
    // 期间蒙层文案源=瞬态档 notice（SyncBanner/page 蒙层消费——「服务繁忙，正在自动重试…」）
    expect(useCanvasStore.getState().wsAuthNotice).toEqual({ reason: 'server-overloaded', terminal: false });

    await vi.advanceTimersByTimeAsync(5_000);    // t=10s——旧基线此处必 failed
    expect(useCanvasStore.getState().hydration).toBe('pending');   // ★延长档未死

    lastInstance().emit('authenticationFailed', { reason: 'server-overloaded' });   // 二次瞬态——闩锁不再延
    await vi.advanceTimersByTimeAsync(10_000);   // t=20s
    expect(useCanvasStore.getState().hydration).toBe('pending');
    await vi.advanceTimersByTimeAsync(5_000);    // t=25s=BASE+GRACE 总封顶
    await p;
    expect(useCanvasStore.getState().hydration).toBe('failed');   // ★到点 failed——后台 supervisor 续试（恢复门不变）
  });

  it('终态档不延长（终态 UX 即出口）——10s 照死；无瞬态信号基线 10s 零回归（首用例锚）', async () => {
    const p = initCollab('p1');
    await vi.advanceTimersByTimeAsync(5_000);
    lastInstance().emit('authenticationFailed', { reason: 'forbidden' });   // 终态（isTerminalReason 单源）
    expect(useCanvasStore.getState().wsAuthNotice).toEqual({ reason: 'forbidden', terminal: true });
    await vi.advanceTimersByTimeAsync(5_000);    // t=10s
    await p;
    expect(useCanvasStore.getState().hydration).toBe('failed');   // 未延长——终态即出口
  });

  it('会话中途断连：hydration 保持 ready（蒙层不弹、指示器承担告知）', async () => {
    const p = initCollab('p1');
    await vi.advanceTimersByTimeAsync(0); // flush teardown 微任务 → provider 构造完成
    // 批0a 健康序（派生判据）：connected 事件 + 公开布尔 + synced + message 代际确认
    const inst = lastInstance();
    inst.emit('status', { status: 'connected' });
    inst.isAuthenticated = true;
    inst.isSynced = true;
    inst.emit('synced', {});
    await p;
    inst.emit('message', {});
    expect(useCanvasStore.getState().connStatus).toBe('connected');
    expect(useCanvasStore.getState().hydration).toBe('ready');

    // 会话中途断连（pm2 重启/网络抖动）：断连走自动重连，hydration 不动（蒙层不弹）
    lastInstance().emit('status', { status: 'disconnected' });
    expect(useCanvasStore.getState().connStatus).toBe('offline'); // SaveStatusIndicator 非阻断告知保留
    expect(useCanvasStore.getState().hydration).toBe('ready');    // 全屏蒙层条件不触发
  });

  it('陈旧 initCollab 超时 timer 不销毁后续同 pid 健康会话（I-1 epoch 判活回归锁）', async () => {
    const p1 = initCollab('p1');
    await vi.advanceTimersByTimeAsync(5_000); // 第一次超时中（timer 未触发、未 emit synced）
    const p2 = initCollab('p1'); // 退出重进/StrictMode 双挂载：入口 teardown 销毁实例 1，新建实例 2
    await vi.advanceTimersByTimeAsync(0); // flush → 实例 2 构造完成
    expect((HocuspocusProvider as any).instances.length).toBe(2);
    // 批0a 健康序（派生判据）：connected 事件 + 公开布尔 + synced + message 代际确认
    const inst2 = lastInstance();
    inst2.emit('status', { status: 'connected' });
    inst2.isAuthenticated = true;
    inst2.isSynced = true;
    inst2.emit('synced', {}); // 第二次健康完成
    await p2;
    inst2.emit('message', {});
    expect(getDoc()).not.toBeNull();
    expect(useCanvasStore.getState().connStatus).toBe('connected');

    await vi.advanceTimersByTimeAsync(10_000); // 越过第一次的 10s 陈旧 timer
    await p1;
    // 旧代码红相：同 pid 守卫放行 → !synced → destroyCollab() 销毁健康会话
    expect(((HocuspocusProvider as any).instances[1] as MockInst).destroyCalls).toBe(0); // 新会话未被销毁
    expect(getDoc()).not.toBeNull();
    expect(useCanvasStore.getState().connStatus).toBe('connected');
    expect(useCanvasStore.getState().hydration).toBe('ready'); // 陈旧超时不吞新会话的 ready
  });
});

// ── Y0b-5 T4：probeReadyReason——零 ready 轮询 + 重连成功但状态异常的事件驱动单次探测 ──
describe('Y0b-5 T4：ready 探测（零 interval 轮询——spec §5.4 明令删；边角兜底=事件驱动单次+节流 60s+抖动）', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const readyCalls = () => fetchMock.mock.calls.filter((c: any[]) => String(c[0]).includes('/api/ready')).length;

  beforeEach(() => {
    vi.useFakeTimers();
    (HocuspocusProvider as any).instances.length = 0;
    _resetCollabDiagForTest();
    useCanvasStore.setState({ connStatus: 'connecting', nodes: [], edges: [], hydration: 'idle', readyProbeHint: null });
    fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ready: false, reason: 'lease-held', collabProtocolVersion: 2 }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(async () => {
    await destroyCollab();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('零 ready 轮询回归锁：无事件触发则任意时长推进零 /api/ready 请求（spec §5.4 明令删）', async () => {
    const p = initCollab('p1');
    await vi.advanceTimersByTimeAsync(120_000);   // 越过死线/退避阶梯/心跳任意周期
    await p;
    expect(readyCalls()).toBe(0);
  });

  it('重连成功但状态异常→单次事件驱动探测（authenticated 后 5s+0-2s 抖动窗内无 synced）：reason 写横幅 hint+节流 60s 内不二探', async () => {
    expect(typeof probeReadyReason).toBe('function');   // ★独立函数（禁复用 handleVersionTerminal——语义正交）
    const p = initCollab('p1');
    await vi.advanceTimersByTimeAsync(0);
    const inst = lastInstance();
    inst.emit('status', { status: 'connected' });
    inst.isAuthenticated = true;
    inst.emit('authenticated', { scope: 'read-write' });   // 重连成功——但 synced 永不到达（状态异常）
    await vi.advanceTimersByTimeAsync(8_000);              // 越过 5-7s 探测窗（抖动上界 2s）
    expect(readyCalls()).toBe(1);                          // 单次（非轮询）
    expect(useCanvasStore.getState().readyProbeHint).toBe('lease-held');   // reason 写横幅 hint

    // 节流 60s：窗口内再次触发（又一场 authenticated 仍无 synced）不二探
    inst.emit('authenticated', { scope: 'read-write' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(readyCalls()).toBe(1);
    // 零 interval：长期推进不自动增长（下一次探测只可由新事件触发且过 60s 节流窗）
    await vi.advanceTimersByTimeAsync(120_000);
    expect(readyCalls()).toBe(1);
  });

  it('★服务恢复 synced 到达→readyProbeHint 清除（与触发对称——健康态横幅「服务端状态异常…」不残留误导刷新）', async () => {
    // 前置：上一用例的探测已占 60s 节流窗（模块级 lastProbeReadyAt 跨用例存活）——先推进假钟
    // 过窗，保证本用例 authenticated 后探测真实触发写入（而非被节流静默跳过）
    await vi.advanceTimersByTimeAsync(70_000);
    const p = initCollab('p1');
    await vi.advanceTimersByTimeAsync(0);
    const inst = lastInstance();
    inst.emit('status', { status: 'connected' });
    inst.isAuthenticated = true;
    inst.emit('authenticated', { scope: 'read-write' });
    await vi.advanceTimersByTimeAsync(8_000);              // 探测窗——hint 已写入
    expect(useCanvasStore.getState().readyProbeHint).toBe('lease-held');

    inst.isSynced = true;
    inst.emit('synced', {});                               // 服务恢复（synced 到达=状态回正常）
    expect(useCanvasStore.getState().readyProbeHint).toBe(null);   // ★清除（现状必红——横幅残留）
    await p;
  });

  it('synced 正常到达（5s 窗内）→零探测（健康序不烧探测）', async () => {
    const p = initCollab('p1');
    await vi.advanceTimersByTimeAsync(0);
    const inst = lastInstance();
    inst.emit('status', { status: 'connected' });
    inst.isAuthenticated = true;
    inst.emit('authenticated', { scope: 'read-write' });
    inst.isSynced = true;
    inst.emit('synced', {});
    await p;
    await vi.advanceTimersByTimeAsync(8_000);
    expect(readyCalls()).toBe(0);
  });
});
