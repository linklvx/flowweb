// apps/web/src/pages/canvas/video-editor/audio-engine/engine.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudioEngine, type AudioContextLike, type BufferSourceLike, type GainNodeLike } from './engine';
import type { ProjectData, VideoClip, AudioClip, Track } from '../types';

vi.mock('./decode', () => ({ decodeMediaPcm: vi.fn() }));
import { decodeMediaPcm } from './decode';

// ---- fake AudioContext（jsdom 无 WebAudio；currentTime 由测试手动推进）----
function makeFakeCtx(sampleRate = 48000) {
  let now = 0;
  const created: { sources: BufferSourceLike[]; gains: GainNodeLike[] } = { sources: [], gains: [] };
  const ctx: AudioContextLike = {
    currentTime: 0, sampleRate, state: 'running',
    destination: { __dest: true },
    createBuffer: vi.fn((channels: number, length: number, sr: number) => ({
      numberOfChannels: channels, length, sampleRate: sr,
      getChannelData: () => new Float32Array(length),
    })),
    createBufferSource: () => {
      const s: BufferSourceLike = {
        buffer: null, connect: () => s, start: vi.fn(), stop: vi.fn(), onended: null,
      };
      created.sources.push(s);
      return s;
    },
    createGain: () => {
      const automation: { type: string; v: number; t: number }[] = [];
      const g: GainNodeLike = {
        gain: {
          value: 1,
          setValueAtTime: (v: number, t: number) => automation.push({ type: 'set', v, t }),
          linearRampToValueAtTime: (v: number, t: number) => automation.push({ type: 'ramp', v, t }),
          cancelScheduledValues: () => {},
        },
        connect: () => g,
        disconnect: () => {},
        __automation: automation,
      } as unknown as GainNodeLike;
      created.gains.push(g);
      return g;
    },
    resume: vi.fn(async () => {}), suspend: vi.fn(async () => {}),
  };
  return { ctx, created, advance: (dt: number) => { now += dt; (ctx as { currentTime: number }).currentTime = now; } };
}

// ---- 夹具 ----
const track = (id: string, type: Track['type'], clipIds: string[], over: Partial<Track> = {}): Track =>
  ({ id, type, name: id, muted: false, hidden: false, clips: clipIds, ...over });
const vc = (id: string, over: Partial<VideoClip> = {}): VideoClip => ({
  id, trackId: 'tv', type: 'video', start: 0, duration: 4, sourceStart: 0, mediaId: 'mv', playbackSpeed: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [], ...over,
});
const au = (id: string, over: Partial<AudioClip> = {}): AudioClip => ({
  id, trackId: 'ta', type: 'audio', start: 0, duration: 4, sourceStart: 0, mediaId: 'ma',
  volume: 1, fade: { in: 0, out: 0 }, playbackSpeed: 1, keyframes: [], ...over,
});
const proj = (tracks: Track[], clips: Record<string, VideoClip | AudioClip>): ProjectData =>
  ({ version: 1, fps: 30, tracks, clips: clips as ProjectData['clips'] });

const PCM = (len = 48000 * 10) => ({ sampleRate: 48000, channels: [new Float32Array(len), new Float32Array(len)] });
const BLOB = new Blob(['x']);

