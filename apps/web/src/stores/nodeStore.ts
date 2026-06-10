import { create } from 'zustand';

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
  allImages: ImageItem[];
  referencedImageIds: string[];
}

// ========== Node data types ==========

export interface TextNodeData {
  content: string;
  prompt?: string;
}

export interface ImageNodeData {
  style: string;
  model: string;
  quality: string;
  ratio: string;
  fileId?: string;
  referenceImage?: string;
  status: 'idle' | 'loading' | 'done' | 'error';
  prompt: PromptValue;
  imageRotation?: 0 | 90 | 180 | 270;
  flipH?: boolean;
  flipV?: boolean;
  transformMode?: boolean;
  editMode?: 'crop' | 'outpaint' | 'erase' | 'redraw' | null;
}

export interface VideoNodeData {
  model: string;
  status: 'idle' | 'loading' | 'done' | 'error';
  fileId?: string;
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

export function isImageNode(node: AppNode): node is AppNode & { data: ImageNodeData } {
  return node.type === 'imageGen';
}

export function isTextNode(node: AppNode): node is AppNode & { data: TextNodeData } {
  return node.type === 'text';
}

export function isMultiImageNode(node: AppNode): node is AppNode & { data: MultiImageNodeData } {
  return node.type === 'multiImageGen';
}

// ========== Edit state helpers ==========

export interface EditState {
  cropRect?: { x: number; y: number; width: number; height: number };
  outpaintRect?: { x: number; y: number; width: number; height: number };
  maskPaths?: { points: number[] }[];
}

function isDefaultCropRect(rect?: { x: number; y: number; width: number; height: number }): boolean {
  if (!rect) return true;
  return rect.x === 0.1 && rect.y === 0.1 && rect.width === 0.8 && rect.height === 0.8;
}

export function hasEditChanges(editMode: string, editState: EditState): boolean {
  switch (editMode) {
    case 'crop':
      return !isDefaultCropRect(editState.cropRect);
    case 'outpaint': {
      const r = editState.outpaintRect;
      // 保守策略：有 rect 即有变更（精确判断在 ImageGenNode 用图片尺寸做）
      return r != null;
    }
    case 'erase':
    case 'redraw':
      return (editState.maskPaths?.length ?? 0) > 0;
    default:
      return false;
  }
}

// ========== Private helpers ==========

function getNode(nodes: Record<string, AppNode>, nodeId: string): AppNode | undefined {
  return nodes[nodeId];
}

/**
 * Merge node config — type-agnostic, works for image/video/text nodes.
 * Preserves all existing fields, applies overrides, fills missing defaults.
 */
function mergeNodeData(existing: Record<string, any> | undefined, overrides: Record<string, any>): Record<string, any> {
  const defaults: Record<string, any> = {
    status: 'idle',
    style: '写实',
    model: 'sdxl',
    quality: 'standard',
    ratio: '16:9',
    prompt: { text: '', html: '', allImages: [] as ImageItem[], referencedImageIds: [] as string[] },
    imageRotation: 0 as 0 | 90 | 180 | 270,
    flipH: false,
    flipV: false,
    transformMode: false,
    editMode: null,
  };

  const merged = { ...(existing ?? {}) };

  for (const [key, value] of Object.entries(overrides)) {
    merged[key] = value;
  }

  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in merged)) merged[key] = value;
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
  updateConfig: (id: string, config: Partial<ImageNodeData>) => void;
  setStatus: (id: string, status: ImageNodeData['status']) => void;
  setFileResult: (id: string, fileId: string) => void;
  updatePromptImages: (nodeId: string, allImages: ImageItem[]) => void;
  updateMultiImageImages: (nodeId: string, images: ImageItem[]) => void;
  setMainImageIndex: (nodeId: string, index: number) => void;
  toggleExpanded: (nodeId: string) => void;
  updateMultiImageNodeStatus: (nodeId: string, status: MultiImageNodeData['nodeStatus']) => void;
  getNodeData: <T>(id: string) => T | undefined;

  // Transform toolbar support
  cancelRequestedAt: number;
  setActiveTransformNodeId: (id: string | null) => void;
  triggerCancelTransform: () => void;
  activeEditNodeId: string | null;
  setActiveEditNodeId: (id: string | null) => void;
  triggerCancelEdit: () => void;
  saveHandlers: Record<string, () => Promise<void>>;
  registerSaveHandler: (nodeId: string, handler: () => Promise<void>) => void;
  unregisterSaveHandler: (nodeId: string) => void;
  saveTransformNode: (nodeId: string) => Promise<void>;
}

// ========== Store ==========

export const useNodeStore = create<NodeState>((set, get) => ({
  nodes: {},
  activeTransformNodeId: null,
  cancelRequestedAt: 0,
  saveHandlers: {},
  activeEditNodeId: null,

  setActiveTransformNodeId: (id) => {
    if (id !== null && get().activeEditNodeId !== null) return;
    set({ activeTransformNodeId: id });
  },
  triggerCancelTransform: () => set({ cancelRequestedAt: Date.now() }),

  setActiveEditNodeId: (id) => {
    if (id !== null && get().activeTransformNodeId !== null) return;
    set({ activeEditNodeId: id });
  },
  triggerCancelEdit: () => set({ cancelRequestedAt: Date.now() }),

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
      const deleteRefs = (imgData.prompt?.allImages ?? []).map((img) =>
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

    set((s) => ({
      nodes: {
        ...s.nodes,
        [id]: {
          id,
          // Preserve node type — never overwrite (image/video/text each own their type)
          type: existing?.type ?? 'imageGen',
          position: existing?.position ?? { x: 0, y: 0 },
          selected: existing?.selected,
          dragging: existing?.dragging,
          data: mergeNodeData(existing?.data, config),
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
              prompt: { ...node.data.prompt, allImages },
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
}));
