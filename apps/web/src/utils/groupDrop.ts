import type { Node } from '@xyflow/react';

/** 节点中心是否落入组包围盒（组节点不可被拖入） */
export function findDropGroup(node: Node, groups: Node[]): Node | null {
  if (node.type === 'group' || node.parentId) return null;
  const nw = node.width ?? 280, nh = node.height ?? 120;
  const cx = node.position.x + nw / 2, cy = node.position.y + nh / 2;
  for (const g of groups) {
    const gw = g.width ?? 0, gh = g.height ?? 0;
    if (cx >= g.position.x && cx <= g.position.x + gw && cy >= g.position.y && cy <= g.position.y + gh) {
      return g;
    }
  }
  return null;
}
