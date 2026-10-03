// apps/web/src/stores/canvasStore.marqueeSelecting.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { useCanvasStore } from './canvasStore';
import { captureStoreProjection } from './canvasIntents';

// spec §5-1.4 白名单护栏：marqueeSelecting 是抑制用 UI 态，严禁进入结构投影
// （captureStoreProjection/storeProjection）与持久化快照——否则框选拖拽会写 undo 栈/协作 doc。
// O0b-4：canvasHistory 整模块删除——结构投影断言改走 captureStoreProjection（写侧单源）。
describe('canvasStore.marqueeSelecting', () => {
  afterEach(() => {
    useCanvasStore.setState({ nodes: [], marqueeSelecting: false });
  });

  it('初始 false；setState 生效', () => {
    expect(useCanvasStore.getState().marqueeSelecting).toBe(false);
    useCanvasStore.setState({ marqueeSelecting: true });
    expect(useCanvasStore.getState().marqueeSelecting).toBe(true);
  });

  it('不入结构投影：标志为 true 时 captureStoreProjection 键集合固定（data 键常驻——普通节点 ns data，组节点组 data，F42）', () => {
    useCanvasStore.setState({
      nodes: [{ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any],
      marqueeSelecting: true,
    });
    const snap = captureStoreProjection();
    // 条件键形态（projectCanvasNodes）：无 parentId/wh 的顶层节点=4 键；data 键恒在（F42）
    expect(Object.keys(snap.nodes[0])).toEqual(['id', 'type', 'position', 'data']);
    expect(JSON.stringify(snap)).not.toContain('marqueeSelecting');
  });
});
