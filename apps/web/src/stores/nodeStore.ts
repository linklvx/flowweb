import { create } from 'zustand';
import { message } from 'antd';
import { useCanvasStore } from './canvasStore';
import { canEdit } from './syncStatus';
// 批4b-1 换芯：协作语义经意图漏斗 doc 直写（循环依赖裁定：顶层仅 import 声明，action 体运行时才调）
import { dispatchCanvasIntent } from './canvasIntents';
import { Origin } from './canvasUndo';
import { selectExecStatus, execOverrideStatus, type ExecStatusEntry, type NodeExecStatus } from './execStatusView';

export type { ExecStatusEntry, NodeExecStatus } from './execStatusView';

// ========== Node type constants ==========

export const NODE_TYPES = {
  IMAGE_GEN: 'imageGen',
  IMAGE_EXT_GEN: 'imageExtGen',
  TEXT: 'textInput',
  VIDEO_GEN: 'videoGen',
  AUDIO_GEN: 'audioGen',
  MULTI_IMAGE_GEN: 'multiImageGen',
} as const;

// ========== Ext config ==========

export interface ImageExtConfig {
  model?: string;
  ratio?: string;
  resolution?: string;
  quality?: string;
  generateCount?: number;
  prompt?: { text?: string; html?: string };
}

export const IMAGE_EXT_DEFAULTS: ImageExtConfig = {
  ratio: '16:9',
  resolution: '2K',
  quality: 'standard',
  generateCount: 1,
};

// ========== Annotation types ==========

export const ANNOTATION_DEFAULTS = {
  color: '#FF0000',
  lineWidth: 4,
  maxHistory: 50,
  minLineWidth: 1,
  maxLineWidth: 40,
  pressureMin: 0.2,
  mousePressure: 0.5,
} as const;

// ★ 所有坐标统一为图片显示区域的 CSS 逻辑坐标（与 displayWidth/displayHeight 同单位）
export interface PenOp {
  type: 'pen';
  points: { x: number; y: number }[];
  color: string;
  lineWidth: number;
  effectivePressure: number;
}

export interface RectOp {
  type: 'rect';
  x1: number; y1: number; x2: number; y2: number;
  color: string;
  lineWidth: number;
}

export interface LineOp {
  type: 'line';
  x1: number; y1: number; x2: number; y2: number;
  color: string;
  lineWidth: number;
}

export type DrawOp = PenOp | RectOp | LineOp;

export interface AnnotationState {
  tool: 'pen' | 'rect' | 'line';
  color: string;
  lineWidth: number;
  history: DrawOp[];
  redoStack: DrawOp[];
}

// ========== Prompt-related types (defined inline for now) ==========

export interface ImageItem {
  id: string;
  url: string;
  name: string;
  status: 'uploading' | 'success' | 'error';
  progress?: number;
}

export interface PromptValue {
  text: string;
  html: string;
  referencedImageIds: string[];
}

// ========== Node data types ==========

export interface TextNodeData {
  content: string;
  prompt?: string;
}

export interface ImageNodeData {
  // —— 根级通用 ——
  fileId?: string;
  referenceImage?: string;
  mediaName?: string;
  status: 'idle' | 'loading' | 'done' | 'error';
  imageRotation?: 0 | 90 | 180 | 270;
  flipH?: boolean;
  flipV?: boolean;
  transformMode?: boolean;
  editMode?: 'crop' | 'outpaint' | 'erase' | 'redraw' | 'annotate' | null;
  customSize?: { width: number; height: number };
  aspectRatio?: number;
  allImages?: ImageItem[];

  // —— imageGen 根级专属生成配置 ——
  style?: string;
  styleId?: string | null;   // 风格库选中（null=已取消，D16 契约：键存在值 null）
  styleName?: string | null;
  model?: string;
  quality?: string;
  ratio?: string;
  resolution?: string;
  prompt?: PromptValue;

  // —— imageExtGen 专属 ——
  extConfig?: ImageExtConfig;
  aiTool?: AiToolId;
}

