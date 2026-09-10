// apps/web/src/pages/canvas/video-editor/audio-engine/gain.test.ts
import { describe, it, expect } from 'vitest';
import { buildGainPoints, gainValueAt } from './gain';
import type { ProjectData, VideoClip, AudioClip, Track } from '../types';

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

const valueAt = (pts: { t: number; value: number }[], t: number) => gainValueAt(pts, t);

describe('buildGainPoints（音频片：volume × kf × fade）', () => {
  it('无修饰恒 1（首尾锚点）', () => {
    const pts = buildGainPoints(proj([track('ta', 'audio', ['a'])], { a: au('a') }), 'a');
    expect(valueAt(pts, 0)).toBe(1);
    expect(valueAt(pts, 2)).toBe(1);
  });
  it('fadeIn 0.5→1 线性；fadeOut 对称', () => {
    const d = proj([track('ta', 'audio', ['a'])], { a: au('a', { fade: { in: 2, out: 2 } }) });
    const pts = buildGainPoints(d, 'a');
    expect(valueAt(pts, 0)).toBeCloseTo(0, 10);
    expect(valueAt(pts, 1)).toBeCloseTo(0.5, 10);
    expect(valueAt(pts, 2)).toBe(1);
    expect(valueAt(pts, 3)).toBeCloseTo(0.5, 10);
  });
  it('volume 基准 × volume 关键帧（越首末取端值）', () => {
    const d = proj([track('ta', 'audio', ['a'])], {
      a: au('a', { volume: 0.8, keyframes: [{ id: 'k1', t: 1, value: 0.2, easing: 'linear' }] }),
    });
    const pts = buildGainPoints(d, 'a');
    expect(valueAt(pts, 0)).toBeCloseTo(0.2, 10); // 越首点取首点值（单点恒值）
    expect(valueAt(pts, 1)).toBeCloseTo(0.2, 10);
  });
  it('muted 轨恒 0（仍占时长——调度不跳过）', () => {
    const d = proj([track('ta', 'audio', ['a'], { muted: true })], { a: au('a') });
    const pts = buildGainPoints(d, 'a');
    expect(pts).toEqual([{ t: 0, value: 0 }]);
  });
});

describe('buildGainPoints（视频片内嵌音轨：与画面 opacity 同曲线 equal-gain）', () => {
  it('crossfade 前片尾缘 1→0 / 后片前缘 0→1（中点各 0.5）', () => {
    const d = proj([track('tv', 'video', ['f', 'b'])], {
      f: vc('f', { start: 0, duration: 3 }),
      b: vc('b', { start: 2.5, duration: 3, transitionIn: { type: 'crossfade', duration: 0.5 } }),
    });
    const pf = buildGainPoints(d, 'f');
    const pb = buildGainPoints(d, 'b');
    expect(valueAt(pf, 2.5)).toBeCloseTo(1, 10);
    expect(valueAt(pf, 2.75)).toBeCloseTo(0.5, 10);
    expect(valueAt(pb, 0)).toBeCloseTo(0, 10);
    expect(valueAt(pb, 0.25)).toBeCloseTo(0.5, 10);
    expect(valueAt(pb, 1)).toBe(1);
  });
  it('三片链 crossfade：中间片双窗口增益（尾缘中点 0.5——R1 审核 G3 修复前恒 1）', () => {
    const d = proj([track('tv', 'video', ['a', 'b', 'c'])], {
      a: vc('a', { start: 0, duration: 3 }),
      b: vc('b', { start: 2.5, duration: 3, transitionIn: { type: 'crossfade', duration: 0.5 } }),
      c: vc('c', { start: 5, duration: 3, transitionIn: { type: 'crossfade', duration: 0.5 } }),
    });
    const pb = buildGainPoints(d, 'b');
    expect(valueAt(pb, 0)).toBeCloseTo(0, 10);
    expect(valueAt(pb, 1)).toBe(1);
    expect(valueAt(pb, 2.75)).toBeCloseTo(0.5, 10);
  });
  it('opacity 关键帧参与音轨增益（画面透明=音量同曲线）', () => {
    const d = proj([track('tv', 'video', ['a'])], {
      a: vc('a', { keyframes: [{ id: 'k1', t: 0, property: 'opacity', value: 0, easing: 'linear' }, { id: 'k2', t: 4, property: 'opacity', value: 1, easing: 'linear' }] }),
    });
    const pts = buildGainPoints(d, 'a');
    expect(valueAt(pts, 0)).toBeCloseTo(0, 10);
    expect(valueAt(pts, 2)).toBeCloseTo(0.5, 10);
  });
  it('fadeOut 转场音轨同步淡出', () => {
    const d = proj([track('tv', 'video', ['a'])], {
      a: vc('a', { transitionOut: { type: 'fadeOut', duration: 2 } }),
    });
    expect(valueAt(buildGainPoints(d, 'a'), 3)).toBeCloseTo(0.5, 10);
  });
  it('图片/字幕片无音轨 → 恒 0', () => {
    const d = proj([track('tv', 'video', ['img'])], {
      img: { id: 'img', trackId: 'tv', type: 'image', start: 0, duration: 4, mediaId: 'mi', transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] } as never,
    });
    expect(buildGainPoints(d, 'img')).toEqual([{ t: 0, value: 0 }]);
  });
});

describe('gainValueAt（折线求值）', () => {
  it('两点间线性', () => {
    expect(gainValueAt([{ t: 0, value: 0 }, { t: 2, value: 1 }], 0.5)).toBeCloseTo(0.25, 10);
  });
});
