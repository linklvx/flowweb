import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from './canvasStore';

beforeEach(() => {
  useCanvasStore.setState({
    nodes: [
      { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, width: 300, height: 200, data: {} },
      { id: 'n2', type: 'textInput', position: { x: 400, y: 0 }, width: 300, height: 200, data: {} },
      { id: 'free', type: 'imageGen', position: { x: 2000, y: 2000 }, width: 300, height: 200, data: {} },
    ] as any,
    edges: [], selectedId: null,
  });
});

describe('dropIntoGroup', () => {
  it('落点在组内 → 加入组', () => {
    const gid = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useCanvasStore.getState().dropIntoGroup('free', gid);
    const free = useCanvasStore.getState().nodes.find((n) => n.id === 'free')!;
    expect(free.parentId).toBe(gid);
  });

  it('拖入折叠组 → 先展开再加入', () => {
    const gid = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useCanvasStore.getState().toggleCollapse(gid);
    useCanvasStore.getState().dropIntoGroup('free', gid);
    const s = useCanvasStore.getState();
    const group = s.nodes.find((n) => n.id === gid)!;
    expect((group.data as any).collapsed).toBe(false);
    expect(s.nodes.find((n) => n.id === 'free')!.parentId).toBe(gid);
  });
});
