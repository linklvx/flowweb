import { describe, it, expect } from 'vitest';
import { selectActiveClips } from './active-clips';
import type { Clip, ProjectData, VideoClip, ImageClip, AudioClip, SubtitleClip } from '../types';

const vc = (id: string, start: number, duration: number, trackId = 'tv', over: Partial<VideoClip> = {}): VideoClip => ({
  id, trackId, type: 'video', start, duration, sourceStart: 0, mediaId: 'm', playbackSpeed: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [], ...over,
});
const ic = (id: string, start: number, duration: number, trackId = 'tv'): ImageClip => ({
  id, trackId, type: 'image', start, duration, mediaId: 'mi',
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
});
const ac = (id: string, start: number, duration: number, trackId = 'ta'): AudioClip => ({
  id, trackId, type: 'audio', start, duration, sourceStart: 0, mediaId: 'ma',
  volume: 1, fade: { in: 0, out: 0 }, playbackSpeed: 1, keyframes: [],
});
const sc = (id: string, start: number, duration: number, trackId = 'ts'): SubtitleClip => ({
  id, trackId, type: 'subtitle', start, duration, text: 'x', visible: true,
  style: { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 },
});

const data = (spec: { trackId: string; type: 'video' | 'subtitle' | 'audio'; hidden?: boolean; clips: Clip[] }[]): ProjectData => ({
  version: 1, fps: 30,
  tracks: spec.map(s => ({ id: s.trackId, type: s.type, name: s.trackId, muted: false, hidden: s.hidden ?? false, clips: s.clips.map(c => c.id) })),
  clips: Object.fromEntries(spec.flatMap(s => s.clips).map(c => [c.id, c])),
});
describe('selectActiveClips（视觉管线活跃判定）', () => {
  it('t=start 含 / t=end 不含（半开区间）', () => {
    const d = data([{ trackId: 'tv', type: 'video', clips: [vc('a', 1, 2)] }]);
    expect(selectActiveClips(d, 1).map(x => x.clip.id)).toEqual(['a']);
    expect(selectActiveClips(d, 3)).toHaveLength(0);
  });
  it('hidden 轨剔除（视觉片不进）', () => {
    const d = data([{ trackId: 'tv', type: 'video', hidden: true, clips: [vc('a', 0, 5)] }]);
    expect(selectActiveClips(d, 1)).toHaveLength(0);
  });
  it('音频片不进视觉管线（音频走 audio-engine 调度）', () => {
    const d = data([{ trackId: 'ta', type: 'audio', clips: [ac('a', 0, 5)] }]);
    expect(selectActiveClips(d, 1)).toHaveLength(0);
  });
  it('renderOrder：视觉片按 track 索引升序、同轨按 start；字幕恒最后', () => {
    const d = data([
      { trackId: 'ts', type: 'subtitle', clips: [sc('sub', 0, 5)] },
      { trackId: 't0', type: 'video', clips: [vc('v-low', 0, 5)] },
      { trackId: 't1', type: 'video', clips: [vc('v-late', 1, 2), vc('v-early', 0, 5)] },
    ]);
    // t1 轨内按 start：early(0) 先于 late(1)；字幕最后（即使其 track 索引为 0——锁定独立语义，防单数组排序变体）
    expect(selectActiveClips(d, 1.5).map(x => x.clip.id)).toEqual(['v-low', 'v-early', 'v-late', 'sub']);
  });
  it('crossfade overlap 区间双片段都在（排序后后片自然在上层）', () => {
    const d = data([{ trackId: 'tv', type: 'video', clips: [
      vc('front', 0, 3), vc('back', 2.5, 3, 'tv', { transitionIn: { type: 'crossfade', duration: 0.5 } }),
    ] }]);
    const r = selectActiveClips(d, 2.6);
    expect(r.map(x => x.clip.id)).toEqual(['front', 'back']);
  });
  it('空工程/无片段返回空数组', () => {
    const d = data([{ trackId: 'tv', type: 'video', clips: [] }]);
    expect(selectActiveClips(d, 0)).toEqual([]);
  });
});
