// apps/web/src/stores/canvasCollabRuntime.conn.spec.ts
// 批0a connStatus 派生 + destroyCollab 实例守卫（缺陷 A 根修 / R23）：
// 红1=现状 connStatus 由 status 事件直写且 'connected' 被映射成 'connecting'（状态机断链），
//     全仓唯一 'connected' 写点在 initCollab 完成时直写（依赖水合路径）；
// 绿1=recomputeConnStatus 唯一写点：lastWsStatus 事件缓存值 + isAuthenticated/isSynced
//     公开布尔 + 代际制（inboundAttemptId===attemptId，'message' 驱动——决策门 A 候选 1）。
// 红1-并发=现状 destroyCollab 的置空无条件——旧 destroy 的 await 恢复会把并发新会话的
//     provider/doc/awarenessBridge 打穿（R23 交错置空）；
// 绿1-并发=实例守卫：快照局部引用 → await → 仅当模块引用未变才置空。
// mock 按库契约（spec v5.8 ⑨）：provider 无 status 字段（只有事件）；
//     isAuthenticated/isSynced 公开布尔；status:'connected' 每连接双发
//     （onOpen + resolveConnectionAttempt）；'message' 只对路由到本 provider 的帧 emit。
//     destroyGate=测试注入的首次 destroy 挂起 promise（R23 交错装置——复现旧 destroy 的
//     await 恢复晚于新 provider 创建的竞态窗口）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useCanvasStore } from './canvasStore';
import * as runtime from './canvasCollabRuntime';

vi.mock('@hocuspocus/provider', () => {
  class MockProvider {
    static instances: MockProvider[] = [];
    isAuthenticated = false;
    isSynced = false;
    destroyCalls = 0;
    destroyGate: Promise<void> | null = null;
    handlers: Record<string, Array<(payload: any) => void>> = {};
    constructor() { MockProvider.instances.push(this); }
    on(event: string, cb: (payload: any) => void) { (this.handlers[event] ??= []).push(cb); }
    emit(event: string, payload: any) { for (const cb of [...this.handlers[event] ?? []]) cb(payload); }
    async destroy() {
      this.destroyCalls++;
      if (this.destroyCalls === 1 && this.destroyGate) await this.destroyGate;
    }
  }
  return { HocuspocusProvider: MockProvider };
});

const lastInstance = () => (HocuspocusProvider as any).instances.at(-1) as any;
/** 一个 macrotask——flush initCollab 入口 destroyCollab 的微任务链（provider 构造完成） */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** 启动会话并取到已构造的 provider 实例（装置适配：mock provider 在 initCollab 的
 *  入口 await destroyCollab 之后才创建——先 flush 再取实例，怎么稳怎么来） */
async function beginCollab(pid: string): Promise<{ done: Promise<void>; p: any }> {
  const done = runtime.initCollab(pid);
  await tick();
  return { done, p: lastInstance() };
}

/** 完整健康序（spec 红1 事件序）：connected 双发 → authenticated → synced */
async function driveToSynced(pid = 'p1') {
  const { done, p } = await beginCollab(pid);
  p.emit('status', { status: 'connected' });   // 双发第一发（onOpen）
  p.emit('status', { status: 'connected' });   // 双发第二发（resolveConnectionAttempt）
  p.isAuthenticated = true;
  p.emit('authenticated', { scope: 'read-write' });
  p.isSynced = true;
  p.emit('synced', {});
  await done;
  return p;
}

