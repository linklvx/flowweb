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
}

export interface VideoNodeData {
  model: string;
  status: 'idle' | 'loading' | 'done' | 'error';
  fileId?: string;
}

export type NodeData = TextNodeData | ImageNodeData | VideoNodeData;

// ========== AppNode (React Flow aligned) ==========

export interface AppNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  selected?: boolean;
  dragging?: boolean;
  data: NodeData;
}

// ========== Type guards ==========

export function isImageNode(node: AppNode): node is AppNode & { data: ImageNodeData } {
  return node.type === 'imageGen';
}

export function isTextNode(node: AppNode): node is AppNode & { data: TextNodeData } {
  return node.type === 'text';
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
    ratio: '1:1',
    prompt: { text: '', html: '', allImages: [] as ImageItem[], referencedImageIds: [] as string[] },
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

  addNode: (node: AppNode) => void;
  updateNodeData: <T>(nodeId: string, data: Partial<T>) => void;
  deleteNode: (nodeId: string) => Promise<void>;

  updateText: (id: string, content: string) => void;
  updateConfig: (id: string, config: Partial<ImageNodeData>) => void;
  setStatus: (id: string, status: ImageNodeData['status']) => void;
  setFileResult: (id: string, fileId: string) => void;
  updatePromptImages: (nodeId: string, allImages: ImageItem[]) => void;
  getNodeData: <T>(id: string) => T | undefined;
}

// ========== Store ==========

export const useNodeStore = create<NodeState>((set, get) => ({
  nodes: {},

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
      const deleteRefs = imgData.prompt.allImages.map((img) =>
        fetch(`/api/storage/files/${img.id}`, { method: 'DELETE' }).catch(() => {})
      );
      await Promise.allSettled(deleteRefs);
      if (imgData.fileId) {
        await fetch(`/api/storage/files/${imgData.fileId}`, { method: 'DELETE' }).catch(() => {});
      }
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

  getNodeData: <T>(id: string): T | undefined => {
    return getNode(get().nodes, id)?.data as T | undefined;
  },
}));
