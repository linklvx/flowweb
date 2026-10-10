// apps/web/src/utils/regen-token.ts —— Y0b-2 T6（Z79/Z95/Z118）：手势 token 生命周期（旧意图 id 记录族三导出退役）
// 三态语义（生命周期四态）：
//  gestureToken(pid,nid) 惰性铸造并持有（sessionStorage——标签隔离+刷新存活双语义；
//    Z118 显式动机：旧组件 ref 记忆刷新即丢 ⇒ 失败后刷新再点=新 id 新扣费——held 跨刷新存活正修它）
//  storedToken(pid,nid)  读持有（error 后重试/在飞复用一律上送——免费 rearm）
//  rotateToken(pid,nid)  轮换（投影 done 或 error∧rearmable:false——轮换/上送判据单源=doc 投影〔服务端权威〕）
// token 值 crypto.randomUUID()（36 位 [0-9a-zA-Z-]——服务端 normalizeRegenToken 形态校验 ^[0-9a-zA-Z_-]{8,64}$ 天然合法）。
const keyOf = (projectId: string, nodeId: string) => `flowweb:regen:${projectId}:${nodeId}`;

/** 铸造并持有新手势 token（"重新生成"手势——新意图照常扣费）。 */
export function gestureToken(projectId: string, nodeId: string): string {
  const token = crypto.randomUUID();
  sessionStorage.setItem(keyOf(projectId, nodeId), token);
  return token;
}

/** 读持有中的 token（null=无持有——普通执行内容键路径）。 */
export const storedToken = (projectId: string, nodeId: string): string | null =>
  sessionStorage.getItem(keyOf(projectId, nodeId));

/** 轮换：丢弃持有（done 后下一击=新"重新生成"；EXHAUSTED 后不自锁）。 */
export function rotateToken(projectId: string, nodeId: string): void {
  sessionStorage.removeItem(keyOf(projectId, nodeId));
}
