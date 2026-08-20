import { describe, it, expect, vi, beforeAll } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCanvasPersistence } from '../useCanvasPersistence';
import { useNodeStore } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';

vi.mock('@/hooks/useSocket', () => ({ useSocket: () => ({}) }));

const PID = 'test-pid';
const CONTENT_KEY = `flowweb_canvas_content_${PID}`;
const CANVAS_KEY = `flowweb_canvas_${PID}`;

const seedNode = (id: string) => ({
  id,
  type: 'imageGen',
  position: { x: 0, y: 0 },
  data: { prompt: { text: '', html: '' } },
});

describe('useCanvasPersistence — content key 防污染守卫', () => {
  beforeAll(() => {
    localStorage.clear();
    useNodeStore.setState({ nodes: {} });
  });

  it('nodeStore 被动清空时不覆盖非空 content key', () => {
    localStorage.setItem(CONTENT_KEY, JSON.stringify({ n1: seedNode('n1') }));
    renderHook(() => useCanvasPersistence(PID));

    // 模拟迟到空响应清空 nodeStore（Bug 2 时序）
    useNodeStore.setState({ nodes: {} });

    expect(localStorage.getItem(CONTENT_KEY)).toBe(JSON.stringify({ n1: seedNode('n1') }));
  });

  it('nodeStore 非空时正常写入 content key', () => {
    const { rerender } = renderHook(() => useCanvasPersistence(PID));

    useNodeStore.setState({ nodes: { n2: seedNode('n2') as never } });
    rerender();

    const stored = JSON.parse(localStorage.getItem(CONTENT_KEY) || '{}');
    expect(Object.keys(stored)).toContain('n2');
  });

  it('store 空且 localStorage 无缓存时写入空对象不抛错（首载空状态）', () => {
    localStorage.removeItem(CONTENT_KEY);
    renderHook(() => useCanvasPersistence(PID));

    expect(() => useNodeStore.setState({ nodes: {} })).not.toThrow();
  });

  it('恢复 effect：mount 时 store 空则从 localStorage 恢复 canvasStore', () => {
    useCanvasStore.setState({ nodes: [], edges: [] });
    localStorage.setItem(
      CANVAS_KEY,
      JSON.stringify({ nodes: [{ id: 'n1', type: 'imageGen', position: { x: 1, y: 2 }, data: {} }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }),
    );

    renderHook(() => useCanvasPersistence(PID));

    expect(useCanvasStore.getState().nodes.map((n: any) => n.id)).toContain('n1');
  });
});
