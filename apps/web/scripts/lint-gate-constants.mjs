/**
 * lint-gate 常量（C0-2 Spec B 静态棘轮）：test/spec 面 useCanvasStore.setState( 文件级 allow-list
 * + 棘轮基线报数。方向与既有 collab-static-asserts 六规则相反：彼豁免测试文件拦生产，本规则
 * （flowweb/no-test-geometry-setstate，G）豁免生产文件拦 test/spec——非 allow-list 的 test/spec
 * 新文件出现几何 setState（静态可判定=对象字面量第一层含 position/width/height 键）即红。
 *
 * 基线口径（2026-10-02 当日 grep 实测）：
 *   - 存量面：201 处 / 38 文件（词边界 useCanvasStore.setState( 正则，apps/web/src 下 test/spec 后缀文件）；
 *   - C0-2 本片新增 geometryTrap.test.ts（陷阱守卫造案夹具——sanctioned 例外，allow-list 第 39 条）：
 *     该文件手写 setState 是陷阱测试的存在目的（造案），+9 处；
 *   - O0a-1（Spec B）canvasIntents.spec 剥键锚用例 +2 处（diff 剥键锚需 cs 直写构造 before/after 差——
 *     同 sanctioned 例外）→ 有效基线 212 处 / 39 文件。
 *     棘轮语义不变：自今日起单调下降、只降不升；新 test/spec 文件几何 setState 走规则 G 直拦。
 */
export const GEOMETRY_SETSTATE_TEST_ALLOWLIST = [
  // —— 存量 38 文件（2026-10-02 grep 生成，顺序按路径排序）——
  'src/hooks/useIsSingleSelected.test.tsx',
  'src/hooks/useMarqueeSelectionGuard.test.tsx',
  'src/hooks/useStitchTask.test.ts',
  'src/hooks/useTrackCanvasPointerShift.test.tsx',
  'src/pages/canvas/components/CanvasView.interaction-props.test.tsx',
  'src/pages/canvas/components/nodes/AudioConfigPanel.viewer.test.tsx',
  'src/pages/canvas/components/nodes/ImageConfigPanel.viewer.test.tsx',
  'src/pages/canvas/components/nodes/TextConfigPanel.viewer.test.tsx',
  'src/pages/canvas/components/nodes/VideoConfigPanel.viewer.test.tsx',
  'src/pages/canvas/video-editor/components/AssetPanel.test.tsx',
  'src/pages/canvas/video-editor/components/ExportModal.test.tsx',
  'src/pages/canvas/video-editor/components/PreviewPlayer.ai.test.tsx',
  'src/pages/canvas/video-editor/components/VideoEditorShell.test.tsx',
  'src/pages/canvas/video-editor/components/timeline/TimelinePanel.render.test.tsx',
  'src/pages/canvas/video-editor/export/product-node.test.ts',
  'src/pages/canvas/video-editor/timeline/auto-edges.test.ts',
  'src/stores/canvasCollabRuntime.baseline.spec.ts',
  'src/stores/canvasCollabRuntime.conn.spec.ts',
  'src/stores/canvasCollabRuntime.execView.spec.ts',
  'src/stores/canvasCollabRuntime.invariant.spec.ts',
  'src/stores/canvasCollabRuntime.offline.test.ts',
  'src/stores/canvasCollabRuntime.projection.test.ts',
  'src/stores/canvasCollabRuntime.viewer.spec.ts',
  'src/stores/canvasIntents.spec.ts',
  'src/stores/canvasStore.async-landing.spec.ts',
  'src/stores/canvasStore.boundary.test.ts',
  'src/stores/canvasStore.cellOps.test.ts',
  'src/stores/canvasStore.dropIntoGroup.test.ts',
  'src/stores/canvasStore.duplicate.test.ts',
  'src/stores/canvasStore.groups.test.ts',
  'src/stores/canvasStore.marqueeSelecting.test.ts',
  'src/stores/canvasStore.storyboard.test.ts',
  'src/stores/canvasStore.storyboardConfig.test.ts',
  'src/stores/canvasStore.test.ts',
  'src/stores/nodeStore.test.ts',
  'src/stores/nodeStore.viewer.spec.ts',
  'src/stores/syncStatus.spec.ts',
  'src/utils/viewportPersistence.test.ts',
  // —— C0-2 sanctioned 例外（陷阱守卫造案夹具——见头注）——
  'src/stores/geometryTrap.test.ts',
];

/** 棘轮基线（lint-gate 输出报数；锚测试 apps/web/src/stores/geometryTrap.test.ts 锚③同口径）。 */
export const GEOMETRY_SETSTATE_RATCHET_BASELINE = {
  capturedAt: '2026-10-02',
  /** 存量起点（当日 grep——38 文件面）。 */
  stock: { count: 201, files: 38 },
  /** 有效基线（含 C0-2 造案夹具 +11 处/1 文件 + O0a-1 剥键用例造案 +2 处/canvasIntents.spec——
   *  diff 剥键锚需 cs 直写构造 before/after 差，setState 是用例的存在目的——同 sanctioned 例外）。 */
  effective: { count: 212, files: 39 },
};
