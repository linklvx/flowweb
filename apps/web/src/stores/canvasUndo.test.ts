import { describe, it, expect, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { Origin, attachUndoManager, detachUndoManager, stopCapturing, undoCanvas, redoCanvas } from './canvasUndo';

const cancelNodeProcess = vi.fn();
vi.mock('./canvasStore', () => ({
  useCanvasStore: {
    getState: () => ({
      nodes: [{ id: 'n1' }],
      nodeProcessMap: { n1: { status: 'running' } },
      cancelNodeProcess,
    }),
  },
}));

describe('Y.UndoManager 集成（spec 4.2/4.4）', () => {
  afterEach(() => {
    detachUndoManager();
  });

  it('local-user 事务入栈；server/provider origin 不入栈', () => {
    const doc = new Y.Doc();
    const um = attachUndoManager(doc);
    doc.transact(() => doc.getMap('nodes').set('n1', 'a'), Origin.LocalUser);
    doc.transact(() => doc.getMap('nodes').set('n2', 'b'), 'server');
    doc.transact(() => doc.getMap('nodes').set('n3', 'c'), null as any);
    expect(um.undoStack.length).toBe(1);
  });

  it('undo 恢复旧值，redo 恢复新值', () => {
    const doc = new Y.Doc();
    const um = attachUndoManager(doc);
    const nodes = doc.getMap('nodes');
    doc.transact(() => nodes.set('n1', 'v1'), Origin.LocalUser);
    doc.transact(() => nodes.set('n1', 'v2'), Origin.LocalUser);
    stopCapturing();
    doc.transact(() => nodes.set('n1', 'v3'), Origin.LocalUser);
    expect(um.undoStack.length).toBe(2); // stopCapturing 分隔
    um.undo();
    expect(nodes.get('n1')).toBe('v2');
    um.redo();
    expect(nodes.get('n1')).toBe('v3');
  });

  it('captureTimeout 内连续事务合并为一个 undo 项，stopCapturing 分隔', () => {
    const doc = new Y.Doc();
    const um = attachUndoManager(doc);
    const pos = new Y.Map(); doc.getMap('nodes').set('n1', pos);
    doc.transact(() => pos.set('x', 1), Origin.LocalUser);
    doc.transact(() => pos.set('x', 2), Origin.LocalUser); // 500ms 内：合并
    expect(um.undoStack.length).toBe(1);
    stopCapturing();
    doc.transact(() => pos.set('x', 3), Origin.LocalUser);
    expect(um.undoStack.length).toBe(2);
    um.undo();
    expect(pos.get('x')).toBe(2);
  });

  it('栈上限 100 截断', () => {
    const doc = new Y.Doc();
    const um = attachUndoManager(doc);
    const nodes = doc.getMap('nodes');
    for (let i = 0; i < 120; i++) {
      stopCapturing();
      doc.transact(() => nodes.set(`n${i}`, i), Origin.LocalUser);
    }
    expect(um.undoStack.length).toBeLessThanOrEqual(100);
  });

  it('undo 使 doc 中节点消失时取消其进程（S-1，store 投影未到也必须触发）', async () => {
    const doc = new Y.Doc();
    attachUndoManager(doc);
    doc.transact(() => doc.getMap('nodes').set('n1', new Y.Map()), Origin.LocalUser);
    stopCapturing();
    await undoCanvas();
    expect(cancelNodeProcess).toHaveBeenCalledWith('n1');
  });

  it('redo 空栈 no-op：不抛错不动作', async () => {
    const doc = new Y.Doc();
    attachUndoManager(doc);
    await expect(redoCanvas()).resolves.toBeUndefined();
    expect(doc.getMap('nodes').size).toBe(0);
  });
});
