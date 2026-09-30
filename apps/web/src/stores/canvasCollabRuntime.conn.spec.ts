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
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import * as runtime from './canvasCollabRuntime';

vi.mock('@hocuspocus/provider', () => {
  class MockProvider {
    static instances: MockProvider[] = [];
    isAuthenticated = false;
    isSynced = false;
    /** 批1-3 装置扩展：终态判据（G1 级别选择）+awareness meta（㉖ clock 播种）+ws 句柄（shouldConnect/connect） */
    isAttached = true;
    unsyncedChanges = 0;
    destroyCalls = 0;
    destroyGate: Promise<void> | null = null;
    handlers: Record<string, Array<(payload: any) => void>> = {};
    configuration: any;
    awareness: any;
    constructor(cfg: any = {}) {
      MockProvider.instances.push(this);
      // y-protocols 契约：awareness.clientID = doc.clientID（同 doc 重建 ⇒ 同 clientID——clock 播种前提）
      const clientId = cfg?.document?.clientID ?? 0;
      this.awareness = {
        clientID: clientId,
        meta: new Map<number, { clock: number; lastUpdated: number }>(),
        localState: null as any,
        setLocalState: vi.fn((s: any) => { this.awareness.localState = s; }),
        getLocalState: () => this.awareness.localState,
      };
      this.configuration = { websocketProvider: { shouldConnect: true, connect: vi.fn() } };
    }
    get hasUnsyncedChanges() { return this.unsyncedChanges > 0; }
    on(event: string, cb: (payload: any) => void) { (this.handlers[event] ??= []).push(cb); }
    emit(event: string, payload: any) { for (const cb of [...this.handlers[event] ?? []]) cb(payload); }
    setAwarenessField(field: string, value: unknown) {
      const cur = this.awareness.getLocalState() ?? {};
      this.awareness.setLocalState({ ...cur, [field]: value });
    }
    async destroy() {
      this.destroyCalls++;
      if (this.destroyCalls === 1 && this.destroyGate) await this.destroyGate;
      // 契约锁 ㉔/㉖ 建模：destroy=removeAllListeners + awareness.destroy 序列推 meta clock 至 N+2
      this.handlers = {};
      const cur = this.awareness.meta.get(this.awareness.clientID)?.clock ?? 0;
      this.awareness.meta.set(this.awareness.clientID, { clock: cur + 2, lastUpdated: Date.now() });
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
    // document.hidden/recoverConnection 的 spyOn 不自动还原——泄漏会打穿后续 describe
    // 的 hidden 守卫类用例（批1-3 实测：hidden=true 残留 ⇒ recoverConnection 全部早退）
    vi.restoreAllMocks();
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

describe('批1-3：recoverConnection 两级原语（级别选择/瞬态/终态/clock 播种/单飞/守卫）', () => {
  beforeEach(() => {
    (HocuspocusProvider as any).instances.length = 0;
    useCanvasStore.setState({ connStatus: 'connecting', syncFailed: false, nodes: [], edges: [], connUi: 'ok', isHydrating: false });
  });
  afterEach(async () => {
    await runtime.destroyCollab();
  });

  async function beginSession(pid = 'p1') {
    const done = runtime.initCollab(pid);
    await tick();
    return { done, p: lastInstance() };
  }
  /** 健康会话建立（含 awareness 桥——终态重放断言前提） */
  async function driveToSyncedR(pid = 'p1') {
    const { done, p } = await beginSession(pid);
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

  it('级别选择（G1）：正常挂起形态 ⇒ 瞬态——provider 实例不变+不销毁+监听不重挂+ws.connect 兜底', async () => {
    const p = await driveToSyncedR();
    const handlerCountBefore = Object.fromEntries(
      ['status', 'authenticated', 'synced', 'message', 'close'].map((e) => [e, p.handlers[e]?.length ?? 0]),
    );
    const connect = p.configuration.websocketProvider.connect;
    await runtime.recovery.recoverConnection();
    expect(lastInstance()).toBe(p);                        // 瞬态=传输级：provider 实例不变
    expect(p.destroyCalls).toBe(0);                        // awareness/监听/消息队列全保留
    for (const [e, n] of Object.entries(handlerCountBefore)) {
      expect(p.handlers[e]?.length ?? 0).toBe(n);          // 六监听不重挂（事件处理器计数锚）
    }
    expect(connect).toHaveBeenCalledTimes(1);               // transport.reconnect 被调——mock 无 socket ⇒ needKick=true ⇒ ws.connect 兜底
  });

  it('级别选择（G1）：!ws.shouldConnect ⇒ 终态重建（瞬态 reconnect 在此是空操作——必红锚）', async () => {
    const p = await driveToSyncedR();
    p.configuration.websocketProvider.shouldConnect = false; // disconnect() 结构死形态
    await runtime.recovery.recoverConnection();
    const np = lastInstance();
    expect(np).not.toBe(p);                                 // 终态=会话级重建：实例变更（禁 connectCalls+1 式假恢复）
    expect(p.destroyCalls).toBe(1);
    expect(p.configuration.websocketProvider.connect).not.toHaveBeenCalled(); // 旧实例 ws 句柄不被碰
  });

  it('级别选择（G1）：!provider.isAttached ⇒ 终态重建', async () => {
    const p = await driveToSyncedR();
    p.isAttached = false;
    await runtime.recovery.recoverConnection();
    expect(lastInstance()).not.toBe(p);
    expect(p.destroyCalls).toBe(1);
  });

  it('终态重建：同 doc（getDoc 同引用）+本地编辑仍在+监听重挂+rebuildPending 武装', async () => {
    const p = await driveToSyncedR();
    const d = runtime.getDoc()!;
    d.getMap('nodes').set('local-1', new Y.Map());          // 断连期本地写（失联允许编辑锚）
    p.configuration.websocketProvider.shouldConnect = false;
    await runtime.recovery.recoverConnection();
    const np = lastInstance();
    expect(runtime.getDoc()).toBe(d);                       // 同 doc
    expect(d.getMap('nodes').get('local-1')).toBeTruthy();  // 本地编辑仍在
    for (const e of ['status', 'authenticated', 'synced', 'message', 'close']) {
      expect(np.handlers[e]?.length ?? 0).toBeGreaterThanOrEqual(1); // 契约锁㉔：destroy=removeAllListeners ⇒ 六监听重挂
    }
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(true);  // rebuildPending 置位（新实例计数 0 仍拦——重建窗口护栏）
  });

  it('clock 播种（契约锁㉖）：读值时点=destroy 之后——种子=旧实例 meta 终值（N+2），非读前值', async () => {
    const p = await driveToSyncedR();
    p.awareness.meta.set(p.awareness.clientID, { clock: 5, lastUpdated: 0 }); // 模拟历史 activity（N=5）
    p.configuration.websocketProvider.shouldConnect = false;
    await runtime.recovery.recoverConnection();
    const np = lastInstance();
    expect(p.awareness.meta.get(p.awareness.clientID)?.clock).toBe(7);       // mock 建模 destroy 序列推 N+2
    expect(np.awareness.clientID).toBe(p.awareness.clientID);                // 同 doc ⇒ 同 clientID
    expect(np.awareness.meta.get(np.awareness.clientID)?.clock).toBe(7);     // 播种=destroy 后读值（读前值 5/不播种 undefined 均红）
  });

  it('awareness 重放：终态后 setLocalState 收到完整 lastLocalUser（禁 {}）', async () => {
    const p = await driveToSyncedR();
    runtime.getAwareness()!.setLocalUser({ id: 'u1', name: '协作用户' });     // bridge 缓存 lastLocalUser
    p.awareness.setLocalState.mockClear();                                   // 隔离旧实例历史——重放必须来自新实例
    p.configuration.websocketProvider.shouldConnect = false;
    await runtime.recovery.recoverConnection();
    const np = lastInstance();
    expect(np).not.toBe(p);                                                  // 重放锚挂终态重建（占位实现 np===p 必红）
    expect(np.awareness.setLocalState).toHaveBeenCalledWith(
      expect.objectContaining({ user: { id: 'u1', name: '协作用户' } }),     // 完整态非空对象（R24）
    );
  });

  it('单飞：并发两调只执行一次重建', async () => {
    const p = await driveToSyncedR();
    p.configuration.websocketProvider.shouldConnect = false;
    const r1 = runtime.recovery.recoverConnection();
    const r2 = runtime.recovery.recoverConnection();
    await Promise.all([r1, r2]);
    expect(p.destroyCalls).toBe(1);
    expect((HocuspocusProvider as any).instances.length).toBe(2);           // 恰一次重建
  });

  it('守卫：document.hidden ⇒ 不下手', async () => {
    const p = await driveToSyncedR();
    const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await runtime.recovery.recoverConnection();
    expect(p.destroyCalls).toBe(0);
    expect(p.configuration.websocketProvider.connect).not.toHaveBeenCalled();
    hiddenSpy.mockRestore();
  });

  it('守卫：offline ⇒ 不下手；无 provider ⇒ no-op 不抛', async () => {
    const p = await driveToSyncedR();
    const onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await runtime.recovery.recoverConnection();
    expect(p.destroyCalls).toBe(0);
    expect(p.configuration.websocketProvider.connect).not.toHaveBeenCalled();
    onlineSpy.mockRestore();
    await runtime.destroyCollab();
    await expect(runtime.recovery.recoverConnection()).resolves.toBeUndefined();
  });
});

describe('批1-4：rebuildPending 实例绑定标记制（unsyncedChanges number===0 + 3s tick 兜底）', () => {
  // 真库事件序建模（spec 判据前置约定 / HP:333-335）：
  // - startSync 每次成功 open 调 resetUnsyncedChanges()=置 1 并 emit；
  // - 服务端对 SS1 不回 SyncStatus ⇒ 首个 'synced' 事件时计数恒 1（synced 早于 ack 一个 RTT）；
  // - decrement 无条件 emit（含归零 number===0）；decrement 归零同时置 synced=true（ack 是 synced 第二生产者）；
  // - 推论：重连后恒有一个 RTT 的 hasUnsyncedChanges 恒真窗口——解除判据必须推进过 ack。
  beforeEach(() => {
    vi.useFakeTimers();
    (HocuspocusProvider as any).instances.length = 0;
    useCanvasStore.setState({ connStatus: 'connecting', syncFailed: false, nodes: [], edges: [], connUi: 'ok', isHydrating: false });
  });
  afterEach(async () => {
    await runtime.destroyCollab();
    vi.useRealTimers();
    vi.restoreAllMocks();
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
  /** 终态重建（disconnect 结构死形态）——返回新实例 */
  async function rebuildTerminal(p: any) {
    p.configuration.websocketProvider.shouldConnect = false;
    await runtime.recovery.recoverConnection();
    return lastInstance();
  }

  it('首个 synced 不解除护栏（真库序：synced 时计数恒 1——ack 一个 RTT 后才归零）', async () => {
    const p = await driveToHealthy();
    const np = await rebuildTerminal(p);
    np.unsyncedChanges = 1;                    // startSync 置 1——synced 事件时计数恒 1
    np.isSynced = true;
    np.emit('synced', {});
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(true); // RTT 窗口内恒真
    np.unsyncedChanges = 0;                    // 隔离 rebuildPending 半边：ack 已落地（字段 0）但事件未发
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(true); // synced 解除式实现在此必红（假绿锚）
  });

  it('unsyncedChanges {number:0}（ack 归零 emit）⇒ 解除', async () => {
    const p = await driveToHealthy();
    const np = await rebuildTerminal(p);
    np.unsyncedChanges = 1;
    np.isSynced = true;
    np.emit('synced', {});
    np.unsyncedChanges = 0;                    // decrement 归零（HP:333-335：同置 synced=true）
    np.emit('unsyncedChanges', { number: 0 }); // decrement 无条件 emit（含归零）
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(false);
  });

  it('实例绑定：旧实例的 unsyncedChanges{number:0} 不清新实例标记', async () => {
    const p = await driveToHealthy();
    expect((p.handlers['unsyncedChanges'] ?? []).length).toBeGreaterThan(0); // 监听已挂（无实现必红）
    const staleCbs = [...(p.handlers['unsyncedChanges'] ?? [])] as Array<(payload: any) => void>;
    const np = await rebuildTerminal(p);
    np.unsyncedChanges = 0;
    for (const cb of staleCbs) cb({ number: 0 }); // 旧实例迟到 ack——destroy 后无投递通道，直接调用建模竞态窗口
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(true);
  });

  it('3s tick 兜底：isSynced && !hasUnsyncedChanges ⇒ 清（ack 事件丢失形态）', async () => {
    const p = await driveToHealthy();
    const np = await rebuildTerminal(p);
    np.isSynced = true;
    np.unsyncedChanges = 0;                    // 事件丢失——仅电平可读
    await vi.advanceTimersByTimeAsync(3_000);
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(false);
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
