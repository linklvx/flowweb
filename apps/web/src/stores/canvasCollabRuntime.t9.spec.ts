// apps/web/src/stores/canvasCollabRuntime.t9.spec.ts
// Y0b-3 T9：客户端锁定项——wsAuthNotice 生产写点（改前零写点：声明 canvasStore:171/消费 syncStatus:9
// 在、写入侧缺失）+【输出级锚】terminal 真停连（connect 调用数==0 且 socket 构造计数==0——禁 spy
// disconnect 假绿，断真开关的输出面）+close 分型 machine 映射（silent-renew-once/planned-restart/
// terminal/backoff）+write-frozen（P-S）+版本 reload 自愈（P-C）。
// mock 形态承 conn.spec（库契约：provider 无 status 字段只有事件；configuration.websocketProvider
// 真开关建模——connect() 首行置回 shouldConnect=true〔esm:225〕且新建 socket 计数；disconnect() 置
// shouldConnect=false〔esm:367-376〕——这就是"connect 后禁 terminal 复发"防线的结构根据）。
// Y0b-5 T3：mock 收敛——唯一载体 @/test/fixtures/fakeHocuspocusProvider（裁定 24⑪⑤）。
//     ⚠ T3 pin 后 createProvider 显式首连（autoConnect:false）——connect/socket 计数一律基线相对。
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useCanvasStore } from './canvasStore';
import * as runtime from './canvasCollabRuntime';
import { canExecute } from './syncStatus';
import { getCollabDiagCounters, _resetCollabDiagForTest } from '@/utils/collabDiagnostics';
import { setSupervisorJitterForTest } from '@/collab/connection-supervisor';

vi.mock('@hocuspocus/provider', async () => {
  const { FakeHocuspocusProvider } = await import('@/test/fixtures/fakeHocuspocusProvider');
  return { HocuspocusProvider: FakeHocuspocusProvider };
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
    setSupervisorJitterForTest(() => 0);   // silent-renew 500ms+jitter——确定性钉 0（真 timer 推进）
    Mocks.instances.length = 0;
    Mocks.resetSockets();
    _resetCollabDiagForTest();
    resetStore();
  });
  afterEach(async () => {
    await runtime.destroyCollab();
    vi.useRealTimers();
    setSupervisorJitterForTest(null);
    vi.restoreAllMocks();
  });

  it('authenticationFailed 终态 reason→wsAuthNotice{reason,terminal:true} 写点+auth_reject diag', async () => {
    await driveToSynced();
    const p = lastInstance();
    p.emit('authenticationFailed', { reason: 'forbidden' });
    expect(useCanvasStore.getState().wsAuthNotice).toEqual({ reason: 'forbidden', terminal: true });
    expect(getCollabDiagCounters().get('auth_reject')).toBe(1);
  });

  it('4401 session-expired close→静默重连恰一次（supervisor silent-renew 500ms 档——不进阶梯），二次失败才终态且不再续期', async () => {
    const p = await driveToSynced();
    const connect = p.configuration.websocketProvider.connect;
    const base = connect.mock.calls.length;                                     // T3 pin：首连占 1——基线相对
    p.emit('close', { event: { code: 4401, reason: 'session-expired' } });
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(base + 1), { timeout: 2_000 }); // 静默续期一次（500ms+j0）
    expect(useCanvasStore.getState().wsAuthNotice).toBeNull();                  // 非终态
    p.emit('authenticationFailed', { reason: 'session-expired' });              // 二次失败（重连后 auth 仍拒）
    expect(useCanvasStore.getState().wsAuthNotice).toEqual({ reason: 'session-expired', terminal: true });
    expect(p.configuration.websocketProvider.shouldConnect).toBe(false);
    p.emit('close', { event: { code: 4401, reason: 'session-expired' } });      // 二次 sweep close——额度已用
    await new Promise<void>((r) => setTimeout(r, 700));                         // 越过 500ms 档——确认零重排
    expect(connect).toHaveBeenCalledTimes(base + 1);                            // 不再静默续期（闩锁）
  });

  it('S-4：静默续期额度 authenticated 重置——续期成功后再次 4401 可再静默续一次', async () => {
    const p = await driveToSynced();
    const connect = p.configuration.websocketProvider.connect;
    const base = connect.mock.calls.length;                                     // T3 pin：首连占 1
    p.emit('close', { event: { code: 4401, reason: 'session-expired' } });
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(base + 1), { timeout: 2_000 });
    p.emit('authenticated', { scope: 'read-write' });   // 续期成功——额度重置（writeFrozen 同点清零）
    p.emit('close', { event: { code: 4401, reason: 'session-expired' } });
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(base + 2), { timeout: 2_000 }); // 第二次静默续期
  });

  it('库 4401 Unauthorized（经 authenticationFailed）→终态不续期（双键分型：只判 code 必混淆）', async () => {
    const p = await driveToSynced();
    const connect = p.configuration.websocketProvider.connect;
    const base = connect.mock.calls.length;                                     // T3 pin：首连占 1
    p.isAuthenticated = false;
    p.emit('authenticationFailed', { reason: 'unauthenticated' });
    expect(useCanvasStore.getState().wsAuthNotice).toEqual({ reason: 'unauthenticated', terminal: true });
    p.emit('close', { event: { code: 4401, reason: 'Unauthorized' } }); // 库默认 reason——非 sweep session-expired
    expect(connect).toHaveBeenCalledTimes(base);                                // 只判 code 在此必红（误续期）——零新 connect
    expect(p.configuration.websocketProvider.shouldConnect).toBe(false);
  });

  it('close 1009（message-too-big）→terminal 写点+真停连+逃生 pending（同版本逃生按钮）+零重连', async () => {
    const p = await driveToSynced();
    const connect = p.configuration.websocketProvider.connect;
    const base = connect.mock.calls.length;                                     // T3 pin：首连占 1
    p.emit('close', { event: { code: 1009 } });
    expect(useCanvasStore.getState().wsAuthNotice).toEqual({ reason: 'message-too-big', terminal: true });
    expect(p.configuration.websocketProvider.shouldConnect).toBe(false);
    expect(useCanvasStore.getState().collabEscapePending).toBe(true);
    await new Promise<void>((r) => setTimeout(r, 20)); // 无任何计划内/库级重连
    expect(connect).toHaveBeenCalledTimes(base);                                // 零新 connect（基线相对）
  });
});

