import { create } from 'zustand';
import {
  type Node, type Edge, type XYPosition,
  applyNodeChanges, applyEdgeChanges,
  type NodeChange, type EdgeChange, type Connection,
} from '@xyflow/react';
import { useNodeStore, IMAGE_EXT_DEFAULTS } from './nodeStore';
import type { ImageItem, AiToolId } from './nodeStore';
import type { MaterialFile } from '@flowweb/shared';
import type { StoryboardConfig } from '@/types/group';
import { message } from 'antd';
import { loadImage, splitImageToBlobs, scaleToMaxSize, validateGridParams, isSubImageTooSmall, MIN_SUB_IMAGE_PX } from '@/utils/imageSplit';
import { uploadSplitBlobs } from '@/utils/splitUploadService';
import { getMediaUrl } from '@/api/mediaApi';
import { deleteProjectByNode } from '@/api/videoProjectApi';
import { deriveHidden, repairStoryboardCells } from '@/utils/groupDerive';
import { ensureParentOrder } from '@/utils/nodeOrder';
import { canEdit } from './syncStatus';
// 批4b-2：auto 边确定性 id 判定（addEdge/removeEdge 的 origin 分流——AutoEdge 不入撤销栈契约）
import { isAutoEdgeId } from './autoEdgeIds';
// 批4b-1 换芯（门 C 裁决·意图漏斗）：协作语义写点经 dispatchCanvasIntent doc 直写+投影回填。
// 批4b-2（组 2 收口）：复合信封写点经 captureStoreProjection/dispatchProjectionDiff 差分换芯
// （before/after 差分翻译 intent 序列——旧 bindBridge 全量同步的增量形态，删除半边=显式成员差）。
// 循环依赖裁定：canvasIntents↔canvasStore/nodeStore 互为顶层 import 声明，action 体运行时才调——安全。
import { dispatchCanvasIntent, captureStoreProjection, dispatchProjectionDiff, type CanvasIntent } from './canvasIntents';
import { Origin } from './canvasUndo';
import { calcGroupBounds, CELL_WIDTH, ASPECT_RATIO_MAP, sortNodesByPosition, calcDefaultGrid, calcStoryboardSize, COLLAPSED_SIZE, DEFAULT_CHILD_SIZE, refitGroupGeometry, shouldAutoRefit, clampChildIntoGroup } from '@/utils/groupLayout';
import { isImageCompletedNode } from '@/utils/imageNodeGuards';
import { resolveStoryboardConfig } from '@/utils/storyboardConfig';
import { placeGrid } from '@/utils/groupGeometry';

let counter = 0;
function getId(prefix: string) {
  return `${prefix}_${Date.now()}_${++counter}`;
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

// Module-level clipboard for group copy/paste
let groupClipboard: { group: Node; children: Node[]; innerEdges: Edge[] } | null = null;

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
  /** WS 侧唯一鉴权载体（批2-1 立字段；reason 五档 CollabAuthReason 落 shared 后收紧类型——批3 接入） */
  wsAuthNotice: { reason: string; terminal: boolean } | null;
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

  addNode: (type: string, position: XYPosition, dataOverride?: Record<string, unknown>) => string;
  copyNode: (id: string) => string | null;
  addChildNode: (sourceId: string, data: Record<string, unknown>) => string | null;
  addChildNodes: (sourceId: string, nodeDataList: AddChildNodeItem[], options?: AddChildNodesOptions) => string[];
  addNodeWithEdge: (sourceId: string) => string | null;
  addEdge: (source: string, target: string, sourceHandle?: string, targetHandle?: string, deterministicId?: string) => string;
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
  applyGroupDerivations: () => void;
  startNodeProcess: (nodeId: string, processType: ProcessType, abortController?: AbortController) => void;
  updateNodeProcessProgress: (nodeId: string, progress: number) => void;
  finishNodeProcess: (nodeId: string, status: 'done' | 'error', errorMsg?: string) => void;
  cancelNodeProcess: (nodeId: string) => void;
  groupNodes: (nodeIds: string[]) => string;
  ungroup: (groupId: string) => void;
  addToGroup: (groupId: string, nodeId: string) => void;
  removeNodeFromGroup: (groupId: string, nodeId: string) => void;
  renameGroup: (groupId: string, name: string) => void;
  markManuallyResized: (groupId: string) => void;
  toggleCollapse: (groupId: string) => void;
  patchGroupData: (groupId: string, patch: Record<string, unknown>) => void;
  /** 组几何唯一写者——重算型入口（§4.8 v11）：守卫+epsilon，见实现。 */
  applyGroupFrame: (groupId: string) => void;
  /** 配置型唯一出口（§4.8 v11）：frame 由 calcStoryboardSize 等配置公式算得，直写组框（无守恒语义）。 */
  applyGroupFrameRect: (groupId: string, frame: { x: number; y: number; width: number; height: number }) => void;
  dropIntoGroup: (nodeId: string, groupId: string) => void;
  dropImageIntoStoryboard: (groupId: string, nodeId: string) => void;
  mergeStoryboard: (nodeIds: string[]) => string;
  convertGroup: (groupId: string, target: 'normal' | 'storyboard') => void;
  updateStoryboardConfig: (groupId: string, patch: Partial<StoryboardConfig>) => void;
  resizeStoryboardGrid: (groupId: string, rows: number, cols: number) => void;
  clearStoryboard: (groupId: string) => void;
  addImageToStoryboardCell: (groupId: string, cellIndex: number, fileId: string, url?: string) => void;
  removeStoryboardCell: (groupId: string, cellIndex: number) => void;
  duplicateGroup: (groupId: string) => string | null;
  copyGroupToClipboard: (groupId: string) => void;
  pasteGroupClipboard: (position: { x: number; y: number }) => string | null;
  hasGroupClipboard: () => boolean;
}

