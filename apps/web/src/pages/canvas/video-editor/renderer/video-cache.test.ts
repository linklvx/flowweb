import { describe, it, expect, vi } from 'vitest';
import { VideoCacheService, RETRY_COOLDOWN_MS, type SinkHandle, type WrappedFrame } from './video-cache';

const SRC = 'http://minio/m1.mp4'; // UrlSource 直连（A3）——不再整文件 fetch blob

function makeSink(frames: { timestamp: number; duration: number }[]) {
  const state = { canvasesCalls: 0, consumed: 0, disposed: false };
  const handle: SinkHandle = {
    canvases: (start: number) => {
      state.canvasesCalls++;
      return (async function* () {
        for (const f of frames) {
          if (f.timestamp + f.duration <= start) continue;
          state.consumed++;
          yield { canvas: { width: 1920, height: 1080 }, timestamp: f.timestamp, duration: f.duration } as WrappedFrame;
        }
      })();
    },
    dispose: () => { state.disposed = true; },
  };
  return { handle, state };
}
const FRAMES = Array.from({ length: 10 }, (_, i) => ({ timestamp: i, duration: 1 })); // 0..9s 各 1s

describe('VideoCacheService（三段命中 + LRU）', () => {
  it('顺序请求：迭代到目标帧窗口', async () => {
    const { handle } = makeSink(FRAMES);
    const svc = new VideoCacheService({ openSink: vi.fn().mockResolvedValue(handle) });
    const f = await svc.getFrame('m1', SRC, 2.5);
    expect(f?.timestamp).toBe(2);
  });
  it('current 命中：同窗口重复请求不再消费 generator', async () => {
    const { handle, state } = makeSink(FRAMES);
    const svc = new VideoCacheService({ openSink: vi.fn().mockResolvedValue(handle) });
    await svc.getFrame('m1', SRC, 2.5);
    const consumed = state.consumed;
    await svc.getFrame('m1', SRC, 2.9);
    expect(state.consumed).toBe(consumed); // current 窗口 [2,3) 直返
    expect((await svc.getFrame('m1', SRC, 2.9))?.timestamp).toBe(2);
  });
  it('前进请求：迭代前进消费下一帧命中', async () => {
    const { handle } = makeSink(FRAMES);
    const svc = new VideoCacheService({ openSink: vi.fn().mockResolvedValue(handle) });
    await svc.getFrame('m1', SRC, 2.5); // 命中 [2,3) 即返（iterator 挂起于 yield ts=2，不预取）
    const f = await svc.getFrame('m1', SRC, 3.2); // |3.2-2|≤2 不重建 → 迭代前进消费 ts=3 命中（顺序产出下 next 预存分支不触达，真正覆盖 next 分支的是超前 yield 场景——vendor 流下由乱序/跳帧触发）
    expect(f?.timestamp).toBe(3);
  });
  it('大跳（>2s）重建 iterator：canvases 再次调用', async () => {
    const { handle, state } = makeSink(FRAMES);
    const svc = new VideoCacheService({ openSink: vi.fn().mockResolvedValue(handle) });
    await svc.getFrame('m1', SRC, 0.5);
    const calls = state.canvasesCalls;
    await svc.getFrame('m1', SRC, 8.2);
    expect(state.canvasesCalls).toBe(calls + 1);
    expect((await svc.getFrame('m1', SRC, 8.2))?.timestamp).toBe(8);
  });
  it('openSink 返回 null（无视频轨/失败）→ getFrame null', async () => {
    const svc = new VideoCacheService({ openSink: vi.fn().mockResolvedValue(null) });
    expect(await svc.getFrame('m1', SRC, 0)).toBeNull();
  });
  it('LRU：超过 maxMedia 淘汰最久未用并 dispose', async () => {
    const sinks = new Map<string, ReturnType<typeof makeSink>>();
    const svc = new VideoCacheService({
      openSink: vi.fn(async (_url: string) => {
        const id = `m${sinks.size + 1}`;
        const s = makeSink(FRAMES); sinks.set(id, s); return s.handle;
      }),
      maxMedia: 2,
    });
    await svc.getFrame('m1', SRC, 0.5);
    await svc.getFrame('m2', SRC, 0.5);
    await svc.getFrame('m3', SRC, 0.5); // m1 最久未用被淘汰
    expect(sinks.get('m1')!.state.disposed).toBe(true);
    expect(svc.size).toBe(2);
  });
  it('LRU 触尾：命中访问移到最近使用端（变异守护——删 delete+set 则退化为 FIFO）', async () => {
    const sinks = new Map<string, ReturnType<typeof makeSink>>();
    const svc = new VideoCacheService({
      openSink: vi.fn(async (_url: string) => {
        const id = `m${sinks.size + 1}`;
        const s = makeSink(FRAMES); sinks.set(id, s); return s.handle;
      }),
      maxMedia: 2,
    });
    await svc.getFrame('m1', SRC, 0.5);
    await svc.getFrame('m2', SRC, 0.5);
    await svc.getFrame('m1', SRC, 0.5); // 触尾：m1 变最近使用
    await svc.getFrame('m3', SRC, 0.5); // 淘汰的应是 m2（最久未用），非 m1
    expect(sinks.get('m2')!.state.disposed).toBe(true);
    expect(sinks.get('m1')!.state.disposed).toBe(false);
    expect(svc.size).toBe(2);
  });
  it('release(mediaId)：指定媒体释放', async () => {
    const { handle, state } = makeSink(FRAMES);
    const svc = new VideoCacheService({ openSink: vi.fn().mockResolvedValue(handle) });
    await svc.getFrame('m1', SRC, 0.5);
    svc.release('m1');
    expect(state.disposed).toBe(true);
    expect(svc.size).toBe(0);
  });
  it('串行链：并发请求不交错（后请求等待前完成）', async () => {
    const { handle } = makeSink(FRAMES);
    const svc = new VideoCacheService({ openSink: vi.fn().mockResolvedValue(handle) });
    const [a, b] = await Promise.all([svc.getFrame('m1', SRC, 2.5), svc.getFrame('m1', SRC, 4.5)]);
    expect(a?.timestamp).toBe(2);
    expect(b?.timestamp).toBe(4);
  });
  it('in-flight 去重（G7）：同 mediaId 并发首取只 openSink 一次', async () => {
    const { handle } = makeSink(FRAMES);
    const openSink = vi.fn(async () => { await new Promise(r => setTimeout(r, 10)); return handle; });
    const svc = new VideoCacheService({ openSink });
    await Promise.all([svc.getFrame('m1', SRC, 1.5), svc.getFrame('m1', SRC, 2.5), svc.getFrame('m1', SRC, 3.5)]);
    expect(openSink).toHaveBeenCalledTimes(1);
  });
  it('取帧抛错 → release 自愈 + 2s 冷却（entry 清空 + 越窗重开——R3 3.3 防永久黑帧 + R4 防每帧重开：坏源 rAF 30-60fps 下每秒几十次 release+openSink）', async () => {
    let clock = 1000;
    const { handle } = makeSink(FRAMES);
    const goodCanvases = handle.canvases;
    const openSink = vi.fn(async () => handle);
    const svc = new VideoCacheService({ openSink, now: () => clock });
    expect(await svc.getFrame('m1', SRC, 2.5)).not.toBeNull();
    handle.canvases = () => (async function* () { throw new Error('403 presigned expired'); })();
    expect(await svc.getFrame('m1', SRC, 4.5)).toBeNull(); // 抛错被吃、返回 null（lastTime=2，|4.5-2|>2 重建 iterator 即抛）
    expect(svc.size).toBe(0);                              // entry 已释放（死 iterator 不残留）
    expect(await svc.getFrame('m1', SRC, 4.5)).toBeNull(); // R4：冷却窗内（clock=1000 < 3000）不再重开
    expect(openSink).toHaveBeenCalledTimes(1);
    handle.canvases = goodCanvases;
    clock += RETRY_COOLDOWN_MS + 1;                        // 越过冷却窗
    expect(await svc.getFrame('m1', SRC, 2.5)).not.toBeNull(); // 下次请求重开
    expect(openSink).toHaveBeenCalledTimes(2);
  });
  it('release 与在途 openSink 竞态：open 迟到完成 → dispose 不复活 entry（R4——"播放中点关闭"不残留活 Input/CanvasSink）', async () => {
    let resolveOpen!: (h: SinkHandle | null) => void;
    const state = { disposed: false };
    const handle: SinkHandle = {
      canvases: () => (async function* () {})(),
      dispose: () => { state.disposed = true; },
    };
    const svc = new VideoCacheService({ openSink: () => new Promise<SinkHandle | null>(r => { resolveOpen = r; }) });
    const p = svc.getFrame('m1', SRC, 0); // 在途（openSink 未决）
    svc.release();                        // 收起/单媒体释放 → generations 作废在途 open
    resolveOpen(handle);                  // open 迟到完成
    expect(await p).toBeNull();
    expect(state.disposed).toBe(true);
    expect(svc.size).toBe(0);
  });
});
