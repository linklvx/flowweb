// apps/web/src/stores/canvasLock.ts
// 编辑锁本地视图态单源（Spec B editMode 分片——原 CanvasView 订阅式/isLockedNow 双定义合并）。
// 独立零依赖模块：语义=编辑锁是本地视图态（activeEditNodeId/activeTransformNodeId 是 nodeStore
// 顶层字段，不进 doc）；放独立文件是 mock 免疫设计——20 处 vi.mock('@/stores/nodeStore') 工厂
// 不必随 selector 导出面膨胀（test_mock_drift 教训：mock 与真实模块导出脱节=静默红）。

/** isLocked=编辑中∨transform 调整中（spec §3 根因修口径）。入参取 state 快照——
 *  订阅式 `useNodeStore(selectIsLocked)` 与命令式 `selectIsLocked(useNodeStore.getState())` 同源。 */
export const selectIsLocked = (s: { activeEditNodeId: string | null; activeTransformNodeId: string | null }): boolean =>
  s.activeEditNodeId !== null || s.activeTransformNodeId !== null;
