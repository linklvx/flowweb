// packages/shared/src/canvas/geometryWriterRegistry.ts
// C0-2 写者名单落盘（Spec B）：几何写者类别枚举 + 全量归类账本（29 处外部 useCanvasStore.setState
// + canvasStore.ts 内部 set( 逐函数归类）。
//
// 纯常量零依赖（不 import 任何 web/api 代码——文件路径用字符串，键=相对 apps/web 的 posix 路径）。
// 出口经 shared index（零 stub 常量——C0-1 类型骨架 stub 出口仍归 O0a）；消费面：
//   - apps/web/src/stores/geometryTrap.ts（写者上下文合法性校验）
//   - B7-1 census（本文件=归类引用源，届时按此逐点复核）
//
// 计数口径备注（不写死单一数字）：canvasStore.ts 内部 set( 的处数随扫描正则口径浮动——
// 词边界 /\bset\(/ 连 records.set 等 Map.set 方法调用一并命中（set 前的 `.` 非词字符，
// 词边界照样成立）= 45 处（2026-10-02 实测）；排除方法调用的口径（如 /[^A-Za-z_.]set\(/）
// 才是 44 处。本账本按"文件+函数"列出、不落处数——行号漂移与正则口径差异都不构成账本失真；
// 同函数多处 set( 在 note 标注。

/** 几何写者类别（陷阱放行面=本枚举；O0b 接线按类挂写者上下文）。
 *  - reconcile：RF 变更吞入窗（onNodesChange applyNodeChanges——拖拽 position/结构变更）
 *  - gesture：手势内核（拖拽/缩放手势显式写体——O0b 显式挂，现状与 reconcile 同窗）
 *  - projection-default：投影结构写（意图漏斗 projectIntentToStore 回填 / doc→store 水合
 *    applyDocToStore / 差分 dispatchProjectionDiff 窗内的结构写）
 *  - config-command：配置型命令体（O0b-5 后=mergeStoryboard/convertGroup/resizeStoryboardGrid
 *    命令体前写+updateStoryboardConfig 经 reconcile storyboard 档派生——frame 由配置公式单源，无守恒语义）
 *  - structure-command：结构命令体（组/解组/入出组/排列/折叠展开/守恒 refit——结构重排携带几何写）
 *  - node-create：节点创建 append（新节点信封携 position/width/height 落 store）
 *  - dimensions-attribute：RF dimensions change（setAttributes=true）写 node.width/height
 *    ——独立写者类别（合法写者，O0b 在 reconcile 内按变更类型细分挂点）
 *  - fixture：测试夹具入口（apps/web/src/test/fixtures/canvas.ts——测试从这进不触发陷阱） */
export type GeometryWriterCategory =
  | 'reconcile'
  | 'gesture'
  | 'projection-default'
  | 'config-command'
  | 'structure-command'
  | 'node-create'
  | 'dimensions-attribute'
  | 'fixture';

/** 类别运行时清单（陷阱合法性校验用——枚举的值面）。 */
export const GEOMETRY_WRITER_CATEGORIES: readonly GeometryWriterCategory[] = [
  'reconcile',
  'gesture',
  'projection-default',
  'config-command',
  'structure-command',
  'node-create',
  'dimensions-attribute',
  'fixture',
];

/** 归类条目：fn=所在函数/符号（store 内部 set( 按函数列出）；category=几何写者类别，
 *  非几何写点='non-geometry'；note=非几何写了什么 / 几何写点的判定备注。 */
export interface GeometryWriterSite {
  fn: string;
  category: GeometryWriterCategory | 'non-geometry';
  note?: string;
}

/**
 * 全量归类账本（2026-10-02 逐文件读码归类）：外部 useCanvasStore.setState 29 处
 * （canvasIntents 6/canvasCollabRuntime 9/CanvasView 6/VideoEditorShell 3/page 2/nodeStore 1/
 * guard 1/pointerShift 1）+ canvasStore.ts 内部 set( 44 处（排除方法调用口径，见文件头口径备注）按函数归并。
 * 几何写点（position/width/height 落节点信封）标写者类别；其余逐处确认非几何字段并注写明。
 */
