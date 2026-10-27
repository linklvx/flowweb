// apps/web/src/collab/connection-supervisor.test.ts
// Y0b-5 T3b：CollabConnectionSupervisor 红测（plan Step 1——真协议路径，锚用真实库装置）。
// 装置：真实 @hocuspocus/provider + fake WebSocket 基类（WebSocketPolyfill 注入边界——库全真，
// fake 的只是"传输"；api 侧 collab.behavior-anchors.gate.spec A6a-6f 同族装置的客户端镜像）。
// 确定性：fake timers + setSupervisorJitterForTest(() => 0)——阶梯断言零随机。
// 所有权对照（实现契约）：supervisor 独占全部 connect/disconnect；库定时器被 open 归零
// shouldConnect 结构性禁用（api 侧 A6a 锚锁库半边，本文件锁 supervisor 接管半边）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { resolveBackoffPlan } from '@flowweb/shared';
import {
  createSupervisor, setSupervisorJitterForTest, AUTH_WAIT_TIMEOUT_MS, CollabConnectionSupervisor,
  type SupervisorDeps,
} from './connection-supervisor';

// ── fake WebSocket 基类（实现库用到的注入面 + 测试驱动面；api 侧 A6 装置同构） ──
class FakeWebSocketBase {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocketBase[] = [];
  readyState: number = FakeWebSocketBase.CONNECTING;
  binaryType = 'blob';
  identifier = 0;
  url: string;
  sent: Uint8Array[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  private listeners = new Map<string, Array<(ev: any) => void>>();
  constructor(url: string | URL) {
    this.url = String(url);
    FakeWebSocketBase.instances.push(this);
  }
  static reset() { FakeWebSocketBase.instances = []; }
  /** 活跃 socket（readyState∈{CONNECTING,OPEN}）——模型不变量 (a) 的计数面 */
  static liveCount(): number {
    return FakeWebSocketBase.instances.filter((s) => s.readyState <= 1).length;
  }
  addEventListener(type: string, fn: (ev: any) => void) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }
  removeEventListener(type: string, fn: (ev: any) => void) {
    const arr = this.listeners.get(type);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  send(data: Uint8Array) { this.sent.push(data); }
  close(code?: number, reason?: string) {
    this.closeCalls.push({ code, reason });
    if (this.readyState <= FakeWebSocketBase.OPEN) {
      this.readyState = FakeWebSocketBase.CLOSED;
      this.fire('close', { code, reason });
    }
  }
  private fire(type: string, ev: any) { for (const fn of [...(this.listeners.get(type) ?? [])]) fn(ev); }
  serverOpen() { this.readyState = FakeWebSocketBase.OPEN; this.fire('open', {}); }
  serverClose(code: number, reason = '') { this.readyState = FakeWebSocketBase.CLOSED; this.fire('close', { code, reason }); }
  serverMessage(data: Uint8Array) { this.fire('message', { data }); }
  /** 真实 WS 生命周期：error 事件后必随 close（error→close 不可分——connectionAttempt 经 onClose 链清空） */
  serverError() {
    this.fire('error', new Error('fake-error'));
    this.readyState = FakeWebSocketBase.CLOSED;
    this.fire('close', { code: 1006, reason: '' });
  }
}

const PING = new Uint8Array([9]);
const lastSocket = () => FakeWebSocketBase.instances[FakeWebSocketBase.instances.length - 1]!;

// ── 装置：真实 provider + pin + supervisor（复制 runtime 的事件接线——authenticationFailed/
//    close 两入口由本装置接给 supervisor，模拟 bindProviderListeners 改道后的生产形态） ──
interface Device { provider: HocuspocusProvider; ws: any; supervisor: CollabConnectionSupervisor; providerDestroyed: number }

/** 活跃装置登记——afterEach 统一 teardown+destroy（陈旧 timer 不得跨用例/跨轮次创建 socket：
 *  生产侧 teardownSession 恒调 supervisor.teardown，本登记是该生命周期的测试镜像） */
const activeDevices: Device[] = [];

function makeDevice(name: string, opts: { isOffline?: () => boolean } = {}): Device {
  FakeWebSocketBase.reset();
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: 'ws://fake.invalid:1', name, document: doc, token: 't',
    WebSocketPolyfill: FakeWebSocketBase as any,
    maxAttempts: 1, delay: 1_000, maxDelay: 30_000, messageReconnectTimeout: 30_000,
    autoConnect: false,
  } as any);
  const ws: any = (provider as any).configuration.websocketProvider;
  const supervisor = createSupervisor({
    getProvider: () => provider,
    isConnOffline: () => opts.isOffline?.() ?? false,
  });
  supervisor.attach(provider);
  supervisor.connectOnce();
  // 生产接线镜像（bindProviderListeners 改道后形态）：authenticationFailed/close→supervisor
  provider.on('authenticationFailed', ({ reason }: any) => supervisor.beginTransientBackoff(reason));
  provider.on('close', ({ event }: any) => { supervisor.routeClose(event?.code, event?.reason); });
  const d: Device = { provider, ws, supervisor, providerDestroyed: 0 };
  activeDevices.push(d);
  return d;
}

