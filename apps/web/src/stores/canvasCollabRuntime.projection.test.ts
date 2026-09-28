import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { syncStoreToDoc } from './canvasCollabRuntime';
import { Origin } from './canvasUndo';
import { fillDoc } from '@/collab/ydocBuilder';

// storyboardGroupFixture：按 cs 的 Node 形状构造 storyboard 组节点（data 含 groupType/storyboard 配置）

describe('G3 读 doc 断言（F42 投影分型）', () => {
  it('G3 读 doc 断言：updateStoryboardConfig 改比例 → doc 里的 storyboard.aspectRatio 更新（F42 投影分型——现状红相=组 data 取 ns 陈旧值）', () => {
    const d = new Y.Doc();
    fillDoc(d, [], []);
    // cs：storyboard 组 aspectRatio 16:9
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 300, height: 250, data: { groupType: 'storyboard', storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: false, stitchResolution: '2K' } } },
    ] as any, edges: [] });
    // ns：陈旧组 data（groupNodes/mergeStoryboard 的 ns.addNode 写入的旧形态——aspectRatio 16:9）
    useNodeStore.setState({ nodes: {
      g1: { id: 'g1', type: 'group', data: { groupType: 'storyboard', storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: false, stitchResolution: '2K' } } },
    } as any });
    useCanvasStore.getState().updateStoryboardConfig('g1', { aspectRatio: '1:1' });
    syncStoreToDoc(d, Origin.LocalUser);
    const m = d.getMap('nodes').get('g1') as any;
    // yjs 13.x typeMapSet：普通对象存为 ContentAny（JSON 编码），不自动转 Y.Map——
    // data 本身是 Y.Map（fillDoc 显式建），data.storyboard 读回是普通对象
    expect(m.get('data').get('storyboard').aspectRatio).toBe('1:1');
    // 现状红相：投影 data 取 ns 陈旧 16:9 → doc 里 aspectRatio 仍 16:9
  });
});
