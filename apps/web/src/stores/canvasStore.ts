import { create } from 'zustand';
import {
  type Node, type Edge, type XYPosition,
  applyNodeChanges, applyEdgeChanges,
  type NodeChange, type EdgeChange, type Connection,
} from '@xyflow/react';
import { useNodeStore, IMAGE_EXT_DEFAULTS } from './nodeStore';
import type { ImageItem, AiToolId, AppNode } from './nodeStore';
import type { MaterialFile, ArrangeMode, CanvasNodeRecord, CopyPlan, DragSession, Rect } from '@flowweb/shared';
import { normalizeSelection, participation, sortForArrange, arrangeRects, buildCopyPlan, normalizeSize } from '@flowweb/shared';
import type { StoryboardConfig } from '@/types/group';
import { message } from 'antd';
import { loadImage, splitImageToBlobs, scaleToMaxSize, validateGridParams, isSubImageTooSmall, MIN_SUB_IMAGE_PX } from '@/utils/imageSplit';
import { uploadSplitBlobs } from '@/utils/splitUploadService';
import { getMediaUrl } from '@/api/mediaApi';
import { deleteProjectByNode } from '@/api/videoProjectApi';
import { ensureParentOrder } from '@/utils/nodeOrder';
import { canEdit } from './syncStatus';
import { batchConnectEdges } from '@/utils/handleMenu';
// 批4b-2：auto 边确定性 id 判定（addEdge/removeEdge 的 origin 分流——AutoEdge 不入撤销栈契约）
import { isAutoEdgeId } from './autoEdgeIds';
// 批4b-1 换芯（门 C 裁决·意图漏斗）：协作语义写点经 dispatchCanvasIntent doc 直写+投影回填。
// 批4b-2（组 2 收口）：复合信封写点经 captureStoreProjection/dispatchProjectionDiff 差分换芯
// （before/after 差分翻译 intent 序列——旧 bindBridge 全量同步的增量形态，删除半边=显式成员差）。
// 循环依赖裁定：canvasIntents↔canvasStore/nodeStore 互为顶层 import 声明，action 体运行时才调——安全。
import { dispatchCanvasIntent, captureStoreProjection, dispatchProjectionDiff, dispatchFixtureSizeIntents, readGroupStoredFrameFromDoc, resolveDoc, type CanvasIntent } from './canvasIntents';
// B5'-1（Spec B）：commitIntents 末帧差分读 doc.abs 单源（readCanvasFromDoc——docShape 单源薄委托）。
// 循环依赖裁定同 canvasIntents：顶层仅声明，action 体运行时才调——安全。
import { readCanvasFromDoc } from '@/collab/ydocBuilder';
// B4'-1（Spec B）：endGesture 单收尾链消费——reconcileGroupGeometry（四元组第 4 成员，终裁 54②/
// 65①）+checkProjectionInvariant（收尾链第 4 步）。循环依赖裁定同 canvasIntents：顶层仅声明、
// action 体运行时才调——ESM 本地绑定延迟求值安全。
import { reconcileGroupGeometry, checkProjectionInvariant, resolveDraggingIdsFromGesture } from './canvasCollabRuntime';
import { Origin, stopCapturing } from './canvasUndo';
// B4'-2（O0b-6 接线）：onNodesChange applyNodeChanges 窗的 geometryTrap 写者上下文。
// 循环依赖裁定同 canvasIntents：geometryTrap 顶层仅 import 声明+纯函数定义（prod 自装经
// queueMicrotask 延后——见彼处注释），action 体运行时才调——安全。
import { withGeometryWriter } from './geometryTrap';
import { calcGroupBounds, CELL_WIDTH, ASPECT_RATIO_MAP, sortNodesByPosition, calcDefaultGrid, calcStoryboardSize, DEFAULT_CHILD_SIZE, clampChildIntoGroup, isContentDerivedFrame } from '@/utils/groupLayout';
import { isImageCompletedNode } from '@/utils/imageNodeGuards';
import { resolveStoryboardConfig } from '@/utils/storyboardConfig';
import { placeGrid } from '@/utils/groupGeometry';
import { GROUP_COLOR_MAP, type GroupColorKey } from '@/utils/groupColor';

let counter = 0;
/** 会话级随机种子（v2.1 getId 跨端防碰撞）：模块初始化生成一次——prefix+Date.now()+counter 跨客户端
 *  同毫秒同计数可撞（Y.Map 键冲突），掺种子后不同客户端 id 域不相交。crypto.randomUUID 有
 *  secure context 限制故用 getRandomValues；无 crypto 环境回落 Math.random。
 *  导出纯缝供测试断言"两次生成（=两客户端）不等"——勿用于业务。 */
export function createSessionSeed(): string {
  const buf = new Uint32Array(1);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buf);
  } else {
    buf[0] = Math.floor(Math.random() * 0xffffffff);
  }
  return buf[0].toString(36);
}
const sessionSeed = createSessionSeed();
function getId(prefix: string) {
  return `${prefix}_${Date.now()}_${sessionSeed}_${++counter}`;
}

/** 节点配置取数单源（同 projectCanvasNodes 分型）：组=cs data；普通节点=ns 全量，取不到即红（无回落）。
 *  与 projectCanvasNodes.ts:18 的 `?? nd.data ?? {}` 回落刻意不对称（注释互注防"一致性重构"）：
 *  投影回落服务恢复窗口（ns 暂缺不丢投影），副本取数 fail-fast（复制陈旧 cs 值=保真缺陷，宁可红）。 */
export function resolveNodeData(node: Node, nsNodes: Record<string, AppNode>): Record<string, unknown> {
  if (node.type === 'group') return (node.data ?? {}) as Record<string, unknown>;
  const ns = nsNodes[node.id];
  if (!ns) throw new Error(`resolveNodeData: nodeStore 缺节点 ${node.id}`);
  return ns.data as unknown as Record<string, unknown>;
}

/** videoEdit 节点删除时级联删 VideoProject（fire-and-forget；失败 console.error 留痕——deleteNode 与 onNodesChange removes 两条路径共用） */
const cascadeDeleteVideoProject = (nodes: { id: string; type?: string }[], removedIds: string[]) => {
  for (const id of removedIds) {
    if (nodes.find((n) => n.id === id)?.type === 'videoEdit') {
      deleteProjectByNode(id).catch((err) => {
        console.error('[video-editor] delete project failed:', err); // 静默孤儿无法排查——失败必须留痕（项目暂无 Sentry 接入，console.error 先行）
      });
    }
  }
};

// Module-level clipboard for group copy/paste（2a-6 schema）：records=ns 全量冻结快照 +
// ids=拷贝时已裁决闭包 + edges=闭包内互连边。粘贴不重裁决——成员/hidden 态在复制与粘贴之间
// 可能已变，冻结裁决结果是保真选择（重裁决会在粘贴点再次排除 hidden，丢成员）。
let groupClipboard: { records: CanvasNodeRecord[]; ids: string[]; edges: { id: string; source: string; target: string }[] } | null = null;

/** 复制偏移常量（duplicate 模式平移量单源——薄壳与测试共用） */
export const DUPLICATE_OFFSET = { x: 40, y: 0 } as const;

type ProcessType = 'generating' | 'trimming' | 'separating' | 'splitting' | 'uploading';

interface NodeProcessState {
  processType: ProcessType;
  status: 'processing' | 'done' | 'error';
  progress?: number;
  errorMsg?: string;
  abortController?: AbortController;
}

const nodeTypeMap: Record<string, string> = {
  text: 'textInput',
  image: 'imageGen',
  imageExt: 'imageExtGen',
  video: 'videoGen',
  audio: 'audioGen',
  multiImage: 'multiImageGen',
};

interface AddChildNodeItem {
  data: Record<string, unknown>;
  gridRow: number;
  gridCol: number;
  nodeType?: string;
}

interface AddChildNodesOptions {
  /** When true, skip creating edges from source to child nodes.
   *  Caller is responsible for creating edges manually (e.g. with handle identifiers). */
  skipEdges?: boolean;
}

interface SplitResult {
  newIds: string[];
  sourcePosition: { x: number; y: number };
  sourceSize: { w: number; h: number };
}

interface CreateDerivedExtNodeParams {
  sourceNodeId: string;
  allImages: ImageItem[];
  aiTool: AiToolId;
}

export interface CanvasState {
  nodes: Node[];
  edges: Edge[];
  viewport: { x: number; y: number; zoom: number };
  selectedId: string | null;
  lastPointerShiftKey: boolean;
  marqueeSelecting: boolean;
  pendingMediaFile: MaterialFile | null;
  pendingFillCell: { groupId: string; cellIndex: number } | null;
  nodeProcessMap: Record<string, NodeProcessState>;
  projectId: string | null;
  teamId: string | null;
  /** 批2-1 hydration 四态（替代 isHydrating 布尔——R25 不留镜像第二真相源）：
   *  idle=无会话（默认/destroyCollab 复位）；pending=openSession/resetSession/initCollab 会话建立；
   *  ready=首同步完成（runtime synced 处理段唯一写点）；failed=10s 超时（修D——provider/doc 保留）。
   *  不进 history/localStorage 快照 */
  hydration: 'idle' | 'pending' | 'ready' | 'failed';
  /** hydration 单写者 action（静态断言：生产源 setState 直写 hydration 零命中） */
  setHydration: (s: CanvasState['hydration']) => void;
  /** 会话级粘滞只读初值 true（v5.4）：HTTP project 响应无 role 字段（R30）——只读保守；
   *  authenticated 事件 scope 权威覆盖（runtime 唯一授权写点，read-write 解除/readonly 置回）；
   *  onClose 不清（fail-closed）；initCollab/destroyCollab 复位 true（G27：粘滞态不跨会话/跨用户）。
   *  零 UX 代价：canEdit 还需 hydration==='ready'，届时 scope 必已到达。不进快照 */
  collabReadOnly: boolean;
  /** O0b-5 viewer 折叠本地 override（终裁 58⑥ 渲染层最小落地）：只读会话折叠/展开的本地视图态
   *  （id→有效折叠态；undefined=未 override 走 data.collapsed）。UI 瞬态——不进 doc/投影/history/
   *  localStorage 快照；initCollab/destroyCollab 会话边界复位（视图态不跨会话/跨用户）；
   *  消费点=GroupNode（resizer 守卫+折叠卡）/CanvasView（GroupToolbar）。
   *  子 hidden 派生消费面扩展（reconcile 读 localCollapsed）归 O0c。 */
  localCollapsed: Record<string, boolean>;
  /** WS 侧唯一鉴权载体（批2-1 立字段；reason 五档 CollabAuthReason 落 shared 后收紧类型——批3 接入） */
  wsAuthNotice: { reason: string; terminal: boolean } | null;
  /** O0b-3 手势会话宿主（C0-1 DragSession 类型——保护序 v2 的让位两层解析源：
   *  freeze=frozenFrames.keys()/live=dragProtectedIds∪{resizeTargetId}∪children(resizeTargetId)）。
   *  B4'-1 落真生命周期（beginDragGesture/beginResize/endGesture/noteDragActivity——watchdog
   *  STALE_MS=5s）；消费面=applyDocToStore 保护捕获/回写+reconcile 让位豁免+remove 谓词。
   *  null=无活跃手势。不进 history/localStorage 快照 */
  dragSession: DragSession | null;
  /** B4'-2（终裁 30）叶子 resize 标记（非会话——resize 会话仅对组）：三处叶子 resizer
   *  （ImageGen/VideoGen/TextInput NodeResizeControl）onResizeStart/End 接线。消费面=门判据②
   *  豁免（position 批∧无 session∧无同批 resize∧无本标记⇒DEV 告警）+首测固化抑制
   *  （session∨resizePending 不固化，终裁 59①[iii]）。UI 瞬态——不进 history/localStorage 快照 */
  resizePending: boolean;
  /** sessionExpiry 401 面电平（批3 接线；canEdit 不读——反向断言锚）。不进快照 */
  httpExpired: boolean;
  /** 协作连接状态（Task15：autosave 退役）：不进 history/localStorage 快照 */
  connStatus: 'connected' | 'connecting' | 'offline';
  /** 批1 恢复 UI 分级（批1-1 watchdog 写入）：hint 非阻断、banner 批1-5 SyncBanner 消费——
   *  与 connStatus 正交（指示器 vs 恢复横幅）。不进 history/localStorage 快照 */
  connUi: 'ok' | 'hint' | 'banner';
  /** B4 单向 latch（批0d）：编辑器有未落库修改——由 autosave onDirtyChange 维护（notifyChange 置位、
   *  仅保存成功清零）；Shell 收起/dispose 清零。不进 history/localStorage 快照 */
  editorDirty: boolean;
  hasActiveProcessInGroup: (groupId: string) => boolean;

