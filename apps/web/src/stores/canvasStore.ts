import { create } from 'zustand';
import {
  type Node, type Edge, type XYPosition,
  applyNodeChanges, applyEdgeChanges,
  type NodeChange, type EdgeChange, type Connection,
} from '@xyflow/react';
import { useNodeStore } from './nodeStore';

let counter = 0;
function getId(prefix: string) {
  return `${prefix}_${Date.now()}_${++counter}`;
}

const nodeTypeMap: Record<string, string> = {
  text: 'textInput',
  image: 'imageGen',
  video: 'videoGen',
  audio: 'audioGen',
  multiImage: 'multiImageGen',
};

interface CanvasState {
  nodes: Node[];
  edges: Edge[];
  viewport: { x: number; y: number; zoom: number };
  selectedId: string | null;

  addNode: (type: string, position: XYPosition) => string;
  copyNode: (id: string) => string | null;
  deleteNode: (id: string) => void;
  selectNode: (id: string | null) => void;
  updateViewport: (vp: { x: number; y: number; zoom: number }) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  selectedId: null,

  addNode: (type, position) => {
    const id = getId('node');
    const resolvedType = nodeTypeMap[type] || type;
    const nodeData = resolvedType === 'textInput' ? { content: '' } : {};
    const node: Node = {
      id,
      type: resolvedType,
      position,
      data: nodeData,
      selected: true,
    };
    if (resolvedType === 'textInput') {
      node.width = 250;
      node.height = 250;
    }
    set((s) => ({
      nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), node],
      selectedId: id,
    }));
    // Also populate nodeStore so ImageGenNode/ImageConfigPanel can read node data
    useNodeStore.getState().addNode({
      id,
      type: resolvedType,
      position,
      data: nodeData as any,
      width: node.width,
      height: node.height,
    });
    return id;
  },

  deleteNode: (id) => {
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    }));
  },

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
    set((s) => ({
      nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), newNode],
      selectedId: id,
    }));
    useNodeStore.getState().addNode({
      id,
      type: node.type!,
      position: newNode.position,
      data: node.data as any,
      width: node.width,
      height: node.height,
    });
    return id;
  },

  selectNode: (id) => set({ selectedId: id }),

  updateViewport: (vp) => set({ viewport: vp }),

  onNodesChange: (changes) => {
    set((s) => {
      const nextNodes = applyNodeChanges(changes, s.nodes) as Node[];
      // Sync dimension changes to nodeStore so components read updated width/height
      for (const change of changes) {
        if (change.type === 'dimensions' && 'dimensions' in change && (change as any).setAttributes) {
          const nodeStore = useNodeStore.getState();
          const existing = nodeStore.nodes[change.id];
          if (existing) {
            const dc = change as any;
            useNodeStore.setState({
              nodes: {
                ...nodeStore.nodes,
                [change.id]: { ...existing, width: dc.dimensions.width, height: dc.dimensions.height },
              },
            });
          }
        }
      }
      return { nodes: nextNodes };
    });
  },

  onEdgesChange: (changes) => {
    set((s) => ({ edges: applyEdgeChanges(changes, s.edges) as Edge[] }));
  },

  onConnect: (connection) => {
    const id = getId('edge');
    const edge: Edge = { id, ...connection };
    set((s) => ({ edges: [...s.edges, edge] }));
  },
}));
