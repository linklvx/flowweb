// apps/web/src/stores/canvasCollabRuntime.t9.spec.ts
// Y0b-3 T9：客户端锁定项——wsAuthNotice 生产写点（改前零写点：声明 canvasStore:171/消费 syncStatus:9
// 在、写入侧缺失）+【输出级锚】terminal 真停连（connect 调用数==0 且 socket 构造计数==0——禁 spy
// disconnect 假绿，断真开关的输出面）+close 分型 machine 映射（silent-renew-once/planned-restart/
// terminal/backoff）+write-frozen（P-S）+版本 reload 自愈（P-C）。
// mock 形态承 conn.spec（库契约：provider 无 status 字段只有事件；configuration.websocketProvider
// 真开关建模——connect() 首行置回 shouldConnect=true〔esm:225〕且新建 socket 计数；disconnect() 置
// shouldConnect=false〔esm:367-376〕——这就是"connect 后禁 terminal 复发"防线的结构根据）。
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useCanvasStore } from './canvasStore';
import * as runtime from './canvasCollabRuntime';
import { canExecute } from './syncStatus';
import { getCollabDiagCounters, _resetCollabDiagForTest } from '@/utils/collabDiagnostics';

vi.mock('@hocuspocus/provider', () => {
  let socketsConstructed = 0;
  class MockProvider {
    static instances: MockProvider[] = [];
    static socketsConstructed() { return socketsConstructed; }
    static resetSockets() { socketsConstructed = 0; }
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
        meta: new Map<number, { clock: number; lastUpdated: number }>(),
        localState: null as any,
        setLocalState: vi.fn((s: any) => { this.awareness.localState = s; }),
        getLocalState: () => this.awareness.localState,
      };
      // 库真开关建模：connect 首行置回 shouldConnect=true（esm:225）+构造新 socket（输出级锚计数面）；
      // disconnect 置 shouldConnect=false（esm:367-376）——onClose 定时器因 !shouldConnect 不再排程
      this.configuration = {
        websocketProvider: {
          shouldConnect: true,
          connect: vi.fn(() => { this.configuration.websocketProvider.shouldConnect = true; socketsConstructed++; }),
          disconnect: vi.fn(() => { this.configuration.websocketProvider.shouldConnect = false; }),
        },
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
/** 一个 macrotask——flush initCollab 入口 destroyCollab 的微任务链（provider 构造完成） */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

async function beginCollab(pid: string): Promise<{ done: Promise<void>; p: any }> {
  const done = runtime.initCollab(pid);
  await tick();
  return { done, p: lastInstance() };
}

/** 完整健康序：connected 双发 → authenticated → synced */
async function driveToSynced(pid = 'p1') {
  const { done, p } = await beginCollab(pid);
  p.emit('status', { status: 'connected' });
  p.emit('status', { status: 'connected' });
  p.isAuthenticated = true;
  p.emit('authenticated', { scope: 'read-write' });
  p.isSynced = true;
  p.emit('synced', {});
  await done;
  p.emit('message', {});
  return p;
}

const resetStore = () => useCanvasStore.setState({
  connStatus: 'connecting', nodes: [], edges: [], connUi: 'ok', hydration: 'idle',
  collabReadOnly: true, wsAuthNotice: null, writeFrozen: false, collabEscapePending: false,
});

// ══════════ Step 1：authenticationFailed 写点 + 输出级终态真停连锚 ══════════
describe('T9 Step1：authenticationFailed→wsAuthNotice 写点（改前红：生产零写点）——真时序档', () => {
  beforeEach(() => {
    Mocks.instances.length = 0;
    Mocks.resetSockets();
    _resetCollabDiagForTest();
    resetStore();
  });
  afterEach(async () => {
    await runtime.destroyCollab();
    vi.restoreAllMocks();
  });

  it('authenticationFailed 终态 reason→wsAuthNotice{reason,terminal:true} 写点+auth_reject diag', async () => {
    await driveToSynced();
    const p = lastInstance();
    p.emit('authenticationFailed', { reason: 'forbidden' });
    expect(useCanvasStore.getState().wsAuthNotice).toEqual({ reason: 'forbidden', terminal: true });
    expect(getCollabDiagCounters().get('auth_reject')).toBe(1);
  });

  it('4401 session-expired close→静默重连恰一次（recovery 单飞），二次失败才终态且不再续期', async () => {
    const p = await driveToSynced();
    p.emit('close', { event: { code: 4401, reason: 'session-expired' } });
    expect(p.configuration.websocketProvider.connect).toHaveBeenCalledTimes(1); // 静默续期一次（唯一执行器=recovery）
    expect(useCanvasStore.getState().wsAuthNotice).toBeNull();                  // 非终态
    p.emit('authenticationFailed', { reason: 'session-expired' });              // 二次失败（重连后 auth 仍拒）
    expect(useCanvasStore.getState().wsAuthNotice).toEqual({ reason: 'session-expired', terminal: true });
    expect(p.configuration.websocketProvider.shouldConnect).toBe(false);
    p.emit('close', { event: { code: 4401, reason: 'session-expired' } });      // 二次 sweep close——额度已用
    expect(p.configuration.websocketProvider.connect).toHaveBeenCalledTimes(1); // 不再静默续期
  });

  it('S-4：静默续期额度 authenticated 重置——续期成功后再次 4401 可再静默续一次', async () => {
    const p = await driveToSynced();
    p.emit('close', { event: { code: 4401, reason: 'session-expired' } });
    expect(p.configuration.websocketProvider.connect).toHaveBeenCalledTimes(1);
    p.emit('authenticated', { scope: 'read-write' });   // 续期成功——额度重置（writeFrozen 同点清零）
    p.emit('close', { event: { code: 4401, reason: 'session-expired' } });
    expect(p.configuration.websocketProvider.connect).toHaveBeenCalledTimes(2); // 第二次静默续期
  });

  it('库 4401 Unauthorized（经 authenticationFailed）→终态不续期（双键分型：只判 code 必混淆）', async () => {
    const p = await driveToSynced();
    p.isAuthenticated = false;
    p.emit('authenticationFailed', { reason: 'unauthenticated' });
    expect(useCanvasStore.getState().wsAuthNotice).toEqual({ reason: 'unauthenticated', terminal: true });
    p.emit('close', { event: { code: 4401, reason: 'Unauthorized' } }); // 库默认 reason——非 sweep session-expired
    expect(p.configuration.websocketProvider.connect).not.toHaveBeenCalled(); // 只判 code 在此必红（误续期）
    expect(p.configuration.websocketProvider.shouldConnect).toBe(false);
  });

  it('close 1009（message-too-big）→terminal 写点+真停连+逃生 pending（同版本逃生按钮）+零重连', async () => {
    const p = await driveToSynced();
    p.emit('close', { event: { code: 1009 } });
    expect(useCanvasStore.getState().wsAuthNotice).toEqual({ reason: 'message-too-big', terminal: true });
    expect(p.configuration.websocketProvider.shouldConnect).toBe(false);
    expect(useCanvasStore.getState().collabEscapePending).toBe(true);
    await new Promise<void>((r) => setTimeout(r, 20)); // 无任何计划内/库级重连
    expect(p.configuration.websocketProvider.connect).not.toHaveBeenCalled();
  });
});

describe('T9 Step1：真停连输出级锚+退避所有权（fake timers——conn.spec beginCollabFake 形态）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Mocks.instances.length = 0;
    Mocks.resetSockets();
    _resetCollabDiagForTest();
    resetStore();
  });
  afterEach(async () => {
    await runtime.destroyCollab();   // fake interval 清理须在 useRealTimers 前
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** fake timers 版装置：tick() 的 setTimeout(0) 在 fake 时钟下不跑——advanceTimersByTimeAsync(0) 等价 flush */
  async function driveToSyncedFake(pid = 'p1') {
    const done = runtime.initCollab(pid);
    await vi.advanceTimersByTimeAsync(0);
    const p = lastInstance();
    p.emit('status', { status: 'connected' });
    p.emit('status', { status: 'connected' });
    p.isAuthenticated = true;
    p.emit('authenticated', { scope: 'read-write' });
    p.isSynced = true;
    p.emit('synced', {});
    await done;
    p.emit('message', {});
    return p;
  }

  it('【输出级锚】terminal reason→websocketProvider 真停连：31s 内 connect 调用数==0 且 socket 构造计数==0', async () => {
    const p = await driveToSyncedFake();
    const wsConnect = vi.spyOn(p.configuration.websocketProvider, 'connect');
    p.isAuthenticated = false;               // 库契约：auth 失败后布尔复位（watchdog 健康电平断裂）
    p.emit('authenticationFailed', { reason: 'schema-outdated' });
    expect(p.configuration.websocketProvider.shouldConnect).toBe(false); // 真开关已落（disconnect）
    await vi.advanceTimersByTimeAsync(31_000); // 越过库 31s 重连周期+watchdog 快线（15s 档）
    expect(wsConnect).not.toHaveBeenCalled();  // terminal 后任何恢复路径禁再调 connect（复发防线）
    expect(Mocks.socketsConstructed()).toBe(0); // 无新 socket（单飞）
  });

  it('瞬态 reason→不断连（shouldConnect 保持）+terminal=false+退避交 watchdog/machine（表驱动 cooldown≥表底 5s——禁新建退避）', async () => {
    const p = await driveToSyncedFake();
    const wsConnect = vi.spyOn(p.configuration.websocketProvider, 'connect');
    p.isAuthenticated = false;
    p.emit('authenticationFailed', { reason: 'server-overloaded' });
    expect(useCanvasStore.getState().wsAuthNotice).toEqual({ reason: 'server-overloaded', terminal: false });
    expect(p.configuration.websocketProvider.shouldConnect).toBe(true);   // 瞬态不断连
    await vi.advanceTimersByTimeAsync(18_000); // watchdog 快线首档（15s 门+3s tick）
    expect(wsConnect).toHaveBeenCalledTimes(1); // watchdog 单飞恢复中
    await vi.advanceTimersByTimeAsync(4_000);   // cooldown=表项[1]=10s+jitter(≤5s)——4s 内必不再激发
    expect(wsConnect).toHaveBeenCalledTimes(1); // RECOVER_BACKOFF_MS 表驱动退避（禁自建表）
    await vi.advanceTimersByTimeAsync(18_000);  // 最坏 15s cooldown+3s tick 对齐（下次激发∈[30s,33s] 档）
    expect(wsConnect).toHaveBeenCalledTimes(2); // watchdog 续恢复
  });

  it('1012 planned-restart：1~3s 短退避收编（conn.spec 既有锚维持——行为不变）', async () => {
    const p = await driveToSyncedFake();
    const wsConnect = vi.spyOn(p.configuration.websocketProvider, 'connect');
    p.emit('close', { event: { code: 1012 } });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(wsConnect).toHaveBeenCalledTimes(1);   // 既有短退避首连（收编后行为不变锚）
  });
});

// ══════════ Step 3：write-frozen（P-S） ══════════
describe('T9 Step3：onStateless write-frozen→writeFrozen 电平（canExecute=false）', () => {
  beforeEach(() => {
    Mocks.instances.length = 0;
    _resetCollabDiagForTest();
    resetStore();
  });
  afterEach(async () => {
    await runtime.destroyCollab();
  });

  it('收 write-frozen 通告→writeFrozen=true+canExecute=false+write_reject diag', async () => {
    const p = await driveToSynced();
    p.emit('stateless', { payload: JSON.stringify({ type: 'write-frozen', reason: 'draining' }) });
    expect(useCanvasStore.getState().writeFrozen).toBe(true);
    expect(canExecute(useCanvasStore.getState())).toBe(false);
    expect(getCollabDiagCounters().get('write_reject')).toBe(1);
  });

  it('通用 stateless 通道容错：坏 JSON/未知 type 静默忽略不抛', async () => {
    const p = await driveToSynced();
    expect(() => p.emit('stateless', { payload: 'not-json{{' })).not.toThrow();
    p.emit('stateless', { payload: JSON.stringify({ type: 'other-notice' }) });
    expect(useCanvasStore.getState().writeFrozen).toBe(false);
  });

  it('恢复：drain 解除→1012 短退避重连→authenticated 清零 writeFrozen（复用既有链路零新恢复逻辑）', async () => {
    const p = await driveToSynced();
    p.emit('stateless', { payload: JSON.stringify({ type: 'write-frozen', reason: 'draining' }) });
    expect(useCanvasStore.getState().writeFrozen).toBe(true);
    p.emit('close', { event: { code: 1012 } });          // drain 解除=1012（gateway 既有）
    p.emit('authenticated', { scope: 'read-write' });    // 重连认证成功
    expect(useCanvasStore.getState().writeFrozen).toBe(false);
  });
});

// ══════════ Step 4：版本过期 reload 自愈（P-C） ══════════
describe('T9 Step4：handleVersionTerminal——loop 保护键=观测到的服务端协议版本', () => {
  // ⚠ 前面 describe 的 afterEach vi.restoreAllMocks() 会解除描述级 spy——fetch spy 每用例重挂
  let fetchSpy: MockInstance;
  const reloadSpy = vi.fn();   // jsdom Location [Unforgeable] 不可 spy——vi.stubGlobal('location') 整体替换
  const ready200 = (csv: number) => new Response(JSON.stringify({ ready: true, collabProtocolVersion: csv }), { status: 200 });

  beforeEach(() => {
    Mocks.instances.length = 0;
    _resetCollabDiagForTest();
    resetStore();
    sessionStorage.clear();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    reloadSpy.mockClear();
    vi.stubGlobal('location', { reload: reloadSpy });
  });
  afterEach(async () => {
    await runtime.destroyCollab();
    useCanvasStore.setState({ collabEscapePending: false });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('版本终态已同步+同版本未刷过→自动 reload 一次+loop 键写入+零逃生', async () => {
    await driveToSynced();
    fetchSpy.mockResolvedValueOnce(ready200(1));
    await runtime.handleVersionTerminal();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('collab-version-reloaded:1')).toBe('1');
    expect(useCanvasStore.getState().collabEscapePending).toBe(false);
  });

  it('未同步门为真→不自动 reload+逃生 pending 置位', async () => {
    const p = await driveToSynced();
    p.unsyncedChanges = 1;                    // 本地未同步编辑——reload 会丢
    fetchSpy.mockResolvedValueOnce(ready200(1));
    await runtime.handleVersionTerminal();
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().collabEscapePending).toBe(true);
  });

  it('loop 保护：同服务端版本已 reload 过→不再 reload（防三锁互扣死页）+逃生 pending', async () => {
    await driveToSynced();
    sessionStorage.setItem('collab-version-reloaded:1', '1');
    fetchSpy.mockResolvedValueOnce(ready200(1));
    await runtime.handleVersionTerminal();
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().collabEscapePending).toBe(true);
  });

  it('服务端版本变化（下次部署）→键异→可再自愈一次', async () => {
    await driveToSynced();
    sessionStorage.setItem('collab-version-reloaded:0', '1'); // 上一部署版本已刷过
    fetchSpy.mockResolvedValueOnce(ready200(1));              // 本次服务端=1——键异
    await runtime.handleVersionTerminal();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('collab-version-reloaded:1')).toBe('1');
  });

  it('ready 不可达→直接落逃生动作（不 reload）', async () => {
    await driveToSynced();
    fetchSpy.mockRejectedValueOnce(new Error('down'));
    await runtime.handleVersionTerminal();
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().collabEscapePending).toBe(true);
  });

  it('ready 探测挂起（半开连接——不 resolve 不 reject）→5s AbortSignal 超时 throw 进 catch→落逃生（改前红：挂起=自愈死锁假横幅「正在自动刷新…」永挂）', async () => {
    await driveToSynced();
    vi.useFakeTimers();
    try {
      // mock fetch 永挂起+响应 signal（AbortSignal.timeout 到期 fetch promise reject=真实 fetch 取消行为的模拟）
      fetchSpy.mockImplementation(((_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener('abort', () => rej(new Error('TimeoutError: signal timed out')));
        })) as typeof fetch);
      const p = runtime.handleVersionTerminal();
      await vi.advanceTimersByTimeAsync(5_100);   // 越过 5s 探测超时（AbortSignal.timeout 内部 timer——fake timers 可驱动）
      await p;
      expect(reloadSpy).not.toHaveBeenCalled();
      expect(useCanvasStore.getState().collabEscapePending).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('escapeWithLocalExport→导出本地画布+强制刷新（不受未同步守卫约束——它就是为未同步而设）', () => {
    (URL as any).createObjectURL = vi.fn(() => 'blob:mock');
    (URL as any).revokeObjectURL = vi.fn();
    useCanvasStore.setState({ nodes: [{ id: 'n1' } as any], edges: [] });
    runtime.escapeWithLocalExport();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
