// apps/web/src/utils/groupDerive.ts
import { groupHidesChildren } from '@flowweb/shared';
import type { Node, Edge } from '@xyflow/react';

/** hidden 推导规则单一来源（spec 3.3）：不持久化，每次全量推导；hidden 判定同引 shared groupHidesChildren（19(i) 防漂移） */
export function deriveHidden(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const groupHidden = new Map<string, boolean>();
  for (const n of nodes) {
    if (n.type === 'group') {
      groupHidden.set(n.id, groupHidesChildren((n.data ?? {}) as Record<string, unknown>));
    }
  }
  const nextNodes = nodes.map((n) => ({
    ...n,
    hidden: n.parentId ? (groupHidden.get(n.parentId) ?? false) : false,
  }));
  const nodeHidden = new Map(nextNodes.map((n) => [n.id, n.hidden]));
  const nextEdges = edges.map((e) => ({
    ...e,
    hidden: (nodeHidden.get(e.source) ?? false) || (nodeHidden.get(e.target) ?? false),
  }));
  return { nodes: nextNodes, edges: nextEdges };
}

/** 一致性守卫：分镜组 children 必须同时在 cells 中；多余子节点移出组（绝对坐标排在组下方） */
export function repairStoryboardCells(nodes: Node[]): Node[] {
  const storyboardGroups = new Map<string, Node>();
  for (const n of nodes) {
    if (n.type === 'group' && (n.data as any)?.groupType === 'storyboard') storyboardGroups.set(n.id, n);
  }
  let overflow = 0;
  return nodes.map((n) => {
    const g = n.parentId ? storyboardGroups.get(n.parentId) : undefined;
    if (!g) return n;
    const cells = ((g.data as any).cells ?? []) as string[];
    if (cells.includes(n.id)) return n;
    const i = overflow++;
    return { ...n, parentId: undefined, extent: undefined,
      position: { x: g.position.x + i * 360, y: g.position.y + (g.height ?? 0) + 20 } };
  });
}
