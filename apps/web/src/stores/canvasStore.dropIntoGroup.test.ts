import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { _setIntentDocForTest } from './canvasIntents';
import { fillDoc } from '@/collab/ydocBuilder';
import { openRwWindow } from '@/test/fixtures/canvas';

// O0b-4：hidden 派生并入 reconcile+toggleCollapse 只读 no-op——命令路径装置需会话 doc+rw 窗口
beforeEach(() => {
  const seeded = [
    { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, width: 300, height: 200, data: {} },
    { id: 'n2', type: 'textInput', position: { x: 400, y: 0 }, width: 300, height: 200, data: {} },
    { id: 'free', type: 'imageGen', position: { x: 2000, y: 2000 }, width: 300, height: 200, data: {} },
  ];
  const doc = new Y.Doc();
  _setIntentDocForTest(doc);
  fillDoc(doc, seeded as any, []);   // Y2 A3：cs≡doc 同步播种（窗尾快照以 doc 收口）
  openRwWindow();
  useCanvasStore.setState({ nodes: seeded as any, edges: [], selectedId: null });
});

afterEach(() => {
  _setIntentDocForTest(null);
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
