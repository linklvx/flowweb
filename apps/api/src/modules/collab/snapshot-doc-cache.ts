// apps/api/src/modules/collab/snapshot-doc-cache.ts
// Y0b-2 T3：快照解码投影的进程内 TTL 单飞缓存——条目=projectId→DecodedSnapshot（nodes/edges
// 投影，非 Y.Doc——解码一次投影复用，不驻留 doc 实例）。并发 get 共享同一 in-flight Promise
// （单飞：Redis 缓存过期瞬间的并发外部分享请求只解码一次）；TTL 过期后下次 get 重新装载。
// LRU 容量上界登记（Y0c/heap 闸同族——T9 残余）：本批仅 TTL 单飞无容量上界，快照体量受
// Yjs doc 规模约束；单实例假设（PM2 instances:1——与模型缓存/SV 门同族约束）。
export interface DecodedSnapshot {
  nodes: any[];
  edges: any[];
}

export class SnapshotDocCache {
  private readonly cache = new Map<string, { value: DecodedSnapshot; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<DecodedSnapshot>>();

  constructor(private readonly ttlMs = 30_000) {}

  get(projectId: string, loader: () => Promise<DecodedSnapshot>): Promise<DecodedSnapshot> {
    const hit = this.cache.get(projectId);
    if (hit) {
      if (hit.expiresAt > Date.now()) return Promise.resolve(hit.value);
      this.cache.delete(projectId);   // 过期条目懒回收（命中即 miss——下次装载覆盖同键）
    }
    const pending = this.inFlight.get(projectId);
    if (pending) return pending;      // 单飞：在飞窗内并发调用共享同一次装载
    const p = loader()
      .then((value) => {
        this.cache.set(projectId, { value, expiresAt: Date.now() + this.ttlMs });
        return value;
      })
      .finally(() => { this.inFlight.delete(projectId); });   // 失败不落缓存（下次重试）+在飞窗关闭
    this.inFlight.set(projectId, p);
    return p;
  }

  /** Y0b-2 T3：video-work process 处理完成后失效——进程内层不跨请求存活（跨请求缓存归
   *  Redis 300s 层）；本层价值=并发窗单飞去重。 */
  invalidate(projectId: string): void {
    this.cache.delete(projectId);
  }
}
