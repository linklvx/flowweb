import { create } from 'zustand';

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
  allImages: ImageItem[];
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
  model?: string;
  quality?: string;
  ratio?: string;
  resolution?: string;
  prompt?: PromptValue;

  // —— imageExtGen 专属 ——
  extConfig?: ImageExtConfig;
  aiTool?: AiToolId;

  // —— 变换保存流程写入的标记（ImageGenNode）——
  isSaving?: boolean;
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
  position: { x: number; y: number };
  selected?: boolean;
  dragging?: boolean;
  width?: number;
  height?: number;
  data: NodeData;
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

// ========== Private helpers ==========

function getNode(nodes: Record<string, AppNode>, nodeId: string): AppNode | undefined {
  return nodes[nodeId];
}

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
    transformMode: false,
    editMode: null,
    allImages: [] as ImageItem[],
  };

  const imageGenDefaults = {
    style: '写实',
    model: 'sdxl',
    quality: 'standard',
    ratio: '16:9',
    resolution: '2K',
    prompt: { text: '', html: '', allImages: [], referencedImageIds: [] },
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

  addNode: (node: AppNode) => void;
  updateNodeData: <T>(nodeId: string, data: Partial<T>) => void;
  deleteNode: (nodeId: string) => Promise<void>;

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

export const useNodeStore = create<NodeState>((set, get) => ({
  nodes: {},
  activeTransformNodeId: null,
  cancelRequestedAt: 0,
  saveHandlers: {},
  activeEditNodeId: null,
  annotationState: null,

  getEditOverlayDragging: () => _editOverlayDragging,
  setEditOverlayDragging: (v) => { _editOverlayDragging = v; },

  setActiveTransformNodeId: (id) => {
    if (id !== null && get().activeEditNodeId !== null) return;
    set({ activeTransformNodeId: id });
  },
  triggerCancelTransform: () => {
    if (_editOverlayDragging) return;
    set({ cancelRequestedAt: Date.now() });
  },

  setActiveEditNodeId: (id) => {
    if (id !== null && get().activeTransformNodeId !== null) return;
    set({ activeEditNodeId: id });
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
        [node.id]: {
          ...node,
          position: node.position ?? { x: 0, y: 0 },
        },
      },
    }));
  },

  updateNodeData: <T>(nodeId: string, data: Partial<T>) => {
    const existing = getNode(get().nodes, nodeId);
    if (!existing) return;

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
    const node = getNode(get().nodes, nodeId);
    if (node && isImageNode(node)) {
      const imgData = node.data;
      // Merge root-level + legacy nested refs, dedupe by id (missed cleanup is irreversible; duplicate DELETE is harmless)
      const rootImgs = imgData.allImages ?? [];
      const nestedImgs = imgData.prompt?.allImages ?? [];
      const allRefs = [...new Map([...rootImgs, ...nestedImgs].map((img) => [img.id, img])).values()];
      const deleteRefs = allRefs.map((img) =>
        fetch(`/api/storage/files/${img.id}`, { method: 'DELETE' }).catch(() => {})
      );
      await Promise.allSettled(deleteRefs);
      if (imgData.fileId) {
        await fetch(`/api/storage/files/${imgData.fileId}`, { method: 'DELETE' }).catch(() => {});
      }
    }
    if (node && isMultiImageNode(node)) {
      const imgData = node.data;
      const deleteRefs = imgData.images.map((img) =>
        fetch(`/api/storage/files/${img.id}`, { method: 'DELETE' }).catch(() => {})
      );
      await Promise.allSettled(deleteRefs);
    }

    const newNodes = { ...get().nodes };
    delete newNodes[nodeId];
    set({ nodes: newNodes });
  },

  updateText: (id, content) => {
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
            position: { x: 0, y: 0 },
            data: { content },
          },
        },
      }));
    }
  },

  updateConfig: (id, config) => {
    const existing = getNode(get().nodes, id);
    const nodeType = existing?.type;

    // ★ 代码层强制过滤 extConfig，杜绝误覆盖
    if ('extConfig' in (config as any)) {
      console.warn('[nodeStore] updateConfig 不允许传入 extConfig，已自动过滤');
      delete (config as any).extConfig;
    }

    set((s) => ({
      nodes: {
        ...s.nodes,
        [id]: {
          id,
          // Preserve node type — never overwrite (image/video/text each own their type)
          type: nodeType ?? 'imageGen',
          position: existing?.position ?? { x: 0, y: 0 },
          selected: existing?.selected,
          dragging: existing?.dragging,
          data: mergeNodeData(existing?.data, config, nodeType) as NodeData,
        },
      },
    }));
  },

  updateExtConfig: (nodeId, partial) => {
    const node = getNode(get().nodes, nodeId);
    if (!node || !isImageExtNode(node)) return;
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
    const existing = getNode(get().nodes, id);
    if (!existing) return;
    set((s) => ({
      nodes: {
        ...s.nodes,
        [id]: {
          ...existing,
          data: { ...existing.data, fileId, status: 'done' as const },
        },
      },
    }));
  },

  updatePromptImages: (nodeId, allImages) => {
    set((state) => {
      const node = state.nodes[nodeId];
      // text nodes have no prompt — noop. image/video nodes share prompt shape.
      if (!node || node.type === 'text') return state;
      return {
        nodes: {
          ...state.nodes,
          [nodeId]: {
            ...node,
            data: {
              ...node.data,
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
  },

  setMainImageIndex: (nodeId, index) => {
    const existing = getNode(get().nodes, nodeId);
    if (!existing || !isMultiImageNode(existing)) return;
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

  updateVideoTrim: (nodeId, trimStart, trimEnd) => {
    const existing = getNode(get().nodes, nodeId);
    if (!existing) return;
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
