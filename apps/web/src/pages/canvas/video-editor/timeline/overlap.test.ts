import { describe, it, expect } from 'vitest';
import type { ProjectData, VideoClip } from '../types';
import { clipsOnTrack, crossfadePredecessor, effectiveTransitions, canPlaceAt, findNearestFreeStart } from './overlap';

const vclip = (id: string, start: number, duration: number, over: Partial<VideoClip> = {}): VideoClip => ({
  id, trackId: 'tv', type: 'video', start, duration, sourceStart: 0, mediaId: 'm',
  playbackSpeed: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [], ...over,
});
const data = (clips: VideoClip[], trackId = 'tv'): ProjectData => ({
  version: 1, fps: 30,
  tracks: [{ id: trackId, type: 'video', name: '视频', muted: false, hidden: false, clips: clips.map(c => c.id) }],
  clips: Object.fromEntries(clips.map(c => [c.id, c])),
});

describe('clipsOnTrack（按 start 有序）', () => {
  it('乱序存入有序取出', () => {
    const d = data([vclip('b', 5, 2), vclip('a', 0, 3), vclip('c', 2, 1)]);
    expect(clipsOnTrack(d, 'tv').map(c => c.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('crossfade 边界状态机（spec 第三节）', () => {
  it('前片缺失 → transitionIn crossfade 退化为 fadeIn', () => {
    const d = data([vclip('solo', 0, 5, { transitionIn: { type: 'crossfade', duration: 0.5 } })]);
    const eff = effectiveTransitions(d, 'solo');
    expect(eff.in?.type).toBe('fadeIn');
    expect(eff.overlap).toBe(0);
  });
  it('前片被移走（start 更大）→ 退化', () => {
    const d = data([
      vclip('a', 0, 3),
      vclip('b', 5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } }),
    ]);
    // b 的前邻 a 结束于 3，b 从 5 开始——无重叠区，overlap 归零但配对存在
    const eff = effectiveTransitions(d, 'b');
    expect(eff.in?.type).toBe('crossfade');
    expect(eff.overlap).toBe(0);
  });
  it('正常 overlap：overlap = 前片 end - 后片 start', () => {
    const d = data([
      vclip('a', 0, 3),
      vclip('b', 2.5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } }),
    ]);
    const eff = effectiveTransitions(d, 'b');
    expect(eff.overlap).toBe(0.5);
  });
  it('前片 transitionOut 与后片 crossfade 冲突 → crossfade 优先（前片 effOut null）', () => {
    const d = data([
      vclip('a', 0, 3, { transitionOut: { type: 'toBlack', duration: 1 } }),
      vclip('b', 2.5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } }),
    ]);
    expect(effectiveTransitions(d, 'a').out).toBeNull();
    expect(effectiveTransitions(d, 'b').in?.type).toBe('crossfade');
  });
  it('分割重配对：split 后后半以原前半为新前片', () => {
    const d = data([
      vclip('a', 0, 3),
      vclip('b1', 4, 1.5),
      vclip('b2', 5.5, 1.5, { transitionIn: { type: 'crossfade', duration: 0.4 } }),
    ]);
    expect(crossfadePredecessor(d, d.clips['b2'] as VideoClip)?.id).toBe('b1');
    expect(effectiveTransitions(d, 'b2').in?.type).toBe('crossfade');
  });
  it('跨轨相邻不触发转场（前邻只查同轨）', () => {
    const d: ProjectData = {
      version: 1, fps: 30,
      tracks: [
        { id: 't1', type: 'video', name: 'V1', muted: false, hidden: false, clips: ['a'] },
        { id: 't2', type: 'video', name: 'V2', muted: false, hidden: false, clips: ['b'] },
      ],
      clips: {
        a: vclip('a', 0, 3),
        b: vclip('b', 2.5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } }),
      },
    };
    (d.clips.b as VideoClip).trackId = 't2';
    expect(crossfadePredecessor(d, d.clips.b as VideoClip)).toBeNull();
    expect(effectiveTransitions(d, 'b').in?.type).toBe('fadeIn'); // 跨轨重叠无转场
  });
  it('字幕片无转场', () => {
    const d = data([]);
    d.clips['s1'] = { id: 's1', trackId: 'tv', type: 'subtitle', start: 0, duration: 2, text: 'x', visible: true, style: { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 } };
    d.tracks[0].clips.push('s1');
    expect(effectiveTransitions(d, 's1')).toEqual({ in: null, out: null, overlap: 0 });
  });
});

describe('canPlaceAt / findNearestFreeStart（同轨禁重叠、跨轨自由）', () => {
  const base = data([vclip('a', 0, 3), vclip('b', 5, 3)]);
  it('同轨空位可放', () => {
    expect(canPlaceAt(base, 'me', 3, 'tv', 1.5)).toBe(true);
  });
  it('同轨重叠拒绝', () => {
    expect(canPlaceAt(base, 'me', 1, 'tv', 1.5)).toBe(false);
  });
  it('crossfade overlap ≤ duration 允许、超过拒绝', () => {
    // 执行期修正（控制器验算）：4.2 → 与 b [5,8) 重叠 0.2 ≤ 0.5 允许；4.6 → 重叠 0.6 > 0.5 拒绝（计划原断言方向写反）
    expect(canPlaceAt(base, 'me', 4.2, 'tv', 1, { transitionIn: { type: 'crossfade', duration: 0.5 } })).toBe(true);
    expect(canPlaceAt(base, 'me', 4.6, 'tv', 1, { transitionIn: { type: 'crossfade', duration: 0.5 } })).toBe(false);
  });
  it('跨轨自由重叠', () => {
    const two: ProjectData = {
      ...base,
      tracks: [...base.tracks, { id: 't2', type: 'video', name: 'V2', muted: false, hidden: false, clips: [] }],
    };
    expect(canPlaceAt(two, 'me', 1, 't2', 5)).toBe(true);
  });
  it('冲突吸附最近空位（帧网格扫描）', () => {
    const s = findNearestFreeStart(base, 'me', 1, 'tv', 1.5); // 1 与 a(0-3) 冲突
    expect(canPlaceAt(base, 'me', s, 'tv', 1.5)).toBe(true);
    expect(s).toBe(3); // 右侧最近空位起点（a 结束于 3，b 从 5 开始，1.5 宽放得下）
  });
});
