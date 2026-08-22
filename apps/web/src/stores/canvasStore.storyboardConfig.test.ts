// canvasStore.storyboardConfig.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import type { StoryboardConfig } from '@/types/group';

const doneImage = (id: string, x = 100, y = 100) =>
  ({ id, type: 'imageGen', position: { x, y }, width: 320, height: 180, data: { status: 'done', fileId: `f-${id}` } });

beforeEach(() => {
  useCanvasStore.setState({
    nodes: [doneImage('a'), doneImage('b', 500, 100), doneImage('c', 100, 400), doneImage('d', 500, 400)] as any,
    edges: [], selectedId: null,
  });
  // 清空 nodeStore 以避免测试间污染
  useNodeStore.setState({ nodes: {} });
});

describe('updateStoryboardConfig', () => {
  it('切换比例 → 组尺寸重算', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b', 'c', 'd']);
    useCanvasStore.getState().updateStoryboardConfig(gid, { aspectRatio: '1:1' });
    const g = useCanvasStore.getState().nodes.find((n) => n.id === gid)!;
    expect(g.height).toBeCloseTo(2 * 320 + 2); // 1:1 → 单格 320 高
  });

  it('showIndex 切换', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']);
    useCanvasStore.getState().updateStoryboardConfig(gid, { showIndex: true } as Partial<StoryboardConfig>);
    expect((useCanvasStore.getState().nodes.find((n) => n.id === gid)!.data as any).storyboard!.showIndex).toBe(true);
  });
});

describe('resizeStoryboardGrid（减格溢出）', () => {
  it('4 图组减为 2x2→1x2：超出的 2 张移出排右侧 + cells 截断', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b', 'c', 'd']);
    const before = useCanvasStore.getState().nodes.find((n) => n.id === gid)!;
    useCanvasStore.getState().resizeStoryboardGrid(gid, 1, 2);
    const s = useCanvasStore.getState();
    const g = s.nodes.find((n) => n.id === gid)!;
    expect(g.data.cells).toEqual(['a', 'c']); // 字典序前 2
    const overflowed = s.nodes.find((n) => n.id === 'b')!;
    expect(overflowed.parentId).toBeUndefined();
    expect(overflowed.position.x).toBeGreaterThan(before.position.x + (before.width ?? 0)); // 组右侧
    expect(overflowed.hidden).toBe(false);
    // P0-新1 回归：溢出节点必须存活（而非被删除）
    expect(s.nodes.find((n) => n.id === 'd')).toBeTruthy();
  });

  it('增格 → cells 不变（空位由渲染器显示）', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']);
    useCanvasStore.getState().resizeStoryboardGrid(gid, 2, 2);
    const g = useCanvasStore.getState().nodes.find((n) => n.id === gid)!;
    expect(g.data.cells).toHaveLength(2);
    expect((g.data as any).storyboard!.gridRows).toBe(2);
  });
});

describe('clearStoryboard', () => {
  it('删除全部子节点，组保留为空宫格', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b', 'c', 'd']);
    useCanvasStore.getState().clearStoryboard(gid);
    const s = useCanvasStore.getState();
    expect(s.nodes.find((n) => n.id === gid)).toBeTruthy();
    expect(s.nodes.find((n) => n.id === gid)!.data.cells).toEqual([]);
    expect(s.nodes.find((n) => n.id === 'a')).toBeUndefined();
  });
});
