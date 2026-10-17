// apps/api/src/modules/collab/collab-outbound-budget.ts
// R4b'（v3）：出站背压判定核+全局预算同步记账——自 SG wrapBackpressure 整体迁入。
// 帧型四档（v3——MessageType 枚举实证 SyncReply=4 是 SS1 回复携全 doc diff 的载体，v2 漏归=上界失效）：
//   ①大帧组 Sync(0)+SyncReply(4)：前瞻 close（backlog+frame>close）——封顶单连接真实上界；
//   ②控制组 Stateless(5)/BroadcastStateless(6)/SyncStatus(8)/Ping(9)/Pong(10)/QueryAwareness(3)：
//     仅 backlog>close 才关（+20B 不触发前瞻）且**预算豁免**（doc-status/conn-status/心跳永不因
//     预算静默丢——控制帧承载状态通道，丢=状态丢失比 close 更糟）；
//   ③Awareness(1)：永 drop 不 close；
//   ④预算失败：大帧组 close(reason='global-budget')，控制/awareness 组不计不投。
// getBacklog 闭包（v3）：bufferedAmount 读点文本留 SG 闭包——本文件零该属性读出现
// → census ⑤ 脚本/自测/backpressure spec 三处零改（读点仍唯一=SG，弃 v2「目标文件切换」方案）。
import { readFrameType, MessageType } from './collab-frame-type';
import { CollabCloseCode } from '@flowweb/shared';
import type { CollabLimits } from './collab-limits';
import { collabAwarenessDroppedTotal, collabSlowConsumerDisconnectTotal, collabOutboundBudgetCloseTotal, yjsOutboundBacklogBytes, yjsOutboundQueuedBytes } from './store.metrics';

type Ws = { send: (data: unknown, cb?: (err?: Error) => void) => void; close: (code: number, reason: string) => void; once?: (event: string, cb: () => void) => void };

const CONTROL_TYPES = new Set<number>([MessageType.QueryAwareness, MessageType.Stateless, MessageType.BroadcastStateless, MessageType.SyncStatus, MessageType.Ping, MessageType.Pong]);

export class OutboundBudget {
  private readonly reservedByWs = new Map<Ws, { getBacklog: () => number; reserved: number }>();
  private total = 0;

  constructor(private readonly limits: CollabLimits) {}

  /** wrap 判定核。getBacklog 由 SG 闭包提供（读点文本留 SG=census ⑤ 零改）。幂等（Map 判重）。 */
  wrap(ws: Ws, hardCloseWs: (ws: Ws, code: number, reason: string) => void, getBacklog: () => number): void {
    if (this.reservedByWs.has(ws)) return;
    this.reservedByWs.set(ws, { getBacklog, reserved: 0 });
    ws.once?.('close', () => this.onClose(ws));   // close 兜底释放（未 flush 残账——泄漏根修）
    const orig = ws.send.bind(ws);
    let sends = 0;
    ws.send = (data: unknown, cb?: (err?: Error) => void) => {
      const frameBytes = (data as Uint8Array)?.byteLength ?? 0;
      const backlog = getBacklog();   // census ⑤：读点经 SG 闭包（本文件零该属性读文本）
      const frameType = readFrameType(data as Uint8Array);
      const isControl = frameType !== null && CONTROL_TYPES.has(frameType);
      if (frameType === MessageType.Awareness) {
        // ③：awareness 永 drop 不 close
        if (backlog + frameBytes > this.limits.backpressureCloseBytes || backlog > this.limits.backpressureDropBytes) {
          collabAwarenessDroppedTotal.inc();
          return;
        }
      } else if (!isControl) {
        // ①大帧组（Sync/SyncReply/未知 sync 族）：前瞻 close
        if (backlog + frameBytes > this.limits.backpressureCloseBytes) {
          collabSlowConsumerDisconnectTotal.inc();
          hardCloseWs(ws, CollabCloseCode.SLOW_CONSUMER, 'slow-consumer');
          return;
        }
      } else if (backlog > this.limits.backpressureCloseBytes) {
        // ②控制组：仅 backlog 已超 close 才关（+20B 不前瞻——心跳反杀根修）
        collabSlowConsumerDisconnectTotal.inc();
        hardCloseWs(ws, CollabCloseCode.SLOW_CONSUMER, 'slow-consumer');
        return;
      }
      if (isControl) {   // ②控制组预算豁免（v3——doc-status/conn-status/心跳永不因预算丢）
        if (++sends % 10 === 0) yjsOutboundBacklogBytes.observe(backlog);
        orig(data, cb);
        return;
      }
      if (!this.reserve(ws, frameBytes)) {   // ④大帧组预算失败
        collabOutboundBudgetCloseTotal.inc();
        collabSlowConsumerDisconnectTotal.inc();
        hardCloseWs(ws, CollabCloseCode.SLOW_CONSUMER, 'global-budget');
        return;
      }
      if (++sends % 10 === 0) yjsOutboundBacklogBytes.observe(backlog);
      try {
        orig(data, (err) => { this.release(ws, frameBytes); cb?.(err); });
      } catch (e) {
        this.release(ws, frameBytes);   // send 同步抛（已断）——预扣不漏
        throw e;   // plan 原文裸 `throw;` 非 JS 语法（ThrowStatement 必带表达式）——绑定后重抛，语义等价
      }
    };
  }

  private reserve(ws: Ws, bytes: number): boolean {
    if (this.total + bytes > this.limits.outboundBudgetBytes) return false;
    this.total += bytes;
    this.reservedByWs.get(ws)!.reserved += bytes;
    yjsOutboundQueuedBytes.set(this.total);
    return true;
  }

  release(ws: Ws, bytes: number): void {
    if (!this.reservedByWs.has(ws)) return;   // v3：closed 后迟到 cb 禁复活 Map（onClose 已释放）
    this.total = Math.max(0, this.total - bytes);
    this.reservedByWs.get(ws)!.reserved = Math.max(0, this.reservedByWs.get(ws)!.reserved - bytes);
    yjsOutboundQueuedBytes.set(this.total);
  }

  /** close 兜底：整连接残账一次释放+台账摘除（cb 不保证触发的泄漏根修）。 */
  onClose(ws: Ws): void {
    const e = this.reservedByWs.get(ws);
    if (!e) return;
    this.total = Math.max(0, this.total - e.reserved);
    this.reservedByWs.delete(ws);
    yjsOutboundQueuedBytes.set(this.total);
  }

  /** 对账（v3：per-ws 回填——reconcile 后 onClose 按当前值减，total 与 per-ws 永不漂移）。
   *  挂 SG authMapsSweeper（60s、SWEEP_ENABLED 阀**之前**=始终运行——弃 sessionSweep 挂点：受逃生阀）。 */
  reconcile(): void {
    let sum = 0;
    for (const e of this.reservedByWs.values()) {
      e.reserved = e.getBacklog();
      sum += e.reserved;
    }
    this.total = sum;
    yjsOutboundQueuedBytes.set(this.total);
  }

  get queuedBytes(): number { return this.total; }
}