export const useCanvasStore = create<CanvasState>()((set, get) => {
  // 组结构写入统一包装：对 updater 产出的 nodes 应用父前子后重排
  // （RF v12 updateChildNode 要求父节点在数组中位于子节点前，否则忽略 parentId）
  const setWithParentOrder = (updater: (s: CanvasState) => Partial<CanvasState>) =>
    set((s) => {
      const next = updater(s);
      return { ...next, nodes: ensureParentOrder(next.nodes ?? s.nodes) };
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
  wsAuthNotice: null,
  httpExpired: false,
  connStatus: 'connecting',
  connUi: 'ok',
  editorDirty: false,

  addNode: (type, position, dataOverride) => {
    const id = getId('node');
    const resolvedType = nodeTypeMap[type] || type;
    const baseData: Record<string, unknown> = resolvedType === 'textInput' ? { content: '' }
      : resolvedType === 'imageExtGen' ? { mediaName: '扩展图片', extConfig: { ...IMAGE_EXT_DEFAULTS }, allImages: [] }
      : {};
    const nodeData = dataOverride ? { ...baseData, ...dataOverride } : baseData;
    const node: Node = {
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
    // 批4b-1 换芯：协作语义（doc 首写+投影回填）走意图漏斗——canEdit 假时 dispatch doc+store
    // 双零写，下方 set 走 append 分支 = 既有"readOnly 可加节点后回弹"语义保留同型
    dispatchCanvasIntent({
      type: 'addNode',
      node: {
        id, type: resolvedType, position,
        ...(node.width != null ? { width: node.width } : {}),
        ...(node.height != null ? { height: node.height } : {}),
        data: nodeData,
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
      type: resolvedType,
      data: nodeData as any,
    });
    return id;
  },

  deleteNode: (id) => {
    // 批4b-2：差分快照在 cascade/结构删/组善后全动作之前捕获——收尾 dispatchProjectionDiff
    // 覆盖级联子删+父组框收缩（applyGroupFrame 自身不 dispatch——几何写回统一归调用方差分）。
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
      } else if ((parent.data as any).groupType === 'normal') {
        // 普通组：删空自动解组；仍有子 → 组框收缩（G1——applyGroupFrame 守卫内建）
        if (!after.nodes.some((c) => c.parentId === parent.id)) {
          get().ungroup(parent.id);
        } else {
          get().applyGroupFrame(parent.id);
        }
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

  copyNode: (nodeId) => {
    const node = get().nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    const id = getId('node');
    const newNode: Node = {
      ...node,
      id,
      position: { x: node.position.x + 50, y: node.position.y + 50 },
      width: node.width,
      height: node.height,
      selected: true,
    };
    // 批4b-2 换芯：doc 建节点走意图漏斗（data 取 cs 现值——copy 语义即复制当前 data）；
    // 下方 set exists 自适应（投影已 append 基础形状 → 只补选择态；canEdit 假 → 原 append 回弹）
    dispatchCanvasIntent({
      type: 'addNode',
      node: {
        id, type: node.type!, position: { x: node.position.x + 50, y: node.position.y + 50 },
        ...(node.parentId != null ? { parentId: node.parentId } : {}),
        ...(node.width != null ? { width: node.width } : {}),
        ...(node.height != null ? { height: node.height } : {}),
        data: (node.data ?? {}) as Record<string, unknown>,
      },
    }, Origin.LocalUser);
    set((s) => {
      const projected = s.nodes.some((n) => n.id === id);
      return {
        nodes: projected
          ? s.nodes.map((n) => (n.id === id ? { ...n, selected: true } : { ...n, selected: false }))
          : [...s.nodes.map((n) => ({ ...n, selected: false })), newNode],
        selectedId: id,
      };
    });
    useNodeStore.getState().addNode({
      id,
      type: node.type!,
      data: node.data as any,
    });
    return id;
  },

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
    const sw = sourceNode.measured?.width ?? sourceNode.width ?? 400;
    const sh = sourceNode.measured?.height ?? sourceNode.height ?? 300;
    const sx = sourceNode.position.x;
    const sy = sourceNode.position.y;
    const otherNodes = get().nodes.filter((n) => n.id !== sourceId);
    const overlaps = (nx: number, ny: number) =>
      otherNodes.some((n) => {
        const nw = n.measured?.width ?? n.width ?? 200;
        const nh = n.measured?.height ?? n.height ?? 200;
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
      id,
      type: sourceNode.type,
      position: bestPos,
      data,
      selected: true,
    };
    const edge: Edge = { id: edgeId, source: sourceId, target: id };

    // 批4b-1 换芯：node+edge 双 intent 单 transact（canEdit 假已被 action 门拦——dispatch 前置门
    // 重复拦截无害）；下方 set exists 自适应防投影 append 叠重复
    dispatchCanvasIntent([
      { type: 'addNode', node: { id, type: sourceNode.type!, position: { ...bestPos }, data } },
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

    const sw = sourceNode.measured?.width ?? sourceNode.width ?? 400;
    const sh = sourceNode.measured?.height ?? sourceNode.height ?? 300;
    const startX = sourceNode.position.x + sw + 120;
    const startY = sourceNode.position.y;
    const GAP = 20;

    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];
    const newIds: string[] = [];

    for (const item of nodeDataList) {
      const nodeId = getId('node');
      const resolvedType = item.nodeType || sourceNode.type;

      const x = startX + item.gridCol * (sw + GAP);
      const y = startY + item.gridRow * (sh + GAP);

      const newNode: Node = {
        id: nodeId,
        type: resolvedType,
        position: { x, y },
        data: item.data,
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

    // 批4b-1 换芯：N node+M edge 单 transact（整批原子——对端一帧收齐）
    dispatchCanvasIntent([
      ...newNodes.map((n) => ({ type: 'addNode' as const, node: { id: n.id, type: n.type!, position: { ...n.position }, data: n.data as Record<string, unknown> } })),
      ...newEdges.map((e) => ({ type: 'upsertEdge' as const, edge: { id: e.id, source: e.source, target: e.target } })),
    ], Origin.LocalUser);
    // exists 自适应：投影已 append 基础形状 → 滤除后 append 完整对象（防叠重复）；canEdit 假
    // 已被 action 门拦（上方 return []），此处防御分支同型
    const newNodeIds = new Set(newNodes.map((n) => n.id));
    const newEdgeIds = new Set(newEdges.map((e) => e.id));
    set((s) => ({
      nodes: [...s.nodes.filter((n) => !newNodeIds.has(n.id)), ...newNodes],
      edges: [...s.edges.filter((e) => !newEdgeIds.has(e.id)), ...newEdges],
    }));

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
    const sw = sourceNode.measured?.width ?? sourceNode.width ?? 400;
    const sh = sourceNode.measured?.height ?? sourceNode.height ?? 300;
    const sx = sourceNode.position.x;
    const sy = sourceNode.position.y;
    const otherNodes = get().nodes.filter((n) => n.id !== sourceId);
    const overlaps = (nx: number, ny: number) =>
      otherNodes.some((n) => {
        const nw = n.measured?.width ?? n.width ?? 200;
        const nh = n.measured?.height ?? n.height ?? 200;
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

  createDerivedExtNode: (params) => {
    const source = get().nodes.find((n) => n.id === params.sourceNodeId);
    if (!source) return null;

    const sw = source.measured?.width ?? source.width ?? 300;
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
    // 批4b-1 换芯：协作语义变更走意图漏斗（doc 首写；投影回填与下方 set 同值幂等收敛）——
    // 置于捕获段之后（上方 cascade/父子捕获须读变更前 state——投影已 filter 会致判型失效）、
    // 结构 set 之前。拖拽 position 批 origin=Geometry（高频路径不入撤销栈——canvasUndo
    // trackedOrigins 契约）；NodeResizer resize（setAttributes dimensions 写 width/height）与
    // remove 走 LocalUser（撤销语义保持）。select 等纯 UI 变更不经漏斗（投影不含 selected/dragging/measured）。
    const dragIntents: CanvasIntent[] = [];
    const structIntents: CanvasIntent[] = [];
    for (const c of changes) {
      if (c.type === 'position' && c.position != null) {
        dragIntents.push({ type: 'moveNode', id: c.id, position: { ...c.position } });
      } else if (c.type === 'dimensions' && (c as any).setAttributes && (c as any).dimensions != null) {
        structIntents.push({
          type: 'updateNodeEnvelope', id: c.id,
          patch: { width: (c as any).dimensions.width, height: (c as any).dimensions.height },
        });
      } else if (c.type === 'remove') {
        structIntents.push({ type: 'deleteNode', id: c.id });
      }
    }
    if (dragIntents.length > 0) dispatchCanvasIntent(dragIntents, Origin.Geometry);
    if (structIntents.length > 0) dispatchCanvasIntent(structIntents, Origin.LocalUser);
    set((s) => {
      const nextNodes = applyNodeChanges(changes, s.nodes) as Node[];
      // 组内边距保留区：只夹取本批 position/dimensions 变更中、普通组的子节点
      const changedIds = new Set(
        changes
          .filter((c) => (c.type === 'position' && c.position != null) || c.type === 'dimensions')
          .map((c) => (c as any).id),
      );
      let nodes = nextNodes;
      if (changedIds.size > 0) {
        const byId = new Map(nextNodes.map((n) => [n.id, n]));
        nodes = nextNodes.map((n) => {
          if (!changedIds.has(n.id) || !n.parentId) return n;
          const parent = byId.get(n.parentId);
          if (!parent || parent.type !== 'group' || (parent.data as any)?.groupType === 'storyboard') return n;
          // 共享守卫 clampChildIntoGroup（Task 18——与 placement 分支 B 同源）：组宽高不可用/退化跳过夹取。
          // 子尺寸 measured 夹层保留（纪律三例外域——measured 唯一保留域=拖拽期 clamp）
          const clamped = clampChildIntoGroup(
            n.position,
            { width: n.width ?? n.measured?.width ?? DEFAULT_CHILD_SIZE.width,
              height: n.height ?? n.measured?.height ?? DEFAULT_CHILD_SIZE.height },
            { width: parent.width ?? parent.measured?.width, height: parent.height ?? parent.measured?.height },
          );
          if (clamped.x === n.position.x && clamped.y === n.position.y) return n;
          return { ...n, position: clamped };
        });
      }
      return { nodes };
    });

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
        } else if ((parent.data as any).groupType === 'normal') {
          // 普通组：删空自动解组；仍有子 → 组框收缩（G1——对齐 deleteNode 同款）
          if (!get().nodes.some((c) => c.parentId === parent.id)) {
            get().ungroup(parent.id);
          } else {
            get().applyGroupFrame(parent.id);
          }
        }
      }
    }
    // v6：级联子清理（组被删时其子走 deleteNode 三件套——cancelNodeProcess/ns.deleteNode/unregisterSaveHandler）
    for (const cid of removedGroupsChildren) {
      if (get().nodes.some((n) => n.id === cid)) get().deleteNode(cid);
    }
    // 批4b-2：善后几何（applyGroupFrame 收缩）经差分落 doc（嵌套 action 自 dispatch 幂等）
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

    // Snapshot source position/size
    const sourceW = sourceNode.measured?.width ?? sourceNode.width ?? 400;
    const sourceH = sourceNode.measured?.height ?? sourceNode.height ?? 300;
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

  applyGroupDerivations: () => {
    set((s) => {
      const repaired = repairStoryboardCells(s.nodes as any);
      return deriveHidden(repaired, s.edges as any);
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
          ? { ...n, selected: false, parentId: id, extent: 'parent' as const,
              position: { x: n.position.x - bounds.x, y: n.position.y - bounds.y } }
          : { ...n, selected: false }),
        groupNode,
      ],
      selectedId: id,
    }));
    useNodeStore.getState().addNode({ id, type: 'group', data: groupNode.data as any });
    get().applyGroupDerivations();
    dispatchProjectionDiff(before, Origin.LocalUser);
    return id;
  },

  ungroup: (groupId) => {
    if (get().hasActiveProcessInGroup(groupId)) {
      message.warning('组内有节点正在执行，请等待完成后再操作');
      return;
    }
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    if (!group) return;
    const gd = group.data as any;
    const gp = group.position;
    const childIds = s.nodes.filter((n) => n.parentId === groupId).map((n) => n.id);
    // 批4b-2 换芯：差分快照→组删+出组信封删键+abs 坐标还原经 dispatchProjectionDiff 落 doc
    const before = captureStoreProjection();
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
          ? { ...n, parentId: undefined, extent: undefined,
              position: { x: n.position.x + gp.x, y: n.position.y + gp.y } }
          : n),
      selectedId: st.selectedId === groupId ? null : st.selectedId,
    }));
    useNodeStore.getState().deleteNode(groupId);
    get().applyGroupDerivations();
    dispatchProjectionDiff(before, Origin.LocalUser);
  },

  addToGroup: (groupId, nodeId) => {
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    const node = s.nodes.find((n) => n.id === nodeId);
    if (!group || !node || node.type === 'group' || node.parentId === groupId) return;  // 已在组 no-op
    const gp = group.position;
    // 跨组：node.position 是相对旧父的 rel——先还原绝对坐标（现状当绝对用是双重偏移根源）
    let absX = node.position.x, absY = node.position.y;
    const oldParent = node.parentId ? s.nodes.find((n) => n.id === node.parentId) : undefined;
    if (oldParent && node.parentId !== groupId) {
      absX += oldParent.position.x; absY += oldParent.position.y;
    }
    const childSize = { width: node.width ?? DEFAULT_CHILD_SIZE.width,      // v6 纪律三：无 measured
                        height: node.height ?? DEFAULT_CHILD_SIZE.height };
    const auto = shouldAutoRefit(group);
    // 批4b-2 换芯：差分快照→入组信封+组框+既有成员 rel 补偿经 dispatchProjectionDiff 落 doc
    const before = captureStoreProjection();
    setWithParentOrder((st) => {
      if (!auto) {
        // 分支 B（v5）：不 refit 组——组框一字不改；新子 rel=abs−组原点，过 clampChildIntoGroup
        //（共享守卫：组宽高不可用/退化时跳过夹取——与 Task 14 拖拽路径的守卫同源）
        const clamped = clampChildIntoGroup(
          { x: absX - gp.x, y: absY - gp.y }, childSize,
          { width: group.width, height: group.height },
        );
        return {
          nodes: st.nodes.map((n) =>
            n.id === nodeId ? { ...n, parentId: groupId, extent: 'parent' as const, position: clamped } : n),
        };
      }
      // 分支 A：守恒 refit（既有成员绝对不变——F33 根修）
      const siblings = st.nodes.filter((n) => n.parentId === groupId || n.id === nodeId);
      const { frame, rels } = refitGroupGeometry(
        siblings.map((n) => ({
          x: n.id === nodeId ? absX : n.position.x + gp.x,
          y: n.id === nodeId ? absY : n.position.y + gp.y,
          width: n.width ?? DEFAULT_CHILD_SIZE.width,       // v6 纪律三：无 measured
          height: n.height ?? DEFAULT_CHILD_SIZE.height,
        })),
      );
      return {
        nodes: st.nodes.map((n) => {
          if (n.id === nodeId) return { ...n, parentId: groupId, extent: 'parent' as const, position: rels[siblings.findIndex((sm) => sm.id === nodeId)] };
          if (n.id === groupId) return { ...n, position: { x: frame.x, y: frame.y }, width: frame.width, height: frame.height };
          const i = siblings.findIndex((sm) => sm.id === n.id);
          return i === -1 ? n : { ...n, position: rels[i] };   // 既有成员 rel 补偿——绝对坐标不变（F33）
        }),
      };
    });
    if (oldParent && node.parentId !== groupId && oldParent.type === 'group') {
      // 源组善后（v5）：失去最后子 → 解组（对齐删除路径语义；plan 原文 ungroupForce 已随 Task 11
      //  v6 级联裁决撤销——现场改调 ungroup，已验证其空组路径无子排序依赖不会炸）；仍有子 → 收缩
      if (!get().nodes.some((c) => c.parentId === oldParent.id)) get().ungroup(oldParent.id);
      else get().applyGroupFrame(oldParent.id);
    }
    get().applyGroupDerivations();
    dispatchProjectionDiff(before, Origin.LocalUser);
  },

  removeNodeFromGroup: (groupId, nodeId) => {
    if (get().hasActiveProcessInGroup(groupId)) {
      message.warning('组内有节点正在执行，请等待完成后再操作');
      return;
    }
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    if (!group) return;
    const gp = group.position;
    // 批4b-2 换芯：差分快照→出组信封删键+abs 还原+组框收缩经 dispatchProjectionDiff 落 doc
    const before = captureStoreProjection();
    set((st) => ({
      nodes: st.nodes.map((n) => n.parentId === groupId && n.id === nodeId
        ? { ...n, parentId: undefined, extent: undefined,
            position: { x: n.position.x + gp.x, y: n.position.y + gp.y } }
        : n),
    }));
    get().applyGroupFrame(groupId);   // G1：移出后组框收缩（守卫内建——分镜/折叠/手动 no-op）
    dispatchProjectionDiff(before, Origin.LocalUser);
    // v5 C2：移出最后子 → normal 空组解组（对齐删空自动解组语义；storyboard 组不受此规则）
    const after = get();
    const g = after.nodes.find((n) => n.id === groupId);
    if (g?.type === 'group' && (g.data as any)?.groupType === 'normal'
      && !after.nodes.some((n) => n.parentId === groupId)) {
      get().ungroup(groupId);
      return; // ungroup 内已调 applyGroupDerivations
    }
    get().applyGroupDerivations();
  },

  dropIntoGroup: (nodeId, groupId) => {
    if (get().hasActiveProcessInGroup(groupId)) {
      message.warning('组内有节点正在执行，请等待完成后再操作');
      return;
    }
    const s = get();
    let group = s.nodes.find((n) => n.id === groupId);
    if (!group) return;
    const node = s.nodes.find((n) => n.id === nodeId);
    if (!node || node.type === 'group' || node.parentId === groupId) return;  // 守卫同 addToGroup（已在组 no-op）
    if ((group.data as any).collapsed) get().toggleCollapse(groupId); // 折叠态先展开
    group = get().nodes.find((n) => n.id === groupId);   // 展开三分派可能重算组框——重读防 gp 陈旧
    if (!group) return;
    const gp = group.position;
    // 跨组：node.position 是相对旧父的 rel——先还原绝对坐标（守卫同 addToGroup）
    let absX = node.position.x, absY = node.position.y;
    const oldParent = node.parentId ? s.nodes.find((n) => n.id === node.parentId) : undefined;
    if (oldParent && node.parentId !== groupId) {
      absX += oldParent.position.x; absY += oldParent.position.y;
    }
    const childSize = { width: node.width ?? DEFAULT_CHILD_SIZE.width,      // v6 纪律三：无 measured
                        height: node.height ?? DEFAULT_CHILD_SIZE.height };
    const auto = shouldAutoRefit(group);
    // 批4b-2 换芯：差分快照→入组信封+组框+rel 补偿经 dispatchProjectionDiff 落 doc（addToGroup 同款；
    // 前置 toggleCollapse 展开自带 dispatch，与本差分幂等）
    const before = captureStoreProjection();
    setWithParentOrder((st) => {
      if (!auto) {
        // 分支 B（v5）：不 refit 组——组框一字不改；新子 rel=abs−组原点，过 clampChildIntoGroup
        const clamped = clampChildIntoGroup(
          { x: absX - gp.x, y: absY - gp.y }, childSize,
          { width: group.width, height: group.height },
        );
        return {
          nodes: st.nodes.map((n) =>
            n.id === nodeId ? { ...n, parentId: groupId, extent: 'parent' as const, position: clamped } : n),
        };
      }
      // 分支 A：守恒 refit（既有成员绝对不变——F33 根修；与 addToGroup 同款）
      const siblings = st.nodes.filter((n) => n.parentId === groupId || n.id === nodeId);
      const { frame, rels } = refitGroupGeometry(
        siblings.map((n) => ({
          x: n.id === nodeId ? absX : n.position.x + gp.x,
          y: n.id === nodeId ? absY : n.position.y + gp.y,
          width: n.width ?? DEFAULT_CHILD_SIZE.width,       // v6 纪律三：无 measured
          height: n.height ?? DEFAULT_CHILD_SIZE.height,
        })),
      );
      return {
        nodes: st.nodes.map((n) => {
          if (n.id === nodeId) return { ...n, parentId: groupId, extent: 'parent' as const, position: rels[siblings.findIndex((sm) => sm.id === nodeId)] };
          if (n.id === groupId) return { ...n, position: { x: frame.x, y: frame.y }, width: frame.width, height: frame.height };
          const i = siblings.findIndex((sm) => sm.id === n.id);
          return i === -1 ? n : { ...n, position: rels[i] };   // 既有成员 rel 补偿——绝对坐标不变（F33）
        }),
      };
    });
    if (oldParent && node.parentId !== groupId && oldParent.type === 'group') {
      // 源组善后（同 addToGroup——ungroup 对空组安全；仍有子 → 收缩）
      if (!get().nodes.some((c) => c.parentId === oldParent.id)) get().ungroup(oldParent.id);
      else get().applyGroupFrame(oldParent.id);
    }
    get().applyGroupDerivations();
    dispatchProjectionDiff(before, Origin.LocalUser);
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
    const gd = group.data as any;
    if (gd.groupType !== 'storyboard') return;

    const cfg = resolveStoryboardConfig(gd);
    const capacity = cfg.gridRows * cfg.gridCols;
    const cells = [...(gd.cells ?? [])];
    const gp = group.position;
    const gw = group.width ?? 0;
    // 批4b-2 换芯：差分快照（multiImage 分支的展开+删源/溢出移位经收尾差分单 transact 落 doc；
    // imageGen 分支的 addToGroup/patchGroupData 自带 dispatch，差分幂等收其余）
    const before = captureStoreProjection();

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
          id, type: 'imageGen', parentId: groupId, extent: 'parent' as const,
          position: { x: 0, y: 0 }, width: 320, height: 180,
          data: { status: 'done', fileId: img.id, mediaUrl: img.url, __fromMulti: nodeId },
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
          // 溢出：排在组右侧
          const overflowIdx = i - filledCount;
          overflowNodes.push({
            ...newNode,
            parentId: undefined,
            extent: undefined,
            hidden: false,
            position: { x: gp.x + gw + 20, y: gp.y + overflowIdx * 200 },
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

      // 找第一个空位
      let emptyIdx = -1;
      for (let idx = 0; idx < Math.max(capacity, cells.length); idx++) {
        if (!cells[idx]) { emptyIdx = idx; break; }
      }

      if (emptyIdx >= 0 && emptyIdx < capacity) {
        // 入组（五审 L-4：addToGroup 单 set + cells 经 patchGroupData 单 set——两段与原结构一致）
        get().addToGroup(groupId, nodeId);
        // 补 null 到空位索引
        const g = get().nodes.find((n) => n.id === groupId);
        if (g) {
          const updatedCells = [...(g.data as any).cells ?? []];
          while (updatedCells.length < emptyIdx) updatedCells.push(null);
          updatedCells[emptyIdx] = nodeId;
          get().patchGroupData(groupId, { cells: updatedCells });
        }
      } else {
        // 溢出：移到组右侧（单 set，无需事务）
        set((st) => ({
          nodes: st.nodes.map((n) =>
            n.id === nodeId ?
              { ...n, parentId: undefined, extent: undefined, hidden: false,
                position: { x: gp.x + gw + 20, y: gp.y } } :
            n
          ),
        }));
        message.info('分镜组已满，图片已放在组旁');
      }
    } else {
      // 非完成图/其他类型：不处理
      return;
    }

    get().applyGroupDerivations();
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
            id, type: 'imageGen', parentId: gid, extent: 'parent' as const,
            // 暂留原 multi 位置：字典序排序依据（P1-新1——若归零则展开图永远插队排最前）；
            // 追加进 nodes 时统一归零（分镜组子节点坐标无意义）
            position: { x: n.position.x, y: n.position.y }, width: 320, height: 180,
            data: { status: 'done', fileId: img.id, mediaUrl: img.url, __fromMulti: n.id },
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
    // 配置型组框直写（§4.8 v11 S2 裁决）：frame=calcStoryboardSize 单源；与子 rel 归零同
    // setWithParentOrder 事务（拆 applyGroupFrameRect 需两次 setState 分写闪烁）——保持原事务结构
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
            ? { ...n, selected: false, parentId: gid, extent: 'parent' as const,
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
    get().applyGroupDerivations();
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
    // （patchGroupData/applyGroupFrame 的变更收在差分内，自带 dispatch 部分幂等）
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
      // 配置型组框直写（§4.8 v11 S2 裁决）：frame=calcStoryboardSize 单源；与子 rel 归零同
      // setWithParentOrder 事务（拆 applyGroupFrameRect 需两次 setState 分写闪烁）——保持原事务结构
      setWithParentOrder((st) => ({
        nodes: st.nodes.map((n) => {
          if (n.id === groupId) return { ...n, type: 'group', position: { x: cx - size.width / 2, y: cy - size.height / 2 },
            width: size.width, height: size.height };
          if (n.parentId === groupId) return { ...n, position: { x: 0, y: 0 } };
          return n;
        }),
      }));
      // F18：增量 patch（name 非空保留；savedSize/manuallyResized undefined=删除键）
      get().patchGroupData(groupId, {
        groupType: 'storyboard', cells: sorted,
        storyboard: { aspectRatio: '16:9', gridRows: rows, gridCols: cols, showIndex: false, stitchResolution: '2K' },
        nameCustom: false,
        name: (gd.name && gd.name.trim()) || `分镜组 ${sorted.length} 个节点`,
        savedSize: undefined, manuallyResized: undefined, collapsed: undefined,
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
      // F18：增量 patch（name 非空保留；storyboard/cells/nameCustom 等删除键）
      get().patchGroupData(groupId, {
        groupType: 'normal',
        name: (gd.name && gd.name.trim()) || '分组',
        nameCustom: undefined, storyboard: undefined, cells: undefined,
        savedSize: undefined, manuallyResized: undefined, collapsed: undefined,
      });
      // 组框重算（守恒——rel 随 frame 补偿，子绝对不变）
      get().applyGroupFrame(groupId);
    }
    get().applyGroupDerivations();
    dispatchProjectionDiff(before, Origin.LocalUser);
  },

  /** 组 data 唯一通道（§4.7）：增量合并；undefined=delete。只写 cs——所有权单一
   *  （F42：镜像 syncGroupDataToNodeStore 已删，ns 无组 data，投影组取 cs）。
   *  批4b-2 换芯：doc 面经 updateNodeData intent（undefined=删键约定两端同构；投影对组节点
   *  写 ns 组条目——同值幂等，投影读取面（F42）不受影响）。
   *  ⚠️ derivations 配对：改 collapsed/cells 的调用方必须随后调 applyGroupDerivations
   *  （deriveHidden/repairStoryboardCells 派生）——本函数不内嵌调用（repairStoryboardCells
   *  会在中间态把子节点移出组）。 */
  patchGroupData: (groupId, patch) => {
    dispatchCanvasIntent({ type: 'updateNodeData', id: groupId, patch }, Origin.LocalUser);
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
    get().patchGroupData(groupId, { name: final });
  },

  markManuallyResized: (groupId) => {
    get().patchGroupData(groupId, { manuallyResized: true });
  },

  toggleCollapse: (groupId) => {
    const g0 = get().nodes.find((n) => n.id === groupId);
    const collapsing = g0 ? !(g0.data as any).collapsed : false;
    if (collapsing && g0) {
      get().patchGroupData(groupId, { collapsed: true, savedSize: { width: g0.width ?? 0, height: g0.height ?? 0 } });
      // 批4b-2 换芯：折叠组框直写走 envelope intent（展开三分派归 applyGroupFrameRect——已自带 dispatch）
      dispatchCanvasIntent(
        [{ type: 'updateNodeEnvelope', id: groupId, patch: { width: COLLAPSED_SIZE.width, height: COLLAPSED_SIZE.height } }],
        Origin.LocalUser,
      );
      set((st) => ({
        nodes: st.nodes.map((n) => (n.id === groupId ? { ...n, width: COLLAPSED_SIZE.width, height: COLLAPSED_SIZE.height } : n)),
      }));
    } else {
      get().patchGroupData(groupId, { collapsed: false });
    }
    const g = get().nodes.find((n) => n.id === groupId);
    if (g && !(g.data as any).collapsed) {
      const d = g.data as any;
      if (d.manuallyResized && d.savedSize) {
        // ① 手动 resize 过的 normal 组：展开恢复用户尺寸（savedSize 仅服务此档），不按子节点重算
        get().applyGroupFrameRect(groupId, { x: g.position.x, y: g.position.y, width: d.savedSize.width, height: d.savedSize.height });
      } else if (d.groupType === 'storyboard') {
        // ② 分镜组：配置是分镜框真理（v6 裁决——不用 savedSize：折叠期间配置被远端改动时按配置展开）
        const cfg = resolveStoryboardConfig(d);
        const size = calcStoryboardSize(cfg.gridRows, cfg.gridCols, cfg.aspectRatio);
        get().applyGroupFrameRect(groupId, { x: g.position.x, y: g.position.y, width: size.width, height: size.height });
      } else {
        // ③ 其余（含 manuallyResized 无 savedSize 堵洞档）：守恒展开——展开前子 rel 未动，
        //    calcGroupBounds(childrenAbs) 即恢复 frame（彻底不依赖 shouldAutoRefit 时点）
        const children = get().nodes.filter((n) => n.parentId === groupId);
        if (children.length > 0) {   // 空组不重算（对齐旧重算入口现状早退——calcGroupBounds 空集=Infinity）
          get().applyGroupFrameRect(groupId, calcGroupBounds(children.map((n) => ({
            x: n.position.x + g.position.x, y: n.position.y + g.position.y,
            width: n.width ?? DEFAULT_CHILD_SIZE.width, height: n.height ?? DEFAULT_CHILD_SIZE.height,
          }))));
        }
      }
    }
    get().applyGroupDerivations();
  },

  /** 组几何唯一写者（§4.8 v11）——重算型入口。守卫：分镜组走配置型出口；shouldAutoRefit=false
   *  （折叠/手动）no-op。epsilon：|Δ|<1e-6 不写（RF 小数坐标 1ULP 抖动防桥乒乓）。
   *  批4b-2 设计裁定：本 action 不 dispatch——doc 写回统一归调用方差分（本地调用方
   *  deleteNode/onNodesChange/addToGroup 族均带差分快照；远端应用路径 refitExpandedGroups 的
   *  几何修正归 S1 收口——此处 dispatch 会在 applyDocToStore 窗口内产生 LocalUser 回声）。 */
  applyGroupFrame: (groupId) => {
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    if (!group || !shouldAutoRefit(group)) return;
    const children = s.nodes.filter((n) => n.parentId === groupId);
    if (children.length === 0) return;
    const { frame, rels } = refitGroupGeometry(
      children.map((n) => ({
        x: n.position.x + group.position.x, y: n.position.y + group.position.y,
        width: n.width ?? DEFAULT_CHILD_SIZE.width,      // v6 纪律三：无 measured——与 normalizeLoadedCanvas/assertInvariant 一字不差同源
        height: n.height ?? DEFAULT_CHILD_SIZE.height,
      })),
    );
    const EPS = 1e-6;
    const moved = Math.abs(group.position.x - frame.x) > EPS || Math.abs(group.position.y - frame.y) > EPS
      || Math.abs((group.width ?? 0) - frame.width) > EPS || Math.abs((group.height ?? 0) - frame.height) > EPS;
    if (!moved && children.every((c, i) => Math.abs(c.position.x - rels[i].x) <= EPS && Math.abs(c.position.y - rels[i].y) <= EPS)) return;
    set((st) => ({
      nodes: st.nodes.map((n) => {
        if (n.id === groupId) return { ...n, position: { x: frame.x, y: frame.y }, width: frame.width, height: frame.height };
        const i = children.findIndex((c) => c.id === n.id);
        return i === -1 ? n : { ...n, position: rels[i] };
      }),
    }));
  },

  /** 配置型唯一出口（§4.8 v11）：frame 由 calcStoryboardSize 等配置公式算得，直写组框（无守恒语义）。
   *  消费者定案（Task 20）：toggleCollapse 展开分支（三分派）+ updateStoryboardConfig（可干净拆出档）；
   *  mergeStoryboard / convertGroup→storyboard / resizeStoryboardGrid 与子写同事务（S2 裁决保持原结构）。
   *  尺寸档调用方必须回显当前 position（传 {x:0,y:0} 会瞬移组框）——updateStoryboardConfig/toggleCollapse savedSize 分支均回显 g.position。 */
  applyGroupFrameRect: (groupId, frame) => {
    // 批4b-1 换芯：resize/入组/convertGroup 族信封写点（本 action=配置型唯一出口——
    // toggleCollapse/updateStoryboardConfig 消费）走意图漏斗：width/height=envelope intent、
    // position=moveNode intent，序列单 transact（origin=LocalUser 保持撤销语义）；
    // 下方 map 型 set 与投影同值幂等
    dispatchCanvasIntent([
      { type: 'updateNodeEnvelope', id: groupId, patch: { width: frame.width, height: frame.height } },
      { type: 'moveNode', id: groupId, position: { x: frame.x, y: frame.y } },
    ], Origin.LocalUser);
    set((st) => ({
      nodes: st.nodes.map((n) =>
        n.id === groupId ? { ...n, position: { x: frame.x, y: frame.y }, width: frame.width, height: frame.height } : n),
    }));
  },

  updateStoryboardConfig: (groupId, patch) => {
    const g = get().nodes.find((n) => n.id === groupId);
    if (!g) return;
    const cfg = resolveStoryboardConfig({ storyboard: { ...resolveStoryboardConfig(g.data), ...patch } });
    const size = calcStoryboardSize(cfg.gridRows, cfg.gridCols, cfg.aspectRatio);
    // 配置型收口（§4.8 v11）：本处 set 仅触组节点（无子写）——可干净拆出，组框写走 applyGroupFrameRect
    get().applyGroupFrameRect(groupId, { x: g.position.x, y: g.position.y, width: size.width, height: size.height });
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
    // 配置型组框直写（§4.8 v11 S2 裁决）：frame=calcStoryboardSize 单源；与溢出移出同事务
    //（拆 applyGroupFrameRect 需两次 setState，中间态溢出节点仍属组）——保持原事务结构。
    // 溢出 x 用新宽 size.width（旧 gw：cols 增且总容量减时溢出节点落进已加宽的新组框内）
    set((st) => ({
      nodes: st.nodes.map((n) => {
        // P0-新1：绝不能 filter 掉溢出节点——那是删除数据；只做 map 改写（移出组排右侧）
        if (n.id === groupId) {
          return { ...n, width: size.width, height: size.height };
        }
        if (overflowIds.includes(n.id) && n.parentId === groupId) {
          const idx = overflowIds.indexOf(n.id);
          return { ...n, parentId: undefined, extent: undefined, hidden: false,
            position: { x: gp.x + size.width + 20, y: gp.y + idx * 200 } };
        }
        return n;
      }),
      edges: st.edges, // 溢出节点若有连线已在组内隐藏；解出后 hidden 推导恢复显示
    }));
    get().patchGroupData(groupId, { cells: keep, storyboard: cfg });
    get().applyGroupDerivations();
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

  addImageToStoryboardCell: (groupId, cellIndex, fileId, url) => {
    const id = getId('node');
    // 空位用 null 占位（cells: (string | null)[]），语义明确且 filter(Boolean) 安全
    const cells: (string | null)[] = [...(((get().nodes.find((n) => n.id === groupId)?.data as any)?.cells) ?? [])];
    while (cells.length < cellIndex) cells.push(null);
    cells[cellIndex] = id;
    // 批4b-2 换芯：差分快照→槽位建图节点+cells 更新经 dispatchProjectionDiff 落 doc
    const before = captureStoreProjection();
    set((st) => ({
      nodes: st.nodes.concat([{
        id, type: 'imageGen', parentId: groupId, extent: 'parent',
        position: { x: 0, y: 0 }, width: 320, height: 180,
        data: { status: 'done', fileId, mediaUrl: url } as any, selected: false,
      } as Node]),
    }));
    get().patchGroupData(groupId, { cells });
    useNodeStore.getState().addNode({ id, type: 'imageGen', data: { status: 'done', fileId, mediaUrl: url } as any });
    get().applyGroupDerivations();
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
    get().applyGroupDerivations();
    dispatchProjectionDiff(before, Origin.LocalUser);
  },

  duplicateGroup: (groupId) => {
    return buildGroupCopy(get, set, groupId, { x: 40, y: 0 }, '创建组副本');
  },

  copyGroupToClipboard: (groupId) => {
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    if (!group) return;
    const children = s.nodes.filter((n) => n.parentId === groupId);
    const childIds = new Set(children.map((n) => n.id));
    groupClipboard = {
      group: structuredClone(group),
      children: structuredClone(children),
      innerEdges: structuredClone(s.edges.filter((e) => childIds.has(e.source) && childIds.has(e.target))),
    };
  },

  pasteGroupClipboard: (position) => {
    if (!groupClipboard) return null;
    return rebuildFromClipboard(get, set, position, '粘贴组');
  },

  hasGroupClipboard: () => groupClipboard !== null,
  };
});

// Shared helper function to build a group copy
function buildGroupCopy(
  get: () => CanvasState,
  set: (partial: Partial<CanvasState>) => void,
  groupId: string,
  offset: { x: number; y: number },
  label: string // '创建组副本' | '粘贴组'
): string | null {
  const s = get();
  const group = s.nodes.find((n) => n.id === groupId);
  if (!group) return null;

  const children = s.nodes.filter((n) => n.parentId === groupId);
  const childIds = new Set(children.map((n) => n.id));
  const innerEdges = s.edges.filter((e) => childIds.has(e.source) && childIds.has(e.target));

  // Generate new IDs upfront (P1-新5 convention)
  const newGid = getId('node');
  const idMap = new Map(children.map((c) => [c.id, getId('node')]));
  const newEdgeIds = innerEdges.map(() => getId('edge'));

  const isStoryboard = (group.data as any).groupType === 'storyboard';

  // Build new group node
  const newGroup: Node = {
    ...structuredClone(group),
    id: newGid,
    position: { x: group.position.x + offset.x, y: group.position.y + offset.y },
    selected: true,
  };
  // Map cells if storyboard（悬空 id → null 占位——禁 || id 兜底，与 clone remapIds 红线同款）
  if (isStoryboard && newGroup.data.cells) {
    (newGroup.data as any).cells = (newGroup.data.cells as string[]).map((id) => idMap.get(id) ?? null);
  }

  // Build new child nodes
  const newChildren: Node[] = children.map((child) => {
    const newId = idMap.get(child.id)!;
    const newChild: Node = {
      ...structuredClone(child),
      id: newId,
      parentId: newGid,
      selected: false,
      // Storyboard children: position zeroed; normal group: preserve relative position
      position: isStoryboard ? { x: 0, y: 0 } : child.position,
    };
    return newChild;
  });

  // Build new edges
  const newEdges: Edge[] = innerEdges.map((edge, idx) => ({
    ...structuredClone(edge),
    id: newEdgeIds[idx],
    source: idMap.get(edge.source)!,
    target: idMap.get(edge.target)!,
  }));

  // 批4b-2 换芯：差分快照→组+子+组内边复制经 dispatchProjectionDiff 单 transact 落 doc
  const before = captureStoreProjection();

  // Update store
  set({
    nodes: [
      ...s.nodes.map((n) => ({ ...n, selected: false })),
      newGroup,
      ...newChildren,
    ],
    edges: [...s.edges, ...newEdges],
    selectedId: newGid,
  });

  // Double-write to nodeStore
  const ns = useNodeStore.getState();
  ns.addNode({
    id: newGid,
    type: 'group',
    data: newGroup.data as any,
  });
  for (const child of newChildren) {
    ns.addNode({
      id: child.id,
      type: child.type!,
      data: child.data as any,
    });
  }

  get().applyGroupDerivations();
  dispatchProjectionDiff(before, Origin.LocalUser);

  return newGid;
}

// Shared helper function to rebuild from clipboard
function rebuildFromClipboard(
  get: () => CanvasState,
  set: (partial: Partial<CanvasState>) => void,
  position: { x: number; y: number },
  label: string // '粘贴组'
): string | null {
  if (!groupClipboard) return null;

  // Generate new IDs upfront
  const newGid = getId('node');
  const idMap = new Map(groupClipboard.children.map((c) => [c.id, getId('node')]));
  const newEdgeIds = groupClipboard.innerEdges.map(() => getId('edge'));

  const isStoryboard = (groupClipboard.group.data as any).groupType === 'storyboard';

  // Build new group node
  const newGroup: Node = {
    ...structuredClone(groupClipboard.group),
    id: newGid,
    position: { x: position.x, y: position.y },
    selected: true,
  };
  // Map cells if storyboard（悬空 id → null 占位——禁 || id 兜底，与 clone remapIds 红线同款）
  if (isStoryboard && newGroup.data.cells) {
    (newGroup.data as any).cells = (newGroup.data.cells as string[]).map((id) => idMap.get(id) ?? null);
  }

  // Build new child nodes
  const newChildren: Node[] = groupClipboard.children.map((child) => {
    const newId = idMap.get(child.id)!;
    const newChild: Node = {
      ...structuredClone(child),
      id: newId,
      parentId: newGid,
      selected: false,
      // Storyboard children: position zeroed; normal group: preserve relative position
      position: isStoryboard ? { x: 0, y: 0 } : child.position,
    };
    return newChild;
  });

  // Build new edges
  const newEdges: Edge[] = groupClipboard.innerEdges.map((edge, idx) => ({
    ...structuredClone(edge),
    id: newEdgeIds[idx],
    source: idMap.get(edge.source)!,
    target: idMap.get(edge.target)!,
  }));

  // 批4b-2 换芯：差分快照→组+子+组内边重建经 dispatchProjectionDiff 单 transact 落 doc
  const before = captureStoreProjection();

  // Update store
  set({
    nodes: [
      ...get().nodes.map((n) => ({ ...n, selected: false })),
      newGroup,
      ...newChildren,
    ],
    edges: [...get().edges, ...newEdges],
    selectedId: newGid,
  });

  // Double-write to nodeStore
  const ns = useNodeStore.getState();
  ns.addNode({
    id: newGid,
    type: 'group',
    data: newGroup.data as any,
  });
  for (const child of newChildren) {
    ns.addNode({
      id: child.id,
      type: child.type!,
      data: child.data as any,
    });
  }

  get().applyGroupDerivations();
  dispatchProjectionDiff(before, Origin.LocalUser);

  return newGid;
}