/** 会话终结（生产 teardownSession 镜像）：先 teardown（清 timer+epoch++——陈旧 timer 判活作废）
 *  后 destroy。模型测试 50 轮共用 fake 时钟——漏 teardown 的轮次其陈旧 timer 会在后续轮次
 *  的 instances 数组创建 socket（实测红相——这正是 (d) 不变量的存在理由）。 */
function teardownDevice(d: Device): void {
  d.supervisor.teardown();
  d.provider.destroy();
}

/** 健康序驱动：connectOnce 的 socket → open → authenticated（supervisor 侧 attempt 清零/authTimer 摘除） */
function driveOpenAuthenticated(d: Device) {
  lastSocket().serverOpen();
  (d.provider as any).emit('authenticated', { scope: 'read-write' });
}

describe('connection-supervisor：单连接所有权（真实库装置）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSupervisorJitterForTest(() => 0);
  });
  afterEach(() => {
    for (const d of activeDevices.splice(0)) teardownDevice(d);
    vi.useRealTimers();
    setSupervisorJitterForTest(null);
  });

  it('真协议①：authenticationFailed("server-overloaded")（瞬态档）→先 disconnect（废 OPEN 僵尸）→按表 2s→connect', async () => {
    const d = makeDevice('t1');
    driveOpenAuthenticated(d);
    expect(FakeWebSocketBase.liveCount()).toBe(1);
    (d.provider as any).emit('authenticationFailed', { reason: 'server-overloaded' });
    expect(d.ws.shouldConnect).toBe(false);                    // ★先断——废库 1s 定时器外第二道保险（归零外）
    expect(FakeWebSocketBase.liveCount()).toBe(0);             // OPEN 僵尸已废
    await vi.advanceTimersByTimeAsync(1_500);
    expect(FakeWebSocketBase.instances.length).toBe(1);        // <2s 首档——零热循环
    await vi.advanceTimersByTimeAsync(1_000);                  // 2.5s
    expect(FakeWebSocketBase.instances.length).toBe(2);        // ★supervisor 按表首连
    expect(d.ws.shouldConnect).toBe(true);                     // connect 置位（esm:225——open 后再归零）
    lastSocket().serverOpen();
    expect(d.ws.shouldConnect).toBe(false);                    // open 再归零（结构锚跨 supervisor 路径成立）
    d.provider.destroy();
  });

  it('真协议②：close(1008,"msg-rate-exceeded") 同入退避；4408"forced" 仅分类器（库合成不 emit close——客户端不可观测）', async () => {
    const d = makeDevice('t2');
    driveOpenAuthenticated(d);
    lastSocket().serverClose(1008, 'msg-rate-exceeded');       // 真实 close 事件 → 装置接线 → routeClose
    expect(d.supervisor.phase).toBe('waiting');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeWebSocketBase.instances.length).toBe(2);        // backoff 档指数表首连（attempt=0→2s）
    d.provider.destroy();
    // 分类器单测（非生产路径——4408 库内部合成走 disconnect 事件面，见去重用例）
    expect(resolveBackoffPlan('close', 4408, 'forced', 0, 0).kind).toBe('exponential');
  });

  it('connectOnce 三防：disconnect 后 webSocket===null⇒放行（死锁反向锚）；CLOSED 残留放行；失败后复置 shouldConnect=false', async () => {
    const d = makeDevice('t3');
    driveOpenAuthenticated(d);
    // ⑥镜像：disconnect → cleanupWebSocket → webSocket===null——"非空即退"在此永不重连=死锁
    d.ws.disconnect();
    expect(d.ws.webSocket).toBeNull();
    expect(d.supervisor.connectOnce()).toBe(true);             // ★放行
    expect(FakeWebSocketBase.instances.length).toBe(2);
    // CLOSED 残留（非 null 但 readyState=CLOSED——静默死亡零事件）：守卫按 readyState 判定⇒放行
    lastSocket().readyState = FakeWebSocketBase.CLOSED;
    expect(d.supervisor.connectOnce()).toBe(true);
    expect(FakeWebSocketBase.instances.length).toBe(3);
    // 失败复置：connect() reject（maxAttempts:1 ladder 用尽）→ catch → setConfiguration 归零
    expect(d.ws.shouldConnect).toBe(true);                     // connect 置位（esm:225）
    lastSocket().serverError();
    await vi.advanceTimersByTimeAsync(0);                      // flush 微任务（retry 无 sleep——maxAttempts:1）
    expect(d.ws.shouldConnect).toBe(false);                    // ★失败窗内一致性——防残余路径排库定时器
    d.provider.destroy();
  });

  it('槽位守卫：OPEN/CONNECTING 在飞时 connectOnce 零第二实例（锚⑤——双 connect 必炸的库形态）', async () => {
    const d = makeDevice('t4');
    driveOpenAuthenticated(d);
    expect(FakeWebSocketBase.instances.length).toBe(1);
    expect(d.supervisor.connectOnce()).toBe(false);            // OPEN——槽位被占
    expect(FakeWebSocketBase.instances.length).toBe(1);        // ★零第二 socket
    // CONNECTING 在飞（attempt 槽位）形态
    lastSocket().serverClose(1006, '');
    await vi.advanceTimersByTimeAsync(2_000);                  // supervisor 重连（attempt 在飞 CONNECTING）
    expect(lastSocket().readyState).toBe(FakeWebSocketBase.CONNECTING);
    expect(d.supervisor.connectOnce()).toBe(false);
    expect(FakeWebSocketBase.instances.length).toBe(2);        // 零第三 socket
    d.provider.destroy();
  });

  it('Step④ 显式超时：connect 后 AUTH_WAIT_TIMEOUT_MS(10s) 内未 authenticated→断+attempt++ 重排（防 OPEN 挂起）', async () => {
    const d = makeDevice('t5');
    lastSocket().serverOpen();                                 // socket OPEN 但永不 authenticated
    expect(d.supervisor.snapshot().authTimer).toBe(true);      // authTimer 已武装
    await vi.advanceTimersByTimeAsync(AUTH_WAIT_TIMEOUT_MS - 100);
    expect(FakeWebSocketBase.instances.length).toBe(1);        // 窗内零动作
    await vi.advanceTimersByTimeAsync(100);                    // 10s 到点
    expect(d.ws.shouldConnect).toBe(false);                    // ★断（permissionDenied 只 emit 不断开——esm:949-952 挂起形态根治）
    expect(d.supervisor.snapshot().attempt).toBe(1);           // attempt++
    await vi.advanceTimersByTimeAsync(5_000);                  // 重排=指数表（档位按既有失败数——jitter0 确定性落点）
    expect(FakeWebSocketBase.instances.length).toBe(2);        // 重排已落（阶梯推进）
    d.provider.destroy();
  });

  it('authenticated 到达→attempt=0 清零+authTimer 摘除', async () => {
    const d = makeDevice('t6');
    lastSocket().serverOpen();
    d.supervisor.beginTransientBackoff('server-overloaded');   // 瞬态——schedule(attempt=0, 2s)
    await vi.advanceTimersByTimeAsync(2_000);                  // fire→attempt=1→connectOnce
    expect(d.supervisor.snapshot().attempt).toBe(1);
    (d.provider as any).emit('authenticated', { scope: 'read-write' });
    expect(d.supervisor.snapshot().attempt).toBe(0);           // ★清零
    expect(d.supervisor.snapshot().authTimer).toBe(false);     // ★authTimer 摘除
    await vi.advanceTimersByTimeAsync(AUTH_WAIT_TIMEOUT_MS);   // 已摘——零后续动作
    expect(FakeWebSocketBase.instances.length).toBe(2);
    d.provider.destroy();
  });

  it('退避期间零并发 socket+零 unhandled rejection：阶梯续试全程 liveCount≤1；首连失败吞 reject', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      const d = makeDevice('t7');
      lastSocket().serverOpen();
      lastSocket().serverClose(1006, '');                      // 普通掉线→exponential
      for (let round = 0; round < 4; round++) {                // 阶梯 2s/5s/10s/30s 续试——全程零并发
        await vi.advanceTimersByTimeAsync(31_000);             // 覆盖最大档 30s——本轮 fire 必落
        expect(FakeWebSocketBase.liveCount()).toBeLessThanOrEqual(1);   // ★(a)
        lastSocket().serverOpen();
        lastSocket().serverClose(1006, '');                    // 每轮失败→下一档
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(unhandled).toEqual([]);                           // ★零 unhandled rejection（吞 ATTEMPT_ABORTED 外 reject）
      d.provider.destroy();
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('1012 planned-restart：short 档 1s（jitter0）+sessionEpoch 捕获——teardown 后旧 timer 不 kick 新 provider', async () => {
    const d = makeDevice('t8');
    driveOpenAuthenticated(d);
    lastSocket().serverClose(1012, '');                        // 真实 close 事件→routeClose→short 档
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeWebSocketBase.instances.length).toBe(2);        // short 档 1s 首连
    // 真实缺陷路径：排程后 teardown（epoch++）→旧 timer 不得 kick 新 provider
    lastSocket().serverClose(1012, '');
    d.supervisor.teardown();
    const socketsAtTeardown = FakeWebSocketBase.instances.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocketBase.instances.length).toBe(socketsAtTeardown);   // ★旧 timer 已废（epoch 判活）
    expect(d.supervisor.phase).toBe('idle');
    d.provider.destroy();
  });

  it('terminal→disconnect 终局不重试；assertHealthy 终态恒 false；二次 terminal 幂等', async () => {
    const d = makeDevice('t9');
    driveOpenAuthenticated(d);
    const decision = d.supervisor.routeClose(1009, 'message-too-big');
    expect(decision.terminal).toBe(true);
    expect(d.supervisor.phase).toBe('terminal');
    expect(d.ws.shouldConnect).toBe(false);                    // 真停连
    expect(d.supervisor.snapshot().timer).toBe(false);         // 零 timer（(c) 不变量）
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocketBase.instances.length).toBe(1);        // 零重试（复发防线）
    expect(d.supervisor.assertHealthy(true)).toBe(false);      // watchdog 单向边终态不出手
    const again = d.supervisor.routeClose(1000, '');           // 迟到帧——幂等
    expect(again.terminal).toBe(true);
    expect(again.already).toBe(true);
    d.provider.destroy();
  });

  it('瞬态档恢复时延：server-overloaded 后首 connect 恰在 2-4s 窗（jitter=0→2s 整）', async () => {
    const d = makeDevice('t10');
    driveOpenAuthenticated(d);
    (d.provider as any).emit('authenticationFailed', { reason: 'server-overloaded' });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(FakeWebSocketBase.instances.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocketBase.instances.length).toBe(2);        // 2s 整——表底档
    d.provider.destroy();
  });

  it('普通掉线收归：open 过→1006→库零定时器（1.5s）→supervisor 2s 首连→服务端不可用阶梯续试不停摆', async () => {
    const d = makeDevice('t11');
    driveOpenAuthenticated(d);
    lastSocket().serverClose(1006, '');                        // 真实 close→routeClose→backoff
    await vi.advanceTimersByTimeAsync(1_500);
    expect(FakeWebSocketBase.instances.length).toBe(1);        // ★库零定时器（归零锚①端到端——改前此处库已 1s 重连）
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeWebSocketBase.instances.length).toBe(2);        // supervisor 首连 2s
    lastSocket().serverClose(1006, '');                        // 服务端仍不可用——
    await vi.advanceTimersByTimeAsync(5_000);                  // 下一档 5s
    expect(FakeWebSocketBase.instances.length).toBe(3);        // ★阶梯续试不因单次失败停摆（maxAttempts:1 反面）
    lastSocket().serverOpen();
    lastSocket().serverClose(1006, '');
    await vi.advanceTimersByTimeAsync(10_000);                 // 再下一档 10s
    expect(FakeWebSocketBase.instances.length).toBe(4);
    d.provider.destroy();
  });

  it('hidden 期间不连（timer 挂起重排不消耗）→visible+kickNow 即连', async () => {
    const d = makeDevice('t12');
    driveOpenAuthenticated(d);
    const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    lastSocket().serverClose(1006, '');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(FakeWebSocketBase.instances.length).toBe(1);        // ★hidden 零 connect（对照现状 hidden 永不恢复）
    expect(d.supervisor.snapshot().timer).toBe(true);          // 恰一 timer 挂着（重排不消耗——(b) 不变量）
    hiddenSpy.mockRestore();
    d.supervisor.kickNow();                                    // visibilitychange(可见) 接线
    await vi.advanceTimersByTimeAsync(3_000);
    expect(FakeWebSocketBase.instances.length).toBe(2);        // 0-3s jitter（jitter0→0ms）即连
    d.provider.destroy();
  });

  it('silent-renew 档收编：close(4401,"session-expired")→500ms 立即一次+闩锁；第二次同因回落 terminal 不重试；authenticated 重置额度', async () => {
    const d = makeDevice('t13');
    driveOpenAuthenticated(d);
    lastSocket().serverClose(4401, 'session-expired');         // 真实 close→routeClose→silent-renew
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeWebSocketBase.instances.length).toBe(2);        // ★立即一次（不进阶梯）
    lastSocket().serverOpen();
    lastSocket().serverClose(4401, 'session-expired');         // 二次同因——额度已用
    expect(d.supervisor.phase).toBe('terminal');               // ★回落 terminal
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocketBase.instances.length).toBe(2);        // 零重试
    d.provider.destroy();
    // authenticated 重置额度（新会话语义——独立装置）
    const e = makeDevice('t13b');
    driveOpenAuthenticated(e);                                 // authenticated——额度就绪
    lastSocket().serverClose(4401, 'session-expired');
    await vi.advanceTimersByTimeAsync(500);
    lastSocket().serverOpen();
    (e.provider as any).emit('authenticated', { scope: 'read-write' });   // 续期成功——额度重置
    lastSocket().serverClose(4401, 'session-expired');
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeWebSocketBase.instances.length).toBe(3);        // ★第二次静默续期（S-4 语义）
    e.provider.destroy();
  });

  it('normal(1000) 带退避一次重连：close(1000)→exponential 档（库抹码掩盖瞬态——真终态由握手 auth 拒权威分型）', async () => {
    const d = makeDevice('t14');
    driveOpenAuthenticated(d);
    lastSocket().serverClose(1000, '');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeWebSocketBase.instances.length).toBe(2);        // exponential 首档重连
    d.provider.destroy();
  });

  it('模型式不变量：随机事件序列 N=50 轮——(a)live≤1 (b)waiting 恰一 timer/在飞 (c)terminal 零 timer (d)teardown 后零 timer 零 kick', async () => {
    // 确定性伪随机（mulberry32——种子固定，红绿可复现）
    let seed = 0x2f6e2b1;
    const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const ACTION_NAMES = ['open', 'close1006', 'authFail', 'close1012', 'close4401', 'kick', 'teardown', 'close1000'];
    for (let round = 0; round < 50; round++) {
      const d = makeDevice(`model-${round}`);
      const actions: Array<() => void> = [
        () => { const s = lastSocket(); if (s && s.readyState === FakeWebSocketBase.CONNECTING) s.serverOpen(); },
        () => { const s = lastSocket(); if (s && s.readyState === FakeWebSocketBase.OPEN) s.serverClose(1006, ''); },
        () => { (d.provider as any).emit('authenticationFailed', { reason: 'server-overloaded' }); },
        () => { d.supervisor.routeClose(1012, ''); },
        () => { d.supervisor.routeClose(4401, 'session-expired'); },
        () => { d.supervisor.kickNow(); },
        () => { d.supervisor.teardown(); },
        () => { const s = lastSocket(); if (s && s.readyState === FakeWebSocketBase.OPEN) s.serverClose(1000, ''); },
      ];
      const history: string[] = [];
      for (let step = 0; step < 8; step++) {
        const idx = Math.floor(rnd() * actions.length);
        history.push(`${ACTION_NAMES[idx]}@${step}`);
        actions[idx]();
        await vi.advanceTimersByTimeAsync(Math.floor(rnd() * 2_000));
        const snap = d.supervisor.snapshot();
        const live = FakeWebSocketBase.liveCount();
        // (a) 活跃 socket ≤1——单连接所有权
        if (live > 1) {
          throw new Error(`[model round=${round} step=${step}] live=${live} history=[${history.join(',')}] snap=${JSON.stringify(snap)} sockets=${FakeWebSocketBase.instances.map((s) => s.readyState).join(',')}`);
        }
        expect(live).toBeLessThanOrEqual(1);
        if (snap.phase === 'terminal') {
          // (c) terminal 后零 timer
          expect(snap.timer).toBe(false);
          expect(snap.authTimer).toBe(false);
        }
        if (snap.phase === 'idle') {
          // (d) teardown 后零 timer
          expect(snap.timer).toBe(false);
          expect(snap.authTimer).toBe(false);
        }
        if (snap.phase === 'waiting' && !snap.inFlight) {
          // (b) 瞬态恰一待触发 timer（不多不少）
          if (!snap.timer) {
            throw new Error(`[model (b) round=${round} step=${step}] waiting+no-timer+no-inflight history=[${history.join(',')}] snap=${JSON.stringify(snap)} sockets=${FakeWebSocketBase.instances.map((s) => s.readyState).join(',')}`);
          }
          expect(snap.timer).toBe(true);
        }
      }
      teardownDevice(d);
      await vi.advanceTimersByTimeAsync(0);
      FakeWebSocketBase.reset();
    }
  });

  it('kickNow：已排程/在飞则忽略（恰一 timer）；idle 态 0-3s jitter 内 connect', async () => {
    const d = makeDevice('t15');
    driveOpenAuthenticated(d);
    lastSocket().serverClose(1006, '');                        // waiting——timer 已排程（2s）
    expect(d.supervisor.kickNow()).toBe(false);                // ★已排程——忽略
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeWebSocketBase.instances.length).toBe(2);        // 恰一次 connect（kick 未叠加）
    lastSocket().serverOpen();                                 // connected+OPEN——在飞
    expect(d.supervisor.kickNow()).toBe(false);                // ★在飞——忽略（零新 socket）
    expect(FakeWebSocketBase.instances.length).toBe(2);
    lastSocket().serverClose(1006, '');                        // close→timer 排程
    d.supervisor.teardown();                                   // 清 timer——idle 是 kick 的合法态
    expect(d.supervisor.kickNow()).toBe(true);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(FakeWebSocketBase.instances.length).toBe(3);        // 0-3s jitter 内 connect（jitter0→0ms）
    d.provider.destroy();
  });

  it('assertHealthy 单向边：offline∧非 terminal∧零在飞 timer/attempt∧onLine 才出手；once 后零重复', async () => {
    let offline = false;
    const d = makeDevice('t16', { isOffline: () => offline });
    driveOpenAuthenticated(d);
    expect(d.supervisor.assertHealthy(true)).toBe(false);      // connStatus 非 offline
    offline = true;
    expect(d.supervisor.assertHealthy(true)).toBe(false);      // 在飞（socket OPEN——attempt 槽位被占）
    lastSocket().serverClose(1006, '');                        // 断连——connStatus offline 形态
    expect(d.supervisor.assertHealthy(true)).toBe(false);      // timer 已在（close 已排程——零重复）
    await vi.advanceTimersByTimeAsync(2_000);                  // fire→connectOnce→authTimer 武装
    expect(d.supervisor.assertHealthy(true)).toBe(false);      // authTimer 在（AUTH_WAIT 窗——非 stalled）
    // stalled 形态构造：serverError（error+close 生命周期——attempt 清）+teardown 清 timer
    //（模拟事件路由全部缺席的楔死——assertHealthy 的存在理由）
    lastSocket().serverError();
    d.supervisor.teardown();
    const onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(d.supervisor.assertHealthy(true)).toBe(false);      // ★onLine=false 不出手（飞行模式不烧阶梯）
    onlineSpy.mockRestore();
    expect(d.supervisor.assertHealthy(true)).toBe(true);       // ★onLine 恢复——排程
    expect(d.supervisor.snapshot().timer).toBe(true);
    expect(d.supervisor.assertHealthy(true)).toBe(false);      // once——timer 已在
    d.provider.destroy();
  });

  it('disconnect 事件订阅：真实 close 两事件同源去重（恰一排程）；4408 合成路径（不 emit close）→disconnect 面路由恢复', async () => {
    const d = makeDevice('t17');
    driveOpenAuthenticated(d);
    lastSocket().serverClose(1006, '');                        // close→routeClose→排程；随后 provider 'disconnect' 同源
    (d.provider as any).emit('disconnect', { event: { code: 1006, reason: '' } });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeWebSocketBase.instances.length).toBe(2);        // ★去重——恰一次恢复
    lastSocket().serverOpen();
    // 库合成 4408：checkConnection strike3 直调 ws.onClose（checkConnection 同款入口）——
    // provider 只收 disconnect（close 客户端不可观测）+cleanup 静默关 socket（listener 已摘——零 close 事件）
    (d.ws as any).onClose({ event: { code: 4408, reason: 'forced' } });
    await vi.advanceTimersByTimeAsync(0);                      // 延迟一拍路由（close 缺席→本拍兜底）
    expect(d.supervisor.phase).toBe('waiting');                // ★disconnect 面路由→backoff 排程
    await vi.advanceTimersByTimeAsync(5_000);                  // attempt=1（首连 fire 已递增）→steps[1]=5s 档
    expect(FakeWebSocketBase.instances.length).toBe(3);        // 4408 恢复闭环（客户端不可观测 close 的补路）
    d.provider.destroy();
  });

  it('open 后不变量自愈：shouldConnect===true 时重放归零（hook 单点自证）', async () => {
    const d = makeDevice('t18');
    lastSocket().serverOpen();
    expect(d.ws.shouldConnect).toBe(false);                    // 归零已落
    d.ws.shouldConnect = true;                                 // 模拟异常形态（mock 漂移/未来库行为漂移）
    lastSocket().serverMessage(PING);                          // 无关流量——不触发
    d.ws.shouldConnect = true;
    // 重放归零 = open 监听逻辑复跑（supervisor 公开面：zeroNow）
    d.supervisor.zeroNow();
    expect(d.ws.shouldConnect).toBe(false);                    // ★自愈
    d.provider.destroy();
  });
});