describe('红1：connStatus 派生（真实事件序）', () => {
  beforeEach(() => {
    (HocuspocusProvider as any).instances.length = 0;
    useCanvasStore.setState({ connStatus: 'connecting', syncFailed: false, nodes: [], edges: [] });
  });
  afterEach(async () => {
    await runtime.destroyCollab(); // 摘 bindBridge 订阅/undo manager，防跨用例泄漏
  });

  it('双发 connected 但未 authenticated → 保持 connecting', async () => {
    const { done, p } = await beginCollab('p1');
    p.emit('status', { status: 'connected' });
    p.emit('status', { status: 'connected' });
    expect(useCanvasStore.getState().connStatus).toBe('connecting');
    p.emit('synced', {});
    await done;
  });

  it('完整序（双发+authenticated+synced+message）→ connected', async () => {
    const p = await driveToSynced('p1');
    p.emit('message', {});   // 本 attempt 首个入站——代际确认
    expect(useCanvasStore.getState().connStatus).toBe('connected');
  });

  it('代际防早宣：离开 connected 后新 attempt 首帧前不得早宣 connected', async () => {
    const p = await driveToSynced('p1');
    p.emit('message', {});
    expect(useCanvasStore.getState().connStatus).toBe('connected');
    // 断连（离开 connected → attemptId++）
    p.emit('status', { status: 'disconnected' });
    expect(['offline', 'connecting']).toContain(useCanvasStore.getState().connStatus);
    // 新 attempt：status 双发 + 布尔陈旧 true（4408 形态——库自发强关不发 close，布尔不复位）
    // 但本 attempt 尚无 message——不得早宣
    p.emit('status', { status: 'connected' });
    p.emit('status', { status: 'connected' });
    p.emit('authenticated', { scope: 'read-write' });
    expect(useCanvasStore.getState().connStatus).not.toBe('connected'); // 防早宣锚
    p.emit('message', {});
    expect(useCanvasStore.getState().connStatus).toBe('connected');
  });
});

