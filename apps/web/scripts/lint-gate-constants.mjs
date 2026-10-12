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
 *     同 sanctioned 例外）；
 *   - O0a-1 评审收口集成造案 +2 处（批尾 DEV throw 挂点守卫——镜像 store 构造 before/after 差，
 *     同 sanctioned 例外）；
 *   - O0a-1 质评 I-1 零位移角点造案 +2 处（补发 moveNode 剥键守卫——构造 normal 组子 rel {0,0}
 *     入分镜组 before/after 差，setState 是造案存在目的，同 sanctioned 例外）→ 有效基线 216 处 / 39 文件。
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
  // O0b-0（2026-10-03）造案 +5 已入有效基线 221/40，allow-list 当时漏列（报数≤基线不进破线
  // 分支从未暴露——O0b-4 质评补登，两处登记对齐；翻转主锚/S1 停写/读侧版本门装置）。
  'src/stores/canvasCollabRuntime.geometry.test.ts',
  // Y0b-2 T7 造案 +1 已入有效基线 222/41（装置清理 store 复位——同 sanctioned 例外，两处登记对齐）。
  'src/stores/canvasCollabRuntime.force-sync.spec.ts',
  // Y0b-3 T5 造案 +1（版本通道装置 beforeEach store 复位——同 sanctioned 例外；T5 落地漏登记，
  // T7 出口 verify 暴露补登，两处登记对齐）→ 223/42。
  'src/stores/canvasCollabRuntime.version-channel.spec.ts',
  // Y0b-3 T9 造案 +3 处/1 文件（canvasCollabRuntime.t9.spec.ts——resetStore 装置+escapePending
  //   复位——sanctioned 例外同模式）+12 处/1 文件（SyncBanner.test.tsx——分档 UI 测试 store
  //   注入是用例的存在目的）→ 238/44。
  'src/stores/canvasCollabRuntime.t9.spec.ts',
  'src/pages/canvas/components/SyncBanner.test.tsx',
  // Y0b-4 T5（2026-10-11）：canvasCollabRuntime.quota.spec.ts 造案 +2 处/1 文件（doc-status reducer
  //   装置——resetStore 复位+Q-I 校准点本地漂移构造，sanctioned 例外同模式）→ 240/45。
  'src/stores/canvasCollabRuntime.quota.spec.ts',
  // Y0b-5 T2（2026-10-12）：canvasCollabRuntime.telemetry.spec.ts 造案 +1 处/1 文件（遥测接线用例
  //   beforeEach 装置复位——sanctioned 例外同模式）→ 260/50。
  'src/stores/canvasCollabRuntime.telemetry.spec.ts',
];

/** 棘轮基线（lint-gate 输出报数；锚测试 apps/web/src/stores/geometryTrap.test.ts 锚③同口径）。 */
export const GEOMETRY_SETSTATE_RATCHET_BASELINE = {
  capturedAt: '2026-10-02',
  /** 存量起点（当日 grep——38 文件面）。 */
  stock: { count: 201, files: 38 },
  /** 有效基线（含 C0-2 造案夹具 +11 处/1 文件 + O0a-1 剥键用例造案 +2 处/canvasIntents.spec——
   *  diff 剥键锚需 cs 直写构造 before/after 差，setState 是用例的存在目的——同 sanctioned 例外；
   *  O0a-1 评审收口集成造案再 +2 处——批尾 DEV throw 挂点守卫，镜像 store 构造 before/after；
   *  O0a-1 质评 I-1 零位移角点造案再 +2 处——补发 moveNode 剥键守卫，构造入分镜组零位移差）。 */
  // O0b-0（2026-10-03）：canvasCollabRuntime.geometry.test.ts 造案 +5 处/1 文件（翻转主锚/S1 停写/
//   读侧版本门装置——sanctioned 例外同模式，与 geometryTrap.test.ts 锚③注释同步登记）→ 有效基线 221 处 / 40 文件。
  // Y0b-2 T7（2026-10-10）：canvasCollabRuntime.force-sync.spec.ts 装置清理 +1 处/1 文件
  //   （unsyncedChanges 归零边沿用例 beforeEach store 复位——sanctioned 例外同模式）→ 222 处 / 41 文件。
  // Y0b-3 T5（2026-10-11）：canvasCollabRuntime.version-channel.spec.ts 装置复位 +1 处/1 文件
  //   （版本通道装置 beforeEach store 复位——sanctioned 例外同模式；T5 漏登记 T7 补登）→ 223 处 / 42 文件。
  // Y0b-3 T9（2026-10-11）：canvasCollabRuntime.t9.spec.ts 装置 +3 处/1 文件（resetStore/escapePending
  //   复位——sanctioned 例外同模式）+SyncBanner.test.tsx +12 处/1 文件（分档 UI 测试 store 注入——
  //   setState 是用例的存在目的）→ 238 处 / 44 文件。
  // Y0b-4 T5（2026-10-11）：canvasCollabRuntime.quota.spec.ts 造案 +2 处/1 文件（doc-status reducer
  //   装置——resetStore 复位+Q-I 校准点本地漂移构造）→ 240 处 / 45 文件。
  // Y0b-4 T9a D-14 补登（2026-10-11）：canvasIntents.quota.spec.ts openRwWindow +1 处/1 文件
  //   （D-14 落地漏登记棘轮已破线，T10 全量回归暴露补登）→ 241 处 / 46 文件。
  // Y0b-4 T10（2026-10-11）：判据④/分块粘贴造案 +8 处/+1 文件（canvasIntents.quota.spec +6——
  //   store 字段直构+runtime 集成 beforeEach 复位；canvasStore.paste-chunk.spec +2 新文件——
  //   装置复位+分块播种）→ 244 处 / 47 文件。
  // Y0b-4 T11（2026-10-11）：quota UX 造案 +15 处/+2 文件（QuotaBanner.test +8/ShrinkDialog.test +4
  //   ——三级分档/瘦身三档 UI 测试 store 注入〔SyncBanner.test 同例外〕；interaction-props +2——
  //   quotaOver 冻结编辑面 props 断言；quota.spec +1——会话起点复位造案）→ 259 处 / 49 文件。
  // Y0b-5 T2（2026-10-12）：canvasCollabRuntime.telemetry.spec.ts 造案 +1 处/1 文件（遥测接线用例
  //   beforeEach 装置复位——sanctioned 例外同模式）→ 260 处 / 50 文件。
  // Y0b-5 T4（2026-10-12）：造案 +3 处/0 新文件（canvasCollabRuntime.offline.test.ts +1——ready 探测
  //   用例 beforeEach 装置复位；SyncBanner.test.tsx +2——六瞬态反向断言循环+probe hint 分档注入，
  //   store 注入是用例存在目的〔同 T9 例外〕；均存量 allow-list 文件）→ 263 处 / 50 文件。
  // Y0b-5 T5（2026-10-12）：canvasCollabRuntime.cache.spec.ts 造案 +1 处/1 新文件（世代通道/purge
  //   挂点用例 beforeEach resetStore 装置复位——sanctioned 例外同模式）→ 264 处 / 51 文件。
  effective: { count: 264, files: 51 },
};