// ═══ T25b M-R1/M-2：resyncing 相位守卫（supervisor 级确定性面——runtime 集成测 mr1-1/mr1-2 的语义稳定锚）═══
describe('T25b M-R1/M-2：resyncing 相位（kickNow/assertHealthy 让位+teardown 保相+resume 出口+endResync）', () => {
  function makeSupervisor(opts: Partial<SupervisorDeps> = {}) {
    return new CollabConnectionSupervisor({
      getProvider: () => null,
      isConnOffline: () => true,   // offline 电平（assertHealthy 出手前置）
      ...opts,
    });
  }

  it('★beginResync 后 kickNow/assertHealthy 让位（零排程）+endResync 恢复常规监管', () => {
    const sup = makeSupervisor();
    expect(sup.beginResync()).toBe(true);
    expect(sup.phase).toBe('resyncing');
    expect(sup.kickNow()).toBe(false);                    // 修前：kick 排程连旧 provider（mr1-1 红的同源）
    expect(sup.assertHealthy(true)).toBe(false);          // 修前：stalled 排程（mr1-2 红的同源）
    expect(sup.snapshot().timer).toBe(false);
    sup.endResync();
    expect(sup.phase).toBe('idle');
    expect(sup.assertHealthy(true)).toBe(true);           // 恢复常规监管（watchdog 出手——防让位死区）
  });

  it('★M-2 teardown 保持 resyncing 相位（destroy await 缝守卫）——resume 公法已删（微批 spec M-3 收口：resumeFromRecovery 改走 resyncFull 重建，terminal 出口=teardown 归 idle 零遗留公法）', () => {
    const sup = makeSupervisor();
    sup.beginResync();
    sup.teardown();
    expect(sup.phase).toBe('resyncing');                  // 修前：teardown 归零 idle=await 缝失守
    sup.endResync();
    sup.terminalDisconnect('recovery-mode');
    expect(sup.phase).toBe('terminal');
    sup.teardown();                                       // 生产 terminal 出口形态（resyncFull→initCollab→teardownSession）
    expect(sup.phase).toBe('idle');
  });
});