export interface VideoNodeData {
  model: string;
  status: 'idle' | 'loading' | 'done' | 'error';
  fileId?: string;
  customSize?: { width: number; height: number };
  aspectRatio?: number;
  referenceVideo?: string;
  ratio?: string;
  prompt?: PromptValue;
  styleId?: string | null;   // 风格库选中（null=已取消，D16 契约：键存在值 null）
  styleName?: string | null;
  allImages?: ImageItem[];
  trimStart?: number;
  trimEnd?: number;
  trimTaskStatus?: 'idle' | 'processing' | 'done' | 'error';
  trimmedFileId?: string;
}

export interface AudioNodeData {
  model: string;
  content: string;
  status: 'idle' | 'loading' | 'done' | 'error';
  fileId?: string;
  referenceAudio?: string;
}

export interface MultiImageNodeData {
  label?: string;
  images: ImageItem[];
  mainImageIndex: number;
  expanded: boolean;
  nodeStatus: 'idle' | 'loading' | 'done' | 'error';
  generationBatchId?: string;
  prompt?: string;
}

export type AiToolId =
  | 'grid_25' | 'four_panel'
  | 'frame_forward_3s' | 'frame_backward_5s'
  | 'film_lighting'
  | 'panorama_720' | 'nine_camera'
  | 'face_three_view' | 'character_sheet' | 'character_three_view'
  | 'scene_sheet' | 'product_sheet';

export type NodeData = TextNodeData | ImageNodeData | VideoNodeData | AudioNodeData | MultiImageNodeData;

// ========== AppNode (React Flow aligned) ==========

export interface AppNode {
  id: string;
  type: string;
  selected?: boolean;
  dragging?: boolean;
  data: NodeData;
}

/** 投影记录 → AppNode 显式构造（类型删字段≠运行时 strip——直喂会带 measured/selected 等杂键，必须白名单构造）。 */
export function toAppNode(r: { id: string; type: string; data: Record<string, unknown> }): AppNode {
  return { id: r.id, type: r.type, data: r.data as unknown as NodeData };
}

// ========== Type guards ==========

export function isImageExtNode(node: unknown): node is AppNode & { type: 'imageExtGen'; data: ImageNodeData & { extConfig: ImageExtConfig } } {
  if (!isImageNode(node)) return false;
  if (node.type !== 'imageExtGen') return false;
  // ★ 运行时兜底：无 extConfig 不判定为扩展节点，避免空值风险
  if (!node.data?.extConfig) return false;
  return true;
}

export function isImageGenNode(node: unknown): node is AppNode & { type: 'imageGen'; data: ImageNodeData } {
  if (!isImageNode(node)) return false;
  return node.type === 'imageGen';
}

export function isImageNode(node: unknown): node is AppNode & { data: ImageNodeData } {
  if (!node || typeof node !== 'object') return false;
  const type = (node as { type?: string }).type;
  return type === 'imageGen' || type === 'imageExtGen';
}

export function isTextNode(node: AppNode): node is AppNode & { data: TextNodeData } {
  return node.type === 'text';
}

export function isMultiImageNode(node: AppNode): node is AppNode & { data: MultiImageNodeData } {
  return node.type === 'multiImageGen';
}

export function isVideoGenNode(node: AppNode): node is AppNode & { data: VideoNodeData } {
  return node.type === 'videoGen';
}

export function isAudioGenNode(node: AppNode): node is AppNode & { data: AudioNodeData } {
  return node.type === 'audioGen';
}

// ========== Private helpers ==========

function getNode(nodes: Record<string, AppNode>, nodeId: string): AppNode | undefined {
  return nodes[nodeId];
}

// 桥接白名单：仅低频图片身份字段同步 canvasStore（订阅 canvasStore 的组件实时响应），
// 防高频 updateConfig 路径（未知字段）引发全画布重渲染。
const CANVAS_BRIDGE_KEYS = new Set(['fileId', 'referenceImage', 'status', 'images']);

function bridgeToCanvasStore(nodeId: string, patch: Record<string, unknown>) {
  const cs = useCanvasStore.getState();
  const exists = cs.nodes.some((n) => n.id === nodeId);
  if (!exists) return;
  useCanvasStore.setState({
    nodes: cs.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)),
  });
}

