// packages/shared/src/collab/undo-policy.ts
// Y1c T5b（plan v1.7 Task 5 业务 DDL 段——Undo 策略 D6 维持）：撤销栈策略契约冻结。
// **CONTRACT-FREEZE**（T16/T18 已消费落地——T21 解冻窗口头注改记现状真值）：常量+纯函数。
// 消费现状（T18 落地真值——apps/web canvasUndo.ts）：构造面 trackedOrigins=new Set([Origin.LocalUser,
// ySyncPluginKey])（S3 ③——构造面一次到位，T16 addTrackedOrigin 后置接线已撤）+captureTimeout 引
// UNDO_CAPTURE_TIMEOUT_MS 单源+溢出整栈 clear 经 undoOverflowAction；旧 :41-43 undoStack.shift()
// 手动截断（「shift 字节回落」旧验收残留）已随 T18 删除——spec §6.7 删除清单兑现。
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

/** 栈基（Y.UndoManager scope——doc 双 Y.Map 'nodes'/'edges'，次序冻结；T16/T18 attach 消费已落地） */
export const UNDO_STACK_BASE = ['nodes', 'edges'] as const;

/** trackedOrigins 初始集（仅 LocalUser——Server/AutoEdge/Geometry origin 刻意不入栈：回放/自动边/
 *  几何修复非用户编辑，防啃 STACK_LIMIT；与 web canvasUndo.ts Origin.LocalUser='local-user' 同值）。
 *  **初始集非终集纪律：增补项同步本文件**——首项增补见 UNDO_TRACKED_ORIGINS_T18_ADDENDUM。 */
export const UNDO_TRACKED_ORIGINS = ['local-user'] as const;

/** T18 增补项登记（初始集非终集纪律的落地真值锚）：ySyncPluginKey=y-prosemirror PluginKey 单例
 *  **对象 origin**（非字符串——shared 无法以字符串常量承载，构造面直传 new Set([Origin.LocalUser,
 *  ySyncPluginKey])，apps/web canvasUndo.ts attachUndoManager 一处）。编辑器键入帧经
 *  ySyncPlugin 事务 origin 入栈（S3 ③ 结论：≠LocalUser 故 T18 构造面一次到位双 tracked）。 */
export const UNDO_TRACKED_ORIGINS_T18_ADDENDUM = 'ySyncPluginKey' as const;

/** 溢出判定（纯函数——入栈后栈长>UNDO_STACK_LIMIT 即整栈 clear） */
export function undoOverflowAction(newStackItemCount: number): 'within-limit' | 'clear-whole-stack' {
  return newStackItemCount > UNDO_STACK_LIMIT ? 'clear-whole-stack' : 'within-limit';
}
