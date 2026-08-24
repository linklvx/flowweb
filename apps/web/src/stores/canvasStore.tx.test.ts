// apps/web/src/stores/canvasStore.tx.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';

vi.mock('antd', () => ({ message: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() } }));
// Mock projectApi to avoid DB calls in tests (reference canvasStore.groups.test.ts pattern if needed)
vi.mock('@/api/projectApi', () => ({
  syncNodes: vi.fn(() => Promise.resolve()),
  syncEdges: vi.fn(() => Promise.resolve()),
}));

const addText = (id: string, x: number, y: number) => {
  useCanvasStore.setState((s) => ({
    nodes: [...s.nodes, { id, type: 'text', position: { x, y }, data: {} } as any],
  }));
  useNodeStore.setState((s) => ({ nodes: { ...s.nodes, [id]: { id, type: 'text', position: { x, y }, data: {} as any } } }));
};

beforeEach(() => {
  useCanvasStore.setState({
    nodes: [],
    edges: [],
    selectedId: null,
    projectId: null,
    nodeProcessMap: {},
    _isPointerInteraction: false,
    isHydrating: false,
  });
  useCanvasStore.temporal.getState().clear();
  useNodeStore.setState({ nodes: {} });
});

describe('多 set 组操作事务护栏（M-1：恰好 1 条历史）', () => {
  it('ungroup 分镜组 → 1 条（宫格重排 + 解组双 set）', () => {
    addText('img1', 0, 0);
    addText('img2', 320, 0);
    const gid = useCanvasStore.getState().groupNodes(['img1', 'img2']);
    useCanvasStore.setState((s) => ({
      nodes: s.nodes.map((n) => n.id === gid
        ? { ...n, data: { ...n.data, groupType: 'storyboard', cells: ['img1', 'img2'],
            storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: false, stitchResolution: '2K' } } }
        : n),
    }));
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.getState().ungroup(gid);
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
  });

  it('convertGroup 分镜→普通 → 1 条（主 set + refitGroupBounds 双 set）', () => {
    addText('img1', 0, 0);
    addText('img2', 320, 0);
    const gid = useCanvasStore.getState().groupNodes(['img1', 'img2']);
    useCanvasStore.setState((s) => ({
      nodes: s.nodes.map((n) => n.id === gid
        ? { ...n, data: { ...n.data, groupType: 'storyboard', cells: ['img1', 'img2'],
            storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: false, stitchResolution: '2K' } } }
        : n),
    }));
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.getState().convertGroup(gid, 'normal');
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
  });

  it('toggleCollapse 折叠 → 1 条；展开 → 1 条', () => {
    addText('a', 0, 0);
    addText('b', 300, 0);
    const gid = useCanvasStore.getState().groupNodes(['a', 'b']);
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.getState().toggleCollapse(gid);                          // 折叠
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.getState().toggleCollapse(gid);                          // 展开（未手动 resize → refit 路径双 set）
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
  });

  it('dropIntoGroup 目标组折叠态 → 1 条（toggleCollapse + 主 set）', () => {
    addText('a', 0, 0);
    addText('b', 300, 0);
    const gid = useCanvasStore.getState().groupNodes(['a', 'b']);
    useCanvasStore.getState().toggleCollapse(gid);                          // 折叠
    addText('c', 600, 0);
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.getState().dropIntoGroup('c', gid);
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
  });

  it('deleteNode 分镜组内节点 → 1 条（主 filter + cells 过滤 set）', () => {
    addText('img1', 0, 0);
    addText('img2', 320, 0);
    const gid = useCanvasStore.getState().groupNodes(['img1', 'img2']);
    useCanvasStore.setState((s) => ({
      nodes: s.nodes.map((n) => n.id === gid
        ? { ...n, data: { ...n.data, groupType: 'storyboard', cells: ['img1', 'img2'],
            storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: false, stitchResolution: '2K' } } }
        : n),
    }));
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.getState().deleteNode('img1');
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
  });

  it('dropImageIntoStoryboard imageGen 路径 → 1 条（五审 L-4 简化护栏；前置已核 :1082-1095：type=imageGen + status=done + 有空位）', () => {
    addText('img1', 0, 0);
    addText('img2', 320, 0);
    const gid = useCanvasStore.getState().groupNodes(['img1', 'img2']);
    useCanvasStore.setState((s) => ({
      nodes: s.nodes.map((n) => n.id === gid
        ? { ...n, data: { ...n.data, groupType: 'storyboard', cells: ['img1'],
            storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: false, stitchResolution: '2K' } } }
        : n),
    }));
    // Add third image node to drop in
    useCanvasStore.setState((s) => ({
      nodes: [...s.nodes, { id: 'img3', type: 'imageGen', position: { x: 600, y: 0 }, data: { status: 'done' } } as any],
    }));
    useNodeStore.setState((s) => ({
      nodes: { ...s.nodes, img3: { id: 'img3', type: 'imageGen', position: { x: 600, y: 0 }, data: { status: 'done' } as any } },
    }));
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.getState().dropImageIntoStoryboard(gid, 'img3');
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
  });
});
