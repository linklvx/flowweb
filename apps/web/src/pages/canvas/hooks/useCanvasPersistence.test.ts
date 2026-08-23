// apps/web/src/pages/canvas/hooks/useCanvasPersistence.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCanvasPersistence } from './useCanvasPersistence';
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeStore } from '@/stores/nodeStore';
import { useGroupHistory } from '@/stores/groupHistory';
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
    useGroupHistory.setState({ past: [], future: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
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
});
