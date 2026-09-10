/** 自动边确定性 id——身份只依赖节点 id（协作桥仅持久化 edge 的 {id,source,target}，data 刷新即丢） */

export function autoEdgeId(editNodeId: string, sourceNodeId: string): string {
  return `auto:${editNodeId}:${sourceNodeId}`;
}

export function autoOutEdgeId(editNodeId: string, productNodeId: string): string {
  return `auto-out:${editNodeId}:${productNodeId}`;
}

/** 订阅路径与 syncAutoEdgesToDoc 的分流判据 */
export function isAutoEdgeId(id: string): boolean {
  return id.startsWith('auto:') || id.startsWith('auto-out:');
}
