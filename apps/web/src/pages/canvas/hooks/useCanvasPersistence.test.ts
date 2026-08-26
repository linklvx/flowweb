// apps/web/src/pages/canvas/hooks/useCanvasPersistence.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCanvasPersistence } from './useCanvasPersistence';
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeStore } from '@/stores/nodeStore';
import { snapshotKey } from './canvasSnapshot';

describe('useCanvasPersistence 组关系往返（Bug F）', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    useCanvasStore.setState({
      nodes: [
        { id: 'n1', type: 'imageGen', position: { x: 100, y: 100 }, width: 300, height: 200, data: {} },
        { id: 'n2', type: 'textInput', position: { x: 500, y: 50 }, width: 300, height: 300, data: {} },
      ] as any,
      edges: [], selectedId: null, projectId: 'p1', isHydrating: false,
    });
    useNodeStore.setState({
      nodes: {
        n1: { id: 'n1', type: 'imageGen', position: { x: 100, y: 100 }, data: {} } as any,
        n2: { id: 'n2', type: 'textInput', position: { x: 500, y: 50 }, data: {} } as any,
      },
    });
    useCanvasStore.temporal.getState().clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('恢复后 storyboard 子节点 hidden（applyGroupDerivations 对齐 DB 路径）', () => {
    // 播种 storyboard 组 + 子节点（可见态），保存快照
    useCanvasStore.setState({
      nodes: [
        { id: 'sg', type: 'group', position: { x: 100, y: 100 }, width: 642, height: 182, data: {
          groupType: 'storyboard', cells: ['c1'],
          storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 1, showIndex: false, stitchResolution: '2K' },
        } } as any,
        { id: 'c1', type: 'imageGen', parentId: 'sg', extent: 'parent', position: { x: 0, y: 0 }, width: 320, height: 180, data: { status: 'done', fileId: 'f1' } } as any,
      ],
      edges: [], selectedId: null, isHydrating: false,
    });
    useNodeStore.setState({
      nodes: {
        sg: { id: 'sg', type: 'group', position: { x: 100, y: 100 }, data: { groupType: 'storyboard', cells: ['c1'] } } as any,
        c1: { id: 'c1', type: 'imageGen', position: { x: 0, y: 0 }, data: { status: 'done', fileId: 'f1' } } as any,
      },
    });

    const { unmount } = renderHook(() => useCanvasPersistence('p1'));
    useCanvasStore.setState({ selectedId: 'trigger' });
    vi.advanceTimersByTime(600);

    // 清空后恢复
    unmount();
    useCanvasStore.setState({ nodes: [], edges: [], selectedId: null, isHydrating: false });
    useNodeStore.setState({ nodes: {} });
    renderHook(() => useCanvasPersistence('p1'));

    const c1 = useCanvasStore.getState().nodes.find((n) => n.id === 'c1')!;
    expect(c1.parentId).toBe('sg');
    expect(c1.hidden).toBe(true); // storyboard 子节点隐藏（格子渲染代替）
  });

  it('带组 store 保存 → 清空 → localStorage 恢复：parentId/extent/父前子后', () => {
    // 1. 打组（Task 2 修复后已父前子后）
    const gid = useCanvasStore.getState().groupNodes(['n1', 'n2']);

    // 2. mount hook + 触发变更 → 500ms debounce 后写入快照
    const { unmount } = renderHook(() => useCanvasPersistence('p1'));
    useCanvasStore.setState({ selectedId: 'trigger-save' });
    vi.advanceTimersByTime(600);

    const raw = localStorage.getItem(snapshotKey('p1'));
    expect(raw).not.toBeNull();
    const snap = JSON.parse(raw!);
    expect(snap.parentMap).toEqual({ n1: gid, n2: gid });

    // 3. 清空 store（模拟刷新后初始状态）
    unmount();
    useCanvasStore.setState({ nodes: [], edges: [], selectedId: null, isHydrating: false });
    useNodeStore.setState({ nodes: {} });

    // 4. 重新 mount → 快照恢复
    renderHook(() => useCanvasPersistence('p1'));

    const nodes = useCanvasStore.getState().nodes;
    const c1 = nodes.find((n) => n.id === 'n1')!;
    expect(c1.parentId).toBe(gid);
    expect(c1.extent).toBe('parent');
    expect(nodes.findIndex((n) => n.id === gid)).toBeLessThan(nodes.findIndex((n) => n.id === 'n1'));
    expect(nodes.findIndex((n) => n.id === gid)).toBeLessThan(nodes.findIndex((n) => n.id === 'n2'));
  });

  it('快照写入 serverVersion', () => {
    useCanvasStore.setState({ serverVersion: 7 });
    // 触发一次 store 结构变更 → 500ms debounce 后写入快照
    const { unmount } = renderHook(() => useCanvasPersistence('p1'));
    useCanvasStore.setState({ selectedId: 'trigger-server-version' });
    vi.advanceTimersByTime(600);
    unmount();

    const raw = localStorage.getItem(snapshotKey('p1'));
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).serverVersion).toBe(7);
  });

  it('手动 resize 组（无 savedSize）恢复：保留快照宽高，不被 refit 覆盖（T8 端到端发现）', () => {
    // 组带 manuallyResized 标记与快照宽高（从未折叠过 → 无 savedSize），子节点用于让 refit 可检测
    useCanvasStore.setState({
      nodes: [
        { id: 'g1', type: 'group', position: { x: 50, y: 50 }, width: 460, height: 436, data: { groupType: 'normal', manuallyResized: true } } as any,
        { id: 'c1', type: 'textInput', parentId: 'g1', extent: 'parent', position: { x: 20, y: 60 }, width: 300, height: 300, data: {} } as any,
      ],
      edges: [], selectedId: null, isHydrating: false,
    });
    useNodeStore.setState({
      nodes: {
        g1: { id: 'g1', type: 'group', position: { x: 50, y: 50 }, width: 460, height: 436, data: { groupType: 'normal', manuallyResized: true } } as any,
        c1: { id: 'c1', type: 'textInput', position: { x: 20, y: 60 }, width: 300, height: 300, data: {} } as any,
      },
    });

    const { unmount } = renderHook(() => useCanvasPersistence('p1'));
    useCanvasStore.setState({ selectedId: 'trigger-save' });
    vi.advanceTimersByTime(600);
    unmount();

    useCanvasStore.setState({ nodes: [], edges: [], selectedId: null, isHydrating: false });
    useNodeStore.setState({ nodes: {} });
    renderHook(() => useCanvasPersistence('p1'));

    const g = useCanvasStore.getState().nodes.find((n) => n.id === 'g1')!;
    expect(g.width).toBe(460);
    expect(g.height).toBe(436);
  });

  it('手动 resize 组 + savedSize + 快照无宽高：恢复用 savedSize 兜底', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'g1', type: 'group', position: { x: 50, y: 50 }, data: { groupType: 'normal', manuallyResized: true, savedSize: { width: 777, height: 555 } } } as any,
        { id: 'c1', type: 'textInput', parentId: 'g1', extent: 'parent', position: { x: 20, y: 60 }, width: 300, height: 300, data: {} } as any,
      ],
      edges: [], selectedId: null, isHydrating: false,
    });
    useNodeStore.setState({
      nodes: {
        g1: { id: 'g1', type: 'group', position: { x: 50, y: 50 }, data: { groupType: 'normal', manuallyResized: true, savedSize: { width: 777, height: 555 } } } as any,
        c1: { id: 'c1', type: 'textInput', position: { x: 20, y: 60 }, width: 300, height: 300, data: {} } as any,
      },
    });

    const { unmount } = renderHook(() => useCanvasPersistence('p1'));
    useCanvasStore.setState({ selectedId: 'trigger-save' });
    vi.advanceTimersByTime(600);
    unmount();

    useCanvasStore.setState({ nodes: [], edges: [], selectedId: null, isHydrating: false });
    useNodeStore.setState({ nodes: {} });
    renderHook(() => useCanvasPersistence('p1'));

    const g = useCanvasStore.getState().nodes.find((n) => n.id === 'g1')!;
    expect(g.width).toBe(777);
    expect(g.height).toBe(555);
  });
});
