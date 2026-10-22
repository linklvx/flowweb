// packages/shared/src/constants/edit-gate.ts
// T17 质评 Minor#8：只读命令拒写节流窗单源常量——web 两消费面（canvasIntents deny 诊断
// 节流/canvasStore denyCommandUX 提示节流）共用；nodeStore viewer toast 2s 窗为 ns 局部
// 形态（批2-2 既有契约，不同窗——不并本源）。B1-B2「节流」形态对齐。
/** 同命令只读拒写节流窗（ms）：窗内重复拒写零重复诊断/提示（防 viewer 连点刷屏）。 */
export const EDIT_COMMAND_DENY_THROTTLE_MS = 5000;
