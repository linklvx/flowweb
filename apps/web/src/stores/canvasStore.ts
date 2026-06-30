import { create } from 'zustand';
import {
  type Node, type Edge, type XYPosition,
  applyNodeChanges, applyEdgeChanges,
  type NodeChange, type EdgeChange, type Connection,
} from '@xyflow/react';
import { useNodeStore, IMAGE_EXT_DEFAULTS } from './nodeStore';
import type { MaterialFile } from '@flowweb/shared';
import type { AiToolId } from './nodeStore';
import { message } from 'antd';
import { loadImage, splitImageToBlobs, scaleToMaxSize, validateGridParams, isSubImageTooSmall, MIN_SUB_IMAGE_PX } from '@/utils/imageSplit';
import { uploadSplitBlobs } from '@/utils/splitUploadService';
import { getMediaUrl } from '@/api/mediaApi';

let counter = 0;
function getId(prefix: string) {
  return `${prefix}_${Date.now()}_${++counter}`;
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
}

interface SplitResult {
  newIds: string[];
  sourcePosition: { x: number; y: number };
  sourceSize: { w: number; h: number };
}

interface CreateDerivedExtNodeParams {
  sourceNodeId: string;
  referenceImage?: string;
  aiTool: AiToolId;
}

interface CanvasState {
  nodes: Node[];
  edges: Edge[];
  viewport: { x: number; y: number; zoom: number };
  selectedId: string | null;
  pendingMediaFile: MaterialFile | null;
  splittingNodeId: string | null;
  splitAbortMap: Record<string, AbortController>;

  addNode: (type: string, position: XYPosition, dataOverride?: Record<string, unknown>) => string;
  copyNode: (id: string) => string | null;
  addChildNode: (sourceId: string, data: Record<string, unknown>) => string | null;
  addChildNodes: (sourceId: string, nodeDataList: AddChildNodeItem[]) => string[];
  addNodeWithEdge: (sourceId: string) => string | null;
  deleteNode: (id: string) => void;
  deleteTransformNode: (id: string) => void;
  setNodeDraggable: (nodeId: string, draggable: boolean) => void;
  selectNode: (id: string | null) => void;
  requestAddMediaNode: (file: MaterialFile) => void;
  updateViewport: (vp: { x: number; y: number; zoom: number }) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  splitImageNode: (nodeId: string, rows: number, cols: number) => Promise<SplitResult | null>;
  createDerivedExtNode: (params: CreateDerivedExtNodeParams) => string | null;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  selectedId: null,
  pendingMediaFile: null,
  splittingNodeId: null,
  splitAbortMap: {},

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
    // Abort any in-progress split task for this node
    const state = get();
    if (state.splitAbortMap[id]) {
      state.splitAbortMap[id].abort();
    }
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    }));
  },

  deleteTransformNode: (id) => {
    // Abort any in-progress split task
    const state = get();
    if (state.splitAbortMap[id]) {
      state.splitAbortMap[id].abort();
    }
    const ns = useNodeStore.getState();
    ns.deleteNode(id);
    ns.unregisterSaveHandler(id);
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    }));
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

  addChildNode: (sourceId, data) => {
    const sourceNode = get().nodes.find((n) => n.id === sourceId);
    if (!sourceNode) return null;
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

    set((s) => ({
      nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), newNode],
      edges: [...s.edges, edge],
      selectedId: id,
    }));

    useNodeStore.getState().addNode({
      id,
      type: sourceNode.type!,
      position: newNode.position,
      data: data as any,
    });

    return id;
  },

  addChildNodes: (sourceId, nodeDataList) => {
    const sourceNode = get().nodes.find((n) => n.id === sourceId);
    if (!sourceNode || nodeDataList.length === 0) return [];

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
      const edgeId = getId('edge');

      const x = startX + item.gridCol * (sw + GAP);
      const y = startY + item.gridRow * (sh + GAP);

      const newNode: Node = {
        id: nodeId,
        type: sourceNode.type,
        position: { x, y },
        data: item.data,
        selected: false,
      };

      const edge: Edge = { id: edgeId, source: sourceId, target: nodeId };

      newNodes.push(newNode);
      newEdges.push(edge);
      newIds.push(nodeId);
    }

    set((s) => ({
      nodes: [...s.nodes, ...newNodes],
      edges: [...s.edges, ...newEdges],
    }));

    const ns = useNodeStore.getState();
    for (const node of newNodes) {
      ns.addNode({
        id: node.id,
        type: node.type!,
        position: node.position,
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

    set((s) => ({
      nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), newNode],
      edges: [...s.edges, edge],
      selectedId: id,
    }));

    // Copy source node data to nodeStore + set transformMode
    const sourceNsNode = useNodeStore.getState().nodes[sourceId];
    const nsData = sourceNsNode?.data ? { ...sourceNsNode.data, transformMode: true, imageRotation: 0, flipH: false, flipV: false } : { transformMode: true };
    useNodeStore.getState().addNode({
      id,
      type: sourceNode.type!,
      position: newNode.position,
      data: nsData as any,
      width: sourceNode.width,
      height: sourceNode.height,
    });

    return id;
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
      allImages: params.referenceImage ? [{ fileId: params.referenceImage }] : [],
      aiTool: params.aiTool,
      extConfig: { ...IMAGE_EXT_DEFAULTS },
    });

    const edgeId = getId('edge');
    const edge: Edge = { id: edgeId, source: params.sourceNodeId, target: newNodeId };
    set((s) => ({ edges: [...s.edges, edge] }));

    return newNodeId;
  },

  selectNode: (id) => set({ selectedId: id }),

  requestAddMediaNode: (file) => set({ pendingMediaFile: file }),

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

  splitImageNode: async (nodeId, rows, cols) => {
    const state = get();

    // Guard: already splitting
    if (state.splittingNodeId !== null) return null;

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
      splittingNodeId: nodeId,
      splitAbortMap: { ...s.splitAbortMap, [nodeId]: ac },
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
        { signal: ac.signal, maxConcurrent: 3, maxRetries: 1, cols, namePrefix },
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
        const { [nodeId]: _, ...restMap } = s.splitAbortMap;
        return { splittingNodeId: null, splitAbortMap: restMap };
      });
    }
  },
}));
