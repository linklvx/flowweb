// apps/web/src/collab/reconnectTransport.spec.ts
// Y0b-5 T3b（裁定 24⑷③）：socket 单实例注册表单测——needKick 语义随归零模型废弃后的改写形态。
// 装置说明：jsdom 有原生 WebSocket，但真实构造会发起 TCP 连接且 readyState 不可控，
// 故 stub 基类精确驱动 readyState 四态+close 事件面。
// extends 子句在工厂函数调用时求值——stubGlobal 先于 createReconnectingWebSocket 即生效。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReconnectingWebSocket, activeSocketCount } from './reconnectTransport';

/** 最小基类：close 记录入参并按 WHATWG 置 CLOSING；close 事件驱动出册 */
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  url: string;
  readyState = FakeWebSocket.CONNECTING;
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  private listeners = new Map<string, Array<(ev: any) => void>>();
  constructor(url: string) { this.url = url; }
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
  send() {}
  close(code?: number, reason?: string) {
    this.closeCalls.push({ code, reason });
    this.readyState = FakeWebSocket.CLOSING;
    for (const fn of [...(this.listeners.get('close') ?? [])]) fn({});
  }
}

const URL_ = 'ws://127.0.0.1:3001/collab';

describe('批1-0（T3b 改形）：socket 单实例注册表', () => {
  beforeEach(() => { vi.stubGlobal('WebSocket', FakeWebSocket); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('注入类唯一构造点保留：构造即入册——activeSocketCount 计数 CONNECTING/OPEN（活性面）', () => {
    const { WebSocketClass } = createReconnectingWebSocket(URL_);
    expect(activeSocketCount()).toBe(0);
    const s1 = new WebSocketClass(URL_) as unknown as FakeWebSocket;
    expect(activeSocketCount()).toBe(1);             // CONNECTING 计入
    s1.readyState = FakeWebSocket.OPEN;
    expect(activeSocketCount()).toBe(1);             // OPEN 计入
    s1.readyState = FakeWebSocket.CLOSED;
    expect(activeSocketCount()).toBe(0);             // CLOSED 不计（活性面）
  });

  it('构造期强关不变量：已有 OPEN 实例→新构造强关之（1000,"superseded"）；CLOSED 残留不波及', () => {
    const { WebSocketClass } = createReconnectingWebSocket(URL_);
    const s1 = new WebSocketClass(URL_) as unknown as FakeWebSocket;
    s1.readyState = FakeWebSocket.OPEN;
    const s2 = new WebSocketClass(URL_) as unknown as FakeWebSocket;
    s2.readyState = FakeWebSocket.CLOSED;            // 残留死实例——不阻塞不波及
    const s3 = new WebSocketClass(URL_) as unknown as FakeWebSocket;
    expect(s1.closeCalls[0]).toEqual({ code: 1000, reason: 'superseded' }); // ★构造期强关（phantom-socket 从纪律变结构）
    expect(s2.closeCalls).toHaveLength(0);           // CLOSED 不被波及
    // 强关后活性：s1 CLOSING 不计、s2 CLOSED 不计、s3 CONNECTING 计——单实例活性成立
    expect(activeSocketCount()).toBe(1);
  });

  it('close 事件出册：终态实例不常驻——计数只反映活性', () => {
    const { WebSocketClass } = createReconnectingWebSocket(URL_);
    const s = new WebSocketClass(URL_) as unknown as FakeWebSocket;
    expect(activeSocketCount()).toBe(1);
    s.close(1000, 'app');                            // close 事件 → registry.delete
    expect(activeSocketCount()).toBe(0);
  });

  it('CLOSING 态实例不在强关面（关闭握手挂起不阻塞新构造）；新实例 CONNECTING 计入活性', () => {
    const { WebSocketClass } = createReconnectingWebSocket(URL_);
    const s1 = new WebSocketClass(URL_) as unknown as FakeWebSocket;
    s1.readyState = FakeWebSocket.CLOSING;           // 关闭握手挂起形态
    const s2 = new WebSocketClass(URL_) as unknown as FakeWebSocket;
    expect(s1.closeCalls).toHaveLength(0);           // CLOSING 不在强关面（非 CONNECTING/OPEN）
    expect(s2.closeCalls).toHaveLength(0);
    expect(activeSocketCount()).toBe(1);             // s2 CONNECTING 计入；s1 CLOSING 不计
  });
});
