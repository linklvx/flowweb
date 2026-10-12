// apps/web/src/collab/reconnectTransport.ts
// 批1-0 transport 薄层（决策门 B 裁决）——Y0b-5 T3b 改形（裁定 24⑷③）：needKick 语义随归零模型
// 整体废弃（"shouldConnect 未被我们动过"归零后恒假——close 链自持重连不存在，恢复所有权归
// connection-supervisor）。改形为 **socket 单实例注册表**：
//   ①注入类唯一构造点保留（库按 new WebSocketPolyfill(url) 每次重连新建实例——构造器副作用进册）；
//   ②activeSocketCount()：CONNECTING/OPEN 实例计数（模型不变量 (a) 的观测面——零并发 socket 锚）；
//   ③构造期"已有 CONNECTING/OPEN 实例则强关"不变量（phantom-socket 从纪律变结构——双 socket
//     存活即此处红，而非依赖 supervisor 槽位守卫单点）；
//   ④close 事件出册（终态实例不常驻——计数只反映活性）。
// 分层纪律：薄层不接管连接生命周期（不自持重连/退避——归 supervisor），只做注入+观测。
import { CollabCloseCode } from '@flowweb/shared';

const registry = new Set<WebSocket>();

/** 活跃 socket 计数（readyState∈{CONNECTING,OPEN}）—— supervisor 退避期间 ≤1 不变量的观测面 */
export function activeSocketCount(): number {
  let n = 0;
  for (const s of registry) {
    if (s.readyState === WebSocket.CONNECTING || s.readyState === WebSocket.OPEN) n++;
  }
  return n;
}

/**
 * _url 仅作 transport 语义标识保留——薄层永不自建 socket（新建由库 new 注入类完成，
 * 库用自己的 url），故不参与行为。
 */
export function createReconnectingWebSocket(_url: string): {
  WebSocketClass: typeof WebSocket;
} {
  class TransportWebSocket extends WebSocket {
    constructor(u: string | URL) {
      super(u);
      // 构造期不变量：已有 CONNECTING/OPEN 实例则强关（1000 正常码——不触发库 4408 特殊分支；
      // 归零模型下库零自持，关旧=纯资源回收+单实例结构性保证）
      for (const s of registry) {
        if (s.readyState === WebSocket.CONNECTING || s.readyState === WebSocket.OPEN) {
          try { s.close(CollabCloseCode.NORMAL, 'superseded'); } catch { /* 已关 */ }
        }
      }
      registry.add(this);
      this.addEventListener('close', () => registry.delete(this));
    }
  }
  return { WebSocketClass: TransportWebSocket };
}
