/** 批0.5：客户端意图记录（B1 同批硬约束）——失败重试复用同 intentId ⇒ 表命中 ⇒ 不双扣；
 *  新生成点击 rotate 新 id ⇒ 照常扣费。存 sessionStorage（标签隔离+刷新存活双语义——
 *  localStorage 会被同项目双标签共享导致同节点撞 id）。R1c 落地后随本地记录器迁移。 */
const keyOf = (projectId: string, nodeId: string) => `flowweb:intent:${projectId}:${nodeId}`;

export function newIntentId(projectId: string, nodeId: string): string {
  const id = crypto.randomUUID();
  sessionStorage.setItem(keyOf(projectId, nodeId), id);
  return id;
}

export function currentIntentId(projectId: string, nodeId: string): string {
  return sessionStorage.getItem(keyOf(projectId, nodeId)) ?? newIntentId(projectId, nodeId);
}
