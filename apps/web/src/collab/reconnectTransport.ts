// apps/web/src/collab/reconnectTransport.ts
// 批1-0 transport 薄层（决策门 B 裁决）：自持传输——瞬态恢复 = transport.reconnect()，
// 不依赖库 attempt ladder 的契约（kick 方案的 ㉕/㉝ 约束随传输自持整体删除）。
// 形态：类工厂——注入类供 WebSocketPolyfill 使用（ws-polyfill.gate 四点验证过的形态：
// 库按 new WebSocketPolyfill(url) 每次重连新建实例，构造器副作用跟踪 current）。
// 分层纪律：薄层不接管库的生命周期（不自持重连循环/退避——那是库 ladder 的事），
// 只做两件事：①注入类 ②reconnect()=关旧 socket（1000 正常码——不触发库 4408 特殊分支）。
//
// needKick 返回值语义（分层裁定：薄层管 socket，库句柄归调用方 1-3）：
// - false：关的是 OPEN socket——库 onClose 分支（esm :404-412）按 shouldConnect（未被我们动过，
//   仍 true）自行调度重连，cancelWebsocketRetry 已被 onOpen 清除——close(1000) 即足够；
// - true：无实例/CONNECTING/CLOSING/CLOSED——close 链不可依赖（CONNECTING=attempt 在飞，
//   ㉕ 迟到 reject 续驱行为不确定），调用方需 ws.connect() 确定性取消在飞 attempt 并重建。
export interface ReconnectHandle {
  /** 关当前 socket；返回 needKick（true=调用方需 ws.connect() 兜底重建） */
  reconnect(): boolean;
}

/**
 * _url 仅作transport 语义标识保留——薄层永不自建 socket（新建由库 new 注入类完成，
 * 库用自己的 url），故不参与行为。
 */
export function createReconnectingWebSocket(_url: string): {
  WebSocketClass: typeof WebSocket;
  handle: ReconnectHandle;
} {
  let current: WebSocket | null = null;
  class TransportWebSocket extends WebSocket {
    constructor(u: string | URL) {
      super(u);
      current = this;
    }
  }
  const handle: ReconnectHandle = {
    reconnect(): boolean {
      const sock = current;
      // needKick 判据必须在 close 前取样——原生 close() 会立即置 readyState=CLOSING
      const wasOpen = !!sock && sock.readyState === WebSocket.OPEN;
      // 旧 socket 尽力关（半开连接资源回收；CLOSED 态 close 是 no-op 不抛）
      try { sock?.close(1000, 'app-recovery'); } catch { /* 已关 */ }
      return !wasOpen;
    },
  };
  return { WebSocketClass: TransportWebSocket, handle };
}
