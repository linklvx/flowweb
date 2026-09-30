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

/** 批0.5-8c：收到即须 rotate intentId 的业务错误码 → 提示文案（六发起处共用唯一真相源）。
 *  EXHAUSTED=免费重试额度尽；CONTEXT_MISMATCH=同 intentId 复用到不同参数（改参重试撞旧 id——
 *  该 409 在 attempts 检查前抛、永不触额度逃生门，不 rotate 则节点编辑按钮死循环）。
 *  非 rotate 值得错误返回 undefined（普通失败照旧复用同 id 重试，表命中不双扣）。 */
export function intentRotateMessage(errorCode?: string): string | undefined {
  if (errorCode === 'INTENT_EXHAUSTED') return '重试次数已用尽，请重新发起生成';
  if (errorCode === 'INTENT_CONTEXT_MISMATCH') return '参数已变更，已重置生成会话，请重新发起';
  return undefined;
}
