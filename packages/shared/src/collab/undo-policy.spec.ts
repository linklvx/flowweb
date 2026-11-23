// packages/shared/src/collab/undo-policy.spec.ts
// Y1c T5b（plan v1.7 Task 5 业务 DDL 段；Undo 策略 D6 维持——spec §6.7 删「shift 字节回落」验收）：
// 撤销栈策略契约冻结的契约测试——500ms 捕获窗/100 上限/溢出=整栈 clear（禁 shift）/栈基
// [nodes,edges,timelines]（Y4a T1 扩第三根）/trackedOrigins=LocalUser 单值+timeline-user 登记。
// 本文件=T16（单 UndoManager 收口）的消费契约锁。
// Y4b T7（spec §0 条 3）：THREADS_ORIGIN 登记+undo 负控 A6（threads 不入任何撤销栈——栈基三根
// 不动、LocalUser 画布事务 undo 不触 threads）。
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  UNDO_CAPTURE_TIMEOUT_MS, UNDO_OVERFLOW_ACTION, UNDO_OVERFLOW_FORBIDDEN, UNDO_STACK_BASE,
  UNDO_STACK_LIMIT, UNDO_TRACKED_ORIGINS, undoOverflowAction, THREADS_ORIGIN,
} from './undo-policy';

describe('Y1c T5b 契约冻结：Undo 策略（D6 维持）', () => {
  it('数字冻结：捕获窗 500ms+栈上限 100', () => {
    expect(UNDO_CAPTURE_TIMEOUT_MS).toBe(500);
    expect(UNDO_STACK_LIMIT).toBe(100);
  });
  it('溢出策略=整栈 clear（clear-whole-stack）；shift 最旧回落=禁用形态登记（负控常量）', () => {
    expect(UNDO_OVERFLOW_ACTION).toBe('clear-whole-stack');
    expect(UNDO_OVERFLOW_FORBIDDEN).toBe('shift-oldest');
    expect(UNDO_OVERFLOW_ACTION).not.toBe(UNDO_OVERFLOW_FORBIDDEN);
  });
  it('undoOverflowAction 真值表：≤100=within-limit；101 起=clear-whole-stack（上限含端点）', () => {
    expect(undoOverflowAction(0)).toBe('within-limit');
    expect(undoOverflowAction(100)).toBe('within-limit');
    expect(undoOverflowAction(101)).toBe('clear-whole-stack');
    expect(undoOverflowAction(5000)).toBe('clear-whole-stack');
  });
  it('栈基冻结=[nodes,edges,timelines] 三 Y.Map（Y4a T1 扩 timelines——spec §0 条 7/画布栈撤销删除带回时间轴；次序冻结）；trackedOrigins=LocalUser 单值（Server/AutoEdge/Geometry 不入栈）', () => {
    expect([...UNDO_STACK_BASE]).toEqual(['nodes', 'edges', 'timelines']);
    expect([...UNDO_TRACKED_ORIGINS]).toEqual(['local-user']);
  });
  it('Y4a T1 时间轴编辑 origin 登记：UNDO_TIMELINE_ORIGIN === \'timeline-user\'（web Origin 枚举引用同值——时间轴编辑栈 trackedOrigins，T5 消费）', async () => {
    const { UNDO_TIMELINE_ORIGIN } = await import('./undo-policy');
    expect(UNDO_TIMELINE_ORIGIN).toBe('timeline-user');
  });
  it('Y1c T21 解冻同步：T18 增补项=ySyncPluginKey（构造面一次到位——初始集非终集纪律的登记真值锚）', async () => {
    const { UNDO_TRACKED_ORIGINS_T18_ADDENDUM } = await import('./undo-policy');
    expect(UNDO_TRACKED_ORIGINS_T18_ADDENDUM).toBe('ySyncPluginKey');   // T18 落地真值：new Set([Origin.LocalUser, ySyncPluginKey])
  });
});

describe('Y4b T7（spec §0 条 3）：threads 编辑 origin 登记+不入任何撤销栈', () => {
  it('THREADS_ORIGIN === \'threads-user\'（Task 10 threadsStore 单事务 origin——web Origin 枚举引用同值）', () => {
    expect(THREADS_ORIGIN).toBe('threads-user');
  });

  it('undo 负控 A6：LocalUser 画布事务 undo ⇒ threads 内容不变（栈基三根不含 threads——threads 不入任何撤销栈）', () => {
    const doc = new Y.Doc();
    // doc 带 threads entry（工厂+首条评论——落成形态）
    const entry = new Y.Map<unknown>();
    entry.set('id', 't1');
    entry.set('nodeId', 'n1');
    entry.set('kind', 'node');
    entry.set('resolved', false);
    entry.set('createdAt', 0);
    entry.set('createdBy', 'u1');
    const comments = new Y.Map<unknown>();
    const c1 = new Y.Map<unknown>();
    c1.set('id', 'c1');
    c1.set('authorId', 'u1');
    c1.set('body', 'undo-negative-control');
    c1.set('createdAt', 0);
    comments.set('c1', c1);
    entry.set('comments', comments);
    doc.getMap('threads').set('t1', entry);
    const threadsSnapshot = JSON.stringify((doc.getMap('threads').get('t1') as Y.Map<unknown>).toJSON());
    // LocalUser origin 画布事务（画布栈形态——scope=UNDO_STACK_BASE 三根+trackedOrigins=['local-user']）
    const um = new Y.UndoManager(
      UNDO_STACK_BASE.map((root) => doc.getMap(root)),
      { captureTimeout: 0, trackedOrigins: new Set([...UNDO_TRACKED_ORIGINS]) },
    );
    doc.transact(() => { doc.getMap('nodes').set('n1', new Y.Map<unknown>([['type', 'textInput']])); }, 'local-user');
    expect(doc.getMap('nodes').has('n1')).toBe(true);
    um.undo();
    expect(doc.getMap('nodes').has('n1')).toBe(false);   // 画布事务确被撤销（栈非空实证）
    // threads 内容不变（undo 装回不含 threads——scope 三根外之根零复活零删除）
    expect(JSON.stringify((doc.getMap('threads').get('t1') as Y.Map<unknown>).toJSON())).toBe(threadsSnapshot);
    um.destroy();
  });
});
