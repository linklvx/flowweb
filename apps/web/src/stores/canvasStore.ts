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
import { deriveHidden, repairStoryboardCells } from '@/utils/groupDerive';
import { ensureParentOrder } from '@/utils/nodeOrder';
import { calcGroupBounds, CELL_WIDTH, CONVERT_GAP, ASPECT_RATIO_MAP, sortNodesByPosition, calcDefaultGrid, calcStoryboardSize, clampPositionToPadding } from '@/utils/groupLayout';
import { isImageCompletedNode } from '@/utils/imageNodeGuards';

/** 组 data 变更双写 nodeStore（localStorage 快照数据源是 nodeStore） */
function syncGroupDataToNodeStore(groupId: string) {
  const ns = useNodeStore.getState();
  const appNode = ns.nodes[groupId];
  const group = useCanvasStore.getState().nodes.find((n) => n.id === groupId);
  if (!appNode || !group) return;
  useNodeStore.setState({ nodes: { ...ns.nodes, [groupId]: { ...appNode, data: group.data as any } } });
}

let counter = 0;
function getId(prefix: string) {
  return `${prefix}_${Date.now()}_${++counter}`;
}

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

interface CanvasState {
  nodes: Node[];
  edges: Edge[];
  viewport: { x: number; y: number; zoom: number };
  selectedId: string | null;
  lastPointerShiftKey: boolean;
  pendingMediaFile: MaterialFile | null;
  pendingFillCell: { groupId: string; cellIndex: number } | null;
  nodeProcessMap: Record<string, NodeProcessState>;
  projectId: string | null;
  teamId: string | null;
  isHydrating: boolean;
  /** 协作连接状态（Task15：autosave 退役）：不进 history/localStorage 快照 */
  connStatus: 'connected' | 'connecting' | 'offline';
  hasActiveProcessInGroup: (groupId: string) => boolean;

