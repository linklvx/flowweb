import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { Origin, attachUndoManager, detachUndoManager, stopCapturing } from './canvasUndo';

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
});
