// packages/shared/src/collab/undo-policy.spec.ts
// Y1c T5b（plan v1.7 Task 5 业务 DDL 段；Undo 策略 D6 维持——spec §6.7 删「shift 字节回落」验收）：
// 撤销栈策略契约冻结的契约测试——500ms 捕获窗/100 上限/溢出=整栈 clear（禁 shift）/栈基 [nodes,edges]/
// trackedOrigins=LocalUser 单值。本文件=T16（单 UndoManager 收口）的消费契约锁。
import { describe, expect, it } from 'vitest';
import {
  UNDO_CAPTURE_TIMEOUT_MS, UNDO_OVERFLOW_ACTION, UNDO_OVERFLOW_FORBIDDEN, UNDO_STACK_BASE,
  UNDO_STACK_LIMIT, UNDO_TRACKED_ORIGINS, undoOverflowAction,
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
  it('栈基冻结=[nodes,edges] 两 Y.Map（doc 双根——次序冻结）；trackedOrigins=LocalUser 单值（Server/AutoEdge/Geometry 不入栈）', () => {
    expect([...UNDO_STACK_BASE]).toEqual(['nodes', 'edges']);
    expect([...UNDO_TRACKED_ORIGINS]).toEqual(['local-user']);
  });
  it('Y1c T21 解冻同步：T18 增补项=ySyncPluginKey（构造面一次到位——初始集非终集纪律的登记真值锚）', async () => {
    const { UNDO_TRACKED_ORIGINS_T18_ADDENDUM } = await import('./undo-policy');
    expect(UNDO_TRACKED_ORIGINS_T18_ADDENDUM).toBe('ySyncPluginKey');   // T18 落地真值：new Set([Origin.LocalUser, ySyncPluginKey])
  });
});
