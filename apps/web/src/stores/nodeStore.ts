import { create } from 'zustand';

interface TextNodeData {
  type: 'text';
  content: string;
}

interface ImageNodeData {
  type: 'image';
  style: string;
  extraPrompt: string;
  model: string;
  resolution: string;
  count: number;
  resultUrl?: string;
  fileId?: string;
  status: 'idle' | 'loading' | 'done' | 'error';
}

type NodeData = TextNodeData | ImageNodeData;

interface ImageConfig {
  style?: string;
  extraPrompt?: string;
  model?: string;
  resolution?: string;
  count?: number;
}

interface NodeState {
  nodes: Record<string, NodeData>;

  updateText: (id: string, content: string) => void;
  updateConfig: (id: string, config: ImageConfig) => void;
  setStatus: (id: string, status: ImageNodeData['status']) => void;
  setResult: (id: string, url: string) => void;
  setFileResult: (id: string, fileId: string) => void;
  getNodeData: (id: string) => NodeData | undefined;
}

export const useNodeStore = create<NodeState>((set, get) => ({
  nodes: {},

  updateText: (id, content) => {
    set((s) => ({
      nodes: { ...s.nodes, [id]: { type: 'text', content } as TextNodeData },
    }));
  },

  updateConfig: (id, config) => {
    const existing = get().nodes[id] as ImageNodeData | undefined;
    set((s) => ({
      nodes: {
        ...s.nodes,
        [id]: {
          type: 'image',
          style: config.style ?? existing?.style ?? '写实',
          extraPrompt: config.extraPrompt ?? existing?.extraPrompt ?? '',
          model: config.model ?? existing?.model ?? 'SD XL',
          resolution: config.resolution ?? existing?.resolution ?? '1024×1024',
          count: config.count ?? existing?.count ?? 1,
          resultUrl: existing?.resultUrl,
          fileId: existing?.fileId,
          status: existing?.status ?? 'idle',
        } as ImageNodeData,
      },
    }));
  },

  setStatus: (id, status) => {
    const existing = get().nodes[id] as ImageNodeData;
    if (!existing) return;
    set((s) => ({
      nodes: { ...s.nodes, [id]: { ...existing, status } },
    }));
  },

  setResult: (id, url) => {
    const existing = get().nodes[id] as ImageNodeData;
    if (!existing) return;
    set((s) => ({
      nodes: { ...s.nodes, [id]: { ...existing, resultUrl: url, status: 'done' as const } },
    }));
  },

  setFileResult: (id, fileId) => {
    const existing = get().nodes[id] as ImageNodeData;
    if (!existing) return;
    set((s) => ({
      nodes: { ...s.nodes, [id]: { ...existing, fileId, status: 'done' as const } },
    }));
  },

  getNodeData: (id) => get().nodes[id],
}));