  addNode: (type: string, position: XYPosition, dataOverride?: Record<string, unknown>, envelope?: { width?: number; height?: number }) => string;
  /** Inner 化（Spec B B4'/B5' 前置）：建点命令体纯构造核——id 生成+类型解析+类型默认 data/wh+
   *  envelope 显式值覆写。零 store 写；addNode 薄壳与 addNodeAndBatchConnect（B6-3 收敛）共用，
   *  B4'/B5' 手势路径直接消费。返回 type 恒非空（构造即落 resolvedType——收窄 RF Node 可选类型）。 */
  addNodeInner: (type: string, position: XYPosition, dataOverride?: Record<string, unknown>, envelope?: { width?: number; height?: number }) => Node & { type: string };
  addChildNode: (sourceId: string, data: Record<string, unknown>) => string | null;
  addChildNodes: (sourceId: string, nodeDataList: AddChildNodeItem[], options?: AddChildNodesOptions) => string[];
  addNodeWithEdge: (sourceId: string) => string | null;
  addEdge: (source: string, target: string, sourceHandle?: string, targetHandle?: string, deterministicId?: string) => string;
  /** B6-3（Spec B 需求 7）：多源→单目标=N 条边（handleEdgeId 单源幂等+禁自环+单 transact）——
   *  参与集=UI 层原样（addOutputSourceIds 产物，不经 participation 组原子块裁决）。见实现 JSDoc。 */
  batchConnect: (sourceIds: string[], targetNodeId: string) => void;
  /** B6-3 点击建点/落空建点+连线（拍板②——HandleAddNodeMenu:82-92 同手势先例）：建点命令体
   *  （复用 addNode 类型默认体[与 addChildNode 同款双意图单 transact 形——终裁 65③ 禁前向引用
   *  addNodeInner，Inner 化批抽取时收敛）+源集→新节点 N 边单 transact 单 undo。 */
  addNodeAndBatchConnect: (type: string, position: XYPosition, sourceIds: string[]) => string | null;
  removeEdge: (id: string) => void;
  deleteNode: (id: string) => void;
  deleteTransformNode: (id: string) => void;
  setNodeDraggable: (nodeId: string, draggable: boolean) => void;
  selectNode: (id: string | null) => void;
  requestAddMediaNode: (file: MaterialFile) => void;
  requestFillStoryboardCell: (groupId: string, cellIndex: number) => void;
  updateViewport: (vp: { x: number; y: number; zoom: number }) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  splitImageNode: (nodeId: string, rows: number, cols: number) => Promise<SplitResult | null>;
  createDerivedExtNode: (params: CreateDerivedExtNodeParams) => string | null;
  setProjectId: (projectId: string) => void;
  setTeamId: (teamId: string | null) => void;
  startNodeProcess: (nodeId: string, processType: ProcessType, abortController?: AbortController) => void;
  updateNodeProcessProgress: (nodeId: string, progress: number) => void;
  finishNodeProcess: (nodeId: string, status: 'done' | 'error', errorMsg?: string) => void;
  cancelNodeProcess: (nodeId: string) => void;
  groupNodes: (nodeIds: string[]) => string;
  ungroup: (groupId: string) => void;
  /** Inner 化（Spec B）：解散纯变更核（分镜 placeGrid 重排+子出组 abs 还原+ns 组条目删）——
   *  capture/dispatch 归薄壳 ungroup；B4'/B5' 手势路径直接消费。 */
  ungroupInner: (groupId: string) => void;
  addToGroup: (groupId: string, nodeId: string) => void;
  /** O0c-3 分镜组纯成员原语（membership=内容真源、cells=槽序——卡三）——见实现 JSDoc。
   *  返回入格槽 index；非分镜组/满员/非法入参 → null 零写。 */
  attachMember: (groupId: string, nodeId: string) => number | null;
  removeNodeFromGroup: (groupId: string, nodeId: string) => void;
  /** Inner 化（Spec B）：移出组纯变更核（分镜/普通两分支 cs 写）——返回分镜清槽后的 cells
   *  （null=非分镜/未命中槽；清槽时序归薄壳=信封差分之后）。capture/dispatch/空组善后归薄壳；
   *  B4'/B5' 手势路径直接消费。 */
  removeNodeFromGroupInner: (groupId: string, nodeId: string) => (string | null)[] | null;
  renameGroup: (groupId: string, name: string) => void;
  /** 2d-6 右键重命名请求（UI 瞬态信号，不入 doc）——见实现 JSDoc */
  renameRequest: { groupId: string; nonce: number } | null;
  requestGroupRename: (groupId: string) => void;
  /** R2c-3 组色写点：合法 palette key 落 data.color，undefined=清色；未知 key 拒写（守卫先于 runCommand——零 transact） */
  setGroupColor: (groupId: string, key?: GroupColorKey) => void;
  toggleCollapse: (groupId: string) => void;
  /** Inner 化（Spec B）：折叠/展开纯变更核（cs 先写+折叠分支子 selected 清——O0b-4 序）——
   *  dispatch 归薄壳（同 patchGroupData/patchGroupDataInner 拆层先例）；B4'/B5' 手势路径直接消费。 */
  toggleCollapseInner: (groupId: string, collapsing: boolean) => void;
  patchGroupData: (groupId: string, patch: Record<string, unknown>) => void;
  /** 组 data 纯写层（v2.1 拆层）：patchGroupData 去 dispatch 的零 dispatch 版——runCommand.fn 内专用 */
  patchGroupDataInner: (groupId: string, patch: Record<string, unknown>) => void;
  /** R2 新命令唯一入口（canEdit 门 + 单 undo 步 + 差分换芯编排）——见实现 JSDoc */
  runCommand: (fn: () => void) => void;
  /** §4.3 整理选区（R2a-5）：组=原子块+散根真重排（participation('arrange') 裁决——detached 排除并计数提示）；
   *  写回经 runCommand（canEdit 门+单 undo 步+差分收尾）；不 refit 组框（refit 属 2c-4 显式几何命令语义） */
  arrangeSelection: (ids: string[], mode: ArrangeMode) => void;
  /** §4.4 排列子节点（R2c-4 显式几何命令）：与 2a-5 口径不同——彼排组间（组=原子块不 refit），
   *  此排组内（纯几何命令——O0c-3 起组 data 零写，帧派生归收尾差分首行 reconcile）。
   *  守卫先于 runCommand（零 transact）：缺失/折叠/分镜/<2 子 → 提示早退。见实现 JSDoc。 */
  arrangeGroupChildren: (groupId: string, mode: ArrangeMode) => void;
  dropIntoGroup: (nodeId: string, groupId: string) => void;
  /** Inner 化（Spec B）：拖放入组纯变更核——跨组 abs 还原+auto/manual 分档 rel（placement 域 B：
   *  clamp 夹入界内——F4 维持）+新子 membership 写+源组空解组善后。入参守卫/折叠展开/capture/
   *  dispatch 归薄壳；B5' 松手路径直接消费。**嵌套事务注记**：源组空解组善后经薄壳 ungroup()
   *  [自带 capture+diff]——本 Inner 非传递性 dispatch-free；B4'/B5' 消费方如在自有 capture 窗内
   *  调用会产生中间事务（换 ungroupInner 可折叠 diff 但改 undo 粒度——届时随手势路径裁决）。 */
  dropIntoGroupInner: (nodeId: string, groupId: string) => void;
  dropImageIntoStoryboard: (groupId: string, nodeId: string) => void;
  /** Inner 化（Spec B）：分镜落图纯变更核——multiImage 展开/完成图经 attachMember 入格+溢出落组旁
   *  +源组善后。执行中守卫/分镜域守卫/capture/dispatch 归薄壳；B5' 松手路径直接消费。
   *  **嵌套事务注记**：入格经 attachMember[内含 patchGroupData 单意图 dispatch]——差分幂等收其余；
   *  同 dropIntoGroupInner 的非传递性 dispatch-free 语义。 */
  dropImageIntoStoryboardInner: (groupId: string, nodeId: string) => void;
  mergeStoryboard: (nodeIds: string[]) => string;
  convertGroup: (groupId: string, target: 'normal' | 'storyboard') => void;
  updateStoryboardConfig: (groupId: string, patch: Partial<StoryboardConfig>) => void;
  resizeStoryboardGrid: (groupId: string, rows: number, cols: number) => void;
  clearStoryboard: (groupId: string) => void;
  addImageToStoryboardCell: (groupId: string, cellIndex: number, fileId: string) => void;
  removeStoryboardCell: (groupId: string, cellIndex: number) => void;
  /** R2a-6 副本薄壳①（选区复制）：ids=原始选集（禁止直通 buildCopyPlan）——入口
   *  participation('duplicate') 裁决 → records 装配（ns 全量）→ buildCopyPlan 纯映射（offset 模式）
   *  → 落位（cs 结构 set 先于 ns.addNode）。写回经 runCommand（canEdit 门+单 undo 步+差分收尾） */
  duplicateNodes: (ids: string[]) => string | null;
  /** R2a-6 副本薄壳②：单组复制=薄委托 duplicateNodes([groupId])（两路径产物逐键等价） */
  duplicateGroup: (groupId: string) => string | null;
  /** R2a-6 副本薄壳③（复制入剪贴板）：冻结 { records(ns 全量), ids(已裁决闭包), edges } 快照 */
  copyGroupToClipboard: (groupId: string) => void;
  /** R2a-6 副本薄壳④（粘贴）：不重裁决；position=flow 坐标（screenToFlowPosition 换算在调用点） */
  pasteGroupClipboard: (position: { x: number; y: number }) => string | null;
  hasGroupClipboard: () => boolean;
  /** B4'-1（Spec B）拖动手势开始（单接 CanvasView onNodeDragStart——第三参 nodes→draggingIds，
   *  O0b-3 定案）：无条件丢弃旧 session（吞 pointerup 兜，终裁 47 场景Ⅱ——静默 drop 不回滚）+
   *  记 baseline=被拖集合几何快照（终裁 56——非整表）+冻结框（让位即冻结：被拖子父组；被拖组不含
   *  ——origin 活）+watchdog armed+activePointers={起始 pointerId}（键控集合，终裁 31①）。 */
  beginDragGesture: (nodes: ReadonlyArray<{ id: string }>, pointerId: number | null) => void;
  /** B4'-1（Spec B）resize 会话开始：首行 discard 旧 session（终裁 31⑤——abort 后立即 resize ⇒
   *  让位集合只含 resizeTargetId∪children）。B4'-2 生产接线=GroupNode NodeResizer onResizeStart
   *  （会话仅对组目标——叶子走 resizePending 标记，终裁 30）。 */
  beginResize: (targetId: string, pointerId?: number | null) => void;
  /** B4'-2（Spec B 终裁 56）resize 会话松手提交：单 updateNodeEnvelope{三键}（提交值=会话末帧
   *  cs 帧三键——"回调第二参值"语义；零子代——子 rel 不随提交重算，RF 反向补偿值即终值）+
   *  单 transact（LocalUser=单 undo 步）。B5'-1 起终裁序对齐 commitIntents：清 session 同步块
   *  （finalizeGestureSession）先于 dispatch ⇒ 漏斗尾 reconcile 全域（子 rel 随新 origin 重基），
   *  不经 abort 族收尾链。生产接线=GroupNode NodeResizer onResizeEnd（先于尾批 onEnd——F10）。
   *  幂等：无 resize 会话=no-op。 */
  commitResizeGesture: () => void;
  /** B4'-2（终裁 30）叶子 resize 标记置位/复位（三叶子 resizer onResizeStart/End 接线）——
   *  见 resizePending 字段 JSDoc。 */
  beginLeafResize: () => void;
  endLeafResize: () => void;
  /** B4'-1（Spec B）单收尾函数（终裁 54②——中止/自愈/remove 谓词三分支共用，其内唯一 1 处
   *  reconcile[收尾链：回滚→清 session（frozenFrames 同步块+watchdog clearTimeout）→reconcile('doc')
   *  →invariant]——reconcile census 四元组第 4 成员）。reason：'aborted'=watchdog 终结（指针已抬+
   *  会话残留，终裁 47 场景Ⅰ）/ 'healed'=常驻监听自愈（pointermove[buttons===0]/blur 检出吞
   *  pointerup）/ 'removed'=remove 谓词（远端删被拖节点，事后回滚）。**提交族不经本函数**
   *  （B5'-1 终裁 78⑩——commitIntents/commitResizeGesture 走 finalizeGestureSession 清 session
   *  同步块+漏斗尾 reconcile；本函数恒回滚）。幂等：无 session=no-op。 */
  endGesture: (reason: 'aborted' | 'healed' | 'removed') => void;
  /** B5'-1（Spec B 终裁 48/66④/78⑩）拖动松手提交——三段式终裁序：①构造 intents（被拖集合末帧
   *  →moveNode 载荷=abs：顶层 cs.position 即 abs、子 rel+组 origin 翻转[拖叶档父组帧冻结/拖组档
   *  origin 活]；被拖 manual/storyboard 组附带帧三键 envelope——手势三行表"拖组 提交=N 子 abs（manual
   *  组+帧三键）"；末帧≡doc 零净变更剔除）→②清 session 同步块（无条件先于判空）→③单 transact
   *  dispatch（Origin.LocalUser——拖动入栈=一步 undo，旧锚"拖动不入栈"反转入栈）+漏斗尾 reconcile
   *  （让位集合已废止⇒终末对齐=reconcile 全域）→invariant（DEV）。**调用图不含 endGesture**
   *  （终裁 78⑩——abort 族收尾回滚会吃掉提交；防复用重演 P0-10）。幂等：无 drag 会话=no-op
   *  （resize 会话归 commitResizeGesture）。生产接线=CanvasView onNodeDragStop 头部。 */
  commitIntents: () => void;
  /** B4'-1（Spec B）手势活动刷新（常驻监听 pointermove[buttons!==0] 消费）：lastActivityAt 置位
   *  +watchdog 重挂（每次活动重挂——主道）。会话非渲染面，lastActivityAt 原位刷新零订阅广播。 */
  noteDragActivity: () => void;
}

// ══════════ B4'-1（Spec B）：dragSession 生命周期 + watchdog（STALE_MS=5s——plan 数字冻结表） ══════════
// watchdog 分场景（终裁 47）：指针已抬+会话残留（activePointers 空——正常 pointerup 后 abort 形态）
// ⇒ 秒级丢弃+cs 回滚 baseline；指针仍按住（集合非空——按住不动/多指暂停，无事件≠抬起）⇒ 续挂
// 观察不丢弃不告警（终裁 16/25①）；pointerup 被吞（集合非空且不可判定）⇒ 常驻监听自愈（healed）
// 或下一次 begin 无条件丢弃兜——watchdog 不承诺"吞 pointerup 也救"（否决清单，物理不可判定）。
/** STALE_MS 冻结值（5s——watchdog 秒级定值单源，测试引用） */
export const DRAG_STALE_MS = 5_000;

/** B4'-2（终裁 16/30）abandon 静默标记：endGesture abort 族（aborted/healed/removed）置位，
 *  下一次 beginDragGesture/beginResize 复位。heal 后同手势尾批（session 已清、无 resize 批的
 *  position 批）静默零 intent 不告警——门判据②的豁免面。**窗口无界**（置位到下一手势开始
 *  之间真实外视写入也被静默）——仅 DEV 诊断面（prod 该分支零 intent 与标记无关），质评接受。 */
let gestureAbandoned = false;

let dragWatchdogTimer: ReturnType<typeof setTimeout> | null = null;

function clearDragWatchdog(): void {
  if (dragWatchdogTimer != null) {
    clearTimeout(dragWatchdogTimer);
    dragWatchdogTimer = null;
  }
}

function armDragWatchdog(): void {
  clearDragWatchdog();
  dragWatchdogTimer = setTimeout(() => {
    dragWatchdogTimer = null;
    const s = useCanvasStore.getState().dragSession;
    if (!s) return;
    if (s.activePointers.size > 0) {
      armDragWatchdog();   // 指针仍按住——续挂观察（非孤儿会话）
      return;
    }
    useCanvasStore.getState().endGesture('aborted');   // 终裁 47 场景Ⅰ：秒级丢弃+回滚
  }, DRAG_STALE_MS);
}

/** cs 节点→冻结帧 rect（begin 快照装配共用；width/height 缺省 0——drag 档回滚只消费 position）。 */
const rectOf = (n: Node | undefined): Rect => ({
  x: n?.position?.x ?? 0,
  y: n?.position?.y ?? 0,
  width: n?.width ?? 0,
  height: n?.height ?? 0,
});