/** 批4b-1：ns 数据 patch 写入体（set ns + 白名单键桥 cs）——applyNodeDataPatch action 与
 *  canvasIntents 投影回填共用写形状。投影不得反调换芯 action（dispatch→action→dispatch
 *  递归在此断链），故抽导出共享。删键约定（intent 契约）：patch 值 undefined ⇒ 物理删键
 *  ——对现有调用方（不传 undefined）与原 spread 形状输出零差异（canvasStore.patchGroupData 同款手法）。 */
export function applyDataPatchToStores(nodeId: string, patch: Record<string, unknown>) {
  const existing = useNodeStore.getState().nodes[nodeId];
  if (!existing) return;
  const nextData = { ...existing.data, ...patch };
  for (const k of Object.keys(patch)) if (patch[k] === undefined) delete (nextData as any)[k];
  useNodeStore.setState((s) => ({
    nodes: {
      ...s.nodes,
      [nodeId]: {
        ...existing,
        data: nextData as unknown as NodeData,
      },
    },
  }));
  // 桥白名单键到 canvasStore（图片身份/状态 → 多选工具条等订阅方实时响应——桥语义不变；
  // undefined 值键已物理删——不桥"删键"（cs 镜像桥只覆盖值写，删键场景现状无调用方））
  const bridged = Object.entries(patch).filter(([k, v]) => CANVAS_BRIDGE_KEYS.has(k) && v !== undefined);
  if (bridged.length > 0) {
    bridgeToCanvasStore(nodeId, Object.fromEntries(bridged));
  }
}

// 批2-2 VIEWER 第二层（UX 预检）：ns 内容写收口 wrapper 的 toast 节流窗——
// 同一节点 2s 内不重复弹（拖拽/连续键入不风暴），异节点各自计时
const VIEWER_TOAST_THROTTLE_MS = 2_000;
const viewerToastAt = new Map<string, number>();

/** 测试缝（只读复位）：节流窗跨用例复位——防用例顺序依赖（runtime getDoc 同先例） */
export function _resetViewerToastForTest() {
  viewerToastAt.clear();
}

/** Merge root-level allImages + legacy nested prompt.allImages, dedupe by id (missed cleanup is irreversible; duplicate DELETE is harmless) */
/**
 * Merge node config — type-agnostic, works for image/video/text nodes.
 * Preserves all existing fields, applies overrides, fills missing defaults.
 */
function mergeNodeData(existing: Record<string, any> | undefined, overrides: Record<string, any>, nodeType?: string): Record<string, any> {
  const defaults: Record<string, any> = {
    status: 'idle',
    imageRotation: 0 as 0 | 90 | 180 | 270,
    flipH: false,
    flipV: false,
    // editMode/transformMode 不入 defaults（Spec B editMode 口径 13）：本地瞬态键随写点显式
    // 进 ns data（读面 ?? 兜底），defaults 注入会让全量对账把瞬态键常态化
    allImages: [] as ImageItem[],
  };

  const imageGenDefaults = {
    style: '写实',
    model: 'sdxl',
    quality: 'standard',
    ratio: '16:9',
    resolution: '2K',
    prompt: { text: '', html: '', referencedImageIds: [] },
  };

  const merged = { ...(existing ?? {}) };

  for (const [key, value] of Object.entries(overrides)) {
    merged[key] = value;
  }

  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in merged)) merged[key] = value;
  }

  // Apply imageGen defaults for imageGen nodes or when creating via updateConfig (no existing node)
  if (nodeType === NODE_TYPES.IMAGE_GEN || !nodeType) {
    for (const [key, value] of Object.entries(imageGenDefaults)) {
      if (!(key in merged)) merged[key] = value;
    }
  }

  // Apply extConfig defaults for imageExtGen nodes
  if (nodeType === NODE_TYPES.IMAGE_EXT_GEN && !merged.extConfig) {
    merged.extConfig = { ...IMAGE_EXT_DEFAULTS };
  }

  return merged;
}

// ========== Store interface ==========

interface NodeState {
  nodes: Record<string, AppNode>;
  activeTransformNodeId: string | null;

