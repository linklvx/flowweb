// packages/shared/src/collab/undo-policy.ts
// Y1c T5b（plan v1.7 Task 5 业务 DDL 段——Undo 策略 D6 维持）：撤销栈策略契约冻结。
// **CONTRACT-FREEZE**——常量+纯函数；消费方=T16（P2 单 UndoManager 收口）。
// 现 web canvasUndo.ts:13 STACK_LIMIT=100/:30 captureTimeout 500 与本契约同值（T16 改引本单源）；
// 其 :41-43 `undoStack.shift()` 手动截断=「shift 字节回落」旧验收残留——spec §6.7 删除清单已废，
// T16 消费本契约改整栈 clear（Y.UndoManager 无内建上限，clear 语义=撤销历史整体复位非逐项丢弃）。
// 契约测试=undo-policy.spec.ts（TDD 红先行）。

/** 捕获窗（D6——同事务多 transact 合并一步 undo；500ms 窗=手势/命令单步左边界） */
export const UNDO_CAPTURE_TIMEOUT_MS = 500 as const;

/** 撤销栈上限（D6——100 步；含端点：≤100 保留） */
export const UNDO_STACK_LIMIT = 100 as const;

/** 溢出策略（D6——**溢出=整栈 clear**：撤销依赖栈内项的成对可逆性，丢弃最旧项会使 redo 链
 *  对不上前序状态；整栈复位=诚实语义）。禁用形态登记=UNDO_OVERFLOW_FORBIDDEN（负控）。 */
export const UNDO_OVERFLOW_ACTION = 'clear-whole-stack' as const;

/** 禁用溢出形态（负控常量——spec §6.7 删除清单「shift 字节回落」；禁复活） */
export const UNDO_OVERFLOW_FORBIDDEN = 'shift-oldest' as const;

/** 栈基（Y.UndoManager scope——doc 双 Y.Map 'nodes'/'edges'，次序冻结；T16 attach 消费） */
export const UNDO_STACK_BASE = ['nodes', 'edges'] as const;

/** trackedOrigins 初始集（仅 LocalUser——Server/AutoEdge/Geometry origin 刻意不入栈：回放/自动边/
 *  几何修复非用户编辑，防啃 STACK_LIMIT；与 web canvasUndo.ts Origin.LocalUser='local-user' 同值，
 *  T16 改引本单源+**addTrackedOrigin 注记**：后续命令通道 origin 若需入栈经 Y.UndoManager
 *  .addTrackedOrigin 增补（本常量=初始集非终集——增补项须同步本文件修订）） */
export const UNDO_TRACKED_ORIGINS = ['local-user'] as const;

/** 溢出判定（纯函数——入栈后栈长>UNDO_STACK_LIMIT 即整栈 clear） */
export function undoOverflowAction(newStackItemCount: number): 'within-limit' | 'clear-whole-stack' {
  return newStackItemCount > UNDO_STACK_LIMIT ? 'clear-whole-stack' : 'within-limit';
}
