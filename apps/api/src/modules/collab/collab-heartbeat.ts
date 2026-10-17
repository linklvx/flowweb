// apps/api/src/modules/collab/collab-heartbeat.ts
// R6'（v2）：保活心跳独立模块——backlog>1MB 丢 awareness 期，客户端 messageReconnectTimeout=30s
// 死线靠任意入站帧刷新（provider 内建）——10s stateless 心跳解耦（stateless 不走 awareness drop
// 分支+小帧免前瞻 close〔T6 帧型四档之控制组〕+免于预算失败静默丢——三重不反杀保证）。
// v2：Map<socketId, conn>（onDisconnectPayload 无 connection——SG:260 注释佐证）；throw=已断自动摘除。
// v3 裁决：心跳=缓解非根修——有效域=大帧排空<30s 的链路（FIFO：心跳与大帧同出站顺序队列，
// 排空>30s 时心跳恒排其后救不了死线——边界登记进 spec；真根修归客户端批/Y1c-3）。
import type { CollabConnection } from './collab.gateway';

const HEARTBEAT_INTERVAL_MS = 10_000;

export class CollabHeartbeat {
  private readonly conns = new Map<string, CollabConnection>();
  private timer: ReturnType<typeof setInterval> | null = null;

  register(socketId: string, conn: CollabConnection): void { this.conns.set(socketId, conn); }
  unregister(socketId: string): void { this.conns.delete(socketId); }

  start(): void {
    this.timer ??= setInterval(() => this.sweepOnce(), HEARTBEAT_INTERVAL_MS);
    this.timer.unref?.();   // 不养事件循环
  }

  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  sweepOnce(): void {
    for (const [sid, conn] of this.conns) {
      try { conn.sendStateless?.(JSON.stringify({ type: 'heartbeat' })); } catch { this.conns.delete(sid); }   // 已断：吞+摘除（强引用防漏）
    }
  }
}