  // 批1-6（B2）：执行状态合并视图两源（均 canvasCollabRuntime 唯一写者，UI 经 selectExecStatus 读）
  execStatus: Map<string, ExecStatusEntry>;  // doc exec map 投影（服务端唯一写者）
  execAligned: Map<string, ExecStatusEntry>; // 断连恢复 intents 查表终态（只读对齐——零 doc 写）

  referenceSelect: { sourceNodeId: string; notice: string | null } | null;
  startReferenceSelect: (nodeId: string) => void;
  exitReferenceSelect: () => void;
  flashReferenceNotice: (text: string) => void;

  addNode: (node: AppNode) => void;
  updateNodeData: <T>(nodeId: string, data: Partial<T>) => void;
  deleteNode: (nodeId: string) => Promise<void>;

  // 批2-2 VIEWER 第二层：ns 内容写收口 wrapper（canEdit 假时早退+toast 节流；
  // 真时等价原 ConfigPanel setState 直写行为 + 白名单键桥接 cs）
  applyNodeDataPatch: (nodeId: string, patch: Record<string, unknown>) => void;

  updateText: (id: string, content: string) => void;
  updateConfig: (id: string, config: Partial<NodeData>) => void;
  updateExtConfig: (id: string, partial: Partial<ImageExtConfig>) => void;
  setStatus: (id: string, status: ImageNodeData['status']) => void;
  setFileResult: (id: string, fileId: string) => void;
  updatePromptImages: (nodeId: string, allImages: ImageItem[]) => void;
  updateMultiImageImages: (nodeId: string, images: ImageItem[]) => void;
  setMainImageIndex: (nodeId: string, index: number) => void;
  toggleExpanded: (nodeId: string) => void;
  updateMultiImageNodeStatus: (nodeId: string, status: MultiImageNodeData['nodeStatus']) => void;
  getNodeData: <T>(id: string) => T | undefined;

  // Video trim actions
  updateVideoTrim: (nodeId: string, trimStart: number, trimEnd: number) => void;
  setTrimTaskStatus: (nodeId: string, status: string) => void;
  setTrimmedResult: (nodeId: string, fileId: string) => void;

  // Transform toolbar support
  cancelRequestedAt: number;
  setActiveTransformNodeId: (id: string | null) => void;
  triggerCancelTransform: () => void;
  activeEditNodeId: string | null;
  setActiveEditNodeId: (id: string | null) => void;
  triggerCancelEdit: () => void;
  getEditOverlayDragging: () => boolean;
  setEditOverlayDragging: (v: boolean) => void;
  saveHandlers: Record<string, () => Promise<void>>;
  registerSaveHandler: (nodeId: string, handler: () => Promise<void>) => void;
  unregisterSaveHandler: (nodeId: string) => void;
  saveTransformNode: (nodeId: string) => Promise<void>;

  // Annotation state
  annotationState: AnnotationState | null;
  initAnnotationState: () => void;
  updateAnnotationTool: (tool: AnnotationState['tool']) => void;
  updateAnnotationColor: (color: string) => void;
  updateAnnotationLineWidth: (lineWidth: number) => void;
  pushDrawOp: (op: DrawOp) => void;
  undoDrawOp: () => DrawOp | null;
  redoDrawOp: () => DrawOp | null;
  clearAnnotationState: () => void;
}

// ========== Store ==========

let _editOverlayDragging = false;

let _referenceNoticeTimer: ReturnType<typeof setTimeout> | null = null;

