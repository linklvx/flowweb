// apps/web/src/stores/canvasUndo.spec.ts
// Y4a T4（plan 2026-11-20-y4a-timeline-domain Task 4——spec §0 条 5/条 7）：canvasUndo 三根扩面
// +undoCanvas 装回闸后挡+双向抄回断言。既有面（canvasUndo.test.ts——origin 隔离/合并窗/整栈 clear/
// S-1 取消进程）不动；本文件锁 T4 三新面：
//  - scope 含 timelines（UNDO_STACK_BASE 三根——画布栈捕获 timelines 根删除，undo 带回节点+时间轴
//    spec §0 条 7：scope 缺这棵根则撤销恢复不复活 timelines item :3535-3545 isParentOf）；
//  - undoCanvas 后挡：栈项累计装回字节>RESTORE_GATE_BYTES→不执行 undo、doc 保持删除态
//    （判断位=await import 与 undoManager!==um 之后、um.undo() 之前——:85-90 现序保持——
//    S-1 活跃进程取消逻辑不动）；
//  - redoCanvas 软限额预检不动（现状断言保持——forward 表照旧消费）+redo 弹栈后抄回新 undo 项。
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { RESTORE_GATE_BYTES, measureTransactionFrames } from '@flowweb/shared';
import {
  Origin, attachUndoManager, detachUndoManager, stopCapturing, undoCanvas, redoCanvas,
  getStackItemRestoreBytes, setPendingRestoreBytes,
} from './canvasUndo';

vi.mock('antd', () => ({ message: { warning: vi.fn(), error: vi.fn() } }));
vi.mock('./canvasStore', () => ({
  useCanvasStore: {
    getState: () => ({ nodes: [], nodeProcessMap: {}, localDocBytes: 0, localDelta: 0, quotaSoftLimitBytes: 0 }),
  },
}));
vi.mock('./canvasIntents', () => ({ effectiveSoftLimit: () => 0 }));

afterEach(() => {
  detachUndoManager();
});

/** 钉死 clientID。 */
const LIVE = 909_090;

describe('Y4a T4：canvasUndo scope 三根+undoCanvas 装回闸后挡', () => {
  it('scope 含 timelines：画布栈捕获 timelines 根删除——undo 带回节点+时间轴（spec §0 条 7）', () => {
    const doc = new Y.Doc();
    doc.clientID = LIVE;
    const um = attachUndoManager(doc);
    // 建节点+同键时间轴（两笔 LocalUser——画布域创建形态；stopCapturing 断窗各自成步——生产
    // 每操作经 afterStructuralChange→stopCapturing 同源口径）
    doc.transact(() => {
      const n = new Y.Map();
      n.set('type', 'videoEdit');
      doc.getMap('nodes').set('n1', n);
    }, Origin.LocalUser);
    stopCapturing();
    doc.transact(() => {
      const tl = new Y.Map();
      tl.set('version', 1); tl.set('fps', 30);
      tl.set('tracks', new Y.Map()); tl.set('clips', new Y.Map());
      doc.getMap('timelines').set('n1', tl);
    }, Origin.LocalUser);
    stopCapturing();
    expect(um.undoStack.length).toBe(2);
    // 一笔 LocalUser 删节点+timelines 同名键（deleteNodesWithTimelines 同族）
    doc.transact(() => {
      doc.getMap('nodes').delete('n1');
      doc.getMap('timelines').delete('n1');
    }, Origin.LocalUser);
    expect(doc.getMap('nodes').has('n1')).toBe(false);
    expect(doc.getMap('timelines').has('n1')).toBe(false);
    um.undo();
    // undo 带回节点+时间轴（scope 三根——缺 timelines 根则只带回节点、时间轴丢失）
    expect(doc.getMap('nodes').has('n1')).toBe(true);
    expect(doc.getMap('timelines').has('n1')).toBe(true);
    doc.destroy();
  });

  it('undoCanvas 后挡：栈项装回字节>RESTORE_GATE_BYTES→不执行 undo、doc 保持删除态', async () => {
    const doc = new Y.Doc();
    doc.clientID = LIVE;
    const um = attachUndoManager(doc);
    doc.transact(() => {
      const n = new Y.Map();
      n.set('type', 'videoEdit');
      n.set('blob', 'Z'.repeat(600_000));
      doc.getMap('nodes').set('n1', n);
    }, Origin.LocalUser);
    stopCapturing();   // 断窗——删除笔独立成步（与创建笔不并窗）
    // 预检量这笔删除的 undoBytes（commit 编排同款——量法在 transact 前跑）+低级登记面注入
    const del = (temp: Y.Doc) => temp.transact(() => { temp.getMap('nodes').delete('n1'); }, Origin.LocalUser);
    const m = measureTransactionFrames(doc, del);
    expect(m.undoBytes).toBeGreaterThan(RESTORE_GATE_BYTES);   // 装回帧超闸
    setPendingRestoreBytes(Origin.LocalUser, m.undoBytes);
    del(doc);
    expect(doc.getMap('nodes').has('n1')).toBe(false);
    const topItem = um.undoStack[um.undoStack.length - 1]!;
    expect(getStackItemRestoreBytes(topItem)).toBeGreaterThan(RESTORE_GATE_BYTES);   // 装回表已记
    await undoCanvas();
    // 后挡：装回字节>RESTORE_GATE_BYTES→不弹栈、doc 保持删除态
    expect(doc.getMap('nodes').has('n1')).toBe(false);
    expect(um.undoStack.length).toBe(2);   // 栈未弹（创建笔+删除笔）
    doc.destroy();
  });

  it('undoCanvas 弹栈后抄装回字节到新 redo 栈项（双向抄 spec §0 条 5——与 :88-92 正向字节同位）', async () => {
    const doc = new Y.Doc();
    doc.clientID = LIVE;
    const um = attachUndoManager(doc);
    doc.transact(() => {
      const n = new Y.Map();
      n.set('type', 'videoEdit');
      doc.getMap('nodes').set('n1', n);
    }, Origin.LocalUser);
    stopCapturing();   // 断窗——删除笔独立成步
    const del = (temp: Y.Doc) => temp.transact(() => { temp.getMap('nodes').delete('n1'); }, Origin.LocalUser);
    const m = measureTransactionFrames(doc, del);
    setPendingRestoreBytes(Origin.LocalUser, m.undoBytes);
    del(doc);
    const srcItem = um.undoStack[um.undoStack.length - 1]!;
    const restoreBytes = getStackItemRestoreBytes(srcItem);
    expect(restoreBytes).toBeGreaterThan(0);   // 装回表已记（捕获策略记账）
    await undoCanvas();
    const redoItem = um.redoStack[um.redoStack.length - 1]!;
    expect(redoItem).toBeDefined();
    expect(getStackItemRestoreBytes(redoItem)).toBe(restoreBytes);   // 抄到新 redo 项
    doc.destroy();
  });

  it('redoCanvas 软限额预检不动（现状断言保持——forward 表照旧消费）', async () => {
    const doc = new Y.Doc();
    doc.clientID = LIVE;
    const um = attachUndoManager(doc);
    doc.transact(() => { doc.getMap('nodes').set('n1', 'v1'); }, Origin.LocalUser);
    await undoCanvas();
    // softLimit=0+redoBytes>0 → redo-precheck 拒（redoStack 不减——现状行为锁死）
    expect(um.redoStack.length).toBe(1);
    await redoCanvas();
    expect(um.redoStack.length).toBe(1);   // 未弹——precheck 不动
    expect(doc.getMap('nodes').get('n1')).toBeUndefined();   // 未回放
    doc.destroy();
  });
});