describe('AudioEngine（调度/主时钟/资源纪律）', () => {
  let fake: ReturnType<typeof makeFakeCtx>;
  let engine: AudioEngine;
  beforeEach(() => {
    fake = makeFakeCtx();
    engine = new AudioEngine({ ctxFactory: () => fake.ctx });
    vi.mocked(decodeMediaPcm).mockReset();
  });

  it('prepare：按 (mediaId,speed) 解码+变速缓存；同 key 不重复解码；getBlob null 跳过', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(PCM());
    const d = proj(
      [track('tv', 'video', ['v1']), track('ta', 'audio', ['a1', 'a2'])],
      { v1: vc('v1', { mediaId: 'mv', playbackSpeed: 2 }), a1: au('a1', { mediaId: 'ma' }), a2: au('a2', { mediaId: 'ma', playbackSpeed: 2 }) },
    );
    await engine.prepare(d, async (id) => (id === 'ma' ? BLOB : null)); // mv 无 blob 跳过
    expect(decodeMediaPcm).toHaveBeenCalledTimes(2); // ma:1 与 ma:2（mv 跳过）
    expect(engine.hasPcm('ma:1')).toBe(true);
    expect(engine.hasPcm('ma:2')).toBe(true);
    expect(engine.hasPcm('mv:2')).toBe(false);
  });

  it('playFrom：source.start 参数——when 未来映射/offset 变速换算/duration 成片时长', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(PCM());
    const d = proj([track('ta', 'audio', ['a'])], {
      a: au('a', { start: 2, duration: 4, sourceStart: 1, playbackSpeed: 2 }), // from=3：局部已进 1s
    });
    await engine.prepare(d, async () => BLOB);
    engine.playFrom(d, 3);
    const src = fake.created.sources.at(-1)!;
    // when=ctxNow(0)+max(0,2-3)=0；offset=(sourceStart 1+已消费 (3-2)×2)/2=1.5（stretched 坐标=原坐标/speed，决策 3——B3 验算修正：(1+2)/2=1.5）；duration=4-1=3
    expect(src.start).toHaveBeenCalledWith(0, 1.5, 3);
  });

  it('playFrom from < clip.start：when 映射到未来', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(PCM());
    const d = proj([track('ta', 'audio', ['a'])], { a: au('a', { start: 5, duration: 4, sourceStart: 0 }) });
    await engine.prepare(d, async () => BLOB);
    fake.advance(1); // ctx.currentTime = 1
    engine.playFrom(d, 0);
    const src = fake.created.sources.at(-1)!;
    expect(src.start).toHaveBeenCalledWith(1 + 5, 0, 4);
  });

  it('now()：主时钟锚定与推进（音频时钟）', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(PCM());
    const d = proj([track('ta', 'audio', ['a'])], { a: au('a') });
    await engine.prepare(d, async () => BLOB);
    engine.playFrom(d, 10);
    expect(engine.now()).toBeCloseTo(10, 6);
    fake.advance(2);
    expect(engine.now()).toBeCloseTo(12, 6);
  });

  it('perf 时钟模式（无 PCM 不创建 AudioContext）', () => {
    engine.setClockMode('perf');
    engine.playFrom(proj([track('tv', 'video', ['i'])], {
      i: { id: 'i', trackId: 'tv', type: 'video', start: 0, duration: 4, sourceStart: 0, mediaId: 'x', playbackSpeed: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] } as never,
    }), 5);
    expect(engine.getContextCreated()).toBe(false); // 不为时钟空转 ctx（spec 第六节）
    expect(engine.now()).toBeGreaterThanOrEqual(5);
  });

  it('seek（播放中）：旧 source 全部 stop + 重调度 + 时钟重锚', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(PCM());
    const d = proj([track('ta', 'audio', ['a'])], { a: au('a') });
    await engine.prepare(d, async () => BLOB);
    engine.playFrom(d, 0);
    const first = [...fake.created.sources];
    engine.playFrom(d, 2); // seek = playFrom 重锚
    for (const s of first) expect(s.stop).toHaveBeenCalled();
    expect(engine.now()).toBeCloseTo(2, 6);
  });

  it('stop：全部 source stop + 时钟清零', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(PCM());
    const d = proj([track('ta', 'audio', ['a'])], { a: au('a') });
    await engine.prepare(d, async () => BLOB);
    engine.playFrom(d, 0);
    engine.stop();
    for (const s of fake.created.sources) expect(s.stop).toHaveBeenCalled();
    expect(engine.now()).toBe(0);
  });

  it('muted 轨：调度不跳过但 gain 恒 0', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(PCM());
    const d = proj([track('ta', 'audio', ['a'], { muted: true })], { a: au('a') });
    await engine.prepare(d, async () => BLOB);
    engine.playFrom(d, 0);
    expect(fake.created.sources).toHaveLength(1); // 仍占时长
    const g = fake.created.gains.at(-1)! as unknown as { __automation: { type: string; v: number }[] };
    expect(g.__automation[0]).toMatchObject({ type: 'set', v: 0 });
  });

  it('gain automation：from 处锚点 + 未来拐点 linearRamp', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(PCM());
    const d = proj([track('ta', 'audio', ['a'])], { a: au('a', { fade: { in: 2, out: 0 } }) });
    await engine.prepare(d, async () => BLOB);
    fake.advance(1);
    engine.playFrom(d, 1); // from=1：锚点 = gain(1)=0.5；未来拐点 t=2(ramp 1.0)、t=4(ramp 1.0)
    const g = fake.created.gains.at(-1)! as unknown as { __automation: { type: string; v: number; t: number }[] };
    expect(g.__automation[0]).toMatchObject({ type: 'set', v: 0.5, t: 1 });
    const ramps = g.__automation.filter(a => a.type === 'ramp');
    expect(ramps.some(r => Math.abs(r.v - 1) < 1e-9 && Math.abs(r.t - 2) < 1e-9)).toBe(true);
  });

  it('releasePcm：清缓存（编辑器收起释放）', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(PCM());
    const d = proj([track('ta', 'audio', ['a'])], { a: au('a') });
    await engine.prepare(d, async () => BLOB);
    engine.releasePcm();
    expect(engine.hasPcm('ma:1')).toBe(false);
  });

  it('重复 playFrom 复用 AudioBuffer（G4：createBuffer 次数不随 playFrom 增长——拖拽 seek 分配纪律）', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(PCM());
    const d = proj([track('ta', 'audio', ['a'])], { a: au('a') });
    await engine.prepare(d, async () => BLOB);
    engine.playFrom(d, 0);
    engine.playFrom(d, 2);
    engine.playFrom(d, 3);
    expect(fake.ctx.createBuffer).toHaveBeenCalledTimes(1); // 每 mediaId:speed 只建一次
  });

  it('suspend 后再次 playFrom：resume 被调（G2——currentTime 冻结修复，二次打开不黑屏）', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(PCM());
    const d = proj([track('ta', 'audio', ['a'])], { a: au('a') });
    await engine.prepare(d, async () => BLOB);
    engine.playFrom(d, 0);
    engine.suspend();
    (fake.ctx as { state: string }).state = 'suspended';
    engine.playFrom(d, 1);
    expect(fake.ctx.resume).toHaveBeenCalled();
  });

  it('setMasterVolume：master gain 设置', () => {
    engine.setMasterVolume(0.5);
    expect(engine.getMasterVolume()).toBeCloseTo(0.5, 10);
  });
});