export const useNodeStore = create<NodeState>((set, get) => ({
  nodes: {},
  execStatus: new Map(),
  execAligned: new Map(),
  activeTransformNodeId: null,
  referenceSelect: null,
  cancelRequestedAt: 0,
  saveHandlers: {},
  activeEditNodeId: null,
  annotationState: null,

  getEditOverlayDragging: () => _editOverlayDragging,
  setEditOverlayDragging: (v) => { _editOverlayDragging = v; },

  setActiveTransformNodeId: (id) => {
    if (id !== null && get().activeEditNodeId !== null) return;
    if (id !== null && get().referenceSelect) set({ referenceSelect: null }); // 编辑/变换模式进入即退出参考选择（spec §3.1）
    set({ activeTransformNodeId: id });
  },
  triggerCancelTransform: () => {
    if (_editOverlayDragging) return;
    set({ cancelRequestedAt: Date.now() });
  },

  setActiveEditNodeId: (id) => {
    if (id !== null && get().activeTransformNodeId !== null) return;
    if (id !== null && get().referenceSelect) set({ referenceSelect: null }); // 编辑/变换模式进入即退出参考选择（spec §3.1）
    set({ activeEditNodeId: id });
  },
  startReferenceSelect: (nodeId) => set({ referenceSelect: { sourceNodeId: nodeId, notice: null } }),
  exitReferenceSelect: () => set({ referenceSelect: null }),
  flashReferenceNotice: (text) => {
    set((s) => (s.referenceSelect ? { referenceSelect: { ...s.referenceSelect, notice: text } } : s));
    if (_referenceNoticeTimer) clearTimeout(_referenceNoticeTimer);
    _referenceNoticeTimer = setTimeout(() => {
      set((s) => (s.referenceSelect ? { referenceSelect: { ...s.referenceSelect, notice: null } } : s));
    }, 2200);
  },
  triggerCancelEdit: () => {
    if (_editOverlayDragging) return;
    set({ cancelRequestedAt: Date.now() });
  },

  registerSaveHandler: (nodeId, handler) =>
    set((s) => ({ saveHandlers: { ...s.saveHandlers, [nodeId]: handler } })),
  unregisterSaveHandler: (nodeId) =>
    set((s) => {
      const { [nodeId]: _, ...rest } = s.saveHandlers;
      return { saveHandlers: rest };
    }),
  saveTransformNode: async (nodeId) => {
    const handler = get().saveHandlers[nodeId];
    if (!handler) return;
    try { await handler(); } catch (err) { console.error(`保存节点 ${nodeId} 失败:`, err); }
  },

  // ── Annotation actions ──

  initAnnotationState: () => {
    if (!get().activeEditNodeId) return;
    set({
      annotationState: {
        tool: 'pen',
        color: ANNOTATION_DEFAULTS.color,
        lineWidth: ANNOTATION_DEFAULTS.lineWidth,
        history: [],
        redoStack: [],
      },
      cancelRequestedAt: 0,
    });
  },

  updateAnnotationTool: (tool) => {
    set(s => ({ annotationState: s.annotationState ? { ...s.annotationState, tool } : null }));
  },

  updateAnnotationColor: (color) => {
    set(s => ({ annotationState: s.annotationState ? { ...s.annotationState, color } : null }));
  },

  updateAnnotationLineWidth: (lineWidth) => {
    set(s => ({ annotationState: s.annotationState ? { ...s.annotationState, lineWidth } : null }));
  },

  pushDrawOp: (op) => {
    const state = get().annotationState;
    if (!state) return;
    const next = [...state.history, op];
    if (next.length > ANNOTATION_DEFAULTS.maxHistory) next.shift();
    set({ annotationState: { ...state, history: next, redoStack: [] } });
  },

  undoDrawOp: () => {
    const state = get().annotationState;
    if (!state || state.history.length === 0) return null;
    const history = [...state.history];
    const op = history.pop()!;
    set({ annotationState: { ...state, history, redoStack: [...state.redoStack, op] } });
    return op;
  },

  redoDrawOp: () => {
    const state = get().annotationState;
    if (!state || state.redoStack.length === 0) return null;
    const redoStack = [...state.redoStack];
    const op = redoStack.pop()!;
    set({ annotationState: { ...state, history: [...state.history, op], redoStack } });
    return op;
  },

  clearAnnotationState: () => set({ annotationState: null }),

  addNode: (node) => {
    set((s) => ({
      nodes: {
        ...s.nodes,
        [node.id]: { ...node },
      },
    }));
  },

  updateNodeData: <T>(nodeId: string, data: Partial<T>) => {
    const existing = getNode(get().nodes, nodeId);
    if (!existing) return;

    // 批4b-2 换芯：doc data 直写经意图漏斗（浅合并 patch——与下方 set 同值；doc 无此节点时
    // applyIntentToDoc no-op，同旧订阅路径"投影不含"语义）
    dispatchCanvasIntent({ type: 'updateNodeData', id: nodeId, patch: data as Record<string, unknown> }, Origin.LocalUser);
    set((s) => ({
      nodes: {
        ...s.nodes,
        [nodeId]: {
          ...existing,
          data: {
            ...existing.data,
            ...(data as Record<string, unknown>),
          } as NodeData,
        },
      },
    }));
  },

  deleteNode: async (nodeId: string) => {
    // TD-15：画布节点删除不触发文件清理——Media 行是素材库/历史资产（软删为产品语义），
    // 生成结果不随节点删除（TD-11 D1 语义扩展至 imageGen/trim）
    const newNodes = { ...get().nodes };
    delete newNodes[nodeId];
    set({ nodes: newNodes });
  },

  applyNodeDataPatch: (nodeId, patch) => {
    // 批2-2 VIEWER 第二层：canEdit 假（readOnly/terminal/非 ready）时早退——被拒时 store 从未
    // 变更（无"先改后回弹"、无 reconcile）；doc 零写由第一层硬门兜底（本层是 UX 面）
    if (!canEdit(useCanvasStore.getState())) {
      const now = Date.now();
      if (now - (viewerToastAt.get(nodeId) ?? 0) >= VIEWER_TOAST_THROTTLE_MS) {
        viewerToastAt.set(nodeId, now);
        message.warning('当前为只读会话，编辑未生效');
      }
      return;
    }
    // 批4b-1 换芯：协作语义走意图漏斗（doc 首写+投影回填；dispatch 前置门重复拦截无害）；
    // 下方写入体保留——与投影双写同值幂等（组 2 删旧路径后投影是唯一 store 写者）
    dispatchCanvasIntent({ type: 'updateNodeData', id: nodeId, patch }, Origin.LocalUser);
    applyDataPatchToStores(nodeId, patch);
  },

  updateText: (id, content) => {
    // 批4b-2 换芯：content 键 doc 直写（node 不在 doc 时 no-op——同旧订阅路径投影不含语义）
    dispatchCanvasIntent({ type: 'updateNodeData', id, patch: { content } }, Origin.LocalUser);
    const existing = getNode(get().nodes, id);
    if (existing) {
      set((s) => ({
        nodes: {
          ...s.nodes,
          [id]: {
            ...existing,
            data: { ...existing.data, content },
          },
        },
      }));
    } else {
      set((s) => ({
        nodes: {
          ...s.nodes,
          [id]: {
            id,
            type: 'text',
            data: { content },
          },
        },
      }));
    }
  },

  updateConfig: (id, config) => {
    const existing = getNode(get().nodes, id);
    const nodeType = existing?.type;

    // I-3 幽灵守卫：双 store 均无此节点（undo 撤销创建后生成完成回调迟到）→ 丢弃。
    // abort() 拦不住已入微任务队列的完成回调；若不拦截会经此处重建 nodeStore 条目，
    // 被 persistence 快照持久化 → 下次刷新幽灵复活
    if (!existing && !useCanvasStore.getState().nodes.some((n) => n.id === id)) return;

    // ★ 代码层强制过滤 extConfig，杜绝误覆盖
    if ('extConfig' in (config as any)) {
      console.warn('[nodeStore] updateConfig 不允许传入 extConfig，已自动过滤');
      delete (config as any).extConfig;
    }

    const merged = mergeNodeData(existing?.data, config, nodeType) as NodeData;
    // 批4b-2 换芯：doc data 直写=mergeNodeData 终态全量（旧订阅路径同步的就是该 ns 终态——
    // defaults 填充随写直达 doc，缺省键漂移由投影不变量兜住）
    dispatchCanvasIntent(
      { type: 'updateNodeData', id, patch: merged as unknown as Record<string, unknown> },
      Origin.LocalUser,
    );
    set((s) => ({
      nodes: {
        ...s.nodes,
        [id]: {
          id,
          // Preserve node type — never overwrite (image/video/text each own their type)
          type: nodeType ?? 'imageGen',
          selected: existing?.selected,
          dragging: existing?.dragging,
          data: merged,
        },
      },
    }));

    // 桥接白名单字段到 canvasStore（图片身份/状态 → 多选工具条等订阅方实时响应）
    const bridged = Object.entries(config).filter(([k]) => CANVAS_BRIDGE_KEYS.has(k));
    if (bridged.length > 0) {
      bridgeToCanvasStore(id, Object.fromEntries(bridged));
    }
  },

  updateExtConfig: (nodeId, partial) => {
    const node = getNode(get().nodes, nodeId);
    if (!node || !isImageExtNode(node)) return;
    // 批4b-2 换芯：extConfig 合并终态落 doc（整键对象值——isEqual 守卫防膨胀）
    dispatchCanvasIntent(
      { type: 'updateNodeData', id: nodeId, patch: { extConfig: { ...node.data.extConfig, ...partial } } },
      Origin.LocalUser,
    );
    set((s) => ({
      nodes: {
        ...s.nodes,
        [nodeId]: {
          ...node,
          data: {
            ...node.data,
            extConfig: { ...node.data.extConfig, ...partial },
          },
        },
      },
    }));
  },

  setStatus: (id, status) => {
    // 批4b-1 换芯：doc 直写经意图漏斗（canEdit 假时 dispatch 拦 doc——下方 set 照写=既有回弹语义）
    dispatchCanvasIntent({ type: 'updateNodeData', id, patch: { status } }, Origin.LocalUser);
    const existing = getNode(get().nodes, id);
    if (!existing) return;
    set((s) => ({
      nodes: {
        ...s.nodes,
        [id]: {
          ...existing,
          data: { ...existing.data, status },
        },
      },
    }));
  },

  setFileResult: (id, fileId) => {
    // 批2-2：AI 落地改走收口 wrapper（原 :243 桥直灌路径）——readOnly 时 fileId/status 不写入
    // store。拒本地写非丢数据：服务端产物经 doc exec map 投影照旧可见（批1-6 双源）
    get().applyNodeDataPatch(id, { fileId, status: 'done' });
  },

  updatePromptImages: (nodeId, allImages) => {
    // 批4b-2 换芯：allImages 键 doc 直写（text 节点 no-op 同旧——ns 面与 doc 面同判）
    const node = get().nodes[nodeId];
    if (node && node.type !== 'text') {
      dispatchCanvasIntent({ type: 'updateNodeData', id: nodeId, patch: { allImages } }, Origin.LocalUser);
    }
    set((state) => {
      const n = state.nodes[nodeId];
      // text nodes have no prompt — noop. image/video nodes share prompt shape.
      if (!n || n.type === 'text') return state;
      return {
        nodes: {
          ...state.nodes,
          [nodeId]: {
            ...n,
            data: {
              ...n.data,
              allImages,  // ★ root-level shared field, no longer nested in prompt
            },
          },
        },
      };
    });
  },

  updateMultiImageImages: (nodeId, images) => {
    const existing = getNode(get().nodes, nodeId);
    if (!existing) return;
    // 批4b-2 换芯：增量 patch 与下方 set 同值（含清空/越界回正条件键）
    const patch: Record<string, unknown> = { images };
    if (images.length === 0) { patch.mainImageIndex = -1; patch.nodeStatus = 'idle'; }
    else if ('mainImageIndex' in existing.data && (existing.data as any).mainImageIndex >= images.length) {
      patch.mainImageIndex = 0;
    }
    dispatchCanvasIntent({ type: 'updateNodeData', id: nodeId, patch }, Origin.LocalUser);
    set((s) => ({
      nodes: {
        ...s.nodes,
        [nodeId]: {
          ...existing,
          data: {
            ...existing.data,
            images,
            ...(images.length === 0 ? { mainImageIndex: -1, nodeStatus: 'idle' as const } : {}),
            ...(images.length > 0 && 'mainImageIndex' in existing.data && (existing.data as any).mainImageIndex >= images.length ? { mainImageIndex: 0 } : {}),
          },
        },
      },
    }));
    bridgeToCanvasStore(nodeId, { images });
  },

  setMainImageIndex: (nodeId, index) => {
    const existing = getNode(get().nodes, nodeId);
    if (!existing || !isMultiImageNode(existing)) return;
    dispatchCanvasIntent({ type: 'updateNodeData', id: nodeId, patch: { mainImageIndex: index } }, Origin.LocalUser);
    set((s) => ({
      nodes: {
        ...s.nodes,
        [nodeId]: {
          ...existing,
          data: { ...existing.data, mainImageIndex: index },
        },
      },
    }));
  },

  toggleExpanded: (nodeId) => {
    const existing = getNode(get().nodes, nodeId);
    if (!existing) return;
    dispatchCanvasIntent(
      { type: 'updateNodeData', id: nodeId, patch: { expanded: !(existing.data as any).expanded } },
      Origin.LocalUser,
    );
    set((s) => ({
      nodes: {
        ...s.nodes,
        [nodeId]: {
          ...existing,
          data: { ...existing.data, expanded: !(existing.data as any).expanded },
        },
      },
    }));
  },

  updateMultiImageNodeStatus: (nodeId, status) => {
    const existing = getNode(get().nodes, nodeId);
    if (!existing) return;
    dispatchCanvasIntent({ type: 'updateNodeData', id: nodeId, patch: { nodeStatus: status } }, Origin.LocalUser);
    set((s) => ({
      nodes: {
        ...s.nodes,
        [nodeId]: {
          ...existing,
          data: { ...existing.data, nodeStatus: status },
        },
      },
    }));
  },

  getNodeData: <T>(id: string): T | undefined => {
    return getNode(get().nodes, id)?.data as T | undefined;
  },

  // ── Video trim actions ──
  // 批4b-2 换芯：trim 三写点 doc 直写经意图漏斗（dispatch 前置——与下方 set 同值幂等）

  updateVideoTrim: (nodeId, trimStart, trimEnd) => {
    const existing = getNode(get().nodes, nodeId);
    if (!existing) return;
    dispatchCanvasIntent({ type: 'updateNodeData', id: nodeId, patch: { trimStart, trimEnd } }, Origin.LocalUser);
    set((s) => ({
      nodes: {
        ...s.nodes,
        [nodeId]: {
          ...existing,
          data: { ...existing.data, trimStart, trimEnd },
        },
      },
    }));
  },

  setTrimTaskStatus: (nodeId, status) => {
    const existing = getNode(get().nodes, nodeId);
    if (!existing) return;
    dispatchCanvasIntent({ type: 'updateNodeData', id: nodeId, patch: { trimTaskStatus: status } }, Origin.LocalUser);
    set((s) => ({
      nodes: {
        ...s.nodes,
        [nodeId]: {
          ...existing,
          data: { ...existing.data, trimTaskStatus: status },
        },
      },
    }));
  },

  setTrimmedResult: (nodeId, fileId) => {
    const existing = getNode(get().nodes, nodeId);
    if (!existing) return;
    dispatchCanvasIntent(
      { type: 'updateNodeData', id: nodeId, patch: { trimmedFileId: fileId, trimTaskStatus: 'done' } },
      Origin.LocalUser,
    );
    set((s) => ({
      nodes: {
        ...s.nodes,
        [nodeId]: {
          ...existing,
          data: { ...existing.data, trimmedFileId: fileId, trimTaskStatus: 'done' as const },
        },
      },
    }));
  },
}));

/** 批1-6（B2）：合并视图读点辅助（非 React 消费方——canvasStore 动作/guards 等）。
 *  组件渲染读用 useNodeStore((s) => selectExecStatus(s, id)) 订阅触发重渲；本函数读当前快照。 */
export function execStatusOf(nodeId: string): NodeExecStatus {
  return selectExecStatus(useNodeStore.getState(), nodeId);
}

/** 批1-6（B2）：exec 覆盖值（无条目=undefined）——data 回落交调用方自己的 data 源
 *  （canvasStore 节点为数据源的读点专用，如 GroupNode cellNodes）。 */
export function execOverrideOf(nodeId: string): NodeExecStatus | undefined {
  return execOverrideStatus(useNodeStore.getState(), nodeId);
}
