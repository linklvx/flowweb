import { create } from 'zustand';
import { message } from 'antd';
import type { Node, Edge } from '@xyflow/react';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';

export type Snapshot<T> = T | null; // null = tombstone（该对象此时间点不存在）

export interface HistoryEntry {
  label: string;
  nodeIds: string[];
  edgeIds: string[];
  before: { nodes: Snapshot<Node>[]; edges: Snapshot<Edge>[] };
  after: { nodes: Snapshot<Node>[]; edges: Snapshot<Edge>[] };
}

const MAX_HISTORY = 50;

interface GroupHistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
  record: (entry: HistoryEntry) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  pastLength: () => number;
  clear: () => void;
}

/** 把快照应用到 store：非 null 覆盖/写入，null（tombstone）删除 */
function applySnapshot(side: 'before' | 'after', entry: HistoryEntry) {
  const nodes = entry[side].nodes;
  const edges = entry[side].edges;
  useCanvasStore.setState((s) => {
    let nextNodes = [...s.nodes];
    nodes.forEach((snap, i) => {
      const id = entry.nodeIds[i];
      nextNodes = snap
        ? nextNodes.some((n) => n.id === id)
          ? nextNodes.map((n) => (n.id === id ? snap : n))
          : [...nextNodes, snap]
        : nextNodes.filter((n) => n.id !== id);
    });
    let nextEdges = [...s.edges];
    edges.forEach((snap, i) => {
      const id = entry.edgeIds[i];
      nextEdges = snap
        ? nextEdges.some((e) => e.id === id)
          ? nextEdges.map((e) => (e.id === id ? snap : e))
          : [...nextEdges, snap]
        : nextEdges.filter((e) => e.id !== id);
    });
    // 撤销/重做可能删除 selectedId 指向的节点 → 清空悬空选中态
    const danglingSelected = s.selectedId !== null
      && entry.nodeIds.includes(s.selectedId)
      && !nextNodes.some((n) => n.id === s.selectedId);
    return { nodes: nextNodes, edges: nextEdges, ...(danglingSelected ? { selectedId: null } : {}) };
  });
  // 双写 nodeStore（P0-1）：canvasStore 组 actions 均双写 nodeStore，撤销/重做的逆操作
  // 必须遵守同一约定，否则两 store 节点集合漂移（幽灵节点/缺失节点）。
  // 注：nodeStore.nodes 是 Record<string, AppNode>（键=节点 id），ns.nodes[id] 是 Record 访问。
  const ns = useNodeStore.getState();
  nodes.forEach((snap, i) => {
    const id = entry.nodeIds[i];
    if (snap) {
      ns.addNode({ id, type: snap.type!, position: snap.position, data: snap.data as any });
    } else if (ns.nodes[id]) {
      ns.deleteNode(id);
    }
  });
}

/** P1-7：撤销/重做受执行中禁令约束——结构变更的逆操作同样是结构变更（spec 8） */
function isEntryExecuting(entry: HistoryEntry): boolean {
  const processes = useCanvasStore.getState().nodeProcessMap;
  return entry.nodeIds.some((id) => id in processes);
}

export const useGroupHistory = create<GroupHistoryState>((set, get) => ({
  past: [], future: [],
  record: (entry) => set((s) => ({
    past: [...s.past, entry].slice(-MAX_HISTORY),
    future: [],
  })),
  undo: () => {
    const entry = get().past[get().past.length - 1];
    if (!entry) return;
    if (isEntryExecuting(entry)) {
      message.warning('组内有节点正在执行，请等待完成后再撤销');
      return;
    }
    applySnapshot('before', entry);
    set((s) => ({ past: s.past.slice(0, -1), future: [entry, ...s.future] }));
  },
  redo: () => {
    const entry = get().future[0];
    if (!entry) return;
    if (isEntryExecuting(entry)) {
      message.warning('组内有节点正在执行，请等待完成后再重做');
      return;
    }
    applySnapshot('after', entry);
    set((s) => ({ past: [...s.past, entry], future: s.future.slice(1) }));
  },
  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
  pastLength: () => get().past.length,
  clear: () => set({ past: [], future: [] }),
}));

/** 操作前抓取受影响对象当前快照（供 canvasStore 组 actions 使用） */
export function captureBefore(nodeIds: string[], edgeIds: string[]) {
  const s = useCanvasStore.getState();
  return {
    nodes: nodeIds.map((id) => (s.nodes.find((n) => n.id === id) ?? null) as Snapshot<Node>),
    edges: edgeIds.map((id) => (s.edges.find((e) => e.id === id) ?? null) as Snapshot<Edge>),
  };
}

export function captureAfter(nodeIds: string[], edgeIds: string[]) {
  const s = useCanvasStore.getState();
  return {
    nodes: nodeIds.map((id) => (s.nodes.find((n) => n.id === id) ?? null) as Snapshot<Node>),
    edges: edgeIds.map((id) => (s.edges.find((e) => e.id === id) ?? null) as Snapshot<Edge>),
  };
}