export const GEOMETRY_WRITER_ALLOWLIST: Readonly<Record<string, readonly GeometryWriterSite[]>> = {
  // —— canvasStore 内部 set(（44 处文本位按函数归并；经 setWithParentOrder 包装的几何写在
  // wrapper 条目注明调用方）——
  'src/stores/canvasStore.ts': [
    { fn: 'setWithParentOrder', category: 'structure-command', note: '父前子后重排包装 set——几何写随调用方（groupNodes/ungroup/addToGroup/dropIntoGroup/mergeStoryboard/convertGroup/arrangeGroupChildren/appendCopyPlan）' },
    { fn: 'addNode', category: 'node-create', note: 'append 回退分支携 position/width/height；投影已到分支仅 selected（非几何）' },
    { fn: 'deleteNode', category: 'non-geometry', note: 'nodes/edges filter 结构删除' },
    { fn: 'deleteTransformNode', category: 'non-geometry', note: '结构删除' },
    { fn: 'setNodeDraggable', category: 'non-geometry', note: 'draggable 标记' },
    { fn: 'addChildNode', category: 'node-create', note: 'append 新节点+边' },
    { fn: 'addChildNodes', category: 'node-create', note: '批量 append' },
    { fn: 'addNodeWithEdge', category: 'node-create', note: 'append 派生节点' },
    { fn: 'addEdge', category: 'non-geometry', note: 'edges' },
    { fn: 'removeEdge', category: 'non-geometry', note: 'edges filter' },
    { fn: 'createDerivedExtNode', category: 'non-geometry', note: 'edges（节点经 addNode intent+append）' },
    { fn: 'selectNode', category: 'non-geometry', note: 'selectedId' },
    { fn: 'requestAddMediaNode', category: 'non-geometry', note: 'pendingMediaFile' },
    { fn: 'requestFillStoryboardCell', category: 'non-geometry', note: 'pendingFillCell' },
    { fn: 'updateViewport', category: 'non-geometry', note: 'viewport 相机——非节点几何' },
    { fn: 'onNodesChange', category: 'reconcile', note: 'applyNodeChanges 吞 RF position/dimensions/select/dragging——O0b-1 挂点（dimensions setAttributes 细分 dimensions-attribute 写者；拖拽期 clamp 已随终裁 43 去闸门整删，clampChildIntoGroup 现仅 placement 域）' },
    { fn: 'onEdgesChange', category: 'non-geometry', note: 'edges' },
    { fn: 'onConnect', category: 'non-geometry', note: 'edges' },
    { fn: 'splitImageNode', category: 'non-geometry', note: 'nodeProcessMap（2 处：启动+finally 清理）' },
    { fn: 'startNodeProcess', category: 'non-geometry', note: 'nodeProcessMap' },
    { fn: 'updateNodeProcessProgress', category: 'non-geometry', note: 'nodeProcessMap' },
    { fn: 'finishNodeProcess', category: 'non-geometry', note: 'nodeProcessMap' },
    { fn: 'cancelNodeProcess', category: 'non-geometry', note: 'nodeProcessMap' },
    { fn: 'setProjectId', category: 'non-geometry', note: 'projectId' },
    { fn: 'setTeamId', category: 'non-geometry', note: 'teamId' },
    { fn: 'setHydration', category: 'non-geometry', note: 'hydration 单写者 action' },
    { fn: 'arrangeSelection', category: 'structure-command', note: '排列选区 position 重排（runCommand fn 内）' },
    { fn: 'arrangeGroupChildren', category: 'structure-command', note: '经 setWithParentOrder——子 rel 写回（组帧写已删=O0b-5 评审收口：帧=bbox(laid)+padding 归差分首行 reconcile 派生）' },
    { fn: 'ungroup', category: 'structure-command', note: '2 处：storyboard 分支 placeGrid 重排+主段 abs 还原/组删' },
    { fn: 'addToGroup', category: 'structure-command', note: '经 setWithParentOrder——新子 rel placement 写（auto 不夹取·组帧=reconcile 派生扩框；manual/折叠/分镜 clamp 帧不动）' },
    { fn: 'attachMember', category: 'structure-command', note: 'O0c-3 后补入账本（纯成员原语——分镜子 position {0,0}+membership 写经 setWithParentOrder[默认 structure-command]，B7-1 O0b-9 接线随包装默认类）' },
    { fn: 'removeNodeFromGroup', category: 'structure-command', note: 'abs 还原；分镜分支：出格 wh=当前格尺寸（信封显式值，O0b-2）' },
    { fn: 'dropIntoGroup', category: 'structure-command', note: '经 setWithParentOrder——addToGroup 同构（新子 rel placement 写）' },
    { fn: 'dropImageIntoStoryboard', category: 'structure-command', note: '2 处：multiImage 展开重写+溢出移位落位' },
    { fn: 'mergeStoryboard', category: 'structure-command', note: '经 setWithParentOrder——组建+子归零' },
    { fn: 'convertGroup', category: 'structure-command', note: '经 setWithParentOrder 2 处：转分镜（配置框+子归零）/转普通（网格重排）' },
    { fn: 'patchGroupDataInner', category: 'non-geometry', note: '纯 data 合并/物理删键（runCommand.fn 契约写层）' },
    { fn: 'requestGroupRename', category: 'non-geometry', note: 'renameRequest UI 瞬态' },
    { fn: 'toggleCollapse', category: 'structure-command', note: 'O0b-5 单意图化：唯折叠子 selected 清写（帧档=reconcile 写域① collapsed 派生——零帧写）；只读档 localCollapsed 本地 override（UI 瞬态非几何）' },
    { fn: 'resizeStoryboardGrid', category: 'config-command', note: '配置组框 calcStoryboardSize+溢出移位' },
    { fn: 'clearStoryboard', category: 'non-geometry', note: 'cells 成员结构删除' },
    { fn: 'addImageToStoryboardCell', category: 'node-create', note: '槽位建图节点 append（position 归零）' },
    { fn: 'removeStoryboardCell', category: 'non-geometry', note: '结构删除' },
    { fn: 'appendCopyPlan', category: 'node-create', note: '经 setWithParentOrder——副本信封携 position（duplicateNodes/pasteGroupClipboard 共用段）' },
  ],
  // —— 外部 useCanvasStore.setState 29 处 ——
  'src/stores/canvasIntents.ts': [
    { fn: 'projectIntentToStore/addNode', category: 'projection-default', note: '投影回填 append 新节点信封（position/width/height）' },
    { fn: 'projectIntentToStore/deleteNode', category: 'non-geometry', note: 'nodes/edges filter' },
    { fn: 'projectIntentToStore/moveNode', category: 'projection-default', note: 'position 直写（几何写点）' },
    { fn: 'projectIntentToStore/updateNodeEnvelope', category: 'projection-default', note: '信封任意键 patch（可携 width/height/position）' },
    { fn: 'projectIntentToStore/upsertEdge', category: 'non-geometry', note: 'edges' },
    { fn: 'projectIntentToStore/deleteEdge', category: 'non-geometry', note: 'edges filter' },
  ],
  'src/stores/canvasCollabRuntime.ts': [
    { fn: 'clampConnUi', category: 'non-geometry', note: 'connUi' },
    { fn: 'recomputeConnStatus', category: 'non-geometry', note: 'connStatus 唯一写点' },
    { fn: 'applyDocToStore', category: 'projection-default', note: 'doc→store 水合投影（nodes 全量含 position/width/height——O0b-2 挂点）' },
    { fn: 'authenticated', category: 'non-geometry', note: 'collabReadOnly' },
    { fn: 'onClose/失败路径', category: 'non-geometry', note: 'collabReadOnly fail-closed' },
    { fn: 'hydrate/viewport 恢复', category: 'non-geometry', note: 'viewport 相机恢复（本地偏好非协作数据）' },
    { fn: '登出/切用户复位', category: 'non-geometry', note: 'collabReadOnly 复位（G27）' },
    { fn: 'reconcileGroupGeometry', category: 'reconcile', note: "写域四类+双源矩阵（'doc' 漏斗尾/applyDocToStore 尾、'cs' diff 首行全仓唯一）+单遍单 origin+零差异短路（O0b-1 内核化）；O0b-2 写域①全档写三字段（auto wh 接管——doc 面零泄漏由差分出口 oracle 化保证）；O0b-4 写域⑤ hidden 派生并入（deriveHiddenMap 单源——数据域不受让位+每调用必跑；旧聚合派生入口整删后本函数=cs hidden 唯一写者）" },
    { fn: 'reapplyGestureProtection', category: 'gesture', note: "O0b-3 保护回写——捕获快照仅几何字段覆盖（applyDocToStore 同步块内，B4'-1 接真 session 后生效）" },
  ],
  'src/pages/canvas/components/CanvasView.tsx': [
    { fn: 'pendingFillCell 清理×2', category: 'non-geometry', note: 'UI 交互态（拖放完成/Escape 清理）' },
    { fn: 'pendingMediaFile 清理×2', category: 'non-geometry', note: 'UI 交互态（媒体拖放消化）' },
    { fn: 'marqueeSelecting×2', category: 'non-geometry', note: '框选 UI 态 置位/复位' },
  ],
  'src/pages/canvas/video-editor/components/VideoEditorShell.tsx': [
    { fn: 'editorDirty×3', category: 'non-geometry', note: 'B4 镜像（onDirtyChange/卸载清零/保存清零——beforeunload 消费）' },
  ],
  'src/pages/canvas/page.tsx': [
    { fn: 'resetSession', category: 'non-geometry', note: 'nodes/edges 清空+viewport 复位+teamId（生命周期整备——结构清空非字段写）' },
    { fn: 'openSession', category: 'non-geometry', note: 'projectId 装载' },
  ],
  'src/stores/nodeStore.ts': [
    { fn: 'bridgeToCanvasStore', category: 'non-geometry', note: 'cs.nodes data 白名单键桥（fileId/referenceImage/status/images——data 面非信封几何）' },
  ],
  'src/hooks/useMarqueeSelectionGuard.ts': [
    { fn: 'marqueeSelecting 复位', category: 'non-geometry', note: '框选 guard UI 态' },
  ],
  'src/hooks/useTrackCanvasPointerShift.ts': [
    { fn: 'lastPointerShiftKey', category: 'non-geometry', note: 'shift 键跟踪 UI 态' },
  ],
};
