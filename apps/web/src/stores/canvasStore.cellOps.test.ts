// canvasStore.cellOps.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import type { Node } from '@xyflow/react';

const doneImage = (id: string, x = 100, y = 100): Node =>
  ({ id, type: 'imageGen', position: { x, y }, width: 320, height: 180, data: { status: 'done', fileId: `f-${id}` } } as Node);

beforeEach(() => {
  useCanvasStore.setState({
    nodes: [doneImage('a'), doneImage('b', 500, 100), doneImage('c', 100, 400), doneImage('d', 500, 400)],
    edges: [], selectedId: null,
  });
});

describe('addImageToStoryboardCell', () => {
  it('填充空格：cells 补位 + 新隐藏子节点', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']); // 1x2 → [a,b]
    useCanvasStore.getState().resizeStoryboardGrid(gid, 2, 2); // 扩为 2x2，两个空位
    useCanvasStore.getState().addImageToStoryboardCell(gid, 3, 'f-new');
    const s = useCanvasStore.getState();
    const g = s.nodes.find((n) => n.id === gid)!;
    const cells = g.data.cells as (string | null)[];
    expect(cells![3]).toBeTruthy();
    const cell3 = s.nodes.find((n) => n.id === cells![3])!;
    expect(cell3.parentId).toBe(gid);
    expect((cell3.data as any).fileId).toBe('f-new');
  });

  it('槽位建图节点 data 不含 mediaUrl 键（R2b-6 写入面清零——F37 presigned URL 不得持久化）', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']);
    useCanvasStore.getState().resizeStoryboardGrid(gid, 2, 2);
    useCanvasStore.getState().addImageToStoryboardCell(gid, 3, 'f-new');
    const s = useCanvasStore.getState();
    const cells = (s.nodes.find((n) => n.id === gid)!.data as any).cells as (string | null)[];
    const csNode = s.nodes.find((n) => n.id === cells![3])!;
    expect(JSON.stringify(csNode.data)).not.toContain('mediaUrl'); // cs 镜像不写
    const nsNode = useNodeStore.getState().nodes[cells![3]!];
    expect(JSON.stringify(nsNode.data)).not.toContain('mediaUrl'); // ns 节点不写（双写第二笔）
  });
});

describe('removeStoryboardCell（删单格：不收缩宫格，序号重排）', () => {
  it('删除 cells[1] → 该格变空、后续前移补位', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b', 'c', 'd']); // 2x2 [a,c,b,d]
    useCanvasStore.getState().removeStoryboardCell(gid, 1); // 删 c
    const s = useCanvasStore.getState();
    const g = s.nodes.find((n) => n.id === gid)!;
    expect(g.data.cells).toEqual(['a', 'b', 'd']); // 前移补位（紧凑）
    expect(s.nodes.find((n) => n.id === 'c')).toBeUndefined();
    const storyboard = (g.data as any).storyboard;
    expect(storyboard.gridRows).toBe(2); // 不收缩
  });
});

describe('dropImageIntoStoryboard（multiImageGen 展开拖入）', () => {
  it('multi 展开填空位、原节点移除、组节点不重复', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']); // 1x2 [a,b]
    useCanvasStore.getState().resizeStoryboardGrid(gid, 2, 2); // 扩为 2x2，两个空位
    useCanvasStore.setState({
      nodes: [...useCanvasStore.getState().nodes, {
        id: 'multi', type: 'multiImageGen', position: { x: 1000, y: 100 }, width: 320, height: 200,
        data: { images: [
          { id: 'm1', url: 'u1', name: 'n', status: 'success' },
          { id: 'm2', url: 'u2', name: 'n', status: 'success' },
        ], nodeStatus: 'done' },
      } as Node],
    });
    useCanvasStore.getState().dropImageIntoStoryboard(gid, 'multi');
    const s = useCanvasStore.getState();
    expect(s.nodes.filter((n) => n.id === gid)).toHaveLength(1); // 组节点唯一（回归：曾因旧实例未排除而重复）
    expect(s.nodes.find((n) => n.id === 'multi')).toBeUndefined();
    const g = s.nodes.find((n) => n.id === gid)!;
    const cells = g.data.cells as (string | null)[];
    expect(cells.filter(Boolean)).toHaveLength(4); // a + b + m1 + m2 全入格
    expect(cells.every((c) => c !== 'multi')).toBe(true);
    const expanded = s.nodes.filter((n) => (n.data as any).__fromMulti === 'multi');
    expect(expanded).toHaveLength(2);
    expect(expanded.every((n) => n.parentId === gid)).toBe(true);
  });

  it('展开节点 data 不含 mediaUrl 键（R2b-6 写入面清零——F37）', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']);
    useCanvasStore.getState().resizeStoryboardGrid(gid, 2, 2);
    useCanvasStore.setState({
      nodes: [...useCanvasStore.getState().nodes, {
        id: 'multi', type: 'multiImageGen', position: { x: 1000, y: 100 }, width: 320, height: 200,
        data: { images: [
          { id: 'm1', url: 'u1', name: 'n', status: 'success' },
          { id: 'm2', url: 'u2', name: 'n', status: 'success' },
        ], nodeStatus: 'done' },
      } as Node],
    });
    useCanvasStore.getState().dropImageIntoStoryboard(gid, 'multi');
    const expanded = useCanvasStore.getState().nodes.filter((n) => (n.data as any).__fromMulti === 'multi');
    expect(expanded.length).toBeGreaterThan(0);
    expect(expanded.every((n) => !JSON.stringify(n.data).includes('mediaUrl'))).toBe(true);
  });
});
