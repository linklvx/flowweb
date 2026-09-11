import { describe, it, expect, vi } from 'vitest';
import { runExport, ExportCanceledError, EXPORT_FPS } from './controller';
import type { ProjectData, VideoClip } from '../types';

const vc = (id: string, start: number, duration: number): VideoClip => ({
  id, trackId: 'tv', type: 'video', start, duration, sourceStart: 0, mediaId: 'm1', playbackSpeed: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
});
const data = (d: number): ProjectData => ({
  version: 1, fps: 30,
  tracks: [{ id: 'tv', type: 'video', name: 'v', muted: false, hidden: false, clips: ['a'] }],
  clips: { a: vc('a', 0, d) },
});

/** mock deps：renderFrameAt 的 FrameRenderDeps 部分 + mixdown/createOutput */
function makeDeps(over: Partial<Record<string, unknown>> = {}) {
  const calls = {
    videoAdd: [] as number[],
    audioAdd: 0,
    progress: [] as [string, number][],
    draw: 0,
    cancel: 0,
    finalize: 0,
    start: 0,
  };
  const output = {
    videoTrack: { add: vi.fn(async (t: number) => { calls.videoAdd.push(t); }) },
    audioTrack: { add: vi.fn(async (_channels: Float32Array[], _sampleRate: number) => { calls.audioAdd++; }) },
    start: vi.fn(async () => { calls.start++; }),
    finalize: vi.fn(async () => { calls.finalize++; }),
    cancel: vi.fn(async () => { calls.cancel++; }),
  };
  const deps = {
    video: { getFrame: vi.fn(async () => null) },
    images: { getImageBitmap: vi.fn(async () => null) },
    getMediaUrl: vi.fn(() => 'http://x'),
    getBlob: vi.fn(async () => null),
    renderer: { draw: vi.fn(() => { calls.draw++; }) },
    mixdown: vi.fn(async () => null),
    createOutput: vi.fn(async () => output), // async 契约——守卫下沉 Worker 侧 hasAudio 分支
    onProgress: vi.fn((phase: string, ratio: number) => { calls.progress.push([phase, ratio]); }),
    signal: new AbortController().signal,
    ...over,
  };
  return { deps, calls };
}

describe('runExport 编排（jsdom 无 WebCodecs——deps 全 mock）', () => {
  it('1s 工程：videoTrack.add 恰 30 次、时间戳 t=k/30（VideoFrame 纪律等价断言）', async () => {
    const { deps, calls } = makeDeps();
    await runExport(data(1), '720p', deps as never);
    expect(calls.videoAdd).toHaveLength(EXPORT_FPS);
    expect(calls.videoAdd[0]).toBe(0);
    expect(calls.videoAdd[1]).toBeCloseTo(1 / 30, 6);
    expect(calls.videoAdd[29]).toBeCloseTo(29 / 30, 6);
    expect(calls.start).toBe(1);
    expect(calls.finalize).toBe(1);
  });

  it('帧渲染走 renderFrameAt 复用（draw 每帧一次）', async () => {
    const { deps, calls } = makeDeps();
    await runExport(data(0.2), '720p', deps as never); // 6 帧
    expect(calls.draw).toBe(6);
  });

  it('两段进度：mixdown 回调透传 + controller 补末帧 mix=1 + encode totalFrames 次且末次 ratio=1', async () => {
    const { deps, calls } = makeDeps();
    deps.mixdown = vi.fn(async (_d: unknown, onP?: (r: number) => void) => { onP?.(0.5); return null; }) as never;
    await runExport(data(0.2), '720p', deps as never);
    const mix = calls.progress.filter(([p]) => p === 'mix');
    const enc = calls.progress.filter(([p]) => p === 'encode');
    expect(mix).toEqual([['mix', 0.5], ['mix', 1]]); // mock 只回调 0.5，末值 1 由 controller 收敛补发
    expect(enc).toHaveLength(6);
    expect(enc[enc.length - 1][1]).toBe(1);
  });

  it('有混音结果：audioTrack.add 恰一次且携带 (channels, sampleRate)（raw f32 契约——分块是装配侧内部）', async () => {
    const { deps, calls } = makeDeps();
    deps.mixdown = vi.fn(async () => ({ left: new Float32Array(48000).fill(0.5), right: new Float32Array(48000).fill(0.5), sampleRate: 48000 })) as never;
    await runExport(data(0.2), '720p', deps as never);
    expect(calls.audioAdd).toBe(1);
    const created = await (deps.createOutput as ReturnType<typeof vi.fn>).mock.results[0].value; // async 契约——results[0].value 是 Promise
    const addCall = created.audioTrack.add.mock.calls[0];
    expect(addCall[0]).toHaveLength(2); // [left, right]
    expect(addCall[0][0][0]).toBeCloseTo(0.5, 5);
    expect(addCall[1]).toBe(48000);
  });

  it('取消（未建 output 前中止）：直接 ExportCanceledError，不装配不 start 不 cancel', async () => {
    const { deps, calls } = makeDeps();
    const ac = new AbortController();
    ac.abort();
    deps.signal = ac.signal;
    await expect(runExport(data(1), '720p', deps as never)).rejects.toBeInstanceOf(ExportCanceledError);
    expect(deps.createOutput).not.toHaveBeenCalled();
    expect(calls.start).toBe(0);
    expect(calls.cancel).toBe(0);
    expect(calls.videoAdd).toHaveLength(0);
  });

  it('中途 abort（第 3 帧后）：已完成帧保留、cancel 调用', async () => {
    const { deps, calls } = makeDeps();
    const ac = new AbortController();
    deps.video.getFrame = vi.fn(async () => { if (calls.videoAdd.length >= 3) ac.abort(); return null; });
    deps.signal = ac.signal;
    await expect(runExport(data(1), '720p', deps as never)).rejects.toBeInstanceOf(ExportCanceledError);
    expect(calls.videoAdd.length).toBeGreaterThanOrEqual(3);
    expect(calls.videoAdd.length).toBeLessThan(EXPORT_FPS);
    expect(calls.cancel).toBe(1);
  });

  it('空工程（duration=0）抛错不入帧循环', async () => {
    const { deps, calls } = makeDeps();
    const empty: ProjectData = { version: 1, fps: 30, tracks: [{ id: 'tv', type: 'video', name: 'v', muted: false, hidden: false, clips: [] }], clips: {} };
    await expect(runExport(empty, '720p', deps as never)).rejects.toThrow('空工程');
    expect(calls.start).toBe(0);
  });

  it('帧渲染抛错原样传播（错误分类归 Worker 层）', async () => {
    const { deps } = makeDeps();
    deps.renderer.draw = vi.fn(() => { throw new Error('draw boom'); });
    await expect(runExport(data(0.2), '720p', deps as never)).rejects.toThrow('draw boom');
  });
});