export const useCanvasStore = create<CanvasState>()((set, get) => {
  // 组结构写入统一包装：对 updater 产出的 nodes 应用父前子后重排
  // （RF v12 updateChildNode 要求父节点在数组中位于子节点前，否则忽略 parentId）
  const setWithParentOrder = (updater: (s: CanvasState) => Partial<CanvasState>) =>
    set((s) => {
      const next = updater(s);
      return { ...next, nodes: ensureParentOrder(next.nodes ?? s.nodes) };
    });

  /** O0c-3 分镜移出/溢出共用落位（removeNodeFromGroup 分镜分支+resizeStoryboardGrid 溢出+分镜落子
   *  溢出同构）：基准=cs 派生帧（组 position+calcStoryboardSize 单源——reconcile 写域① storyboard
   *  档同源）；abs=帧右上角外 20px；index 纵向 200px 堆叠（resizeStoryboardGrid 多节点溢出同源）。 */
  const placementBesideGroup =
    (frame: { x: number; y: number; width: number }, index = 0): { x: number; y: number } =>
      ({ x: frame.x + frame.width + 20, y: frame.y + index * 200 });

  /** B5'-1（Spec B 终裁 78⑩）提交族收尾同步块：清 session（frozenFrames/activePointers/
   *  gestureAbandoned/resizePending/resizeTargetId 随 dragSession=null 整对象清）+watchdog
   *  clearTimeout。零回滚零自有 reconcile——提交族（commitIntents/commitResizeGesture）专用；
   *  abort 族（endGesture 中止/自愈/remove 谓词）的回滚+reconcile+invariant 链在彼处、不经本块。 */
  const finalizeGestureSession = () => {
    clearDragWatchdog();
    set({ dragSession: null });
  };

  // R2a-6 副本落位公共段（duplicateNodes/pasteGroupClipboard 两薄壳共用）：cs 结构 set（副本信封
  // +选择态+新边，父前子后）先于 ns.addNode（B-2 纪律）；返回首个顶层副本 id（=组复制的新组 id）
  const appendCopyPlan = (plan: CopyPlan): string | null => {
    const copyEnvelopes = plan.copies.map((c) => ({
      id: c.id,
      type: c.type,
      ...(c.parentId != null ? { parentId: c.parentId } : {}),
      ...(c.width != null ? { width: c.width } : {}),
      ...(c.height != null ? { height: c.height } : {}),
      position: c.position,
      data: c.data,
      selected: c.selected === true,
    }) as Node);
    // 边 id 保持 edge_ 前缀约定（buildCopyPlan 单 newId 缝与节点共用计数——id 在此重生成）
    const newEdges: Edge[] = plan.newEdges.map((e) => ({ id: getId('edge'), source: e.source, target: e.target }));
    const firstTopId = plan.copies.find((c) => c.parentId == null)?.id ?? null;
    setWithParentOrder((st) => ({
      nodes: [...st.nodes.map((n) => ({ ...n, selected: false })), ...copyEnvelopes],
      edges: [...st.edges, ...newEdges],
      ...(firstTopId ? { selectedId: firstTopId } : {}),
    }));
    // B-2：cs set 已先行——普通节点副本双写 ns 全量（组 data 所有权归 cs/F42——ns 不写组）
    const ns = useNodeStore.getState();
    for (const c of plan.copies) {
      if (c.type === 'group') continue;
      ns.addNode({ id: c.id, type: c.type, data: c.data as any });
    }
    return firstTopId;
  };

  // R2a-6 records 装配（薄壳取数单点）：ids 全员经 resolveNodeData（组=cs data、普通=ns 全量，
  // 取不到即红）+ 父记录超集（detached 绝对位换算需父 position——父仅作坐标参照，不进复制集）
  const assembleRecords = (ids: string[], nodes: Node[]): CanvasNodeRecord[] => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const nsNodes = useNodeStore.getState().nodes;
    const records = new Map<string, CanvasNodeRecord>();
    const push = (n: Node) => {
      if (records.has(n.id)) return;
      records.set(n.id, {
        id: n.id,
        type: n.type!,
        ...(n.parentId != null ? { parentId: n.parentId } : {}),
        ...(n.width != null ? { width: n.width } : {}),
        ...(n.height != null ? { height: n.height } : {}),
        position: n.position,
        data: resolveNodeData(n, nsNodes) as Record<string, unknown>,
      });
    };
    for (const id of ids) {
      const n = byId.get(id);
      if (!n) continue;   // 裁决 ids 与 nodes 同源——防御性跳过（fail-fast 在 buildCopyPlan 兜底）
      push(n);
      if (n.parentId) {
        const parent = byId.get(n.parentId);
        if (parent) push(parent);
      }
    }
    return [...records.values()];
  };

  // ══ O0b-5（Spec B）：refit 族退役——帧写归 reconcile 单写者（applyGroupFrame/shouldAutoRefit/
  //  refitGroupGeometry/refitContentDerivedFrame 内联件全删；组框重算恒经 dispatchProjectionDiff
  //  首行 reconcile('cs')/漏斗尾 reconcile('doc') 派生）══
  /** auto 组谓词（isContentDerivedFrame 消费点——帧由内容派生 bbox+padding 的组）：
   *  storedFrame 优先取 doc 侧记录键（终裁 44 oracle——readGroupStoredFrameFromDoc 单源取数）；
   *  无 doc/组未注册 ⇒ 空帧形态（=auto——裸 store 与旧 shouldAutoRefit 的 data 形态判据同构：
   *  storyboard/collapsed 拒、其余 auto）。manual（doc 三键齐）⇒ false（帧=密封源不动）。 */
  const isContentDerivedGroup = (group: Node): boolean =>
    isContentDerivedFrame({
      data: (group.data ?? {}) as Record<string, unknown>,
      storedFrame: readGroupStoredFrameFromDoc(group.id) ?? {},
    });

  return {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  selectedId: null,
  lastPointerShiftKey: false,
  marqueeSelecting: false,
  pendingMediaFile: null,
  pendingFillCell: null,
  nodeProcessMap: {},
  projectId: null,
  teamId: null,
  hydration: 'idle',
  collabReadOnly: true,
  localCollapsed: {},
  wsAuthNotice: null,
  dragSession: null,
  resizePending: false,
  httpExpired: false,
  connStatus: 'connecting',
  connUi: 'ok',
  editorDirty: false,

  /** Inner 化（Spec B）：建点命令体纯构造核——见接口 JSDoc。零 store 写（纯函数出参）。 */
  addNodeInner: (type, position, dataOverride, envelope): Node & { type: string } => {
    const id = getId('node');
    const resolvedType = nodeTypeMap[type] || type;
    const baseData: Record<string, unknown> = resolvedType === 'textInput' ? { content: '' }
      : resolvedType === 'imageExtGen' ? { mediaName: '扩展图片', extConfig: { ...IMAGE_EXT_DEFAULTS }, allImages: [] }
      : {};
    const nodeData = dataOverride ? { ...baseData, ...dataOverride } : baseData;
    const node: Node & { type: string } = {
      id,
      type: resolvedType,
      position,
      data: nodeData,
      selected: true,
    };
    if (resolvedType === 'textInput') {
      node.width = 300;
      node.height = 300;
    }
    if (resolvedType === 'videoEdit') {
      node.width = 320; // spec：产物位置 fallback 链（measured→width→300）会落到 300 导致首渲染偏移
    }
    // O0b-2 (i) 命令体显式值形参（envelope——useStitchTask 拼接产物等已知尺寸载荷；终裁 59①[i]）：
    // 显式 wh 优先于类型默认值，同 intent 单 transact 落 doc（不拆第二事务）
    if (envelope?.width != null) node.width = envelope.width;
    if (envelope?.height != null) node.height = envelope.height;
    return node;
  },

  addNode: (type, position, dataOverride, envelope) => {
    // Inner 化薄壳：构造核归 addNodeInner + dispatch + 选择态/ns 双写
    const node = get().addNodeInner(type, position, dataOverride, envelope);
    const id = node.id;
    // 批4b-1 换芯：协作语义（doc 首写+投影回填）走意图漏斗——canEdit 假时 dispatch doc+store
    // 双零写，下方 set 走 append 分支 = 既有"readOnly 可加节点后回弹"语义保留同型
    dispatchCanvasIntent({
      type: 'addNode',
      node: {
        id, type: node.type, position,
        ...(node.width != null ? { width: node.width } : {}),
        ...(node.height != null ? { height: node.height } : {}),
        data: node.data as Record<string, unknown>,
      },
    }, Origin.LocalUser);
    set((s) => {
      // 投影已 append（canEdit 真窗口）→ 本 set 只补 UI 选择态；dispatch 被拦 → 原 append
      const projected = s.nodes.some((n) => n.id === id);
      return {
        nodes: projected
          ? s.nodes.map((n) => (n.id === id ? { ...n, selected: true } : { ...n, selected: false }))
          : [...s.nodes.map((n) => ({ ...n, selected: false })), node],
        selectedId: id,
      };
    });
    // Also populate nodeStore so ImageGenNode/ImageConfigPanel can read node data
    useNodeStore.getState().addNode({
      id,
      type: node.type,
      data: node.data as any,
    });
    return id;
  },

  deleteNode: (id) => {
    // 批4b-2：差分快照在 cascade/结构删/组善后全动作之前捕获——收尾 dispatchProjectionDiff
    // 覆盖级联子删+父组框收缩（首行 reconcile('cs')——O0b-5 帧写单写者）。
    // 与显式 deleteNode intent 幂等共存（同值 no-op，撤销栈同窗合并）
    const before = captureStoreProjection();
    // v6：被删节点是组 → 级联删子（对齐菜单 GroupContextMenu 先删子再删组的既有语义——
    // 否则子节点 parentId 悬空、rel 被当绝对渲染飞原点；子也可能是组，递归天然覆盖）
    const self = get().nodes.find((n) => n.id === id);
    if (self?.type === 'group') {
      for (const c of get().nodes.filter((n) => n.parentId === id)) {
        get().deleteNode(c.id);
      }
    }
    // 组清理需在删除前捕获父子关系（filter 后会丢失）
    const prevParentId = get().nodes.find((n) => n.id === id)?.parentId;
    // Cancel any in-progress process for this node
    const state = get();
    state.cancelNodeProcess(id);
    // videoEdit 节点：级联删除 VideoProject（fire-and-forget——失败上报不阻塞画布删除；边由下方 edges.filter 级联清除）
    cascadeDeleteVideoProject(state.nodes, [id]);
    // 批4b-1 换芯：doc 删（含级联边删）走意图漏斗——置于 cascade/捕获段之后（上方判型读变更前
    // state）、结构 set 之前（doc 首写）；下方 filter 型 set 与投影幂等，canEdit 假时 dispatch
    // 拦 doc=doc 零写（dispatch 门），store 侧回弹语义不变
    dispatchCanvasIntent({ type: 'deleteNode', id }, Origin.LocalUser);
    // B-2：结构 set 必须先于 nodeStore 清理——先清会触发 nodeStore 订阅提前 sync，被删节点走 nd.data 陈旧 fallback 瞬态覆写 doc data；结构 set 先行使其直接从投影消失
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    }));
    // 组清理逻辑：检查被删节点的父组是否需要清理
    const after = get();
    const parent = prevParentId ? after.nodes.find((n) => n.id === prevParentId) : undefined;
    if (parent && parent.type === 'group') {
      if ((parent.data as any)?.cells) {
        // 分镜组：cells 移除该 id（宫格不收缩）——patchGroupData 唯一通道（对齐 onNodesChange removes 段同款清理）
        get().patchGroupData(parent.id, { cells: ((parent.data as any).cells as string[]).filter((c) => c !== id) });
      } else if ((parent.data as any).groupType === 'normal'
        && !after.nodes.some((c) => c.parentId === parent.id)) {
        // 普通组：删空自动解组；仍有子 → 组框收缩归收尾差分首行 reconcile('cs')（O0b-5 帧写单写者）
        get().ungroup(parent.id);
      }
    }
    const ns = useNodeStore.getState();
    ns.deleteNode(id);
    ns.unregisterSaveHandler(id);
    // 批4b-2：善后几何（组框收缩）+ 级联删除的整体差分落 doc（冗余部分同值 no-op）
    dispatchProjectionDiff(before, Origin.LocalUser);
  },

  deleteTransformNode: (id) => {
    // Cancel any in-progress process for this node
    const state = get();
    state.cancelNodeProcess(id);
    // 批4b-2 换芯：doc 删（含级联引用边）走意图漏斗（deleteNode 同款）；filter 型 set 幂等
    dispatchCanvasIntent({ type: 'deleteNode', id }, Origin.LocalUser);
    // B-2（spec D2）：结构 set 必须先于 nodeStore 清理
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    }));
    const ns = useNodeStore.getState();
    ns.deleteNode(id);
    ns.unregisterSaveHandler(id);
  },

  setNodeDraggable: (nodeId, draggable) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, draggable } : n)),
    })),

  addChildNode: (sourceId, data) => {
    const sourceNode = get().nodes.find((n) => n.id === sourceId);
    if (!sourceNode) return null;
    // 批2-3 R20 异步落地：canEdit 假（断连/只读/未水合）时生成回调静默丢弃（不回弹不抛错）。
    // 产物已落素材库（presign/confirm 先于回调）——仅丢"插入画布"这步，toast 指引手动补
    if (!canEdit(get())) {
      message.warning('生成完成，但画布会话不可用，未插入画布——可从素材库手动插入');
      return null;
    }
    const id = getId('node');
    const edgeId = getId('edge');
    const GAP = 40;
    // O0b-2 A 类三档链（doc wh 第一/measured 第二/常量最后——C0-3 定档；B7-1 形态断言：链首非 .measured）
    const sw = sourceNode.width ?? sourceNode.measured?.width ?? 400;
    const sh = sourceNode.height ?? sourceNode.measured?.height ?? 300;
    const sx = sourceNode.position.x;
    const sy = sourceNode.position.y;
    const otherNodes = get().nodes.filter((n) => n.id !== sourceId);
    const overlaps = (nx: number, ny: number) =>
      otherNodes.some((n) => {
        const nw = n.width ?? n.measured?.width ?? 200;
        const nh = n.height ?? n.measured?.height ?? 200;
        return !(nx + sw < n.position.x || nx > n.position.x + nw || ny + sh < n.position.y || ny > n.position.y + nh);
      });
    const candidates = [
      { x: sx + sw + GAP, y: sy },
      { x: sx + sw + GAP, y: sy - sh - GAP },
      { x: sx + sw + GAP, y: sy + sh + GAP },
    ];
    let bestPos = candidates[0];
    for (const pos of candidates) {
      if (!overlaps(pos.x, pos.y)) { bestPos = pos; break; }
    }
    // O0b-2 (i) 命令体显式值：data.width/height（载荷尺寸——splitImage 同源形态）提到信封并从 data 剥除
    //（终裁 59①[i]——addChildNode intent.node 扩 wh 键=删 customSize 后初始尺寸的显式形参）
    const { width: dataW, height: dataH, ...restData } = data as Record<string, unknown>;
    const hasWh = typeof dataW === 'number' && typeof dataH === 'number';
    const edge: Edge = { id: edgeId, source: sourceId, target: id };

    // 批4b-1 换芯：node+edge 双 intent 单 transact（canEdit 假已被 action 门拦——前置门 return null
    // 保证 dispatch 恒成功⇒投影恒 append）。O0b-2 exists 收口：下方 set 只做 selected 合并
    //（append 回退分支随前置门死码化删除——census"dispatch 后无 cs 几何直写"兼容）
    dispatchCanvasIntent([
      { type: 'addNode', node: {
        id, type: sourceNode.type!, position: { ...bestPos },
        ...(hasWh ? { width: normalizeSize(dataW as number), height: normalizeSize(dataH as number) } : {}),
        data: restData as Record<string, unknown>,
      } },
      { type: 'upsertEdge', edge: { id: edgeId, source: sourceId, target: id } },
    ], Origin.LocalUser);
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, selected: true } : { ...n, selected: false })),
      selectedId: id,
    }));

    useNodeStore.getState().addNode({
      id,
      type: sourceNode.type!,
      data: data as any,
    });

    return id;
  },

  addChildNodes: (sourceId, nodeDataList, options) => {
    const sourceNode = get().nodes.find((n) => n.id === sourceId);
    if (!sourceNode || nodeDataList.length === 0) return [];
    // 批2-3 R20 异步落地：同 addChildNode 门——整批静默丢弃 + toast 一次
    if (!canEdit(get())) {
      message.warning('生成完成，但画布会话不可用，未插入画布——可从素材库手动插入');
      return [];
    }

    const skipEdges = options?.skipEdges ?? false;

    // O0b-2 A 类三档链（doc wh 第一/measured 第二/常量最后——C0-3 定档）
    const sw = sourceNode.width ?? sourceNode.measured?.width ?? 400;
    const sh = sourceNode.height ?? sourceNode.measured?.height ?? 300;
    const startX = sourceNode.position.x + sw + 120;
    const startY = sourceNode.position.y;
    const GAP = 20;

    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];
    const newIds: string[] = [];
    // O0b-2 (i) 命令体显式值：item.data 携 wh（splitImage 载荷尺寸）提到信封并从 data 剥除
    const newWhs = new Map<string, { width: number; height: number }>();

    for (const item of nodeDataList) {
      const nodeId = getId('node');
      const resolvedType = item.nodeType || sourceNode.type;

      const x = startX + item.gridCol * (sw + GAP);
      const y = startY + item.gridRow * (sh + GAP);

      const { width: itemW, height: itemH, ...itemRest } = item.data as Record<string, unknown>;
      if (typeof itemW === 'number' && typeof itemH === 'number') {
        newWhs.set(nodeId, { width: normalizeSize(itemW), height: normalizeSize(itemH) });
      }
      const newNode: Node = {
        id: nodeId,
        type: resolvedType,
        position: { x, y },
        data: itemRest as Record<string, unknown>,
        selected: false,
      };

      newNodes.push(newNode);
      if (!skipEdges) {
        const edgeId = getId('edge');
        const edge: Edge = { id: edgeId, source: sourceId, target: nodeId };
        newEdges.push(edge);
      }
      newIds.push(nodeId);
    }

    // 批4b-1 换芯：N node+M edge 单 transact（整批原子——对端一帧收齐）；wh=命令体显式值键
    dispatchCanvasIntent([
      ...newNodes.map((n) => ({ type: 'addNode' as const, node: {
        id: n.id, type: n.type!, position: { ...n.position },
        ...(newWhs.get(n.id) ?? {}),
        data: n.data as Record<string, unknown>,
      } })),
      ...newEdges.map((e) => ({ type: 'upsertEdge' as const, edge: { id: e.id, source: e.source, target: e.target } })),
    ], Origin.LocalUser);

    const ns = useNodeStore.getState();
    for (const node of newNodes) {
      ns.addNode({
        id: node.id,
        type: node.type!,
        data: node.data as any,
      });
    }

    return newIds;
  },

  addNodeWithEdge: (sourceId) => {
    const sourceNode = get().nodes.find((n) => n.id === sourceId);
    if (!sourceNode) return null;
    const id = getId('node');
    const edgeId = getId('edge');
    // Smart positioning: right side of source, avoid overlapping other nodes
    const GAP = 40;
    // O0b-2 A 类三档链（doc wh 第一/measured 第二/常量最后——C0-3 定档）
    const sw = sourceNode.width ?? sourceNode.measured?.width ?? 400;
    const sh = sourceNode.height ?? sourceNode.measured?.height ?? 300;
    const sx = sourceNode.position.x;
    const sy = sourceNode.position.y;
    const otherNodes = get().nodes.filter((n) => n.id !== sourceId);
    const overlaps = (nx: number, ny: number) =>
      otherNodes.some((n) => {
        const nw = n.width ?? n.measured?.width ?? 200;
        const nh = n.height ?? n.measured?.height ?? 200;
        return !(nx + sw < n.position.x || nx > n.position.x + nw || ny + sh < n.position.y || ny > n.position.y + nh);
      });
    const candidates = [
      { x: sx + sw + GAP, y: sy },
      { x: sx + sw + GAP, y: sy - sh - GAP },
      { x: sx + sw + GAP, y: sy + sh + GAP },
    ];
    let bestPos = candidates[0];
    for (const pos of candidates) {
      if (!overlaps(pos.x, pos.y)) { bestPos = pos; break; }
    }
    const newNode: Node = {
      ...sourceNode,
      id,
      position: bestPos,
      width: sourceNode.width,
      height: sourceNode.height,
      selected: true,
    };
    const edge: Edge = { id: edgeId, source: sourceId, target: id };

    // Copy source node data to nodeStore + set transformMode（批4b-2：前置计算——dispatch 与 set 同值）
    const sourceNsNode = useNodeStore.getState().nodes[sourceId];
    const nsData = sourceNsNode?.data ? { ...sourceNsNode.data, transformMode: true, imageRotation: 0, flipH: false, flipV: false } : { transformMode: true };

    // 批4b-2 换芯：node+edge 双 intent 单 transact（data 取 nsData——与 nodeStore 写入同值）；
    // set exists 自适应防投影 append 叠重复（addChildNode 同款）
    dispatchCanvasIntent([
      {
        type: 'addNode',
        node: {
          id, type: sourceNode.type!, position: { ...bestPos },
          ...(sourceNode.parentId != null ? { parentId: sourceNode.parentId } : {}),
          ...(sourceNode.width != null ? { width: sourceNode.width } : {}),
          ...(sourceNode.height != null ? { height: sourceNode.height } : {}),
          data: nsData as Record<string, unknown>,
        },
      },
      { type: 'upsertEdge', edge: { id: edgeId, source: sourceId, target: id } },
    ], Origin.LocalUser);
    set((s) => {
      const nodeProjected = s.nodes.some((n) => n.id === id);
      const edgeProjected = s.edges.some((e) => e.id === edgeId);
      return {
        nodes: nodeProjected
          ? s.nodes.map((n) => (n.id === id ? { ...n, selected: true } : { ...n, selected: false }))
          : [...s.nodes.map((n) => ({ ...n, selected: false })), newNode],
        edges: edgeProjected ? s.edges : [...s.edges, edge],
        selectedId: id,
      };
    });

    useNodeStore.getState().addNode({
      id,
      type: sourceNode.type!,
      data: nsData as any,
    });

    return id;
  },

  addEdge: (source, target, sourceHandle, targetHandle, deterministicId) => {
    const id = deterministicId ?? getId('edge');
    // 确定性建边幂等：同 id 已存在 no-op（防 React Flow 双 key）
    if (get().edges.some(e => e.id === id)) return id;
    const edge: Edge = { id, source, target, type: 'default', sourceHandle, targetHandle };
    // 批4b-1 换芯：doc 建边走意图漏斗；set exists 自适应（投影已 append 基础形状→补完整对象）。
    // 批4b-2：auto 边 origin=AutoEdge（撤销栈不收自动边/onRemote 跳过——ensureAutoEdges 契约，
    // 旧 syncAutoEdgesToDoc 对账 origin 的意图形态承接）
    dispatchCanvasIntent(
      { type: 'upsertEdge', edge: { id, source, target } },
      isAutoEdgeId(id) ? Origin.AutoEdge : Origin.LocalUser,
    );
    set((s) => ({
      edges: s.edges.some((e) => e.id === id)
        ? s.edges.map((e) => (e.id === id ? edge : e))
        : [...s.edges, edge],
    }));
    return id;
  },

  removeEdge: (id) => {
    // 批4b-1 换芯：doc 删边走意图漏斗；filter 型 set 幂等。批4b-2：auto 边 origin=AutoEdge（同 addEdge）
    dispatchCanvasIntent(
      { type: 'deleteEdge', id },
      isAutoEdgeId(id) ? Origin.AutoEdge : Origin.LocalUser,
    );
    set((s) => ({ edges: s.edges.filter(e => e.id !== id) }));
  },

  batchConnect: (sourceIds, targetNodeId) => {
    // B6-3（Spec B 需求 7）：多源→单目标=N 条边——batchConnectEdges 装配（禁自环+双侧
    // 对称+handleEdgeId 单源）；既有边过滤（幂等收敛——addEdge deterministicId no-op 守卫同源）后
    // N intent 单 transact（对端一帧收齐+撤销栈单捕获窗=单 undo 步）。参与集=UI 层原样（+号
    // addOutputSourceIds 产物——'connect' 不进 participation 组原子块，arrangeSelection :57 陷阱）。
    const edges = batchConnectEdges(sourceIds, targetNodeId);
    if (edges.length === 0) return;
    const existing = new Set(get().edges.map((e) => e.id));
    const intents = edges
      .filter((e) => !existing.has(e.id))
      .map((e) => ({ type: 'upsertEdge' as const, edge: { id: e.id, source: e.source, target: e.target } }));
    if (intents.length === 0) return; // 幂等：全部已存在=零 intent 零 transact
    dispatchCanvasIntent(intents, Origin.LocalUser);
  },

  addNodeAndBatchConnect: (type, position, sourceIds) => {
    // B6-3 点击建点/+号拖线落空=建点+连线（拍板②）：建点命令体=addNodeInner（Inner 化批收敛——
    // v3.17 终裁 65③ 的"Inner 化批随迁改名"迁移注释核销）+源集→新节点 N 边同批单 transact
    // （addNode intent+upsertEdge×N 一批——同 runCommand 单 undo）。
    const node = get().addNodeInner(type, position);
    const id = node.id;
    const edges = batchConnectEdges(sourceIds, id); // 新目标 id ⇒ 全新 handle: 边
    dispatchCanvasIntent([
      {
        type: 'addNode',
        node: {
          id, type: node.type, position,
          ...(node.width != null ? { width: node.width } : {}),
          ...(node.height != null ? { height: node.height } : {}),
          data: node.data as Record<string, unknown>,
        },
      },
      ...edges.map((e) => ({ type: 'upsertEdge' as const, edge: { id: e.id, source: e.source, target: e.target } })),
    ], Origin.LocalUser);
    set((s) => {
      // 投影已 append（canEdit 真窗口）→ 本 set 只补 UI 选择态；dispatch 被拦 → 原 append（addNode 同款）
      const projected = s.nodes.some((n) => n.id === id);
      return {
        nodes: projected
          ? s.nodes.map((n) => (n.id === id ? { ...n, selected: true } : { ...n, selected: false }))
          : [...s.nodes.map((n) => ({ ...n, selected: false })), node],
        selectedId: id,
      };
    });
    useNodeStore.getState().addNode({ id, type: node.type, data: node.data as any });
    return id;
  },

  createDerivedExtNode: (params) => {
    const source = get().nodes.find((n) => n.id === params.sourceNodeId);
    if (!source) return null;

    // O0b-2 A 类三档链（doc wh 第一——C0-3 定档）
    const sw = source.width ?? source.measured?.width ?? 300;
    const GAP = 80;
    const position = {
      x: source.position.x + sw + GAP,
      y: source.position.y,
    };

    const newNodeId = get().addNode('imageExt', position, {
      allImages: params.allImages,
      aiTool: params.aiTool,
      extConfig: { ...IMAGE_EXT_DEFAULTS },
    });

    const edgeId = getId('edge');
    const edge: Edge = { id: edgeId, source: params.sourceNodeId, target: newNodeId };
    // 批4b-2 换芯：doc 建边走意图漏斗；set exists 自适应防投影叠重复
    dispatchCanvasIntent(
      { type: 'upsertEdge', edge: { id: edgeId, source: params.sourceNodeId, target: newNodeId } },
      Origin.LocalUser,
    );
    set((s) => ({
      edges: s.edges.some((e) => e.id === edgeId) ? s.edges : [...s.edges, edge],
    }));

    return newNodeId;
  },

  selectNode: (id) => set({ selectedId: id }),

  requestAddMediaNode: (file) => set({ pendingMediaFile: file }),

  requestFillStoryboardCell: (groupId, cellIndex) =>
    set({ pendingFillCell: { groupId, cellIndex } }),

  updateViewport: (vp) => set({ viewport: vp }),

  // ══ B4'-1（Spec B）：dragSession 生命周期（begin/end/watchdog——C0-1 只落骨架字段，本批真生命周期）══
  beginDragGesture: (nodes, pointerId) => {
    clearDragWatchdog();   // 旧 session 无条件丢弃（吞 pointerup 兜，终裁 47 场景Ⅱ——静默 drop：pointerup
    gestureAbandoned = false;   // B4'-2：新手势开始——abandon 静默窗复位
                           // 未达=手势结果不可判定，doc 落后 cs 由下一命令差分补上，spec §5；不回滚）
    const byId = new Map(get().nodes.map((n) => [n.id, n]));
    const draggingIds = resolveDraggingIdsFromGesture(nodes);   // 第三参全 id 集（O0b-3 定案）
    const baseline = new Map<string, Rect>();
    const groupBaseline = new Map<string, Rect>();
    const draggedGroupIds = new Set<string>();
    for (const id of draggingIds) {
      const n = byId.get(id);
      if (!n) continue;
      if (n.type === 'group') {
        draggedGroupIds.add(id);
        groupBaseline.set(id, rectOf(n));
      } else {
        baseline.set(id, rectOf(n));
      }
    }
    // 冻结框（让位即冻结——spec §3.2.2）：受影响组=被拖子的父组；被拖组不含（拖组档 origin 活/
    // 尺寸冻结——B4'-2 手势内核）；同父去重（多选拖子共享父组）。
    const frozenFrames = new Map<string, Rect>();
    for (const id of draggingIds) {
      const n = byId.get(id) as Node | undefined;
      if (n?.parentId == null || draggedGroupIds.has(n.parentId)) continue;
      const p = byId.get(n.parentId);
      if (p?.type === 'group' && !frozenFrames.has(n.parentId)) {
        frozenFrames.set(n.parentId, rectOf(p));
      }
    }
    set({
      dragSession: {
        baseline,                       // 被拖集合几何快照（终裁 56——非整表，回滚域）
        groupBaseline,                  // 被拖组帧快照（resize 档回滚=帧三键）
        delta: { x: 0, y: 0 },          // 手势内核写者面（B4'-2 编排）
        draggingIds,
        dragProtectedIds: new Set(draggingIds),   // live 层=被拖集合（让位两层——卡一）
        draggedGroupIds,
        frozenFrames,
        gestureKind: 'drag',
        resizePending: false,
        lastActivityAt: Date.now(),
        activePointers: new Set(pointerId != null ? [pointerId] : []),   // 键控集合（终裁 31①）
        gestureAbandoned: false,
        resizeTargetId: null,
      },
    });
    armDragWatchdog();
  },

  beginResize: (targetId, pointerId = null) => {
    const target = get().nodes.find((n) => n.id === targetId);
    if (!target) return;   // 目标缺席=no-op（不拆旧 session 的 watchdog——防孤儿会话）
    clearDragWatchdog();   // 首行 discard（终裁 31⑤）：旧 session 静默清——让位集合只含 resizeTargetId
    gestureAbandoned = false;   // B4'-2：新手势开始——abandon 静默窗复位
    set({
      dragSession: {
        baseline: new Map(),
        groupBaseline: new Map([[targetId, rectOf(target)]]),   // resize 回滚=帧三键（提交值=末帧，B4'-2）
        delta: { x: 0, y: 0 },
        draggingIds: new Set(),
        dragProtectedIds: new Set(),
        draggedGroupIds: new Set(),
        frozenFrames: new Map(),
        gestureKind: 'resize',
        resizePending: true,
        lastActivityAt: Date.now(),
        activePointers: new Set(pointerId != null ? [pointerId] : []),
        gestureAbandoned: false,
        resizeTargetId: targetId,
      },
    });
    armDragWatchdog();
  },

  commitResizeGesture: () => {
    const s = get().dragSession;
    if (!s || s.gestureKind !== 'resize' || s.resizeTargetId == null) return;   // 幂等（只点不拖无提交）
    const target = get().nodes.find((n) => n.id === s.resizeTargetId);
    const d = resolveDoc();
    // 提交值=会话末帧 cs 帧三键（终裁 56——"回调第二参值"语义，读 cs 末帧单源）；
    // 恒三键密封（pos 回填——auto→manual 经 resize 转换的唯一通道）；零子代（子 rel 不随提交
    // 重算——RF 反向补偿值即终值，doc 子 abs 不动；清 session 先于 dispatch[B5'-1 终裁序对齐]
    // ⇒漏斗尾 reconcile 全域：子 rel 随新 origin 重基[abs 守恒]——旧 endGesture('completed')
    // 收尾链的清后 reconcile 由漏斗尾承接）。
    // isFinite 守卫（质评 Minor-3）：目标缺席/wh 非有限（如整帧被远端删的窄窗）⇒ 跳过提交 intent
    // 但仍走"跳过但完成"收尾——清 session 同步块无条件执行（会话必须终结，
    // 残帧不落 doc=保守不写而非写脏值）。
    if (target && Number.isFinite(target.width) && Number.isFinite(target.height)) {
      finalizeGestureSession();   // 提交族收尾（不回滚、不走 abort 族收尾链——B5'-1 终裁 78⑩）
      dispatchCanvasIntent([{
        type: 'updateNodeEnvelope', id: s.resizeTargetId,
        patch: {
          position: { x: target.position.x, y: target.position.y },
          width: target.width,
          height: target.height,
        },
      }], Origin.LocalUser);   // 单 transact=单 undo 步（LocalUser 入栈）
      stopCapturing();   // 手势=单 undo 步（捕获窗关闭——旧 GroupNode onResizeEnd 语义随迁）
    } else {
      finalizeGestureSession();
    }
    // canEdit 门拦（viewer 窗口）⇒ dispatch 零写、cs 停末帧=设计内分叉（下一 reconcile 收敛）——
    // invariant 断言面只覆盖 dispatch 真跑（rw）窗
    if (import.meta.env.DEV && d && canEdit(get()) && !checkProjectionInvariant(d)) {
      throw new Error("[B5'-1] commitResizeGesture 提交后投影不变量破缺（doc≡store 应收敛）");
    }
  },

  commitIntents: () => {
    const s = get().dragSession;
    if (!s || s.gestureKind !== 'drag') return;   // 幂等：无会话/resize 会话（提交=commitResizeGesture 专属）no-op
    const nodes = get().nodes;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const d = resolveDoc();
    const docPosById = d
      ? new Map(readCanvasFromDoc(d).nodes.map((r) => [r.id, r.position]))
      : null;
    const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6;   // RECONCILE_EPS 同值（量化契约表冻结——浮点往返噪声域）
    const intents: CanvasIntent[] = [];
    // ①被拖叶：末帧→moveNode 载荷=abs（量化契约表：顶层 cs.position 即 abs；子 rel+组 origin 翻转
    // ——拖叶档父组帧冻结[origin=frozenFrames]/拖组档 origin 活=cs[G].position）。零净变更剔除：
    // 末帧 abs≡doc 现值（手势期 doc 零写⇒≡baseline）⇒零 intent——空操作/往返 exact 同档零事务。
    for (const id of s.draggingIds) {
      const n = byId.get(id);
      if (!n || n.type === 'group') continue;   // 被拖组归②；手势期被删（remove 谓词应已收尾）防御跳过
      const parentId = n.parentId;
      const origin = parentId != null
        ? (s.draggedGroupIds.has(parentId)
            ? byId.get(parentId)?.position   // 拖组档：origin 活
            : s.frozenFrames.get(parentId) ?? byId.get(parentId)?.position)   // 拖叶档：父组帧冻结
        : undefined;
      const abs = origin
        ? { x: n.position.x + origin.x, y: n.position.y + origin.y }
        : { x: n.position.x, y: n.position.y };
      const cur = docPosById?.get(id);
      if (cur == null) continue;   // doc 无记录/分镜子无 position 键（剥键域非本提交面——membership 归 B5'-2）
      if (near(abs.x, cur.x) && near(abs.y, cur.y)) continue;   // 零净变更
      intents.push({ type: 'moveNode', id, position: abs });
    }
    // ②被拖组：随组位移的子代（不在 draggingIds 的成员——RF 拖组只动组节点，子 rel 不变、abs 随
    // origin 平移；直拖子①已提交去重）+manual/storyboard 组帧三键密封（auto 恒无帧键——帧归
    // reconcile 派生；折叠档 cs wh=COLLAPSED_SIZE 派生禁入 doc[终裁 82 doc 三键=展开态密封]⇒position-only）
    for (const gid of s.draggedGroupIds) {
      const g = byId.get(gid);
      if (!g) continue;
      for (const c of nodes) {
        if (c.parentId !== gid || s.draggingIds.has(c.id)) continue;
        const abs = { x: c.position.x + g.position.x, y: c.position.y + g.position.y };
        const cur = docPosById?.get(c.id);
        if (cur == null) continue;
        if (near(abs.x, cur.x) && near(abs.y, cur.y)) continue;
        intents.push({ type: 'moveNode', id: c.id, position: abs });
      }
      const gcur = docPosById?.get(gid);
      if (!isContentDerivedGroup(g) && gcur != null
        && !(near(g.position.x, gcur.x) && near(g.position.y, gcur.y))) {
        const collapsed = (g.data as Record<string, unknown>).collapsed === true;
        intents.push({
          type: 'updateNodeEnvelope', id: gid,
          patch: collapsed
            ? { position: { x: g.position.x, y: g.position.y } }
            : { position: { x: g.position.x, y: g.position.y }, width: g.width, height: g.height },
        });
      }
    }
    // ③清 session 同步块（无条件先于判空——零 intents 亦清+watchdog clearTimeout）→ 单 transact
    // dispatch（Origin.LocalUser=拖动入栈一步 undo，终裁 48）。**清先于 dispatch**：漏斗尾 reconcile
    // 随 dispatch 跑时让位集合已废止⇒终末对齐=reconcile 全域（auto 父组帧重派生——冻结帧不滞留；
    // 收尾链不可交换）；空批也走 dispatch——零意图手势的冻结帧/远端漂移同样经漏斗尾终末收敛
    // （空 transact 零 update 零栈项——"零净变更=零事务"判据面不破）。提交不经 endGesture
    // （终裁 78⑩——abort 族收尾回滚会吃掉提交；防复用重演 P0-10）。
    finalizeGestureSession();
    dispatchCanvasIntent(intents, Origin.LocalUser);
    if (intents.length > 0) stopCapturing();   // 手势=单 undo 步（commitResizeGesture 同款——下一步命令不并栈）
    // canEdit 门拦（viewer 窗口）⇒ dispatch 零写、cs 停末帧=设计内分叉（下一 reconcile 收敛）——
    // invariant 断言面只覆盖 dispatch 真跑（rw）窗
    if (import.meta.env.DEV && d && canEdit(get()) && !checkProjectionInvariant(d)) {
      throw new Error("[B5'-1] commitIntents 提交后投影不变量破缺（doc≡store 应收敛）");
    }
  },

  beginLeafResize: () => {
    set({ resizePending: true });
    // 悬挂兜底（B4'-2 spec 评发现#1）：只点不拖（RF resizeDetected 守卫跳过 onResizeEnd）⇒ 标记
    // 永悬（固化被永久抑制+门判据②错路由）。pointerup/pointercancel 一次性兜底清——真 resize 的
    // 末批自带 setAttributes（批内判据照常 else 路由），两类清零幂等无冲突。
    // 质评 Minor-1 有界化：once 对只各自摘自身——未触发的孪生监听器会跨手势滞留（慢泄漏），
    // 共享 clear 双摘封顶每手势零残留。
    const clear = () => {
      window.removeEventListener('pointerup', clear, { capture: true });
      window.removeEventListener('pointercancel', clear, { capture: true });
      set({ resizePending: false });
    };
    window.addEventListener('pointerup', clear, { capture: true });
    window.addEventListener('pointercancel', clear, { capture: true });
  },
  endLeafResize: () => set({ resizePending: false }),

  endGesture: (reason) => {
    void reason;   // 三分支（aborted/healed/removed）收尾同构——reason 仅诊断面（单收尾终裁 54②）
    const s = get().dragSession;
    if (!s) return;   // 收尾幂等锚（终裁 66④②）：松手后再触发=no-op（cs 不回跳）
    gestureAbandoned = true;   // B4'-2（终裁 16/30）：abort 族置位——同手势尾批静默
    // 收尾链（v3.10 终裁 3 冻结序——禁改序：reconcile 提前则让位残留致被拖节点 cs 停旧值≠doc）。
    // ①回滚：abort 族（aborted/healed/removed——B5'-1 起提交族不经本函数，恒回滚）被拖集合回
    //   baseline（cs≡末帧锚归 commitIntents——终裁 66④①）。drag 档只回 position；resize 档回帧三键。
    const resize = s.gestureKind === 'resize';
    set((st) => ({
      nodes: st.nodes.map((n) => {
        const b = s.baseline.get(n.id);
        if (b) return { ...n, position: { x: b.x, y: b.y } };
        const gb = s.groupBaseline.get(n.id);
        if (gb) {
          return resize
            ? { ...n, position: { x: gb.x, y: gb.y }, width: gb.width, height: gb.height }
            : { ...n, position: { x: gb.x, y: gb.y } };
        }
        return n;
      }),
    }));
    // ②清 session 同步块：frozenFrames/activePointers/gestureAbandoned/resizePending/resizeTargetId
    //   随 dragSession=null 整对象清（与 frozenFrames 同步块——终裁 23）+watchdog clearTimeout
    finalizeGestureSession();
    // ③reconcile('doc')：清后让位失效，doc 权威直拷=终态（拖动中被远端写的被拖节点取 doc 远端值
    //   非 baseline——终裁 66④；四元组第 4 成员——census 锚在 canvasCollabRuntime.geometry.test）
    const d = resolveDoc();
    if (d) reconcileGroupGeometry(d, 'doc');
    // ④invariant（DEV）：收尾后 doc≡store 收敛断言（非让位态——session 已清）
    if (import.meta.env.DEV && d && !checkProjectionInvariant(d)) {
      throw new Error("[B4'-1] endGesture 收尾后投影不变量破缺（doc≡store 应收敛）");
    }
  },

  noteDragActivity: () => {
    const s = get().dragSession;
    if (!s) return;
    s.lastActivityAt = Date.now();   // 原位刷新——会话非渲染面（零订阅广播；draggingIds 等只读集不变）
    armDragWatchdog();               // 每次活动重挂（主道——spec §3.2.2）
  },

  onNodesChange: (changes) => {
    // C1：键盘 Delete 手势路径——videoEdit 节点 remove 需在 applyNodeChanges 移除节点前用变更前 state 判型级联删工程
    const removedIds = changes.filter((c) => c.type === 'remove').map((c) => (c as any).id);
    if (removedIds.length > 0) cascadeDeleteVideoProject(get().nodes, removedIds);
    // v6：被删节点是组 → 级联（先于 applyNodeChanges 捕获，filter 后丢父子）；对齐 deleteNode/菜单语义
    const removedGroupsChildren = removedIds.flatMap((gid) => {
      const n = get().nodes.find((x) => x.id === gid);
      return n?.type === 'group' ? get().nodes.filter((c) => c.parentId === gid).map((c) => c.id) : [];
    });
    const parentOfRemoved = new Map(   // set 之前捕获——filter 后丢失父子关系（deleteNode 同款）
      removedIds.map((id) => [id, get().nodes.find((n) => n.id === id)?.parentId]),
    );
    // ══ B4'-2（Spec B §3.2.1）首行两件事：自愈副道+分镜丢弃 → 整批预扫描 → 手势期/门判据分型 ══
    // ①自愈副道（watchdog 主道的冗余检查——终裁 16/31①）：activePointers 空∧idle>STALE_MS ⇒
    //   abort 收尾（回滚+清+reconcile）；触发批自身随后按普通流程路由（gestureAbandoned 静默）。
    {
      const s0 = get().dragSession;
      if (s0 && s0.activePointers.size === 0 && Date.now() - s0.lastActivityAt > DRAG_STALE_MS) {
        get().endGesture('aborted');
      }
    }
    const gesture = get().dragSession;
    // ②分镜子 position 批=按条目数据层丢弃（卡三 cs 死字段：cs {0,0} 构造默认不可移；识别按父组
    //   groupType==='storyboard' 非 position 值——多选混批普通条目照常路由）
    let routed: NodeChange[] = changes;
    if (changes.some((c) => c.type === 'position')) {
      const sbParents = new Set(
        get().nodes
          .filter((n) => n.type === 'group' && (n.data as Record<string, unknown> | undefined)?.groupType === 'storyboard')
          .map((n) => n.id),
      );
      if (sbParents.size > 0) {
        const parentIdOf = new Map(get().nodes.map((n: any) => [n.id, (n.parentId ?? null) as string | null]));
        routed = changes.filter((c) => !(c.type === 'position' && parentIdOf.get(c.id) != null && sbParents.has(parentIdOf.get(c.id)!)));
      }
    }
    // 整批预扫描（changes.some 先于分类——门判据②分型判据，终裁 30/44③）
    const hasPosition = routed.some((c) => c.type === 'position');
    const hasResizeAttr = routed.some((c) => c.type === 'dimensions' && (c as any).setAttributes);

    // remove 结构批：手势内外都照常路由（结构域非几何域——deleteNode intent + 下方三件套善后）
    const structIntents: CanvasIntent[] = [];
    for (const c of routed) {
      if (c.type === 'remove') structIntents.push({ type: 'deleteNode', id: c.id });
    }

    const dragIntents: CanvasIntent[] = [];
    // O0b-2 (iii) 首测固化候选：dimensions 批非 setAttributes（RF 首测）。手势期隔离=session∨
    // resizePending 不固化（终裁 59①[iii]——dispatchFixtureSizeIntents 门）；类型限定/首写者胜/
    // 批量单 transact 判定收口在彼处（doc 读+textInput 类）。
    const fixCandidates: { id: string; width: number; height: number }[] = [];
    // 首测固化候选预收集（B4'-2 spec 评发现#2——非 setAttributes dimensions 与 position 混批时
    // 告警分支不吞固化候选：收集先于三分路由，仅手势期（gesture 分支）由 dispatchFixtureSizeIntents
    // 的 session∨resizePending 门拦下）
    for (const c of routed) {
      if (c.type === 'dimensions' && !(c as any).setAttributes && (c as any).dimensions != null) {
        fixCandidates.push({ id: c.id, width: (c as any).dimensions.width, height: (c as any).dimensions.height });
      }
    }
    // O0b-5（终裁 50）：resize 提交=单 updateNodeEnvelope{三键}——同批 position 变更属 resize 手势
    // 位移（非拖拽），并入 envelope 单 intent 单 transact；两遍装配（position 与 dimensions 相对序不保证）
    const positionChanges = new Map<string, { x: number; y: number }>();
    const resizeCommits = new Map<string, { width: number; height: number }>();

    if (gesture) {
      // ── 手势期零 intent（终裁 44①/56——"拖动单帧 doc 写入=0"根因锚）：session 活跃期
      // position/dimensions 批只落 cs（下方 applyNodeChanges 统一应用）。RF 对子发 rel、cs 即 rel
      // 空间——旧路径 moveNode 把 rel 写进 doc.abs 槽=B4'-1 登记的 rel-as-abs 洞，此处结构性关闭
      //（松手 finalize 的 reconcile('doc') 不再腐蚀覆盖）。提交归松手路径：组 resize=
      // commitResizeGesture（B4'-2）；拖动=commitIntents（B5'-1——CanvasView onNodeDragStop 头部，
      // 拖入组路由 B5'-2 单一路径化）。end 重放批（dragging:false——F1）落 session 内零告警；
      // remove 见上方 structIntents。
    } else if (hasPosition && !hasResizeAttr && !get().resizePending) {
      // ── 门判据②（终裁 30 分型）：position 批∧无 session∧无 resize 批（同批无 dimensions/
      // setAttributes 且无 resizePending 叶子标记）⇒ 零 intent+DEV 告警——外视写入（不变量
      // "cs position 批⇐session∨resize 批，否则告警"）；cs 照常吞 RF 批（受控面一致，下一
      // applyDocToStore 回滚对齐 doc）。gestureAbandoned 置位后静默（heal 后同手势尾批——终裁 16/30）。
      if (!gestureAbandoned && import.meta.env.DEV) {
        const ids = routed.filter((c) => c.type === 'position').map((c) => c.id).join(',');
        console.error(`[B4'-2] 无 session 的 position 批（外视写入——cs position 批⇐session∨resize 批）: ${ids}`);
      }
    } else {
      // ── 无 session 的常规路由（批4b-1 换芯语义保持）：叶子 resize 现状（setAttributes 三态+
      // position 逐帧落 doc 零告警——终裁 30"有 resize 批⇒照常派发"）；resize 走 LocalUser
      // （撤销语义），position 批走 Geometry（不入栈——canvasUndo trackedOrigins 契约；B5'-1 起
      // 拖动提交=commitIntents 单 transact LocalUser 入栈，本路由不再承载拖动）。
      for (const c of routed) {
        if (c.type === 'position' && c.position != null) {
          positionChanges.set(c.id, { ...c.position });
        } else if (c.type === 'dimensions' && (c as any).setAttributes && (c as any).dimensions != null) {
          // (iv) resize 提交（现状保通——NodeResizer/NodeResizeControl setAttributes=true）
          resizeCommits.set(c.id, { width: (c as any).dimensions.width, height: (c as any).dimensions.height });
        }
      }
      for (const [id, wh] of resizeCommits) {
        // 质评收口 C-1（终裁 50 恒三键密封）：RF ResizeControl 仅左上方向柄同批发 position 变更，
        // 右/下柄批 dimensions-only——缺位时回填 cs 现节点 position（手势末 auto 组=reconcile 派生帧
        // origin；回填即全量密封：auto→manual 经 resize 转换的唯一通道）。缺位不回填会落 2 键部分
        // 帧形态——frameMode 判 auto ⇒ 漏斗尾 reconcile('doc') 重派生 bbox 帧，resize 静默回弹。
        const pos = positionChanges.get(id) ?? get().nodes.find((n) => n.id === id)?.position;
        positionChanges.delete(id);   // resize 位移并入 envelope 三键（不另发 moveNode）
        structIntents.push({
          type: 'updateNodeEnvelope', id,
          patch: { position: pos, width: wh.width, height: wh.height },
        });
      }
      for (const [id, pos] of positionChanges) {
        dragIntents.push({ type: 'moveNode', id, position: pos });
      }
    }
    if (dragIntents.length > 0) dispatchCanvasIntent(dragIntents, Origin.Geometry);
    if (structIntents.length > 0) dispatchCanvasIntent(structIntents, Origin.LocalUser);
    // O0b-2 (iii)：固化独立 Geometry transact——不与 LocalUser 提交同 transact 合批（终裁 59⑥）
    dispatchFixtureSizeIntents(fixCandidates);
    // 去闸门（终裁 43 需求 5 物理前提）：拖拽期 clamp 块整删——子节点拖出组帧外 cs 位置原样保留
    // （脱离判定归 B5' 松手路由）；placement 域 clamp（addToGroup/dropIntoGroup 分支 B）是另一域（F4 维持）
    // O0b-6（geometryTrap 写者上下文接线）：applyNodeChanges 窗标 'reconcile'；批含 dimensions
    // setAttributes（RF resize 写 node.width/height）细分 'dimensions-attribute'——两类皆合法
    // registry 上下文；单一 set 窗按批主导面取类（混批[position+setAttributes 同批=左上柄]时
    // dimensions 写优先标——首测固化路径的写者面）
    withGeometryWriter(hasResizeAttr ? 'dimensions-attribute' : 'reconcile', () => {
      set((s) => ({ nodes: applyNodeChanges(routed, s.nodes) as Node[] }));
    });
    // B4'-2 手势期本地自删：remove 命中被拖集合/resize 目标 ⇒ 会话收尾（'removed'——幸存者回
    // baseline 事后回滚；doc 删已在上 structIntents 落地）
    {
      const s1 = get().dragSession;
      if (s1 && removedIds.length > 0
        && removedIds.some((id) => s1.draggingIds.has(id) || id === s1.resizeTargetId)) {
        get().endGesture('removed');
      }
    }

    // TD-11: 键盘/程序化删除 → 对齐 deleteTransformNode 的 store 侧清理三件套
    // （DB 同步由 bindCanvasSync 订阅判脏 → 统一 runtime debounce 保存承担）
    const removes = changes.filter((c) => c.type === 'remove');
    if (removes.length === 0) return;
    // 批4b-2：善后段差分快照——上方结构 set 的变更已由显式 intent 覆盖（origin 语义分开：
    // 拖拽 Geometry/结构 LocalUser），快照只收善后几何（父组框收缩/自动解组/级联子删）
    const aftercareBefore = captureStoreProjection();
    for (const change of removes) {
      get().cancelNodeProcess(change.id);
      const ns = useNodeStore.getState();
      ns.deleteNode(change.id);
      ns.unregisterSaveHandler(change.id);
      // v6 组清理（cells 第 7 写者——对齐 deleteNode 的父组清理）：分镜组 cells 过滤死 id；普通组删空自动解组
      const prevParentId = parentOfRemoved.get(change.id);
      const parent = prevParentId ? get().nodes.find((n) => n.id === prevParentId) : undefined;
      if (parent?.type === 'group') {
        if ((parent.data as any)?.cells) {
          get().patchGroupData(parent.id, { cells: ((parent.data as any).cells as string[]).filter((c) => c !== change.id) });
        } else if ((parent.data as any).groupType === 'normal'
          && !get().nodes.some((c) => c.parentId === parent.id)) {
          // 普通组：删空自动解组；仍有子 → 组框收缩归收尾差分首行 reconcile('cs')（对齐 deleteNode 同款）
          get().ungroup(parent.id);
        }
      }
    }
    // v6：级联子清理（组被删时其子走 deleteNode 三件套——cancelNodeProcess/ns.deleteNode/unregisterSaveHandler）
    for (const cid of removedGroupsChildren) {
      if (get().nodes.some((n) => n.id === cid)) get().deleteNode(cid);
    }
    // 批4b-2：善后几何（refit 收缩）经差分落 doc（嵌套 action 自 dispatch 幂等）
    dispatchProjectionDiff(aftercareBefore, Origin.LocalUser);
  },

  onEdgesChange: (changes) => {
    // 批4b-1 换芯：remove 变更（键盘 Delete/程序化删边）doc 删走意图漏斗；filter 幂等
    const removeIntents = changes
      .filter((c) => c.type === 'remove')
      .map((c) => ({ type: 'deleteEdge' as const, id: c.id }));
    if (removeIntents.length > 0) dispatchCanvasIntent(removeIntents, Origin.LocalUser);
    set((s) => ({ edges: applyEdgeChanges(changes, s.edges) as Edge[] }));
  },

  onConnect: (connection) => {
    // 同源判重（spec 第二节顺手项：现状缺口非本功能引入，同一对节点重复拖线不再叠边）
    if (get().edges.some(e => e.source === connection.source && e.target === connection.target)) return;
    const id = getId('edge');
    const edge: Edge = { id, ...connection };
    // 批4b-1 换芯（connectLine 连线手势）：doc 建边走意图漏斗；set exists 自适应防投影叠重复
    dispatchCanvasIntent(
      { type: 'upsertEdge', edge: { id, source: connection.source, target: connection.target } },
      Origin.LocalUser,
    );
    set((s) => ({
      edges: s.edges.some((e) => e.id === id)
        ? s.edges.map((e) => (e.id === id ? edge : e))
        : [...s.edges, edge],
    }));
  },

  splitImageNode: async (nodeId, rows, cols) => {
    const state = get();

    // Guard: already processing
    if (state.nodeProcessMap[nodeId]) return null;

    // Guard: invalid params
    if (!validateGridParams(rows, cols)) return null;

    const sourceNode = state.nodes.find((n) => n.id === nodeId);
    if (!sourceNode) return null;

    const nsData = useNodeStore.getState().nodes[nodeId]?.data as any;
    const fileId: string | undefined = nsData?.fileId;
    const referenceImage: string | undefined = nsData?.referenceImage;

    const mediaId = fileId || referenceImage;
    if (!mediaId) return null;

    // Snapshot source position/size（O0b-2 A 类三档链——doc wh 第一）
    const sourceW = sourceNode.width ?? sourceNode.measured?.width ?? 400;
    const sourceH = sourceNode.height ?? sourceNode.measured?.height ?? 300;
    const sourcePosition = { x: sourceNode.position.x, y: sourceNode.position.y };

    const ac = new AbortController();
    set((s) => ({
      nodeProcessMap: {
        ...s.nodeProcessMap,
        [nodeId]: { processType: 'splitting', status: 'processing', abortController: ac },
      },
    }));

    let isTimeout = false;
    const timer = setTimeout(() => {
      isTimeout = true;
      ac.abort();
    }, 10_000);

    let imageUrl: string | null = null;

    try {
      // Resolve image URL via API
      imageUrl = (await getMediaUrl(mediaId)).url;

      ac.signal.throwIfAborted();

      const img = await loadImage(imageUrl, ac.signal);
      clearTimeout(timer);

      // Validate
      if (img.naturalWidth === 0 || img.naturalHeight === 0) {
        message.error('图片损坏，无法切分');
        return null;
      }

      // Scale if needed
      let finalW = img.naturalWidth;
      let finalH = img.naturalHeight;
      if (Math.max(finalW, finalH) > 4096) {
        const scaled = scaleToMaxSize(finalW, finalH, 4096);
        finalW = scaled.width;
        finalH = scaled.height;
      }

      // Min size check
      if (isSubImageTooSmall(finalW, finalH, rows, cols, MIN_SUB_IMAGE_PX)) {
        message.warning('切分后子图尺寸过小，无法使用');
        return null;
      }

      // Split to blobs
      const blobResults = await splitImageToBlobs(img, finalW, finalH, rows, cols);

      // Double-check source node still exists
      if (!get().nodes.find((n) => n.id === nodeId)) {
        ac.abort();
        return null;
      }

      // Upload (pass blobResults directly — preserves original indices)
      const namePrefix = (nsData?.fileName as string) || fileId || referenceImage || 'split';
      const uploadResult = await uploadSplitBlobs(
        blobResults,
        { signal: ac.signal, maxConcurrent: 3, maxRetries: 1, cols, namePrefix, projectId: get().projectId ?? undefined },
      );

      // Check again
      if (!get().nodes.find((n) => n.id === nodeId)) {
        ac.abort();
        return null;
      }

      // Build node data list (pair upload results with grid positions)
      const nodeDataList: AddChildNodeItem[] = [];
      for (const r of uploadResult.success) {
        const gridRow = Math.floor(r.index / cols);
        const gridCol = r.index % cols;
        nodeDataList.push({
          gridRow,
          gridCol,
          data: {
            fileId: r.fileId,
            fileName: `${namePrefix}_r${gridRow}_c${gridCol}.webp`,
            status: 'done',
            width: sourceW,
            height: sourceH,
          },
        });
      }

      // Batch create nodes
      const newIds = get().addChildNodes(nodeId, nodeDataList);

      // Report results
      const successCount = uploadResult.success.length;
      const failCount = uploadResult.failed.length;

      if (failCount === 0 && successCount > 0) {
        message.success(`成功切分为 ${successCount} 张图片`);
      } else if (successCount > 0 && failCount > 0) {
        message.warning(`切分完成：成功 ${successCount} 张，失败 ${failCount} 张`);
      } else if (successCount === 0 && failCount > 0) {
        const reasons = [...new Set(uploadResult.failed.map(f => f.error))].join('; ');
        message.error(`切分失败：所有子图上传失败 (${reasons})`);
      }

      return {
        newIds,
        sourcePosition,
        sourceSize: { w: sourceW, h: sourceH },
      };
    } catch (err) {
      if (isTimeout) {
        message.error('图片加载超时，请检查网络');
      } else if (err instanceof DOMException && err.name === 'AbortError') {
        // Silent abort (user cancelled or node deleted)
      } else {
        message.error(`切分失败：${(err as Error).message}`);
      }
      return null;
    } finally {
      clearTimeout(timer);
      if (imageUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(imageUrl);
      }
      set((s) => {
        const next = { ...s.nodeProcessMap };
        delete next[nodeId];
        return { nodeProcessMap: next };
      });
    }
  },
  startNodeProcess: (nodeId, processType, abortController) =>
    set((s) => ({
      nodeProcessMap: {
        ...s.nodeProcessMap,
        [nodeId]: { processType, status: 'processing', abortController },
      },
    })),

  updateNodeProcessProgress: (nodeId, progress) =>
    set((s) => ({
      nodeProcessMap: {
        ...s.nodeProcessMap,
        [nodeId]: { ...s.nodeProcessMap[nodeId], progress },
      },
    })),

  finishNodeProcess: (nodeId, _status, _errorMsg) =>
    set((s) => {
      const next = { ...s.nodeProcessMap };
      delete next[nodeId];
      return { nodeProcessMap: next };
    }),

  cancelNodeProcess: (nodeId) => {
    const entry = get().nodeProcessMap[nodeId];
    if (entry?.abortController) {
      entry.abortController.abort();
    }
    set((s) => {
      const next = { ...s.nodeProcessMap };
      delete next[nodeId];
      return { nodeProcessMap: next };
    });
  },

  hasActiveProcessInGroup: (groupId: string) => {
    const s = get();
    const childIds = new Set(s.nodes.filter((n) => n.parentId === groupId).map((n) => n.id));
    return Object.keys(s.nodeProcessMap ?? {}).some((id) => childIds.has(id));
  },

  setProjectId: (projectId) => set({ projectId }),
  setTeamId: (teamId) => set({ teamId }),
  setHydration: (s) => set({ hydration: s }),

  /** R2 新命令唯一入口（v2 裁定+v2.1 异常/单 transact 契约）：canEdit 门 + 单 undo 步 + 差分换芯编排。
   *  仅新命令使用；既有 16 处 capture/diff 点不迁移（spec:169 既有命令不动）。
   *  fn 契约（钉死）：① 只准 plain set（含删键）——组 data 写用 patchGroupDataInner（纯写层），
   *  禁用 patchGroupData（其自带正向 dispatch，叠外层差分=同值写两遍两 transact）；
   *  ② 先取数校验（resolveNodeData 取不到即红）后结构写——抛错须发生在任何写之前；
   *  ③ finally 恒收尾 diff：fn 抛错时 catch 提示不 rethrow，diff 出已写部分——doc≡store 不变量恒成立。 */
  runCommand: (fn) => {
    if (!canEdit(get())) {
      message.warning('当前为只读会话，操作已忽略');
      return;
    }
    stopCapturing();
    const before = captureStoreProjection();
    try {
      fn();
    } catch (err) {
      message.error(`操作失败：${(err as Error).message}`);
    } finally {
      dispatchProjectionDiff(before, Origin.LocalUser);
    }
  },

  /** §4.3 整理选区（R2a-5 写回）：参与裁决 normalizeSelection+participation('arrange')——组=原子块、
   *  散根真重排、组内 detached 排除（excludedCount 计数提示）。写回经 runCommand；排列后不 refit 组框
   *  （hidden 派生已并入 reconcile——O0b-4；显式几何 refit 属 2c-4 口径，两 task 口径不同非矛盾）。 */
  arrangeSelection: (ids, mode) => {
    const s = get();
    const buckets = normalizeSelection(s.nodes as any, ids);
    const p = participation(buckets, 'arrange', s.nodes as any);
    if (p.ids.length < 2) {
      message.warning(p.excludedCount > 0 ? '没有可排列的节点：所选节点均在未选中的组内' : '没有可排列的节点');
      return;
    }
    get().runCommand(() => {
      // storedRectOf（v2.1 简化）：信封恒等可见盒现状成立（折叠组信封=reconcile collapsed 档派生尺寸、
      // 分镜组信封=配置尺寸）——直接读 n.width/height + DEFAULT_CHILD_SIZE 兜底，不重算分镜配置尺寸
      // （防第二真相与信封竞争）
      const storedRectOf = (n: Node): { width: number; height: number } => ({
        width: n.width ?? DEFAULT_CHILD_SIZE.width,
        height: n.height ?? DEFAULT_CHILD_SIZE.height,
      });
      const items = sortForArrange(p.ids.map((id) => {
        const n = s.nodes.find((x) => x.id === id)!;
        const wh = storedRectOf(n);
        return { id, x: n.position.x, y: n.position.y, ...wh };
      }));
      const laid = arrangeRects(items.map(({ id, ...r }) => r), mode);
      set((st) => ({
        nodes: st.nodes.map((n) => {
          const i = items.findIndex((it) => it.id === n.id);
          return i === -1 ? n : { ...n, position: { x: laid[i].x, y: laid[i].y } };
        }),
      }));
      if (p.excludedCount > 0) message.warning(`${p.excludedCount} 个组内节点未参与排列（需调整请先选中其所在组）`);
    });
  },

  /** §4.4 排列子节点（R2c-4 显式几何命令）：守卫先于 runCommand（零 transact）——缺失/折叠/分镜/
   *  <2 子 → 提示早退。写回经 runCommand（canEdit 门+单 undo 步+差分收尾）。核心序（O0c-3 后）：
   *  ① 纯几何命令——组 data 零写（旧折叠快照键的"清守恒域标记"data 写点已随键全链删除消亡）；
   *  ② 子绝对 rect（rel+组原点，尺寸 DEFAULT_CHILD_SIZE 兜底）→ sortForArrange 行优先 → arrangeRects
   *  （laid=绝对坐标——bbox 中心不变、平移不变）；③ 子 rel 写回（O0b-5 评审收口：组帧写删——
   *  帧≡bbox(laid)+padding 由 runCommand 尾差分首行 reconcile('cs') 派生[跃迁表 arrange 行]、
   *  子 rel 随新 origin 重基[写域②]——子新绝对位置恒=laid 守恒；命令体仅子 rel 直写
   *  =abs−组当前 origin——帧写不涉，ALLOW_FN 终态={reconcileGroupGeometry} 后命令体 position 直写
   *  仍属合法（group-frame-writer-guard 正例锚））。 */
  arrangeGroupChildren: (groupId, mode) => {
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    if (!group || group.type !== 'group') return;
    const gd = group.data as Record<string, unknown>;
    if (gd.collapsed) { message.warning('折叠组不支持排列子节点，请先展开'); return; }
    if (gd.groupType === 'storyboard') { message.warning('分镜组不支持排列子节点'); return; }
    const children = s.nodes.filter((n) => n.parentId === groupId);
    if (children.length < 2) { message.warning('组内节点不足 2 个，无需排列'); return; }
    get().runCommand(() => {
      const items = sortForArrange(children.map((n) => ({
        id: n.id,
        x: n.position.x + group.position.x, y: n.position.y + group.position.y,
        width: n.width ?? DEFAULT_CHILD_SIZE.width, height: n.height ?? DEFAULT_CHILD_SIZE.height,
      })));
      const laid = arrangeRects(items.map(({ id, ...r }) => r), mode);
      setWithParentOrder((st) => ({
        nodes: st.nodes.map((n) => {
          const i = items.findIndex((it) => it.id === n.id);
          return i === -1 ? n : { ...n, position: { x: laid[i].x - group.position.x, y: laid[i].y - group.position.y } };
        }),
      }));
    });
  },

  groupNodes: (nodeIds) => {
    const s = get();
    const picked = s.nodes.filter((n) => nodeIds.includes(n.id));
    if (picked.length < 2) throw new Error('打组至少需要 2 个节点');
    if (picked.some((n) => n.type === 'group')) throw new Error('组不支持嵌套');
    const id = getId('node');
    const allNodeIds = [...nodeIds, id];
    const bounds = calcGroupBounds(picked.map((n) => ({
      x: n.position.x, y: n.position.y,
      width: n.width ?? DEFAULT_CHILD_SIZE.width, height: n.height ?? DEFAULT_CHILD_SIZE.height,
    })));
    const groupNode: Node = {
      id, type: 'group',
      position: { x: bounds.x, y: bounds.y },
      width: bounds.width, height: bounds.height,
      data: { groupType: 'normal' },
      selected: true,
    };
    // 批4b-2 换芯：差分快照→组+入组信封+rel 坐标经 dispatchProjectionDiff 单 transact 落 doc
    const before = captureStoreProjection();
    setWithParentOrder((st) => ({
      nodes: [
        ...st.nodes.map((n) => nodeIds.includes(n.id)
          ? { ...n, selected: false, parentId: id,
              position: { x: n.position.x - bounds.x, y: n.position.y - bounds.y } }
          : { ...n, selected: false }),
        groupNode,
      ],
      selectedId: id,
    }));
    useNodeStore.getState().addNode({ id, type: 'group', data: groupNode.data as any });
    // O0b-5 建组 author 形预注册（0 帧键——auto 组恒无帧键[终裁 89]）：新组先以作者态入 doc，差分出口
    // 的键集 oracle（readGroupFrameModes）随之判 auto——否则差分 addNode 对未注册组回落 record 形态
    // 判定（cs 派生帧三键齐⇒误判 manual）帧键泄漏进 doc；副本路径（duplicate/paste=帧继承例外 §4.8
    // 登记）不经此——差分 fallback manual 保留帧键是刻意语义。applyIntentToDoc addNode 同 id 幂等守卫
    // 使差分重放零膨胀（两 transact 同 origin 同步块——撤销捕获窗合并单步）。
    dispatchCanvasIntent({
      type: 'addNode',
      node: { id, type: 'group', data: groupNode.data as Record<string, unknown> },
    }, Origin.LocalUser);
    dispatchProjectionDiff(before, Origin.LocalUser);
    return id;
  },

  /** Inner 化（Spec B）：解散纯变更核——见接口 JSDoc。 */
  ungroupInner: (groupId) => {
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    if (!group) return;
    const gd = group.data as any;
    const gp = group.position;
    if (gd.groupType === 'storyboard') {
      const cfg = resolveStoryboardConfig(gd);
      const ratioKey = cfg.aspectRatio as keyof typeof ASPECT_RATIO_MAP;
      const cellH = CELL_WIDTH / ASPECT_RATIO_MAP[ratioKey];
      // F38 sizeOf 契约：槽位语义下 placeGrid 必然对无节点 id（悬空 cells 项）调 sizeOf——回落基准防 TypeError
      const byId = new Map(s.nodes.map((n) => [n.id, n]));
      const sizeOf = (id: string): { width: number; height: number } => {
        const n = byId.get(id) as any;
        return n ? { width: n.width ?? CELL_WIDTH, height: n.height ?? cellH } : { width: CELL_WIDTH, height: cellH };
      };
      // F38：解散保留子自身尺寸——只重排 position（placeGrid v5 槽位语义：null/悬空按基准占格不塌陷）
      const pos = placeGrid(gd.cells ?? [], cfg.gridCols, CELL_WIDTH, cellH, sizeOf);
      set((st) => ({
        nodes: st.nodes.map((n) => {
          const p = pos.get(n.id);
          if (!p || n.parentId !== groupId) return n;
          return { ...n, position: p };
        }),
      }));
    }
    set((st) => ({
      nodes: st.nodes
        .filter((n) => n.id !== groupId)
        .map((n) => n.parentId === groupId
          ? { ...n, parentId: undefined,
              position: { x: n.position.x + gp.x, y: n.position.y + gp.y } }
          : n),
      selectedId: st.selectedId === groupId ? null : st.selectedId,
    }));
    useNodeStore.getState().deleteNode(groupId);
  },

  ungroup: (groupId) => {
    // R4 守卫收窄（Inner 化批）：组内执行中守卫移除——新家=B5'-2 松手路由预检（单一路由）；
    // 键盘/程序化路由不再拦（守卫窄化）。执行中守卫仍驻 dropImageIntoStoryboard/convertGroup/
    // resizeStoryboardGrid/clearStoryboard/removeStoryboardCell。
    const group = get().nodes.find((n) => n.id === groupId);
    if (!group) return;
    // 批4b-2 换芯：差分快照→组删+出组信封删键+abs 坐标还原经 dispatchProjectionDiff 落 doc
    const before = captureStoreProjection();
    get().ungroupInner(groupId);
    dispatchProjectionDiff(before, Origin.LocalUser);
  },

  addToGroup: (groupId, nodeId) => {
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    const node = s.nodes.find((n) => n.id === nodeId);
    if (!group || !node || node.type === 'group' || node.parentId === groupId) return;  // 已在组 no-op
    // O0c-3 公开面 groupType 守卫：分镜组成员写唯一通道=attachMember（membership+入格槽序一体）——
    // 本公开面拒分镜组（零写：不 clamp/不写 rel/不写 cells）
    if ((group.data as any).groupType === 'storyboard') return;
    const gp = group.position;
    // 跨组：node.position 是相对旧父的 rel——先还原绝对坐标（现状当绝对用是双重偏移根源）
    let absX = node.position.x, absY = node.position.y;
    const oldParent = node.parentId ? s.nodes.find((n) => n.id === node.parentId) : undefined;
    if (oldParent && node.parentId !== groupId) {
      absX += oldParent.position.x; absY += oldParent.position.y;
    }
    const childSize = { width: node.width ?? DEFAULT_CHILD_SIZE.width,      // v6 纪律三：无 measured
                        height: node.height ?? DEFAULT_CHILD_SIZE.height };
    // O0b-5：auto 判定=isContentDerivedFrame（shouldAutoRefit 退役——doc 帧键形态 oracle：manual
    //（三键齐）/storyboard/collapsed 走分支 B 帧不动；auto 守恒扩框）
    const auto = isContentDerivedGroup(group);
    // 批4b-2 换芯：差分快照→入组信封+新子 rel 经 dispatchProjectionDiff 落 doc
    const before = captureStoreProjection();
    setWithParentOrder((st) => {
      // 命令体仅 placement 域新子位写（跃迁表 addToGroup 行"cs 子=新子 clamp rel"——组帧零写）：
      //  · auto 组不夹取——扩框归收尾差分首行 reconcile('cs') 派生（childrenAbs=cs rel+旧 origin
      //    反推 → calcGroupBounds；既有成员 rel 随新 origin 重基[写域②]——绝对坐标守恒，F33 根修）；
      //  · manual/折叠/分镜组帧一字不改，rel 过 clampChildIntoGroup 夹入界内（共享守卫：组宽高
      //    不可用/退化时跳过夹取——与 Task 14 拖拽路径的守卫同源）。
      const rel = auto
        ? { x: absX - gp.x, y: absY - gp.y }
        : clampChildIntoGroup(
            { x: absX - gp.x, y: absY - gp.y }, childSize,
            { width: group.width, height: group.height },
          );
      return {
        nodes: st.nodes.map((n) =>
          n.id === nodeId ? { ...n, parentId: groupId, position: rel } : n),
      };
    });
    if (oldParent && node.parentId !== groupId && oldParent.type === 'group'
      && !get().nodes.some((c) => c.parentId === oldParent.id)) {
      // 源组善后（v5）：失去最后子 → 解组（对齐删除路径语义；plan 原文 ungroupForce 已随 Task 11
      //  v6 级联裁决撤销——现场改调 ungroup，已验证其空组路径无子排序依赖不会炸）；
      // 仍有子 → 源组收缩归收尾差分首行 reconcile('cs')（O0b-5 帧写单写者）
      get().ungroup(oldParent.id);
    }
    dispatchProjectionDiff(before, Origin.LocalUser);
  },

  /** O0c-3 attachMember：分镜组纯成员原语（membership=内容真源、cells=槽序——卡三）。分镜入格
   *  唯一通道（addToGroup/dropIntoGroup 公开面已挂分镜组守卫，与本法双向互斥）：
   *  ① cs membership 写（parentId/position 归零——分镜子坐标无意义，mergeStoryboard/
   *    addImageToStoryboardCell 同款；去闸门终裁 43：cs 节点无 extent 键）；② 首空槽入格（cells 经 patchGroupData 单 set 单
   *    updateNodeData intent）；③ doc membership 信封（updateNodeEnvelope{parentId, position:
   *    undefined}——分镜子无 position 键集表，顶层入格前的 position 剥键走本 intent）。
   *  满员/非分镜组/非法入参 → null 零写（溢出处置=caller 策略——dropImageIntoStoryboard 落组旁）。 */
  attachMember: (groupId, nodeId) => {
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    const node = s.nodes.find((n) => n.id === nodeId);
    if (!group || group.type !== 'group' || !node || node.type === 'group' || node.parentId === groupId) return null;
    const gd = group.data as any;
    if (gd.groupType !== 'storyboard') return null;   // 纯分镜成员原语——普通组走 addToGroup/dropIntoGroup
    const cfg = resolveStoryboardConfig(gd);
    const capacity = cfg.gridRows * cfg.gridCols;
    const cells = [...(gd.cells ?? [])];
    let slot = -1;
    for (let idx = 0; idx < Math.max(capacity, cells.length); idx++) {
      if (!cells[idx]) { slot = idx; break; }
    }
    if (slot < 0 || slot >= capacity) return null;    // 满员——零写
    setWithParentOrder((st) => ({
      nodes: st.nodes.map((n) =>
        n.id === nodeId ? { ...n, parentId: groupId, position: { x: 0, y: 0 } } : n),
    }));
    while (cells.length < slot) cells.push(null);
    cells[slot] = nodeId;
    get().patchGroupData(groupId, { cells });
    dispatchCanvasIntent(
      { type: 'updateNodeEnvelope', id: nodeId, patch: { parentId: groupId, position: undefined } },
      Origin.LocalUser,
    );
    return slot;
  },

  /** Inner 化（Spec B）：移出组纯变更核——见接口 JSDoc。 */
  removeNodeFromGroupInner: (groupId, nodeId) => {
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    if (!group) return null;
    const gp = group.position;
    const gd = group.data as Record<string, unknown>;
    let cellsClear: (string | null)[] | null = null;
    if (gd.groupType === 'storyboard') {
      // O0c-3 分镜移出三坏收口：①cells 清槽（槽=null——membership[parentId]与槽序[cells]两通道
      //   同步断开；此前槽位残留⇒GroupNode cellNodes 谓词漏渲染已移出节点）；②落位=
      //   placementBesideGroup 共享（基准=cs 派生帧 calcStoryboardSize——与 resizeStoryboardGrid
      //   溢出同源）；③出格信封 wh=当前格尺寸（O0b-2 终裁 78④——非入格旧值）。分镜组帧=config
      //   权威不动；与普通分支共用薄壳 dispatchProjectionDiff 尾（棘轮调用点数不增）。
      const cfg = resolveStoryboardConfig(gd);
      const size = calcStoryboardSize(cfg.gridRows, cfg.gridCols, cfg.aspectRatio);
      const cells = [...(gd.cells as (string | null)[] ?? [])];
      const slot = cells.indexOf(nodeId);
      if (slot >= 0) { cells[slot] = null; cellsClear = cells; }   // 清槽非紧凑前移——cells=槽序语义（resize keep 切片同族）
      set((st) => ({
        nodes: st.nodes.map((n) => n.parentId === groupId && n.id === nodeId
          ? { ...n, parentId: undefined,
              position: placementBesideGroup({ x: gp.x, y: gp.y, width: size.width }),
              width: normalizeSize(size.cellWidth), height: normalizeSize(size.cellHeight) }
          : n),
      }));
    } else {
      set((st) => ({
        nodes: st.nodes.map((n) => n.parentId === groupId && n.id === nodeId
          ? { ...n, parentId: undefined,
              position: { x: n.position.x + gp.x, y: n.position.y + gp.y } }
          : n),
      }));
    }
    return cellsClear;
  },

  removeNodeFromGroup: (groupId, nodeId) => {
    // R4 守卫收窄（Inner 化批）：组内执行中守卫移除——新家=B5'-2 松手路由预检（单一路由）
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    if (!group) return;
    // 批4b-2 换芯：差分快照→出组信封删键+abs 还原+组框收缩经 dispatchProjectionDiff 落 doc
    const before = captureStoreProjection();
    const cellsClear = get().removeNodeFromGroupInner(groupId, nodeId);
    // G1：移出后组框收缩归下方差分首行 reconcile('cs')（O0b-5 帧写单写者——manual/折叠/分镜档恒不动）
    dispatchProjectionDiff(before, Origin.LocalUser);
    // cells 清槽在信封差分之后（O0c-3 序）：反序会让 cells intent 漏斗尾 reconcile('doc') 以 doc 旧
    // wh 回写 cs（写域③），吞掉出格 wh——出组信封先落 doc 再清槽则末次 reconcile 读到新 wh
    if (cellsClear) get().patchGroupData(groupId, { cells: cellsClear });
    // v5 C2：移出最后子 → normal 空组解组（对齐删空自动解组语义；storyboard 组不受此规则）
    const after = get();
    const g = after.nodes.find((n) => n.id === groupId);
    if (g?.type === 'group' && (g.data as any)?.groupType === 'normal'
      && !after.nodes.some((n) => n.parentId === groupId)) {
      get().ungroup(groupId);
      return; // ungroup 自带 dispatchProjectionDiff——hidden 清理由其 diff 首行 reconcile 全域覆盖（O0b-4）
    }
  },

  /** Inner 化（Spec B）：拖放入组纯变更核——见接口 JSDoc。 */
  dropIntoGroupInner: (nodeId, groupId) => {
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    if (!group) return;
    const node = s.nodes.find((n) => n.id === nodeId);
    if (!node || node.type === 'group' || node.parentId === groupId) return;  // 守卫同 addToGroup（已在组 no-op）
    const gp = group.position;
    // 跨组：node.position 是相对旧父的 rel——先还原绝对坐标（守卫同 addToGroup）
    let absX = node.position.x, absY = node.position.y;
    const oldParent = node.parentId ? s.nodes.find((n) => n.id === node.parentId) : undefined;
    if (oldParent && node.parentId !== groupId) {
      absX += oldParent.position.x; absY += oldParent.position.y;
    }
    const childSize = { width: node.width ?? DEFAULT_CHILD_SIZE.width,      // v6 纪律三：无 measured
                        height: node.height ?? DEFAULT_CHILD_SIZE.height };
    // O0b-5：auto 判定=isContentDerivedFrame（shouldAutoRefit 退役——addToGroup 同款）
    const auto = isContentDerivedGroup(group);
    setWithParentOrder((st) => {
      // 命令体仅 placement 域新子位写（addToGroup 同款——组帧零写）：auto 组扩框归收尾差分首行
      // reconcile('cs') 派生（既有成员绝对守恒 F33）；manual/折叠/分镜组帧一字不改、rel 夹入界内。
      const rel = auto
        ? { x: absX - gp.x, y: absY - gp.y }
        : clampChildIntoGroup(
            { x: absX - gp.x, y: absY - gp.y }, childSize,
            { width: group.width, height: group.height },
          );
      return {
        nodes: st.nodes.map((n) =>
          n.id === nodeId ? { ...n, parentId: groupId, position: rel } : n),
      };
    });
    if (oldParent && node.parentId !== groupId && oldParent.type === 'group'
      && !get().nodes.some((c) => c.parentId === oldParent.id)) {
      // 源组善后（同 addToGroup——ungroup 对空组安全）；仍有子 → 源组收缩归收尾差分首行 reconcile('cs')
      get().ungroup(oldParent.id);
    }
  },

  dropIntoGroup: (nodeId, groupId) => {
    // R4 守卫收窄（Inner 化批）：组内执行中守卫移除——新家=B5'-2 松手路由预检（单一路由）
    const s = get();
    let group = s.nodes.find((n) => n.id === groupId);
    if (!group) return;
    const node = s.nodes.find((n) => n.id === nodeId);
    if (!node || node.type === 'group' || node.parentId === groupId) return;  // 守卫同 addToGroup（已在组 no-op）
    // O0c-3 公开面 groupType 守卫（同 addToGroup）：分镜组成员写唯一通道=attachMember——拒零写
    // （先于折叠展开——分镜组不可折叠，toggleCollapse 亦 no-op，守卫前置保语义零写）
    if ((group.data as any).groupType === 'storyboard') return;
    if ((group.data as any).collapsed) get().toggleCollapse(groupId); // 折叠态先展开（B5'-2：预检/折叠展开留在本函数体单层）
    group = get().nodes.find((n) => n.id === groupId);   // 展开三分派可能重算组框——重读防 gp 陈旧
    if (!group) return;
    // 批4b-2 换芯：差分快照→入组信封+新子 rel 经 dispatchProjectionDiff 落 doc（addToGroup 同款；
    // 前置 toggleCollapse 展开自带 dispatch，与本差分幂等）
    const before = captureStoreProjection();
    get().dropIntoGroupInner(nodeId, groupId);
    dispatchProjectionDiff(before, Origin.LocalUser);
  },

  /** Inner 化（Spec B）：分镜落图纯变更核——见接口 JSDoc。零命中分支（非完成图/其他类型/空展开）
   *  早退零写——薄壳收尾差分零差异短路（无 transact）。 */
  dropImageIntoStoryboardInner: (groupId, nodeId) => {
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    const node = s.nodes.find((n) => n.id === nodeId);
    if (!group || !node) return;
    const gd = group.data as any;
    if (gd.groupType !== 'storyboard') return;

    const cfg = resolveStoryboardConfig(gd);
    const capacity = cfg.gridRows * cfg.gridCols;
    const cells = [...(gd.cells ?? [])];
    const gp = group.position;
    const gw = group.width ?? 0;

    // 判断节点类型
    if (node.type === 'multiImageGen') {
      // multiImageGen：展开成功图片逐个填充
      const nd = node.data as any;
      const successImages = nd.images?.filter((i: any) => i.status === 'success') ?? [];
      if (successImages.length === 0) return;

      // 预生成所有新节点 ID（P1-新5 convention）
      const newIds = successImages.map(() => getId('node'));

      // 构造新节点（复用 T10 mergeStoryboard 展开模式）
      const expandedNodes: Node[] = [];
      const overflowNodes: Node[] = [];
      let filledCount = 0;

      for (let i = 0; i < successImages.length; i++) {
        const img = successImages[i];
        const id = newIds[i];
        const newNode: Node = {
          id, type: 'imageGen', parentId: groupId,
          position: { x: 0, y: 0 }, width: 320, height: 180,
          data: { status: 'done', fileId: img.id, __fromMulti: nodeId },
          selected: false,
        } as Node;

        // 找第一个空位
        let emptyIdx = -1;
        for (let idx = 0; idx < Math.max(capacity, cells.length); idx++) {
          if (!cells[idx]) { emptyIdx = idx; break; }
        }

        if (emptyIdx >= 0 && emptyIdx < capacity) {
          // 入组：补 null 到空位索引
          while (cells.length < emptyIdx) cells.push(null);
          cells[emptyIdx] = id;
          expandedNodes.push(newNode);
          filledCount++;
        } else {
          // 溢出：排在组右侧（placementBesideGroup 共享——O0c-3 与移出/减格溢出同源）
          const overflowIdx = i - filledCount;
          overflowNodes.push({
            ...newNode,
            parentId: undefined,
            position: placementBesideGroup({ x: gp.x, y: gp.y, width: gw }, overflowIdx),
          });
        }
      }

      // 写入 store
      const ns = useNodeStore.getState();
      set((st) => ({
        nodes: [
          ...st.nodes.filter((n) => n.id !== nodeId && n.id !== groupId),
          ...expandedNodes,
          ...overflowNodes,
          group,
        ],
        edges: st.edges,
      }));
      get().patchGroupData(groupId, { cells });

      // 双写 nodeStore
      for (const e of expandedNodes) {
        ns.addNode({ id: e.id, type: 'imageGen', data: e.data as any });
      }
      for (const o of overflowNodes) {
        ns.addNode({ id: o.id, type: 'imageGen', data: o.data as any });
      }
      ns.deleteNode(nodeId);

      if (overflowNodes.length > 0) {
        message.info(`分镜组已满，${overflowNodes.length} 张图片已放在组旁`);
      }
    } else if (node.type === 'imageGen' || node.type === 'imageExtGen') {
      // imageGen/imageExtGen 完成态
      const nd = node.data as any;
      if (nd.status !== 'done') return;

      // O0c-3：入格=attachMember 纯成员原语（membership+首空槽一体——addToGroup 公开面已挂分镜组
      // 守卫，旧 addToGroup+cells 两段写通道退役）；满员返回 null → 溢出落组旁（placementBesideGroup
      // 共享——基准=cs 派生帧[组 position+cs 帧 width]，与 removeNodeFromGroup/resizeStoryboardGrid 同源）
      if (get().attachMember(groupId, nodeId) == null) {
        set((st) => ({
          nodes: st.nodes.map((n) =>
            n.id === nodeId ?
              { ...n, parentId: undefined,
                position: placementBesideGroup({ x: gp.x, y: gp.y, width: gw }) } :
              n
          ),
        }));
        message.info('分镜组已满，图片已放在组旁');
      } else if (node.parentId && node.parentId !== groupId) {
        // 源组善后（addToGroup 同款，随 addToGroup 通道退役移此）：跨组拖入失去最后子 → 解组
        //（ungroup 对空组安全）；仍有子 → 源组收缩归收尾差分首行 reconcile('cs')。原语零善后是
        // 刻意分层（纯成员写——策略归 caller）。
        const oldParent = s.nodes.find((n) => n.id === node.parentId);
        if (oldParent?.type === 'group'
          && !get().nodes.some((c) => c.parentId === oldParent.id)) {
          get().ungroup(oldParent.id);
        }
      }
    } else {
      // 非完成图/其他类型：不处理
      return;
    }
  },

  dropImageIntoStoryboard: (groupId, nodeId) => {
    if (get().hasActiveProcessInGroup(groupId)) {
      message.warning('组内有节点正在执行，请等待完成后再操作');
      return;
    }
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    const node = s.nodes.find((n) => n.id === nodeId);
    if (!group || !node) return;
    // 分镜域守卫①：非分镜组拒零写
    if ((group.data as any).groupType !== 'storyboard') return;
    // 分镜域守卫②（载荷域）：零命中路径（multiImage 无成功图/完成图未完成/其他类型）早退零写零
    // diff——空 diff 也免（diff 首行 reconcile('cs') 的 DEV config 门对旧克隆缺 config 组会抛，
    // F2 契约"克隆体上 store 命令不崩"；与旧分支内 return 同构，Inner 内同款守卫为直调防御）
    const nd = node.data as any;
    if (node.type === 'multiImageGen') {
      if (!(nd.images ?? []).some((i: any) => i.status === 'success')) return;
    } else if (node.type === 'imageGen' || node.type === 'imageExtGen') {
      if (nd.status !== 'done') return;
    } else {
      return;
    }
    // 批4b-2 换芯：差分快照（multiImage 分支的展开+删源/溢出移位经收尾差分单 transact 落 doc；
    // imageGen 分支的 attachMember 自带 dispatch[cells+信封]，差分幂等收其余）
    const before = captureStoreProjection();
    get().dropImageIntoStoryboardInner(groupId, nodeId);
    dispatchProjectionDiff(before, Origin.LocalUser);
  },

  mergeStoryboard: (nodeIds) => {
    const s = get();
    const picked = s.nodes.filter((n) => nodeIds.includes(n.id));
    if (picked.length < 2) throw new Error('合并分镜组至少需要 2 个节点');
    if (picked.some((n) => !isImageCompletedNode(n))) {
      throw new Error('分镜组仅支持含完成图片的节点');
    }
    // 0. 先生成组 id：展开节点构造时即挂组（若构造后再追加，map 分支覆盖不到新增节点 → parentId 永远缺失）
    const gid = getId('node');
    // 1. 展开 multiImageGen → 独立隐藏 imageGen 节点
    const expanded: Node[] = [];
    const kept: Node[] = [];
    for (const n of picked) {
      const d = n.data as any;
      if (n.type === 'multiImageGen') {
        for (const img of d.images.filter((i: any) => i.status === 'success')) {
          const id = getId('node');
          expanded.push({
            id, type: 'imageGen', parentId: gid,
            // 暂留原 multi 位置：字典序排序依据（P1-新1——若归零则展开图永远插队排最前）；
            // 追加进 nodes 时统一归零（分镜组子节点坐标无意义）
            position: { x: n.position.x, y: n.position.y }, width: 320, height: 180,
            data: { status: 'done', fileId: img.id, __fromMulti: n.id },
            selected: false,
          } as Node);
        }
      } else {
        kept.push(n);
      }
    }
    const expandedIds = expanded.map((e) => e.id);
    const multiIdsToRemove = picked.filter((n) => n.type === 'multiImageGen').map((n) => n.id);
    const allNodeIds = [...nodeIds, ...expandedIds, gid];
    const images = [...kept, ...expanded];
    // 2. 字典序排序 + 智能宫格
    const sorted = sortNodesByPosition(images.map((n) => ({ ...n, positionX: n.position.x, positionY: n.position.y })))
      .map((n) => (n as any).id);
    const { rows, cols } = calcDefaultGrid(sorted.length);
    // 3. 组中心对齐选中区域中心
    const cx = images.reduce((sum, n) => sum + n.position.x + (n.width ?? 320) / 2, 0) / images.length;
    const cy = images.reduce((sum, n) => sum + n.position.y + (n.height ?? 180) / 2, 0) / images.length;
    const size = calcStoryboardSize(rows, cols, '16:9');
    // 配置型组框直写（§4.8 v11 S2 裁决，O0b-5 保留前写）：frame=calcStoryboardSize 单源；与子 rel
    // 归零同 setWithParentOrder 事务（拆两次 setState 分写闪烁）——保持原事务结构
    const groupNode: Node = {
      id: gid, type: 'group',
      position: { x: cx - size.width / 2, y: cy - size.height / 2 },
      width: size.width, height: size.height, selected: true,
      data: {
        groupType: 'storyboard', name: `分镜组 ${sorted.length} 个节点`, cells: sorted,
        storyboard: { aspectRatio: '16:9', gridRows: rows, gridCols: cols, showIndex: false, stitchResolution: '2K' },
      },
    };
    // 批4b-2 换芯：差分快照→组建+展开节点+入组信封+multi 删经 dispatchProjectionDiff 单 transact 落 doc
    const before = captureStoreProjection();
    setWithParentOrder((st) => ({
      nodes: [
        ...st.nodes
          .filter((n) => !(n.type === 'multiImageGen' && nodeIds.includes(n.id)))
          .map((n) => images.some((i) => i.id === n.id)
            ? { ...n, selected: false, parentId: gid,
                position: { x: 0, y: 0 } } // 分镜组子节点坐标无意义（纯 DOM 宫格渲染），归零
            : { ...n, selected: false }),
        ...expanded.map((e) => ({ ...e, position: { x: 0, y: 0 } })), // 排序已完成，入组归零
        groupNode,
      ],
      selectedId: gid,
    }));
    useNodeStore.getState().addNode({ id: gid, type: 'group', data: groupNode.data as any });
    // 双写补全：展开的新节点写入 nodeStore；被移除的 multiImageGen 原节点同步删除（双 store 一致）
    const ns = useNodeStore.getState();
    for (const e of expanded) {
      ns.addNode({ id: e.id, type: 'imageGen', data: e.data as any });
    }
    for (const n of picked) {
      if (n.type === 'multiImageGen') ns.deleteNode(n.id);
    }
    dispatchProjectionDiff(before, Origin.LocalUser);
    return gid;
  },

  convertGroup: (groupId, target) => {
    if (get().hasActiveProcessInGroup(groupId)) {
      message.warning('组内有节点正在执行，请等待完成后再操作');
      return;
    }
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    if (!group) return;
    const gd = group.data as any;
    const childIds = s.nodes.filter((n) => n.parentId === groupId).map((n) => n.id);
    // 批4b-2 换芯：差分快照→组框配置化+子归零/网格重排+data 键迁移经 dispatchProjectionDiff 落 doc
    // （patchGroupData 的变更收在差分内，自带 dispatch 部分幂等；组帧重算=差分首行
    //  reconcile('cs') 派生——帧写者=deriveGroupFrame 单源）
    const before = captureStoreProjection();

    if (target === 'storyboard') {
      const children = s.nodes.filter((n) => n.parentId === groupId);
      if (children.some((n) => !isImageCompletedNode(n))) {
        throw new Error('仅包含图片节点的组可转为分镜组');
      }
      // 复用 mergeStoryboard 的宫格逻辑，但保留原组 id 与位置
      const sorted = sortNodesByPosition(children.map((n) => ({ ...n, positionX: n.position.x + group.position.x, positionY: n.position.y + group.position.y })))
        .map((n) => (n as any).id);
      const { rows, cols } = calcDefaultGrid(sorted.length);
      const size = calcStoryboardSize(rows, cols, '16:9');
      const cx = group.position.x + (group.width ?? 0) / 2;
      const cy = group.position.y + (group.height ?? 0) / 2;
      // 配置型组框直写（§4.8 v11 S2 裁决，O0b-5 保留前写）：frame=calcStoryboardSize 单源；与子
      // rel 归零同 setWithParentOrder 事务（拆两次 setState 分写闪烁）——保持原事务结构
      setWithParentOrder((st) => ({
        nodes: st.nodes.map((n) => {
          if (n.id === groupId) return { ...n, type: 'group', position: { x: cx - size.width / 2, y: cy - size.height / 2 },
            width: size.width, height: size.height };
          // hidden 写入侧不变量（v2.1）：转分镜⇒子节点 selected 清 false（同 toggleCollapse 折叠分支）
          if (n.parentId === groupId) return { ...n, position: { x: 0, y: 0 }, selected: false };
          return n;
        }),
      }));
      // F18：增量 patch（name 非空保留；collapsed undefined=删除键——分镜组不可折叠；旧折叠快照
      // 键已随 O0c-3 全链删，清键面收窄至折叠键）
      get().patchGroupData(groupId, {
        groupType: 'storyboard', cells: sorted,
        storyboard: { aspectRatio: '16:9', gridRows: rows, gridCols: cols, showIndex: false, stitchResolution: '2K' },
        nameCustom: false,
        name: (gd.name && gd.name.trim()) || `分镜组 ${sorted.length} 个节点`,
        collapsed: undefined,
      });
    } else {
      // 分镜组 → 普通组：cells 顺序网格重排
      const cfg = resolveStoryboardConfig(gd);
      const cellW = CELL_WIDTH;
      const ratioKey = cfg.aspectRatio as keyof typeof ASPECT_RATIO_MAP;
      const cellH = CELL_WIDTH / ASPECT_RATIO_MAP[ratioKey];
      // F38 sizeOf 契约：同 ungroup——悬空 cells 项回落基准防 TypeError
      const byId = new Map(s.nodes.map((n) => [n.id, n]));
      const sizeOf = (id: string): { width: number; height: number } => {
        const n = byId.get(id) as any;
        return n ? { width: n.width ?? cellW, height: n.height ?? cellH } : { width: cellW, height: cellH };
      };
      // F38：转换保留子自身尺寸——只重排 position（placeGrid v5 槽位语义：null/悬空按基准占格不塌陷）
      const pos = placeGrid(gd.cells ?? [], cfg.gridCols, cellW, cellH, sizeOf);
      setWithParentOrder((st) => ({
        nodes: st.nodes.map((n) => {
          const p = pos.get(n.id);
          if (!p || n.parentId !== groupId) return n;
          return { ...n, position: p };
        }),
      }));
      // F18：增量 patch（name 非空保留；storyboard/cells/nameCustom/collapsed 等删除键——旧折叠
      // 快照键已随 O0c-3 全链删）
      get().patchGroupData(groupId, {
        groupType: 'normal',
        name: (gd.name && gd.name.trim()) || '分组',
        nameCustom: undefined, storyboard: undefined, cells: undefined,
        collapsed: undefined,
      });
      // 组框重算（守恒）归下方差分首行 reconcile('cs')——auto 组从子 abs（网格 rel+组原点）重派生
      // bbox+padding、子 rel 随新 origin 重基（O0b-5 帧写单写者）
    }
    dispatchProjectionDiff(before, Origin.LocalUser);
  },

  /** 组 data 唯一通道（§4.7）：增量合并；undefined=delete。只写 cs——所有权单一
   *  （F42：镜像 syncGroupDataToNodeStore 已删，ns 无组 data，投影组取 cs）。
   *  批4b-2 换芯：doc 面经 updateNodeData intent（undefined=删键约定两端同构；投影对组节点
   *  写 ns 组条目——同值幂等，投影读取面（F42）不受影响）。
   *  ⚠️ O0b-4 起无配对义务：hidden 派生已并入 reconcile 单内核（cs 先写后 dispatch——漏斗尾
   *  reconcile 读 cs 活值即时派生；repairStoryboardCells 整删，membership 守卫=写侧断言）。 */
  patchGroupData: (groupId, patch) => {
    get().patchGroupDataInner(groupId, patch);
    dispatchCanvasIntent({ type: 'updateNodeData', id: groupId, patch }, Origin.LocalUser);
  },

  /** 组 data 纯写层（v2.1 拆层）：合并+物理删键，零 dispatch——runCommand.fn 内专用
   *  （外层 patchGroupData=本层先写+正向 intent dispatch 后发——O0b-4 序：漏斗尾 reconcile
   *  的 hidden 派生读 cs 活值；runCommand.fn 契约"纯写层"不变）。 */
  patchGroupDataInner: (groupId, patch) => {
    set((st) => ({
      nodes: st.nodes.map((n) => {
        if (n.id !== groupId) return n;
        const merged = { ...n.data, ...patch };
        for (const k of Object.keys(patch)) if ((patch as any)[k] === undefined) delete (merged as any)[k];
        return { ...n, data: merged };
      }),
    }));
  },

  renameGroup: (groupId, name) => {
    const final = name.trim() || '分组';
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    if (!group || (group.data as any).name === final) return;
    // 2d-6：runCommand 包装（spec:169 五命令之一）——fn 内走纯写层 patchGroupDataInner；
    // nameCustom 恒 true（空名兜底『分组』同样是用户命名意图——2d-5 标题层据此切用户名）
    get().runCommand(() => { get().patchGroupDataInner(groupId, { name: final, nameCustom: true }); });
  },

  /** 2d-6 右键重命名请求（UI 瞬态信号，不入 doc）：GroupContextMenu「重命名」→ CanvasView →
   *  本字段；NormalGroupRenderer 消费进编辑态（编辑态本态在组件内——跨树经此触达，与双击共享；
   *  nonce 递增防同组重放不触发）。 */
  renameRequest: null,
  requestGroupRename: (groupId) => {
    set((st) => ({ renameRequest: { groupId, nonce: (st.renameRequest?.nonce ?? 0) + 1 } }));
  },

  /** R2c-3 组色写点（R2 新命令唯一入口 runCommand 包装）：fn 内走纯写层 patchGroupDataInner——
   *  禁 patchGroupData（其正向 dispatch + 外层差分=同值双 transact）；undefined=清色
   *  （patchGroupDataInner undefined=delete-key 语义）。 */
  setGroupColor: (groupId, key) => {
    if (key !== undefined && !(key in GROUP_COLOR_MAP)) return;
    get().runCommand(() => { get().patchGroupDataInner(groupId, { color: key }); });
  },

  /** Inner 化（Spec B）：折叠/展开纯变更核——见接口 JSDoc（O0b-4 序：cs 先写后 dispatch 由薄壳承接）。 */
  toggleCollapseInner: (groupId, collapsing) => {
    get().patchGroupDataInner(groupId, { collapsed: collapsing });
    if (collapsing) {
      // hidden 写入侧不变量（v2.1）：折叠⇒子节点 selected 清 false（selected 不进投影——
      // B 端 stale selected+hidden 形态由显示侧读点过滤兜，SelectionBoxOverlay）
      set((st) => ({
        nodes: st.nodes.map((n) => (n.parentId === groupId ? { ...n, selected: false } : n)),
      }));
    }
  },

  /** O0b-5 单意图化（终裁 82——折叠分支 envelope 写删）：折叠/展开=唯 [updateNodeData{collapsed}]
   *  单意图单 transact 落 doc。doc 帧三键=展开态密封源全程不动（manual 读回/auto 折叠态本无键）；
   *  cs 折叠渲染档=COLLAPSED_SIZE 由 reconcile 写域① collapsed 档派生（优先级最高）——本 action
   *  零帧写；展开=manual 读 doc 三键/auto 重派生 bbox（旧展开三分派模块消费已删——展开帧模块
   *  已随 O0c-3 整删）。快照语义由密封帧三键承担（旧折叠快照键已全链删除）。
   *  viewer 折叠=本地视图折叠（终裁 58⑥）：只读档写 localCollapsed 渲染层 override（UI 瞬态零
   *  doc/投影写——功能保留非禁用；O0b-4"只读 no-op"锚=nodes 零变化保持）。 */
  toggleCollapse: (groupId) => {
    const g0 = get().nodes.find((n) => n.id === groupId);
    if (!g0) return;
    const d0 = g0.data as Record<string, unknown>;
    // v2.2 分镜组不可折叠：双向 no-op（折叠/展开均拒——store 半开闭环；渲染侧 GroupToolbar
    // 折叠按钮仅在 normal 分支渲染，本守卫堵程序化/脏数据路径）——先于 canEdit（只读档同拒）
    if (d0.groupType === 'storyboard') return;
    if (!canEdit(get())) {
      // O0b-5 viewer 折叠最小落地：localCollapsed[id]=有效折叠态翻转（undefined 走 data.collapsed
      // 初值）；nodes/doc 零写（只读折叠不再产生 cs 与 doc 分叉——子 hidden 派生消费面归 O0c）
      set((st) => ({
        localCollapsed: { ...st.localCollapsed, [groupId]: !(st.localCollapsed[groupId] ?? d0.collapsed === true) },
      }));
      return;
    }
    const collapsing = d0.collapsed !== true;
    // O0b-4 序：cs 先写后 dispatch——漏斗尾 reconcile 的 hidden 派生读 cs 活值
    // （原序 dispatch→cs 写会让漏斗尾读到旧 data，折叠 hidden 断链）
    get().toggleCollapseInner(groupId, collapsing);
    dispatchCanvasIntent({ type: 'updateNodeData', id: groupId, patch: { collapsed: collapsing } }, Origin.LocalUser);
  },

  // O0b-5（Spec B）：applyGroupFrame/applyGroupFrameRect 两 action 整删（refit 族退役——含
  // refitContentDerivedFrame 内联件）——守恒收缩/重算统一归 diff 首 reconcile('cs')/漏斗尾
  // reconcile('doc') 单写者；配置型组框直写归 mergeStoryboard/convertGroup/resizeStoryboardGrid
  // 命令体前写（S2 裁决保持原事务结构）。

  /** O0b-5 单意图化：改配置=单次 updateNodeData{storyboard} 落 doc（单 transact，零 moveNode/
   *  envelope 意图——applyGroupFrameRect 退役）；cs 帧=reconcile 写域① storyboard 档同 tick 派生
   *  （calcStoryboardSize 单源——非手写派生第二实现）。 */
  updateStoryboardConfig: (groupId, patch) => {
    const g = get().nodes.find((n) => n.id === groupId);
    if (!g) return;
    const cfg = resolveStoryboardConfig({ storyboard: { ...resolveStoryboardConfig(g.data), ...patch } });
    get().patchGroupData(groupId, { storyboard: cfg });
  },

  resizeStoryboardGrid: (groupId, rows, cols) => {
    if (get().hasActiveProcessInGroup(groupId)) {
      message.warning('组内有节点正在执行，请等待完成后再操作');
      return;
    }
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    if (!group) return;
    const gd = group.data as any;
    const capacity = rows * cols;
    const keep = (gd.cells ?? []).slice(0, capacity);
    const overflowIds = (gd.cells ?? []).slice(capacity);
    const gp = group.position;
    const cfg = { ...resolveStoryboardConfig(gd), gridRows: rows, gridCols: cols };
    const size = calcStoryboardSize(rows, cols, cfg.aspectRatio);
    // 批4b-2 换芯：差分快照→组框尺寸+溢出移出（出组信封+abs 落位）经 dispatchProjectionDiff 落 doc
    const before = captureStoreProjection();
    // 配置型组框直写（§4.8 v11 S2 裁决，O0b-5 保留前写）：frame=calcStoryboardSize 单源；与溢出
    // 移出同事务（拆两次 setState，中间态溢出节点仍属组）——保持原事务结构。
    // 溢出 x 用新宽 size.width（旧 gw：cols 增且总容量减时溢出节点落进已加宽的新组框内）
    set((st) => ({
      nodes: st.nodes.map((n) => {
        // P0-新1：绝不能 filter 掉溢出节点——那是删除数据；只做 map 改写（移出组排右侧）
        if (n.id === groupId) {
          return { ...n, width: size.width, height: size.height };
        }
        if (overflowIds.includes(n.id) && n.parentId === groupId) {
          const idx = overflowIds.indexOf(n.id);
          return { ...n, parentId: undefined,
            position: placementBesideGroup({ x: gp.x, y: gp.y, width: size.width }, idx) };
        }
        return n;
      }),
      edges: st.edges, // 溢出节点若有连线已在组内隐藏；解出后 hidden 推导恢复显示
    }));
    get().patchGroupData(groupId, { cells: keep, storyboard: cfg });
    dispatchProjectionDiff(before, Origin.LocalUser);
    if (overflowIds.length > 0) {
      message.info(`${overflowIds.length} 张图片已移出分镜组`);
    }
  },

  clearStoryboard: (groupId) => {
    if (get().hasActiveProcessInGroup(groupId)) {
      message.warning('组内有节点正在执行，请等待完成后再操作');
      return;
    }
    const s = get();
    const cellIds = (s.nodes.find((n) => n.id === groupId)?.data as any)?.cells ?? [];
    // 批4b-2 换芯：差分快照→cells 成员删（级联边删）+cells 清空经 dispatchProjectionDiff 落 doc
    const before = captureStoreProjection();
    set((st) => ({
      nodes: st.nodes.filter((n) => !(cellIds.includes(n.id) && n.parentId === groupId)),
      edges: st.edges.filter((e) => !cellIds.includes(e.source) && !cellIds.includes(e.target)),
    }));
    get().patchGroupData(groupId, { cells: [] });
    cellIds.forEach((id: string) => useNodeStore.getState().deleteNode(id));
    dispatchProjectionDiff(before, Origin.LocalUser);
  },

  addImageToStoryboardCell: (groupId, cellIndex, fileId) => {
    const id = getId('node');
    // 空位用 null 占位（cells: (string | null)[]），语义明确且 filter(Boolean) 安全
    const cells: (string | null)[] = [...(((get().nodes.find((n) => n.id === groupId)?.data as any)?.cells) ?? [])];
    while (cells.length < cellIndex) cells.push(null);
    cells[cellIndex] = id;
    // 批4b-2 换芯：差分快照→槽位建图节点+cells 更新经 dispatchProjectionDiff 落 doc
    const before = captureStoreProjection();
    set((st) => ({
      nodes: st.nodes.concat([{
        id, type: 'imageGen', parentId: groupId,
        position: { x: 0, y: 0 }, width: 320, height: 180,
        data: { status: 'done', fileId }, selected: false,
      } as Node]),
    }));
    get().patchGroupData(groupId, { cells });
    useNodeStore.getState().addNode({ id, type: 'imageGen', data: { status: 'done', fileId } });
    dispatchProjectionDiff(before, Origin.LocalUser);
  },

  removeStoryboardCell: (groupId, cellIndex) => {
    if (get().hasActiveProcessInGroup(groupId)) {
      message.warning('组内有节点正在执行，请等待完成后再操作');
      return;
    }
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    if (!group) return;
    const gd = group.data as any;
    const cells = [...(gd.cells ?? [])];
    if (cellIndex < 0 || cellIndex >= cells.length) return;
    const removedId = cells[cellIndex];
    // 紧凑前移：splice 移除该位，后续自动前移
    cells.splice(cellIndex, 1);
    // 批4b-2 换芯：差分快照→槽成员删（级联边删）+cells 紧凑前移经 dispatchProjectionDiff 落 doc
    const before = captureStoreProjection();
    set((st) => ({
      nodes: st.nodes.filter((n) => n.id !== removedId),
      edges: st.edges.filter((e) => e.source !== removedId && e.target !== removedId),
    }));
    get().patchGroupData(groupId, { cells });
    if (removedId) useNodeStore.getState().deleteNode(removedId);
    dispatchProjectionDiff(before, Origin.LocalUser);
  },

  /** R2a-6 副本薄壳①（选区复制）：ids=原始选集（禁止直通 buildCopyPlan）——入口
   *  participation('duplicate') 裁决（组闭包全量保真+陈旧 hidden 直选排除）→ records 装配
   *  （ns 全量）→ buildCopyPlan 纯映射（offset 模式）→ appendCopyPlan 落位。 */
  duplicateNodes: (ids) => {
    let firstTopId: string | null = null;
    get().runCommand(() => {
      const s = get();
      const buckets = normalizeSelection(s.nodes as any, ids);
      const p = participation(buckets, 'duplicate', s.nodes as any);
      if (p.ids.length === 0) return;
      const plan = buildCopyPlan(
        assembleRecords(p.ids, s.nodes),
        p.ids,
        { offset: DUPLICATE_OFFSET },
        () => getId('node'),
        s.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
      );
      firstTopId = appendCopyPlan(plan);
    });
    return firstTopId;
  },

  /** R2a-6 副本薄壳②：单组复制=薄委托（等价断言钉死——两条路径产物逐键深等除 id） */
  duplicateGroup: (groupId) => get().duplicateNodes([groupId]),

  /** R2a-6 副本薄壳③（复制入剪贴板）：participation('duplicate') 裁决前置，冻结
   *  { records: ns 全量快照, ids: 已裁决闭包, edges: 闭包内互连边 }——粘贴不重取数/重裁决 */
  copyGroupToClipboard: (groupId) => {
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    if (!group) return;
    const buckets = normalizeSelection(s.nodes as any, [groupId]);
    const p = participation(buckets, 'duplicate', s.nodes as any);
    const idSet = new Set(p.ids);
    // 剪贴板存冻结快照（防活对象别名随源变更污染粘贴）
    groupClipboard = structuredClone({
      records: assembleRecords(p.ids, s.nodes),
      ids: [...p.ids],
      edges: s.edges
        .filter((e) => idSet.has(e.source) && idSet.has(e.target))
        .map((e) => ({ id: e.id, source: e.source, target: e.target })),
    });
  },

  /** R2a-6 副本薄壳④（粘贴）：不重裁决（clipboard 冻结成员/hidden 态——重裁决会在粘贴点再次
   *  排除已变 hidden 态丢成员）；position=flow 坐标（screenToFlowPosition 换算在调用点），经
   *  buildCopyPlan position 模式锚定首个顶层副本整选平移。 */
  pasteGroupClipboard: (position) => {
    if (!groupClipboard) return null;
    let firstTopId: string | null = null;
    get().runCommand(() => {
      if (!groupClipboard) return;
      const plan = buildCopyPlan(
        groupClipboard.records,
        groupClipboard.ids,
        { position },
        () => getId('node'),
        groupClipboard.edges,
      );
      firstTopId = appendCopyPlan(plan);
    });
    return firstTopId;
  },

  hasGroupClipboard: () => groupClipboard !== null,
  };
});
