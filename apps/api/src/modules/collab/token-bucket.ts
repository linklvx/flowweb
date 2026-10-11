/**
 * Y0b-3 T2：WS 升级限流的内存 token bucket（per-IP）。
 * 定位=DoS 兜底非配额（注释钉死）：60/min 补充+burst 20 容量（多标签友好——单个用户同时开
 * 多个标签页各持一条 WS 连接，burst 抬高集中握手容忍度）；重启清零（内存态——精确配额不归它管）。
 * Map 上界 10_000 清最旧（插入序近似 FIFO——Map.set 已有键不刷新插入序，防伪造 X-Real-IP 洪灌出无界键集合）。
 * 独立文件=纯函数零依赖，便于单测。
 * Y0b-4 T6 扩：consume(key,cost) 按量扣减+delete(key)——速率闸三桶复用（msg/bytes/aware，gateway 构造）。
 */
export interface TokenBucketOptions {
  capacity: number;
  refillPerMin: number;
}

const MAX_KEYS = 10_000;

export class TokenBucket {
  private readonly buckets = new Map<string, { tokens: number; last: number }>();

  constructor(private readonly options: TokenBucketOptions) {}

  /** Y0b-4 T6（Q-E v5）：cost 按量扣减（默认 1=既有调用零改动——upgrade 桶/upstream）。
   *  tokens<cost 分支保留积分（cost 同构——失败尝试不扣，仅落账已积 refill）；cost>capacity 结构性
   *  恒 false（tokens≤capacity<cost——报告1 P0-2：桶容量必须≥最大合法帧，防"合法帧永拒"形态复发）。 */
  consume(key: string, cost = 1): boolean {
    if (this.buckets.size >= MAX_KEYS) {
      const oldest = this.buckets.keys().next().value;   // 插入序首键=最旧
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
    const now = Date.now();
    const entry = this.buckets.get(key);
    const refill = ((now - (entry?.last ?? now)) / 60_000) * this.options.refillPerMin;
    // Math.max(0, …) 下限：时钟回拨时 refill 为负——防 tokens 深负（深负桶按速率需超长回补）
    const tokens = Math.max(0, Math.min(this.options.capacity, (entry?.tokens ?? this.options.capacity) + refill));
    if (tokens < cost) {
      if (entry) {
        // I-1：积分保留语义——失败尝试也落账已积 refill（标准桶 tokens(t)=min(cap, tokens(t0)+rate·Δt)）。
        // 只推进采样点不落账=已积 refill 整体丢弃→重试间隔＜补充周期的客户端每次清零进度→永久 429。
        entry.tokens = tokens;
        entry.last = now;   // 失败尝试也推进采样点（补充速率按真实时间流逝）
      } else {
        // 仅 cost>capacity 可达（cost≤capacity 时首试恒 tokens=capacity≥cost 走成功支）——防御性保留
        this.buckets.set(key, { tokens, last: now });
      }
      return false;
    }
    this.buckets.set(key, { tokens: tokens - cost, last: now });
    return true;
  }

  /** Y0b-4 T6：键删除（onDisconnect 清理——重连重置语义=断连循环刷桶的 DoS 兜底；delete 后新键首试=capacity 满桶重生）。 */
  delete(key: string): void {
    this.buckets.delete(key);
  }
}
