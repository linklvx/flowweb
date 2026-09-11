import type { Input, CanvasSink } from 'mediabunny';

export interface WrappedFrame { canvas: HTMLCanvasElement | OffscreenCanvas; timestamp: number; duration: number; }
export type SinkIterator = AsyncGenerator<WrappedFrame, void, undefined>;
export interface SinkHandle { canvases(start: number): SinkIterator; dispose(): void; }
export interface VideoCacheDeps { openSink: (url: string) => Promise<SinkHandle | null>; maxMedia?: number; now?: () => number; }

const SEEK_REBUILD_GAP = 2; // 距上次消费 >2s 重建 iterator（vendor 同款）
export const RETRY_COOLDOWN_MS = 2000; // R4：坏源自愈冷却——无冷却时 renderLatest 按 rAF 30-60fps 重试，每秒几十次 openSink（每次 Input 构造 + moov range 请求）

class MediaEntry {
  current: WrappedFrame | null = null;
  next: WrappedFrame | null = null;
  private iterator: SinkIterator | null = null;
  private lastTime = 0;
  private chain: Promise<WrappedFrame | null> = Promise.resolve(null);
  private seekGen = 0;
  constructor(private readonly handle: SinkHandle) {}

  /** 串行链：所有请求排队执行，防 generator 交错 */
  getFrameAt(time: number): Promise<WrappedFrame | null> {
    const run = this.chain.then(() => this.doGet(time));
    this.chain = run.then(() => null, () => null); // 链不断（错误吞在单次请求内）
    return run;
  }

  private async doGet(time: number): Promise<WrappedFrame | null> {
    if (this.next && time >= this.next.timestamp && time < this.next.timestamp + this.next.duration) {
      this.current = this.next; this.next = null;
      return this.current;
    }
    if (this.current && time >= this.current.timestamp && time < this.current.timestamp + this.current.duration) {
      return this.current;
    }
    const gen = ++this.seekGen;
    if (!this.iterator || Math.abs(time - this.lastTime) > SEEK_REBUILD_GAP) {
      await this.iterator?.return?.().catch(() => {});
      this.iterator = this.handle.canvases(time);
    }
    for (;;) {
      if (gen !== this.seekGen) return this.current; // 期间有新 seek，让位
      const { value, done } = await this.iterator.next();
      if (done || !value) return this.current;
      this.lastTime = value.timestamp;
      if (time >= value.timestamp && time < value.timestamp + value.duration) {
        this.current = value; this.next = null;
        return value;
      }
      if (value.timestamp > time) { this.next = value; return this.current; } // 超前：返回最近已有帧
      this.current = value; // 落后继续追
    }
  }

  dispose(): void {
    this.seekGen++;
    void this.iterator?.return?.().catch(() => {});
    this.iterator = null; this.current = null; this.next = null;
    this.handle.dispose();
  }
}

/** 帧缓存服务：mediaId → 常驻 CanvasSink + 三段命中（vendor 形状）+ LRU 上限淘汰 + openSink in-flight 去重（G7）
 *  + 自愈三纪律（R4）：取帧抛错 release + 2s 冷却重试（坏源防每帧重开）；release 作废在途 open（generations 代数——
 *  "播放中收起"不残留活 Input/CanvasSink 到 LRU/收起为止）。 */
export class VideoCacheService {
  private entries = new Map<string, MediaEntry>(); // Map 插入序 = LRU 序（访问即 delete+set 移尾）
  private opening = new Map<string, Promise<MediaEntry | null>>(); // 同 tick 并发同 mediaId 只 openSink 一次（vendor initPromises 同款）
  private retryAfter = new Map<string, number>();  // mediaId → 冷却截止时间戳（R4）
  private generations = new Map<string, number>(); // mediaId → 已作废代数（R4：release 时 ++，在途 open 完成时比对）
  private readonly now: () => number;
  private readonly maxMedia: number;
  constructor(private readonly deps: VideoCacheDeps) {
    this.now = deps.now ?? Date.now;
    this.maxMedia = deps.maxMedia ?? 8;
  }

  get size(): number { return this.entries.size; }

