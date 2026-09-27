// apps/web/src/stores/canvasStore.marqueeSelecting.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { useCanvasStore } from './canvasStore';
import { pickStructNodes } from './canvasHistory';

// spec §5-1.4 白名单护栏：marqueeSelecting 是抑制用 UI 态，严禁进入结构投影
// （pickStructNodes/storeProjection）与持久化快照——否则框选拖拽会写 undo 栈/协作 doc。
describe('canvasStore.marqueeSelecting', () => {
  afterEach(() => {
    useCanvasStore.setState({ nodes: [], marqueeSelecting: false });
  });

  it('初始 false；setState 生效', () => {
    expect(useCanvasStore.getState().marqueeSelecting).toBe(false);
    useCanvasStore.setState({ marqueeSelecting: true });
    expect(useCanvasStore.getState().marqueeSelecting).toBe(true);
  });

  it('不入结构投影：标志为 true 时 pickStructNodes 键集合固定', () => {
    useCanvasStore.setState({
      nodes: [{ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any],
      marqueeSelecting: true,
    });
    const picked = pickStructNodes(useCanvasStore.getState().nodes);
    expect(Object.keys(picked[0])).toEqual(['id', 'type', 'position', 'parentId', 'width', 'height']);
    expect(JSON.stringify(picked)).not.toContain('marqueeSelecting');
  });
});
