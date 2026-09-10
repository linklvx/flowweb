import { describe, it, expect, beforeEach } from 'vitest';
import { planAutoEdgeOps, ensureAutoEdges } from './auto-edges';
import { autoEdgeId } from '@/stores/autoEdgeIds';
import type { ProjectData, VideoClip } from '../types';
import { useCanvasStore } from '@/stores/canvasStore';

const dataWith = (sourceNodeIds: (string | undefined)[]): ProjectData => {
  const entries = sourceNodeIds.map((sn, i) => {
    // 夹具用 VideoClip 注解（而非 as const）：防 type 与 playbackSpeed 字面量同时拓宽为 string/number
    const v: VideoClip = {
      id: `c${i}`, trackId: 'tv', type: 'video', start: 0, duration: 3, sourceStart: 0, mediaId: `m${i}`,
      ...(sn ? { sourceNodeId: sn } : {}), playbackSpeed: 1,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
    };
    return [`c${i}`, v] as const;
  });
  return {
    version: 1, fps: 30,
    tracks: [{ id: 'tv', type: 'video', name: 'V', muted: false, hidden: false, clips: entries.map(([id]) => id) }],
    clips: Object.fromEntries(entries),
  };
};

describe('planAutoEdgeOps（spec 定稿对账算法）', () => {
  const E = 'edit1';
  it('加带源片段 → 建边', () => {
    const ops = planAutoEdgeOps(dataWith(['s1']), [], E);
    expect(ops.toAdd).toEqual([{ id: autoEdgeId(E, 's1'), source: 's1', target: E }]);
    expect(ops.toRemove).toEqual([]);
  });
  it('同源多片只一边', () => {
    const d = dataWith(['s1', 's1']);
    const ops = planAutoEdgeOps(d, [{ id: autoEdgeId(E, 's1'), source: 's1', target: E }], E);
    expect(ops.toAdd).toHaveLength(0); // 已有，不重复
  });
  it('删全部该源片段 → 删边', () => {
    const ops = planAutoEdgeOps(dataWith(['s2']), [{ id: autoEdgeId(E, 's1'), source: 's1', target: E }], E);
    expect(ops.toRemove).toEqual([autoEdgeId(E, 's1')]);
  });
  it('素材库来源（无 sourceNodeId）不建边', () => {
    const ops = planAutoEdgeOps(dataWith([undefined]), [], E);
    expect(ops.toAdd).toHaveLength(0);
  });
  it('手动边（无 auto: 前缀）永不自动删', () => {
    const manual = { id: 'edge_1', source: 's1', target: E };
    const ops = planAutoEdgeOps(dataWith([]), [manual], E);
    expect(ops.toRemove).toHaveLength(0);
  });
  it('字幕片不建边（type subtitle 排除）', () => {
    const d = dataWith([]);
    d.clips['sub'] = { id: 'sub', trackId: 'tv', type: 'subtitle', start: 0, duration: 2, text: 'x', visible: true, style: { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 }, sourceNodeId: 's9' } as any;
    d.tracks[0].clips.push('sub');
    const ops = planAutoEdgeOps(d, [], E);
    expect(ops.toAdd).toHaveLength(0);
  });
});

describe('ensureAutoEdges（store 落地，幂等）', () => {
  beforeEach(() => {
    // 守卫语义下建边需源节点真实在画布：夹具提供 edit1/s1/s2（个别用例自行 setState 覆盖）
    useCanvasStore.setState({
      nodes: [
        { id: 'edit1', type: 'videoEdit', position: { x: 0, y: 0 }, data: {} } as any,
        { id: 's1', type: 'videoGen', position: { x: 0, y: 0 }, data: {} } as any,
        { id: 's2', type: 'videoGen', position: { x: 0, y: 0 }, data: {} } as any,
      ],
      edges: [], selectedId: null,
    });
  });
  it('建边 → 再跑一遍无新增（幂等）', () => {
    ensureAutoEdges('edit1', dataWith(['s1', 's2']));
    expect(useCanvasStore.getState().edges).toHaveLength(2);
    ensureAutoEdges('edit1', dataWith(['s1', 's2']));
    expect(useCanvasStore.getState().edges).toHaveLength(2);
  });
  it('移除源后删边', () => {
    ensureAutoEdges('edit1', dataWith(['s1']));
    ensureAutoEdges('edit1', dataWith([]));
    expect(useCanvasStore.getState().edges).toHaveLength(0);
  });
  it('素材缺失态：源节点已删（nodes 无该 id）→ 不重建悬空边（spec 生命周期）', () => {
    useCanvasStore.setState({
      nodes: [{ id: 'edit1', type: 'videoEdit', position: { x: 0, y: 0 }, data: {} } as any],
      edges: [], selectedId: null,
    });
    ensureAutoEdges('edit1', dataWith(['ghost'])); // ghost 节点不在画布
    expect(useCanvasStore.getState().edges).toHaveLength(0);
  });
  it('源节点存在 → 正常建边（守卫不放过头）', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'edit1', type: 'videoEdit', position: { x: 0, y: 0 }, data: {} } as any,
        { id: 's1', type: 'videoGen', position: { x: 0, y: 0 }, data: {} } as any,
      ],
      edges: [], selectedId: null,
    });
    ensureAutoEdges('edit1', dataWith(['s1']));
    expect(useCanvasStore.getState().edges).toHaveLength(1);
  });
});
