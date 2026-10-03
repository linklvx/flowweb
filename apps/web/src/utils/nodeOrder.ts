// apps/web/src/utils/nodeOrder.ts
// RF v12 updateChildNode 要求父节点在 nodes 数组中位于子节点之前，否则忽略 parentId。
// ensureParentOrder 按原顺序拓扑输出（父先于子）；顺序已满足时返回原数组引用。
// 防御：parentId 指向不存在节点 → 照常输出；循环引用 → visiting 命中即跳过，不抛栈溢出。

export function ensureParentOrder<T extends { id: string; parentId?: string | null }>(
  nodes: T[],
): T[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const out: T[] = [];

  const visit = (node: T) => {
    if (visited.has(node.id) || visiting.has(node.id)) return;
    visiting.add(node.id);
    const parent = node.parentId != null ? byId.get(node.parentId) : undefined;
    if (parent) visit(parent);
    visiting.delete(node.id);
    visited.add(node.id);
    out.push(node);
  };

  nodes.forEach(visit);

  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i] !== out[i]) return out;
  }
  return nodes;
}