describe('批1-1：watchdog 恢复门集成锚（fake timers）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (HocuspocusProvider as any).instances.length = 0;
    useCanvasStore.setState({ connStatus: 'connecting', syncFailed: false, nodes: [], edges: [], connUi: 'ok', isHydrating: false });
  });
  afterEach(async () => {
    // fake timers 仍激活时先销毁——clearInterval 才能命中 fake interval（useRealTimers 后清不掉）
    await runtime.destroyCollab();
    vi.useRealTimers();
  });

  /** fake timers 版装置：tick() 的 setTimeout(0) 在 fake 时钟下不跑——advanceTimersByTimeAsync(0) 等价 flush */
  async function beginCollabFake(pid: string): Promise<{ done: Promise<void>; p: any }> {
    const done = runtime.initCollab(pid);
    await vi.advanceTimersByTimeAsync(0); // flush 入口 destroyCollab 微任务链 → provider 构造完成
    return { done, p: lastInstance() };
  }

  /** 健康会话（批0a 健康序 + message 代际确认 + watchdog 入站新鲜度） */
  async function driveToHealthy(pid = 'p1') {
    const { done, p } = await beginCollabFake(pid);
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

  it('健康会话：心跳多 tick 零恢复、UI 保持 ok', async () => {
    const p = await driveToHealthy();
    expect(useCanvasStore.getState().connStatus).toBe('connected');
    const spy = vi.spyOn(runtime.recovery, 'recoverConnection');
    await vi.advanceTimersByTimeAsync(10_000); // 3 个心跳 tick，入站新鲜度 10s < 45s
    expect(spy).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().connUi).toBe('ok');
  });

  it('断连后健康电平断裂超门（60s jitter 上界外）⇒ recoverConnection 被调 + ui 离开 ok', async () => {
    const p = await driveToHealthy();
    p.emit('status', { status: 'disconnected' });
    const spy = vi.spyOn(runtime.recovery, 'recoverConnection');
    await vi.advanceTimersByTimeAsync(75_000); // 首tick置 unhealthySince 后 elapsed≈72s > 60s（gate 上界）
    expect(spy).toHaveBeenCalled();
    expect(useCanvasStore.getState().connUi).not.toBe('ok');
  });

  it('hydration 进行中（首同步窗口）⇒ 门开也不恢复', async () => {
    const p = await driveToHealthy();
    p.emit('status', { status: 'disconnected' });
    useCanvasStore.setState({ isHydrating: true });
    const spy = vi.spyOn(runtime.recovery, 'recoverConnection');
    await vi.advanceTimersByTimeAsync(75_000);
    expect(spy).not.toHaveBeenCalled();
  });

  it('页面隐藏 ⇒ 零自动恢复', async () => {
    const p = await driveToHealthy();
    p.emit('status', { status: 'disconnected' });
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const spy = vi.spyOn(runtime.recovery, 'recoverConnection');
    await vi.advanceTimersByTimeAsync(75_000);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('批1-2：1012 计划内重启短退避（fake timers）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (HocuspocusProvider as any).instances.length = 0;
    useCanvasStore.setState({ connStatus: 'connecting', syncFailed: false, nodes: [], edges: [], connUi: 'ok', isHydrating: false });
  });
  afterEach(async () => {
    await runtime.destroyCollab(); // fake interval 清理须在 useRealTimers 前
    vi.useRealTimers();
  });

  async function beginCollabFake(pid: string): Promise<{ done: Promise<void>; p: any }> {
    const done = runtime.initCollab(pid);
    await vi.advanceTimersByTimeAsync(0);
    return { done, p: lastInstance() };
  }
  async function driveToHealthy(pid = 'p1') {
    const { done, p } = await beginCollabFake(pid);
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

  it('close 1012 → 1~3s 内 ws.connect 重连（短退避首连）', async () => {
    const p = await driveToHealthy();
    const connect = vi.fn();
    (p as any).configuration = { websocketProvider: { connect } }; // 真实 provider 库契约：configuration.websocketProvider
    p.emit('close', { event: { code: 1012 } });
    await vi.advanceTimersByTimeAsync(3_000); // jitter delay∈[1000,3000)——3s 推进全覆盖
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('非 1012 close 不触发短退避', async () => {
    const p = await driveToHealthy();
    const connect = vi.fn();
    (p as any).configuration = { websocketProvider: { connect } };
    p.emit('close', { event: { code: 1006 } }); // 异常断连走库自发重连——不抢跑
    await vi.advanceTimersByTimeAsync(3_000);
    expect(connect).not.toHaveBeenCalled();
  });

  it('计划内重启窗口（30s）内 banner 钳制 hint；窗口过期恢复 banner', async () => {
    const p = await driveToHealthy();
    p.emit('status', { status: 'disconnected' });
    await vi.advanceTimersByTimeAsync(68_000); // elapsed≈65s——首次 recover 已过（gate 45~60s）
    p.emit('close', { event: { code: 1012 } }); // plannedRestartUntil = now+30s
    await vi.advanceTimersByTimeAsync(27_000);  // elapsed≈92s ≥90s（banner 档）但 now 仍在窗口内（27<30）
    expect(useCanvasStore.getState().connUi).toBe('hint'); // 钳制：计划内重启不吓用户
    await vi.advanceTimersByTimeAsync(6_000);   // 窗口过期（33>30）
    expect(useCanvasStore.getState().connUi).toBe('banner');
  });
});

describe('红1-并发：destroyCollab 实例守卫（R23）', () => {
  beforeEach(() => {
    (HocuspocusProvider as any).instances.length = 0;
    useCanvasStore.setState({ connStatus: 'connecting', syncFailed: false, nodes: [], edges: [] });
  });
  afterEach(async () => {
    await runtime.destroyCollab();
  });

  it('旧 destroy 的 await 恢复后不得置空新会话', async () => {
    const p1 = await driveToSynced('p1');
    // R23 交错装置：p1 首次 destroy 挂在 gate 上——构造"旧 destroy 的 await 恢复
    // 晚于新 provider 创建"的竞态窗口（gate 手动释放）
    let release!: () => void;
    p1.destroyGate = new Promise<void>((r) => { release = r; });
    const destroying = runtime.destroyCollab();   // #1：快照后挂在 gate
    const second = runtime.initCollab('p2');      // 入口 destroy（p1 第2次调用即过）→ 新 provider 创建
    await tick();
    const p2 = lastInstance();
    expect(p2).not.toBe(p1);                       // 新会话已建立在旧 destroy 的 await 期间
    p2.emit('status', { status: 'connected' });
    p2.isAuthenticated = true;
    p2.isSynced = true;
    p2.emit('authenticated', {});
    p2.emit('synced', {});
    p2.emit('message', {});
    await second;
    expect(useCanvasStore.getState().connStatus).toBe('connected');

    release();                                     // 旧 destroy 恢复——竞态窗口打开
    await destroying;
    expect(runtime.getDoc()).not.toBeNull();      // 旧 destroy 恢复不得 null 掉新 doc（今天必红）
    expect(useCanvasStore.getState().connStatus).toBe('connected'); // 新会话状态不被打穿
  });
});
