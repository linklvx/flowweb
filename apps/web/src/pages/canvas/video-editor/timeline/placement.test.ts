import { describe, it, expect } from 'vitest';
import { placeAssetInTrack } from './placement';
import { createDefaultProjectData } from '../types';
import type { ProjectData, AudioClip, VideoClip } from '../types';

const audioClip = (id: string, start: number, duration: number, trackId: string): AudioClip => ({
  id, trackId, type: 'audio', start, duration, sourceStart: 0, mediaId: 'ma',
  volume: 1, fade: { in: 0, out: 0 }, playbackSpeed: 1, keyframes: [],
});
const vclip = (id: string, start: number, duration: number, trackId: string): VideoClip => ({
  id, trackId, type: 'video', start, duration, sourceStart: 0, mediaId: 'm',
  playbackSpeed: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
});

describe('placeAssetInTrack（spec 3.1 / D8 动态建轨策略）', () => {
  it('视频素材进已有空视频轨，起点 0', () => {
    const d = createDefaultProjectData();
    const r = placeAssetInTrack(d, { mimeType: 'video/mp4' });
    expect(r.trackId).toBe(d.tracks[0].id);
    expect(r.start).toBe(0);
    expect(r.createNewTrack).toBe(false);
  });

  it('无音频轨时放音频 → 标记建轨；轨尾口径 = 该轨 max(start+duration) 而非全局时长', () => {
    const d = createDefaultProjectData();
    // 视频轨已有 0-10s 片段（全局时长 10）
    d.clips.c1 = vclip('c1', 0, 10, d.tracks[0].id);
    d.tracks[0].clips.push('c1');
    const r = placeAssetInTrack(d, { mimeType: 'audio/mp3' });
    expect(r.createNewTrack).toBe(true);   // 无音频轨 → 建
    expect(r.start).toBe(0);               // 新轨从 0
    expect(r.newTrackType).toBe('audio');
    // 显式补建音频轨 + 一条 0-3s 片段：
    const d2: ProjectData = {
      ...d,
      tracks: [...d.tracks, { id: 'ta', type: 'audio', name: '音频1', muted: false, hidden: false, clips: ['a1'] }],
      clips: { ...d.clips, a1: audioClip('a1', 0, 3, 'ta') },
    };
    const r2 = placeAssetInTrack(d2, { mimeType: 'audio/mp3' });
    expect(r2.createNewTrack).toBe(false);
    expect(r2.trackId).toBe('ta');
    expect(r2.start).toBe(3);              // 该轨轨尾 3，而非全局 10（轨尾口径用例）
  });

  it('mimeType 三分类：video/* 与 image/* → video 轨，audio/* → audio 轨', () => {
    const d = createDefaultProjectData();
    expect(placeAssetInTrack(d, { mimeType: 'image/png' }).trackId).toBe(d.tracks[0].id);
  });
});
