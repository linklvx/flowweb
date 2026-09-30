// apps/web/src/collab/reconnectTransport.spec.ts
// 批1-0 transport 薄层（决策门 B 裁决——自持传输）单测。
// 装置说明：jsdom 有原生 WebSocket，但真实构造会发起 TCP 连接且 readyState 不可控
// （needKick 语义的判据输入），故 stub 基类精确驱动 readyState 四态。
// extends 子句在工厂函数调用时求值——stubGlobal 先于 createReconnectingWebSocket 即生效。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReconnectingWebSocket } from './reconnectTransport';

/** 最小基类：close 记录入参并按 WHATWG 置 CLOSING（readyState 由用例显式摆位） */
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  url: string;
  readyState = FakeWebSocket.CONNECTING;
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  constructor(url: string) { this.url = url; }
  close(code?: number, reason?: string) {
    this.closeCalls.push({ code, reason });
    this.readyState = FakeWebSocket.CLOSING;
  }
}

const URL_ = 'ws://127.0.0.1:3001/collab';
const make = () => createReconnectingWebSocket(URL_);

describe('批1-0：transport 薄层 createReconnectingWebSocket', () => {
  beforeEach(() => { vi.stubGlobal('WebSocket', FakeWebSocket); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('实例跟踪：最新 new 的实例成为 current——reconnect 只关新不关旧', () => {
    const { WebSocketClass, handle } = make();
    const s1 = new WebSocketClass(URL_) as unknown as FakeWebSocket;
    const s2 = new WebSocketClass(URL_) as unknown as FakeWebSocket;
    handle.reconnect();
    expect(s1.closeCalls).toHaveLength(0); // 旧实例不被波及（库侧消息队列/监听保持）
    expect(s2.closeCalls).toHaveLength(1); // current 指向最新构造实例
  });

  it('reconnect 关旧实例：close(1000, "app-recovery")——1000 正常码不触发库 4408 特殊分支', () => {
    const { WebSocketClass, handle } = make();
    const s = new WebSocketClass(URL_) as unknown as FakeWebSocket;
    s.readyState = FakeWebSocket.OPEN;
    handle.reconnect();
    expect(s.closeCalls[0]).toEqual({ code: 1000, reason: 'app-recovery' });
  });

  it('needKick=false：OPEN socket——close 链确定性触发库自持重连（esm onClose 分支，shouldConnect 未动）', () => {
    const { WebSocketClass, handle } = make();
    const s = new WebSocketClass(URL_) as unknown as FakeWebSocket;
    s.readyState = FakeWebSocket.OPEN;
    expect(handle.reconnect()).toBe(false);
  });

  it('needKick=true：CONNECTING（attempt 在飞/挂起——close 链不可依赖，调用方 ws.connect() 兜底）', () => {
    const { WebSocketClass, handle } = make();
    const s = new WebSocketClass(URL_) as unknown as FakeWebSocket;
    s.readyState = FakeWebSocket.CONNECTING;
    expect(handle.reconnect()).toBe(true);
    expect(s.closeCalls).toHaveLength(1); // 仍尽力关旧（半开连接资源回收）
  });

  it('needKick=true：无实例 / CLOSING / CLOSED（close 链无事件可发）', () => {
    const a = make();
    expect(a.handle.reconnect()).toBe(true); // 无实例——不抛
    const { WebSocketClass, handle } = make();
    const s = new WebSocketClass(URL_) as unknown as FakeWebSocket;
    s.readyState = FakeWebSocket.CLOSING;
    expect(handle.reconnect()).toBe(true);
    const s2 = new WebSocketClass(URL_) as unknown as FakeWebSocket;
    s2.readyState = FakeWebSocket.CLOSED;
    expect(handle.reconnect()).toBe(true);
  });

  it('双重 reconnect：OPEN 首踢 false→close 置 CLOSING→再踢 true（冷却窗口二次恢复的退化语义）', () => {
    const { WebSocketClass, handle } = make();
    const s = new WebSocketClass(URL_) as unknown as FakeWebSocket;
    s.readyState = FakeWebSocket.OPEN;
    expect(handle.reconnect()).toBe(false);
    expect(handle.reconnect()).toBe(true); // FakeWebSocket.close 已置 CLOSING
    expect(s.closeCalls).toHaveLength(2);  // 幂等尽力关——不抛不静默
  });
});
