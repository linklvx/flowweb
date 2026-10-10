/**
 * Y0b-3 T2：WS 升级限流的内存 token bucket（per-IP）。
 * 定位=DoS 兜底非配额（注释钉死）：60/min 补充+burst 20 容量（多标签友好——单个用户同时开
 * 多个标签页各持一条 WS 连接，burst 抬高集中握手容忍度）；重启清零（内存态——精确配额不归它管）。
 * Map 上界 10_000 清最旧（插入序近似 LRU——防伪造 X-Real-IP 洪灌出无界键集合）。
 * 独立文件=纯函数零依赖，便于单测。
 */
export interface TokenBucketOptions {
  capacity: number;
  refillPerMin: number;
}

const MAX_KEYS = 10_000;

export class TokenBucket {
  private readonly buckets = new Map<string, { tokens: number; last: number }>();

  constructor(private readonly options: TokenBucketOptions) {}

  consume(key: string): boolean {
    if (this.buckets.size >= MAX_KEYS) {
      const oldest = this.buckets.keys().next().value;   // 插入序首键=最旧
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
    const now = Date.now();
    const entry = this.buckets.get(key);
    const refill = ((now - (entry?.last ?? now)) / 60_000) * this.options.refillPerMin;
    const tokens = Math.min(this.options.capacity, (entry?.tokens ?? this.options.capacity) + refill);
    if (tokens < 1) {
      if (entry) entry.last = now;   // 失败尝试也推进采样点（补充速率按真实时间流逝）
      else this.buckets.set(key, { tokens, last: now });
      return false;
    }
    this.buckets.set(key, { tokens: tokens - 1, last: now });
    return true;
  }
}