  async getFrame(mediaId: string, url: string, time: number): Promise<WrappedFrame | null> {
    const until = this.retryAfter.get(mediaId);
    if (until !== undefined && this.now() < until) return null; // 冷却窗内不重开（R4）
    let entry = this.entries.get(mediaId);
    if (!entry) {
      let opening = this.opening.get(mediaId);
      if (!opening) {
        const gen = this.generations.get(mediaId) ?? 0;
        opening = this.deps.openSink(url).then((handle) => {
          if (!handle) {
            // R5：open 失败（无视频轨/canDecode false/403 reject）同样进冷却——否则 .finally 删 opening 后
            // 下一帧 renderLatest 再调 getFrame 再次 openSink（Input 构造 + moov range 请求），30-60 次/秒
            console.warn('[video-cache] openSink 失败（null handle）:', mediaId); // 遗留③：所有失败路径至少一行痕迹
            this.retryAfter.set(mediaId, this.now() + RETRY_COOLDOWN_MS);
            return null;
          }
          if ((this.generations.get(mediaId) ?? 0) !== gen) { // R4：release 已发生 → 在途 open 作废
            try { handle.dispose(); } catch { /* 已释放 */ }
            return null;
          }
          const e = new MediaEntry(handle);
          this.evictIfNeeded();
          this.entries.set(mediaId, e);
          return e;
        }).finally(() => { this.opening.delete(mediaId); });
        this.opening.set(mediaId, opening);
      }
      try {
        entry = (await opening) ?? undefined;
      } catch (err) {
        // 遗留③：openSink reject 不再直穿 getFrame——转 null + warn + 冷却（否则注入坏 openSink 时
        // rAF 30-60 次/秒重开风暴——冷却限频是 warn 不刷屏的前提）
        console.warn('[video-cache] openSink 失败:', mediaId, err);
        this.retryAfter.set(mediaId, this.now() + RETRY_COOLDOWN_MS);
        return null;
      }
      if (!entry) return null; // 无视频轨/打开失败（warn 与冷却在上方 then 的 null handle 分支）
    } else {
      this.entries.delete(mediaId); // LRU 触尾
      this.entries.set(mediaId, entry);
    }
    try {
      const f = await entry.getFrameAt(time);
      if (f) this.retryAfter.delete(mediaId); // 成功取帧解除冷却
      return f;
    } catch {
      // R3 3.3：UrlSource 预签名过期/网络错误时 iterator 已死、entry 残留 → 该素材从此永久黑帧——
      // 释放 entry 使下次请求重开 sink（新 URL 由调用方 mediaInfo 刷新后传入；一期限制见 spec 边界表"预签名过期"）
      console.warn('[video-cache] getFrame 失败，释放并 2s 后重试:', mediaId); // R4：诊断痕迹——冷却限频天然防刷屏
      this.retryAfter.set(mediaId, this.now() + RETRY_COOLDOWN_MS);
      this.release(mediaId); // 带参 release 不清 retryAfter——自愈冷却跨 release 继续生效
      return null;
    }
  }

  private evictIfNeeded(): void {
    while (this.entries.size >= this.maxMedia) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.get(oldest)?.dispose();
      this.entries.delete(oldest);
      this.retryAfter.delete(oldest); // 容量淘汰非源坏——冷却不继承
    }
  }

  release(mediaId?: string): void {
    // R4：先作废在途 open（keys 物化后再清 entries），再释放已驻留 entry。
    // R5：generations 不 clear——bump 值即作废凭据，clear 会把它抹平（在途 chain 捕获 gen=0、
    // 迟到完成时 undefined ?? 0 = 0 相等 → 不作废 → 复活 entry，用例 11 两断言必红）；
    // 保留计数无副作用：重进后新 chain 以 bump 后的值为基准捕获，比对相等正常放行。map 只增媒体数个 number。
    const keys = mediaId === undefined
      ? [...new Set([...this.entries.keys(), ...this.opening.keys()])]
      : [mediaId];
    for (const k of keys) this.generations.set(k, (this.generations.get(k) ?? 0) + 1);
    if (mediaId === undefined) {
      for (const e of this.entries.values()) e.dispose();
      this.entries.clear();
      this.retryAfter.clear(); // 会话终结（编辑器收起）——冷却不跨会话继承（与 generations 语义不同：retryAfter 是源健康度、新会话重试合理；generations 是实例代数、清了旧 chain 复活）
    } else {
      this.entries.get(mediaId)?.dispose();
      this.entries.delete(mediaId);
      // retryAfter 保留：自愈路径 release 后冷却继续生效，防立即重进再打网络
    }
  }
}

/** 生产装配：mediabunny CanvasSink（vendor video-cache/service.ts 同款）。
 *  B1 实测修正：CanvasSink 无 dispose 方法（mediabunny media-sink.d.ts 只有 getCanvas/canvases/canvasesAtTimestamps）；
 *  Input.dispose() 返回 void 非 Promise（input.d.ts L158）——同步调用，异常用 try/catch。
 *  R2 A3：视频取源 UrlSource（HTTP Range 随机读，决策 1）——presigned GET 直连，不整文件下载。
 *  R4：整段包 try——原 `await import` 与 `new Input` 在 try 外，一 reject 则 openSink reject 而非 null，
 *  违反 getFrame"失败 → null"契约（预览侧调用方 .catch 兜住不炸，但 Plan 4 导出路径未必兜）。 */
export async function openMediabunnySink(url: string): Promise<SinkHandle | null> {
  let input: Input | null = null;
  try {
    const { Input, ALL_FORMATS, UrlSource, CanvasSink } = await import('mediabunny');
    input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) {
      try { input.dispose(); } catch { /* 已释放 */ }
      console.warn('[video-cache] openSink 失败（无视频轨）:', url);
      return null;
    }
    const sink = new CanvasSink(track, { poolSize: 3, fit: 'contain' });
    const held = input; // const 断言窄化——闭包内 TS 对 let 不保留窄化
    return {
      canvases: (start: number) => sink.canvases(start) as unknown as SinkIterator,
      dispose: () => { try { held.dispose(); } catch { /* 已释放 */ } }, // 资源主口是 input.dispose
    };
  } catch (err) {
    if (input) { try { input.dispose(); } catch { /* 已释放 */ } }
    console.warn('[video-cache] openSink 失败:', url, err);
    return null;
  }
}

export const videoCache = new VideoCacheService({ openSink: openMediabunnySink });
