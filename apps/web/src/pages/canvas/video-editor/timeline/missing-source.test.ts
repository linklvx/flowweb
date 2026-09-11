// apps/web/src/pages/canvas/video-editor/timeline/missing-source.test.ts
import { describe, it, expect } from 'vitest';
import { missingSourceNodeIds } from './missing-source';
import type { ProjectData } from '../types';

const data = (sourceNodeIds: (string | undefined)[]): ProjectData => ({
  version: 1, fps: 30,
  tracks: [{ id: 'tv', type: 'video', name: 'V', muted: false, hidden: false, clips: sourceNodeIds.map((_, i) => `c${i}`) }],
  clips: Object.fromEntries(sourceNodeIds.map((sn, i) => [`c${i}`, {
    id: `c${i}`, trackId: 'tv', type: 'video', start: 0, duration: 3, sourceStart: 0, mediaId: `m${i}`,
    ...(sn ? { sourceNodeId: sn } : {}), playbackSpeed: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
  }])) as ProjectData['clips'],
});

describe('missingSourceNodeIds（素材缺失态派生——spec 生命周期第 3 条）', () => {
  it('clip.sourceNodeId 不在画布节点集合 → 计入缺失', () => {
    const m = missingSourceNodeIds(data(['ghost', 'alive']), new Set(['alive', 'edit1']));
    expect(m).toEqual(new Set(['ghost']));
  });
  it('素材库来源（无 sourceNodeId）不计入；字幕片不计入', () => {
    const d = data([undefined]);
    // strict 适配：shared SubtitleClip 类型无 sourceNodeId 字段（计划注释与之矛盾，TS2353）——
    // as 联合保留测试意图：字幕片即使残留 sourceNodeId 也不计入缺失
    d.clips['sub'] = { id: 'sub', trackId: 'tv', type: 'subtitle', start: 5, duration: 2, text: 'x', visible: true, style: { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 }, sourceNodeId: 'ghost2' } as ProjectData['clips'][string];
    d.tracks[0].clips.push('sub');
    expect(missingSourceNodeIds(d, new Set())).toEqual(new Set());
  });
  it('data null → 空集合', () => {
    expect(missingSourceNodeIds(null, new Set())).toEqual(new Set());
  });
});