  addNode: (type: string, position: XYPosition, dataOverride?: Record<string, unknown>) => string;
  copyNode: (id: string) => string | null;
  addChildNode: (sourceId: string, data: Record<string, unknown>) => string | null;
  addChildNodes: (sourceId: string, nodeDataList: AddChildNodeItem[], options?: AddChildNodesOptions) => string[];
  addNodeWithEdge: (sourceId: string) => string | null;
  addEdge: (source: string, target: string, sourceHandle?: string, targetHandle?: string) => string;
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
  setHydrating: (v: boolean) => void;
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
  refitGroupBounds: (groupId: string) => void;
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
  pendingMediaFile: null,
  pendingFillCell: null,
  nodeProcessMap: {},
  projectId: null,
  teamId: null,
  isHydrating: false,
  connStatus: 'connecting',

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
    // 组清理需在删除前捕获父子关系（filter 后会丢失）
    const prevParentId = get().nodes.find((n) => n.id === id)?.parentId;
    // Cancel any in-progress process for this node
    const state = get();
    state.cancelNodeProcess(id);
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
        // 分镜组：cells 移除该 id（宫格不收缩）
        set((s) => ({
          nodes: s.nodes.map((n) => n.id === parent.id
            ? { ...n, data: { ...n.data, cells: (n.data as any).cells.filter((c: string) => c !== id) } }
            : n),
        }));
      } else if ((parent.data as any).groupType === 'normal'
        && !after.nodes.some((c) => c.parentId === parent.id)) {
        // 普通组：删空自动解组
        get().ungroup(parent.id);
      }
    }
    const ns = useNodeStore.getState();
    ns.deleteNode(id);
    ns.unregisterSaveHandler(id);
  },

  deleteTransformNode: (id) => {
    // Cancel any in-progress process for this node
    const state = get();
    state.cancelNodeProcess(id);
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

  addChildNodes: (sourceId, nodeDataList, options) => {
    const sourceNode = get().nodes.find((n) => n.id === sourceId);
    if (!sourceNode || nodeDataList.length === 0) return [];

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

  addEdge: (source, target, sourceHandle, targetHandle) => {
    const id = getId('edge');
    const edge: Edge = { id, source, target, type: 'default', sourceHandle, targetHandle };
    set((s) => ({ edges: [...s.edges, edge] }));
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
      allImages: params.allImages,
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

  requestFillStoryboardCell: (groupId, cellIndex) =>
    set({ pendingFillCell: { groupId, cellIndex } }),

  updateViewport: (vp) => set({ viewport: vp }),

  onNodesChange: (changes) => {
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
          const clamped = clampPositionToPadding(
            n.position,
            { width: n.width ?? n.measured?.width ?? 280, height: n.height ?? n.measured?.height ?? 120 },
            { width: parent.width ?? parent.measured?.width ?? 0, height: parent.height ?? parent.measured?.height ?? 0 },
          );
          if (clamped.x === n.position.x && clamped.y === n.position.y) return n;
          return { ...n, position: clamped };
        });
      }
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
      // TD-Pos: position 变更同步 nodeStore（localStorage 快照兜底恢复的 position 来源），取 clamp 后的最终值
      const posChangedIds = new Set(
        changes.filter((c) => c.type === 'position' && c.position != null).map((c) => (c as any).id),
      );
      if (posChangedIds.size > 0) {
        const nodeStore = useNodeStore.getState();
        let nsNodes = nodeStore.nodes;
        let dirty = false;
        for (const n of nodes) {
          if (!posChangedIds.has(n.id)) continue;
          const existing = nsNodes[n.id];
          if (existing && (existing.position.x !== n.position.x || existing.position.y !== n.position.y)) {
            nsNodes = { ...nsNodes, [n.id]: { ...existing, position: n.position } };
            dirty = true;
          }
        }
        if (dirty) useNodeStore.setState({ nodes: nsNodes });
      }
      return { nodes };
    });

    // TD-11: 键盘/程序化删除 → 对齐 deleteTransformNode 的 store 侧清理三件套
    // （DB 同步由 bindCanvasSync 订阅判脏 → 统一 runtime debounce 保存承担）
    const removes = changes.filter((c) => c.type === 'remove');
    if (removes.length === 0) return;
    for (const change of removes) {
      get().cancelNodeProcess(change.id);
      const ns = useNodeStore.getState();
      ns.deleteNode(change.id);
      ns.unregisterSaveHandler(change.id);
    }
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
  setHydrating: (v) => set({ isHydrating: v }),

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
      width: n.width ?? 280, height: n.height ?? 120,
    })));
    const groupNode: Node = {
      id, type: 'group',
      position: { x: bounds.x, y: bounds.y },
      width: bounds.width, height: bounds.height,
      data: { groupType: 'normal' },
      selected: true,
    };
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
    useNodeStore.getState().addNode({ id, type: 'group', position: groupNode.position, data: groupNode.data as any });
    get().applyGroupDerivations();
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
    if (gd.groupType === 'storyboard') {
      const cfg = gd.storyboard;
      const ratioKey = cfg.aspectRatio as keyof typeof ASPECT_RATIO_MAP;
      const cellH = CELL_WIDTH / ASPECT_RATIO_MAP[ratioKey];
      set((st) => ({
        nodes: st.nodes.map((n) => {
          const idx = (gd.cells ?? []).indexOf(n.id);
          if (idx === -1 || n.parentId !== groupId) return n;
          const row = Math.floor(idx / cfg.gridCols), col = idx % cfg.gridCols;
          return { ...n, width: CELL_WIDTH, height: Math.round(cellH),
            position: { x: col * (CELL_WIDTH + CONVERT_GAP), y: row * (Math.round(cellH) + CONVERT_GAP) } };
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
  },

  addToGroup: (groupId, nodeId) => {
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    const node = s.nodes.find((n) => n.id === nodeId);
    if (!group || !node || node.type === 'group') return;
    const gp = group.position;
    setWithParentOrder((st) => {
      const child = {
        ...node, parentId: groupId, extent: 'parent' as const,
        position: { x: node.position.x - gp.x, y: node.position.y - gp.y },
      };
      const siblings = st.nodes.filter((n) => n.parentId === groupId || n.id === nodeId);
      const bounds = calcGroupBounds(siblings.map((n) => ({
        x: (n.id === nodeId ? child.position.x : n.position.x) + gp.x,
        y: (n.id === nodeId ? child.position.y : n.position.y) + gp.y,
        width: n.width ?? 280, height: n.height ?? 120,
      })));
      return {
        nodes: st.nodes.map((n) => {
          if (n.id === nodeId) return child;
          if (n.id === groupId) return { ...n, position: { x: bounds.x, y: bounds.y }, width: bounds.width, height: bounds.height };
          return n;
        }),
      };
    });
    get().applyGroupDerivations();
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
    set((st) => ({
      nodes: st.nodes.map((n) => n.parentId === groupId && n.id === nodeId
        ? { ...n, parentId: undefined, extent: undefined,
            position: { x: n.position.x + gp.x, y: n.position.y + gp.y } }
        : n),
    }));
    get().applyGroupDerivations();
  },

  dropIntoGroup: (nodeId, groupId) => {
    if (get().hasActiveProcessInGroup(groupId)) {
      message.warning('组内有节点正在执行，请等待完成后再操作');
      return;
    }
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    if (!group) return;
    const gp = group.position;
    const node = s.nodes.find((n) => n.id === nodeId);
    if (!node || node.type === 'group') return;
    if ((group.data as any).collapsed) get().toggleCollapse(groupId); // 折叠态先展开
    setWithParentOrder((st) => {
      const child = {
        ...node, parentId: groupId, extent: 'parent' as const,
        position: { x: node.position.x - gp.x, y: node.position.y - gp.y },
      };
      const siblings = st.nodes.filter((n) => n.parentId === groupId || n.id === nodeId);
      const bounds = calcGroupBounds(siblings.map((n) => ({
        x: (n.id === nodeId ? child.position.x : n.position.x) + gp.x,
        y: (n.id === nodeId ? child.position.y : n.position.y) + gp.y,
        width: n.width ?? 280, height: n.height ?? 120,
      })));
      return {
        nodes: st.nodes.map((n) => {
          if (n.id === nodeId) return child;
          if (n.id === groupId) return { ...n, position: { x: bounds.x, y: bounds.y }, width: bounds.width, height: bounds.height };
          return n;
        }),
      };
    });
    get().applyGroupDerivations();
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

    const cfg = gd.storyboard as StoryboardConfig;
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
          { ...group, data: { ...gd, cells } },
        ],
        edges: st.edges,
      }));

      // 双写 nodeStore
      for (const e of expandedNodes) {
        ns.addNode({ id: e.id, type: 'imageGen', position: e.position, data: e.data as any });
      }
      for (const o of overflowNodes) {
        ns.addNode({ id: o.id, type: 'imageGen', position: o.position, data: o.data as any });
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
        // 入组（五审 L-4：addToGroup 本身是单 set 操作，但 cells set 是独立 set，需包事务）
        get().addToGroup(groupId, nodeId);
        // 补 null 到空位索引
        set((st) => {
          const g = st.nodes.find((n) => n.id === groupId);
          if (!g) return st;
          const updatedCells = [...(g.data as any).cells ?? []];
          while (updatedCells.length < emptyIdx) updatedCells.push(null);
          updatedCells[emptyIdx] = nodeId;
          return {
            nodes: st.nodes.map((n) =>
              n.id === groupId ? { ...n, data: { ...n.data, cells: updatedCells } } : n
            ),
          };
        });
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
    const groupNode: Node = {
      id: gid, type: 'group',
      position: { x: cx - size.width / 2, y: cy - size.height / 2 },
      width: size.width, height: size.height, selected: true,
      data: {
        groupType: 'storyboard', name: `分镜组 ${sorted.length} 个节点`, cells: sorted,
        storyboard: { aspectRatio: '16:9', gridRows: rows, gridCols: cols, showIndex: false, stitchResolution: '2K' },
      },
    };
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
    useNodeStore.getState().addNode({ id: gid, type: 'group', position: groupNode.position, data: groupNode.data as any });
    // 双写补全：展开的新节点写入 nodeStore；被移除的 multiImageGen 原节点同步删除（双 store 一致）
    const ns = useNodeStore.getState();
    for (const e of expanded) {
      ns.addNode({ id: e.id, type: 'imageGen', position: e.position, data: e.data as any });
    }
    for (const n of picked) {
      if (n.type === 'multiImageGen') ns.deleteNode(n.id);
    }
    get().applyGroupDerivations();
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
      setWithParentOrder((st) => ({
        nodes: st.nodes.map((n) => {
          if (n.id === groupId) return { ...n, type: 'group', position: { x: cx - size.width / 2, y: cy - size.height / 2 },
            width: size.width, height: size.height,
            data: { groupType: 'storyboard', name: `分镜组 ${sorted.length} 个节点`, cells: sorted,
                    storyboard: { aspectRatio: '16:9', gridRows: rows, gridCols: cols, showIndex: false, stitchResolution: '2K' } } };
          if (n.parentId === groupId) return { ...n, position: { x: 0, y: 0 } };
          return n;
        }),
      }));
    } else {
      // 分镜组 → 普通组：cells 顺序网格重排
      const cfg = gd.storyboard;
      const cellW = CELL_WIDTH;
      const ratioKey = cfg.aspectRatio as keyof typeof ASPECT_RATIO_MAP;
      const cellH = CELL_WIDTH / ASPECT_RATIO_MAP[ratioKey];
      setWithParentOrder((st) => ({
        nodes: st.nodes.map((n) => {
          if (n.id === groupId) return { ...n, data: { groupType: 'normal', name: '分组' } };
          const idx = gd.cells.indexOf(n.id);
          if (idx === -1 || n.parentId !== groupId) return n;
          const row = Math.floor(idx / cfg.gridCols), col = idx % cfg.gridCols;
          return { ...n, position: { x: col * (cellW + CONVERT_GAP), y: row * (cellH + CONVERT_GAP) },
                   width: cellW, height: Math.round(cellH) };
        }),
      }));
      // 组框重算
      get().refitGroupBounds(groupId);
    }
    // data 整体重建清掉了 manuallyResized/savedSize——双写 nodeStore 防旧标记经快照复活
    syncGroupDataToNodeStore(groupId);
    get().applyGroupDerivations();
  },

  renameGroup: (groupId, name) => {
    const final = name.trim() || '分组';
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    if (!group || (group.data as any).name === final) return;
    set((st) => ({
      nodes: st.nodes.map((n) => (n.id === groupId ? { ...n, data: { ...n.data, name: final } } : n)),
    }));
    syncGroupDataToNodeStore(groupId);
  },

  markManuallyResized: (groupId) => {
    set((st) => ({
      nodes: st.nodes.map((n) => (n.id === groupId ? { ...n, data: { ...n.data, manuallyResized: true } } : n)),
    }));
    syncGroupDataToNodeStore(groupId);
  },

  toggleCollapse: (groupId) => {
    set((st) => ({
      nodes: st.nodes.map((n) => {
        if (n.id !== groupId) return n;
        const collapsing = !(n.data as any).collapsed;
        if (collapsing) {
          return {
            ...n,
            data: { ...n.data, collapsed: true, savedSize: { width: n.width ?? 0, height: n.height ?? 0 } },
            width: 200, height: 64,
          };
        }
        return { ...n, data: { ...n.data, collapsed: false } };
      }),
    }));
    const g = get().nodes.find((n) => n.id === groupId);
    if (g && !(g.data as any).collapsed) {
      const d = g.data as any;
      if (d.manuallyResized && d.savedSize) {
        // 手动 resize 过的组：展开恢复用户尺寸，不按子节点重算
        set((st) => ({
          nodes: st.nodes.map((n) => (n.id === groupId
            ? { ...n, width: d.savedSize.width, height: d.savedSize.height }
            : n)),
        }));
      } else {
        get().refitGroupBounds(groupId);
      }
    }
    syncGroupDataToNodeStore(groupId);
    get().applyGroupDerivations();
  },

  refitGroupBounds: (groupId) => {
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    if (!group) return;
    const gp = group.position;
    const children = s.nodes.filter((n) => n.parentId === groupId);
    if (children.length === 0) return;
    const bounds = calcGroupBounds(children.map((n) => ({
      x: n.position.x + gp.x, y: n.position.y + gp.y,
      width: n.width ?? 280, height: n.height ?? 120,
    })));
    set((st) => ({
      nodes: st.nodes.map((n) => n.id === groupId
        ? { ...n, position: { x: bounds.x, y: bounds.y }, width: bounds.width, height: bounds.height }
        : n),
    }));
  },

  updateStoryboardConfig: (groupId, patch) => {
    set((st) => ({
      nodes: st.nodes.map((n) => {
        if (n.id !== groupId) return n;
        const cfg = { ...(n.data as any).storyboard, ...patch };
        const size = calcStoryboardSize(cfg.gridRows, cfg.gridCols, cfg.aspectRatio);
        return { ...n, width: size.width, height: size.height, data: { ...n.data, storyboard: cfg } };
      }),
    }));
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
    const gw = group.width ?? 0;
    set((st) => ({
      nodes: st.nodes.map((n) => {
        // P0-新1：绝不能 filter 掉溢出节点——那是删除数据；只做 map 改写（移出组排右侧）
        if (n.id === groupId) {
          const cfg = { ...gd.storyboard, gridRows: rows, gridCols: cols };
          const size = calcStoryboardSize(rows, cols, cfg.aspectRatio);
          return { ...n, width: size.width, height: size.height, data: { ...gd, cells: keep, storyboard: cfg } };
        }
        if (overflowIds.includes(n.id) && n.parentId === groupId) {
          const idx = overflowIds.indexOf(n.id);
          return { ...n, parentId: undefined, extent: undefined, hidden: false,
            position: { x: gp.x + gw + 20, y: gp.y + idx * 200 } };
        }
        return n;
      }),
      edges: st.edges, // 溢出节点若有连线已在组内隐藏；解出后 hidden 推导恢复显示
    }));
    get().applyGroupDerivations();
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
    set((st) => ({
      nodes: st.nodes
        .filter((n) => !(cellIds.includes(n.id) && n.parentId === groupId))
        .map((n) => n.id === groupId ? { ...n, data: { ...n.data, cells: [] } } : n),
      edges: st.edges.filter((e) => !cellIds.includes(e.source) && !cellIds.includes(e.target)),
    }));
    cellIds.forEach((id: string) => useNodeStore.getState().deleteNode(id));
  },

  addImageToStoryboardCell: (groupId, cellIndex, fileId, url) => {
    const id = getId('node');
    set((st) => ({
      nodes: st.nodes.map((n) => {
        if (n.id !== groupId) return n;
        // 空位用 null 占位（cells: (string | null)[]），语义明确且 filter(Boolean) 安全
        const cells: (string | null)[] = [...((n.data as any).cells ?? [])];
        while (cells.length < cellIndex) cells.push(null);
        cells[cellIndex] = id;
        return { ...n, data: { ...n.data, cells } };
      }).concat([{
        id, type: 'imageGen', parentId: groupId, extent: 'parent',
        position: { x: 0, y: 0 }, width: 320, height: 180,
        data: { status: 'done', fileId, mediaUrl: url } as any, selected: false,
      } as Node]),
    }));
    useNodeStore.getState().addNode({ id, type: 'imageGen', position: { x: 0, y: 0 }, data: { status: 'done', fileId, mediaUrl: url } as any });
    get().applyGroupDerivations();
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
    set((st) => ({
      nodes: st.nodes
        .filter((n) => n.id !== removedId)
        .map((n) => n.id === groupId ? { ...n, data: { ...n.data, cells } } : n),
      edges: st.edges.filter((e) => e.source !== removedId && e.target !== removedId),
    }));
    if (removedId) useNodeStore.getState().deleteNode(removedId);
    get().applyGroupDerivations();
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
  // Map cells if storyboard
  if (isStoryboard && newGroup.data.cells) {
    (newGroup.data as any).cells = (newGroup.data.cells as string[]).map((id) => idMap.get(id) || id);
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
    position: newGroup.position,
    data: newGroup.data as any,
  });
  for (const child of newChildren) {
    ns.addNode({
      id: child.id,
      type: child.type!,
      position: child.position,
      data: child.data as any,
      width: child.width,
      height: child.height,
    });
  }

  get().applyGroupDerivations();

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
  // Map cells if storyboard
  if (isStoryboard && newGroup.data.cells) {
    (newGroup.data as any).cells = (newGroup.data.cells as string[]).map((id) => idMap.get(id) || id);
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
    position: newGroup.position,
    data: newGroup.data as any,
  });
  for (const child of newChildren) {
    ns.addNode({
      id: child.id,
      type: child.type!,
      position: child.position,
      data: child.data as any,
      width: child.width,
      height: child.height,
    });
  }

  get().applyGroupDerivations();

  return newGid;
}
