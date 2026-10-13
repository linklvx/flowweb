// apps/api/src/modules/collab/snapshot-doc-cache.ts
// Y0b-2 T3：快照解码投影的进程内 TTL 单飞缓存——条目=projectId→DecodedSnapshot（nodes/edges
// 投影，非 Y.Doc——解码一次投影复用，不驻留 doc 实例）。并发 get 共享同一 in-flight Promise
// （单飞：Redis 缓存过期瞬间的并发外部分享请求只解码一次）；TTL 过期后下次 get 重新装载。
// Y0b-5 T10（spec §5.8②）：容量上界 32（LRU 驱逐最旧——Map 插入序维护新近度：命中刷新=delete+重插；
// 超界驱逐=evict 最旧键）+yjs_snapshot_cache_entries gauge 可见化——与 LRU 同源的第二条无界增长
// 路径封口（原「仅 TTL 单飞无容量上界」登记项消纳）。单实例假设（PM2 instances:1——与模型缓存/
// SV 门同族约束）。
export interface DecodedSnapshot {
  nodes: any[];
  edges: any[];
}

/** 条目上限（T10 裁定值 32——测试常量绑定防漂移） */
export const SNAPSHOT_CACHE_MAX_ENTRIES = 32;

export class SnapshotDocCache {
  private readonly cache = new Map<string, { value: DecodedSnapshot; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<DecodedSnapshot>>();

  constructor(
    private readonly ttlMs = 30_000,
    private readonly maxEntries: number = SNAPSHOT_CACHE_MAX_ENTRIES,
  ) {}

  /** 现条目数（entries gauge 数据源） */
  get size(): number {
    return this.cache.size;
  }

  get(projectId: string, loader: () => Promise<DecodedSnapshot>): Promise<DecodedSnapshot> {
    const hit = this.cache.get(projectId);
    if (hit) {
      if (hit.expiresAt > Date.now()) {
        // LRU 新近度刷新：delete+重插移到 Map 尾部（头部=最旧——超界驱逐目标）
        this.cache.delete(projectId);
        this.cache.set(projectId, hit);
        return Promise.resolve(hit.value);
      }
      this.cache.delete(projectId);   // 过期条目懒回收（命中即 miss——下次装载覆盖同键）
    }
    const pending = this.inFlight.get(projectId);
    if (pending) return pending;      // 单飞：在飞窗内并发调用共享同一次装载
    const p = loader()
      .then((value) => {
        this.cache.set(projectId, { value, expiresAt: Date.now() + this.ttlMs });
        this.evictOverCapacity();
        return value;
      })
      .finally(() => { this.inFlight.delete(projectId); });   // 失败不落缓存（下次重试）+在飞窗关闭
    this.inFlight.set(projectId, p);
    return p;
  }

  /** Y0b-5 T10：超界驱逐最旧（Map 头部=最久未用；in-flight 装载完成时统一收口——get 热路径零遍历） */
  private evictOverCapacity(): void {
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  /** Y0b-2 T3：video-work process 处理完成后失效——进程内层不跨请求存活（跨请求缓存归
   *  Redis 300s 层）；本层价值=并发窗单飞去重。 */
  invalidate(projectId: string): void {
    this.cache.delete(projectId);
  }
}
