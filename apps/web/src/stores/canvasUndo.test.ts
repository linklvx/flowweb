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

  it('auto-edge origin 不入撤销栈（跨撤销栈隔离——spec 验收 20）', () => {
    const doc = new Y.Doc();
    const um = attachUndoManager(doc);
    doc.transact(() => { doc.getMap('edges').set('auto:e1:s1', new Y.Map()); }, Origin.AutoEdge);
    expect(um.undoStack.length).toBe(0);
    detachUndoManager();
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

  // ★T18 先红①（偏离 31）：栈上限>100=**整栈 clear()**——撤销依赖栈内项成对可逆性，丢最旧项
  // 使 redo 链对不上前序状态（shared undo-policy.ts UNDO_OVERFLOW_ACTION 冻结契约）。
  // 注：卡文「200 次编辑后 undoStack>100」字面在 yjs 13.6.32 实测不可构造（shift 与 clear 均把
  // 数组压在 ≤100——probe 实证：200 次分离编辑后现状 len=100）；「栈内积压」的真实缺陷=现状
  // shift 逐个丢最旧项（积压 100 项残栈+被 shift 项 keep 永不释放=泄漏）而非整栈复位。红锚=
  // stack-cleared 事件+整栈清零断言（现状 shift：永不 clear）。
  it('★T18 栈上限溢出=整栈 clear()：第 101 项触发 stack-cleared+两栈清零（现状 shift 仅截数组=红）', () => {
    const doc = new Y.Doc();
    const um = attachUndoManager(doc);
    const nodes = doc.getMap('nodes');
    let cleared = 0;
    um.on('stack-cleared', () => { cleared++; });
    for (let i = 0; i < 101; i++) {
      stopCapturing();
      doc.transact(() => nodes.set(`n${i}`, i), Origin.LocalUser);
    }
    expect(um.undoStack.length).toBe(0);   // 整栈复位（现状=100 积压——shift 丢最旧后残栈）
    expect(um.redoStack.length).toBe(0);   // clear() 两栈同清（redo 配对链整体作废=诚实语义）
    expect(cleared).toBe(1);               // 唯一释放口=clear()（现状 shift：零 clear 事件）
  });

  it('★T18 200 次编辑后栈恒 ≤100 且溢出档=整栈 clear 语义（101 清零后 99 项新栈——非逐项截断）', () => {
    const doc = new Y.Doc();
    const um = attachUndoManager(doc);
    const nodes = doc.getMap('nodes');
    let maxLen = 0;
    let cleared = 0;
    um.on('stack-cleared', () => { cleared++; });
    for (let i = 0; i < 200; i++) {
      stopCapturing();
      doc.transact(() => nodes.set(`n${i}`, i), Origin.LocalUser);
      maxLen = Math.max(maxLen, um.undoStack.length);
    }
    expect(maxLen).toBeLessThanOrEqual(100);   // 溢出在 stack-item-added 处理器内即时 clear——外部可见长度恒 ≤UNDO_STACK_LIMIT
    expect(um.undoStack.length).toBe(99);      // 200-101=99（101 清零+99 新项）——shift 形态终值=100（红锚）
    expect(cleared).toBe(1);
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
