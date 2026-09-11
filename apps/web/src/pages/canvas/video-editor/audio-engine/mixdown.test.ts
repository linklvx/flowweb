// apps/web/src/pages/canvas/video-editor/audio-engine/mixdown.test.ts
import { describe, it, expect } from 'vitest';
import { mixdownTimeline, MIX_SAMPLE_RATE } from './mixdown';
import type { ProjectData, AudioClip, VideoClip } from '../types';

// PcmData 实形 = { sampleRate, channels: Float32Array[] }——夹具同形
const mkPcm = (seconds: number, amp = 1) => {
  const n = Math.round(seconds * MIX_SAMPLE_RATE);
  return { sampleRate: MIX_SAMPLE_RATE, channels: [new Float32Array(n).fill(amp), new Float32Array(n).fill(amp)] };
};
const ac = (id: string, mediaId: string, start: number, duration: number, over: Partial<AudioClip> = {}): AudioClip => ({
  id, trackId: 'ta', type: 'audio', start, duration, sourceStart: 0, mediaId,
  volume: 1, fade: { in: 0, out: 0 }, playbackSpeed: 1, keyframes: [], ...over,
});
const mk = (clips: (AudioClip | VideoClip)[], muted = false): ProjectData => ({
  version: 1, fps: 30,
  tracks: [{ id: 'ta', type: 'audio', name: 'a', muted, hidden: false, clips: clips.map((c) => c.id) }],
  clips: Object.fromEntries(clips.map((c) => [c.id, c])),
});

describe('mixdownTimeline（导出离线混音——复用 buildGainPoints/gainValueAt 同源语义）', () => {
  it('无音频片/视频片 → null（不产 PCM）', async () => {
    expect(await mixdownTimeline(mk([]), async () => null)).toBeNull();
  });
  it('全部 PCM 不可得（纯视频素材无音轨）→ null', async () => {
    expect(await mixdownTimeline(mk([ac('a', 'm1', 0, 2)]), async () => null)).toBeNull();
  });
  it('单片线性写入：2s amp=0.5 volume=1 → 左右声道 0..2s 恒 0.5', async () => {
    const data = mk([ac('a', 'm1', 0, 2, { volume: 0.5 })]);
    const r = await mixdownTimeline(data, async () => mkPcm(3));
    expect(r).not.toBeNull();
    expect(r!.left.length).toBe(2 * MIX_SAMPLE_RATE);
    expect(r!.left[0]).toBeCloseTo(0.5, 5);
    expect(r!.left[2 * MIX_SAMPLE_RATE - 1]).toBeCloseTo(0.5, 5);
    expect(r!.sampleRate).toBe(MIX_SAMPLE_RATE);
  });
  it('时间偏移：片 start=1s → [0,48000) 静音、[48000,96000) 有声（前导黑场计入成片）', async () => {
    const data = mk([ac('a', 'm1', 1, 1)]);
    const r = await mixdownTimeline(data, async () => mkPcm(2));
    expect(r!.left[100]).toBe(0);
    expect(r!.left[MIX_SAMPLE_RATE + 100]).toBeCloseTo(1, 5);
  });
  it('sourceStart 偏移进入 stretched 坐标（sourceStart/speed）', async () => {
    const data = mk([ac('a', 'm1', 0, 1, { sourceStart: 1 })]); // 源 1s 处开始取 1s
    const left = new Float32Array(MIX_SAMPLE_RATE * 3); // 源 [1s,2s) 为 1
    left[MIX_SAMPLE_RATE] = 1; left[MIX_SAMPLE_RATE * 2 - 1] = 1;
    const pcm = { sampleRate: MIX_SAMPLE_RATE, channels: [left, left] };
    const r = await mixdownTimeline(data, async () => pcm);
    expect(r!.left[0]).toBeCloseTo(1, 5);
    expect(r!.left[MIX_SAMPLE_RATE - 1]).toBeCloseTo(1, 5);
  });
  it('多片叠加求和（同刻两片各 1 → 2）', async () => {
    const data = mk([ac('a', 'm1', 0, 2), ac('b', 'm2', 1, 1)]);
    const r = await mixdownTimeline(data, async () => mkPcm(3));
    expect(r!.left[MIX_SAMPLE_RATE + 100]).toBeCloseTo(2, 4);
  });
  it('muted 轨 gain=0（buildGainPoints 语义）但仍占时长', async () => {
    const data = mk([ac('a', 'm1', 0, 2)], true);
    const r = await mixdownTimeline(data, async () => mkPcm(3));
    expect(r!.left.every((v) => v === 0)).toBe(true);
    expect(r!.left.length).toBe(2 * MIX_SAMPLE_RATE);
  });
  it('fade in 生效：片头增益≈0（128 样本块粒度）', async () => {
    const data = mk([ac('a', 'm1', 0, 2, { fade: { in: 1, out: 0 } })]);
    const r = await mixdownTimeline(data, async () => mkPcm(3));
    expect(Math.abs(r!.left[10])).toBeLessThan(0.01);   // 首 128 样本块 gain≈块首时刻
    expect(r!.left[MIX_SAMPLE_RATE]).toBeCloseTo(1, 2); // 1s 处 fade 完成
  });
  it('onProgress 按 clip 数推进（0.5/1）', async () => {
    const seen: number[] = [];
    const data = mk([ac('a', 'm1', 0, 1), ac('b', 'm2', 1, 1)]);
    await mixdownTimeline(data, async () => mkPcm(2), (r) => seen.push(r));
    expect(seen).toEqual([0.5, 1]);
  });
});
