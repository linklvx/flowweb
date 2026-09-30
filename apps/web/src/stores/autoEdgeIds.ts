/** 自动边确定性 id——身份只依赖节点 id（协作桥仅持久化 edge 的 {id,source,target}，data 刷新即丢） */

export function autoEdgeId(editNodeId: string, sourceNodeId: string): string {
  return `auto:${editNodeId}:${sourceNodeId}`;
}

export function autoOutEdgeId(editNodeId: string, productNodeId: string): string {
  return `auto-out:${editNodeId}:${productNodeId}`;
}

/** auto 边身份判定——addEdge/removeEdge 的 origin 分流判据（批4b-2：AutoEdge origin intent） */
export function isAutoEdgeId(id: string): boolean {
  return id.startsWith('auto:') || id.startsWith('auto-out:');
}
