import type { AppNode } from '@/stores/nodeStore';

export const SNAPSHOT_VERSION = 2;

export function snapshotKey(projectId: string): string {
  return `flowweb_canvas_v2_${projectId}`;
}

export interface CanvasSnapshot {
  version: typeof SNAPSHOT_VERSION;
  nodes: Record<string, AppNode>;
  edges: { id: string; source: string; target: string }[];
  viewport: { x: number; y: number; zoom: number };
  /** 可选：nodeId→parentId 组关系（旧快照无此字段仍有效，不升版本） */
  parentMap?: Record<string, string>;
  /** 可选：服务端乐观锁版本（冲突取证/兜底判断用；旧快照无此字段仍有效） */
  serverVersion?: number;
}

function isValidNode(v: unknown): v is AppNode {
  if (typeof v !== 'object' || v === null) return false;
  const n = v as Record<string, unknown>;
  return (
    typeof n.id === 'string' &&
    typeof n.type === 'string' &&
    typeof n.position === 'object' && n.position !== null &&
    typeof (n.position as any).x === 'number' &&
    typeof (n.position as any).y === 'number' &&
    typeof n.data === 'object' && n.data !== null
  );
}

function isValidPayload(p: unknown): p is CanvasSnapshot {
  if (typeof p !== 'object' || p === null) return false;
  const s = p as Record<string, unknown>;
  if (s.version !== SNAPSHOT_VERSION) return false;
  if (typeof s.nodes !== 'object' || s.nodes === null || Array.isArray(s.nodes)) return false;
  if (!Object.values(s.nodes).every(isValidNode)) return false;
  if (!Array.isArray(s.edges)) return false;
  if (!s.edges.every((e) => {
    if (typeof e !== 'object' || e === null) return false;
    const edge = e as Record<string, unknown>;
    return typeof edge.id === 'string' && typeof edge.source === 'string' && typeof edge.target === 'string';
  })) return false;
  if (typeof s.viewport !== 'object' || s.viewport === null) return false;
  const vp = s.viewport as Record<string, unknown>;
  if (!(typeof vp.x === 'number' && typeof vp.y === 'number' && typeof vp.zoom === 'number')) return false;
  // serverVersion 可选；存在时必须是 number
  if (s.serverVersion !== undefined && typeof s.serverVersion !== 'number') return false;
  // parentMap 可选（旧快照无此字段/null 宽松通过）；存在时必须是 Record<string,string>
  if (s.parentMap === undefined || s.parentMap === null) return true;
  if (typeof s.parentMap !== 'object' || Array.isArray(s.parentMap)) return false;
  return Object.values(s.parentMap).every((v) => typeof v === 'string');
}

/** 读取并校验快照；解析/校验失败时清除 key 返回 null（IO 副作用内聚，调用方不触 localStorage） */
export function loadSnapshot(projectId: string): CanvasSnapshot | null {
  const key = snapshotKey(projectId);
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (isValidPayload(parsed)) return parsed;
  } catch {
    // fallthrough to removeItem
  }
  localStorage.removeItem(key);
  return null;
}

export function isEmptySnapshot(s: CanvasSnapshot): boolean {
  return Object.keys(s.nodes).length === 0;
}