describe('T9 Step1：真停连输出级锚+退避所有权（fake timers——conn.spec beginCollabFake 形态）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSupervisorJitterForTest(() => 0);   // 指数/short 档确定性钉 0
    Mocks.instances.length = 0;
    Mocks.resetSockets();
    _resetCollabDiagForTest();
    resetStore();
  });
  afterEach(async () => {
    await runtime.destroyCollab();   // fake interval 清理须在 useRealTimers 前
    vi.useRealTimers();
    setSupervisorJitterForTest(null);
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
    const socketsBase = Mocks.socketsConstructed(); // T3 pin：显式首连占 1——基线相对
    p.isAuthenticated = false;               // 库契约：auth 失败后布尔复位（watchdog 健康电平断裂）
    p.emit('authenticationFailed', { reason: 'schema-outdated' });
    expect(p.configuration.websocketProvider.shouldConnect).toBe(false); // 真开关已落（disconnect）
    await vi.advanceTimersByTimeAsync(31_000); // 越过库 31s 重连周期+watchdog 快线（15s 档）
    expect(wsConnect).not.toHaveBeenCalled();  // terminal 后任何恢复路径禁再调 connect（复发防线）
    expect(Mocks.socketsConstructed()).toBe(socketsBase); // 无新 socket（单飞）
  });

  it('★瞬态 reason→supervisor 指数表接管（裁定 24⑷②）：先断（shouldConnect=false 废 OPEN 僵尸——旧锚"保持 true"随归零模型反转）→2s 首连（jitter0）→AUTH_WAIT 10s 未 authenticated→attempt++ 阶梯续试', async () => {
    const p = await driveToSyncedFake();
    const wsConnect = vi.spyOn(p.configuration.websocketProvider, 'connect');
    p.isAuthenticated = false;
    p.emit('authenticationFailed', { reason: 'server-overloaded' });
    expect(useCanvasStore.getState().wsAuthNotice).toEqual({ reason: 'server-overloaded', terminal: false });
    expect(p.configuration.websocketProvider.shouldConnect).toBe(false);  // ★先断（废 OPEN 僵尸——现状零动作=15-18s 快线+热循环风险根除）
    await vi.advanceTimersByTimeAsync(1_500);
    expect(wsConnect).not.toHaveBeenCalled();   // <2s 首档——零热循环
    await vi.advanceTimersByTimeAsync(1_000);   // 2.5s > 2s
    expect(wsConnect).toHaveBeenCalledTimes(1); // ★supervisor 指数表首连（2-4s 窗——改前 15-18s）
    await vi.advanceTimersByTimeAsync(10_000);  // AUTH_WAIT 10s 未 authenticated → attempt++ → 断+重排
    expect(p.configuration.websocketProvider.shouldConnect).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);   // 重排=指数表 attempt=1→5s 档
    expect(wsConnect).toHaveBeenCalledTimes(2); // ★阶梯续试不因单次失败停摆
  });

  it('1012 planned-restart：supervisor short 档承接（jitter0→恰 1s——full jitter 0-60s 窗的零点）', async () => {
    const p = await driveToSyncedFake();
    const wsConnect = vi.spyOn(p.configuration.websocketProvider, 'connect');
    p.emit('close', { event: { code: 1012 } });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(wsConnect).toHaveBeenCalledTimes(1);   // short 档 1s 首连
  });
});

// ══════════ Step 3：write-frozen（P-S；Y0b-4 T5 起通告载体=doc-status writeFrozen 维度） ══════════
describe('T9 Step3：onStateless doc-status writeFrozen→writeFrozen 电平（canExecute=false）', () => {
  /** Y0b-4 T5：write-frozen stateless 已退役——本族红改为 doc-status 等价语义（断言保留） */
  const drainFreeze = (rev = 1) => JSON.stringify({
    type: 'doc-status', rev, writeFrozen: true,
    quota: { state: 'ok', bytes: 1, limit: 10, maxTxBytes: 4, softLimitBytes: 8 },
  });

  beforeEach(() => {
    Mocks.instances.length = 0;
    _resetCollabDiagForTest();
    resetStore();
  });
  afterEach(async () => {
    await runtime.destroyCollab();
  });

  it('收冻结通告（doc-status writeFrozen:true）→writeFrozen=true+canExecute=false+quota-soft arm 记 write_reject diag', async () => {
    const p = await driveToSynced();
    p.emit('stateless', { payload: drainFreeze() });   // drain 冻结（quota ok）
    expect(useCanvasStore.getState().writeFrozen).toBe(true);
    expect(canExecute(useCanvasStore.getState())).toBe(false);
    // diag 等价语义改由 quota over arm 承接（drain 无 write_reject——通告退役后 reason 字段消失）
    p.emit('stateless', { payload: JSON.stringify({
      type: 'doc-status', rev: 2, writeFrozen: true,
      quota: { state: 'over', bytes: 9, limit: 10, maxTxBytes: 4, softLimitBytes: 8 },
    }) });
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
    p.emit('stateless', { payload: drainFreeze() });
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
