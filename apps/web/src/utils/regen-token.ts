// apps/web/src/utils/regen-token.ts —— Y0b-2 T6（Z79/Z95/Z118）：手势 token 生命周期（旧意图 id 记录族三导出退役）
// 三态语义（生命周期四态）：
//  gestureToken(pid,nid) 惰性铸造并持有（sessionStorage——标签隔离+刷新存活双语义；
//    Z118 显式动机：旧组件 ref 记忆刷新即丢 ⇒ 失败后刷新再点=新 id 新扣费——held 跨刷新存活正修它）
//  storedToken(pid,nid)  读持有（error 后重试/在飞复用一律上送——免费 rearm）
//  rotateToken(pid,nid[,execSeq])  轮换（投影 done 或 error∧rearmable:false——轮换/上送判据单源=doc 投影〔服务端权威〕）
// token 值 crypto.randomUUID()（36 位 [0-9a-zA-Z-]——服务端 normalizeRegenToken 形态校验 ^[0-9a-zA-Z_-]{8,64}$ 天然合法）。
//
// Y3 Task4（plan v3.1 合同二——轮换代际三步）：两次同步间旧代 done 先应用已轮换 token、更高 execSeq
// loading 随后进槽——mergeSlot 保得住槽面撤不回轮换、这次点击仍持旧 token=服务端对不上原手势再开一笔扣费。
//  ① rotateToken 第三参 execSeq：同一 execSeq 只轮换一次（sessionStorage 记已轮换 execSeq——代际记录）+
//     槽上 execSeq 比已轮换的更小则忽略；无 execSeq 调用形态（无行终态——INTENT_EXHAUSTED 同步 409 等）
//     维持今天行为（照常轮换、零代际记录）。
//  ② markGestureConsumed(pid,nid)：只在真正发出受理请求的那一次调用（渲染读 token 不算消费）；
//     gestureToken 再铸清消费标记（新 token 新生命周期）。
//  ③ restoreRotatedToken(pid,nid,slot)：回滚三条件 API——当前槽非终态（非 done 且非 error∧
//     rearmable===false）∧槽上 execSeq 更大∧本轮换出 token 未被消费 ⇒ 恢复轮换前值（缺一不恢复；
//     轮换窗口记录同笔清除——不二次回滚）。
const keyOf = (projectId: string, nodeId: string) => `flowweb:regen:${projectId}:${nodeId}`;
const consumedKeyOf = (projectId: string, nodeId: string) => `flowweb:regen-consumed:${projectId}:${nodeId}`;
const rotatedSeqKeyOf = (projectId: string, nodeId: string) => `flowweb:regen-seq:${projectId}:${nodeId}`;
const rotatedPrevKeyOf = (projectId: string, nodeId: string) => `flowweb:regen-prev:${projectId}:${nodeId}`;

/** 铸造并持有新手势 token（"重新生成"手势——新意图照常扣费）。再铸清消费标记（新 token 新生命周期）。 */
export function gestureToken(projectId: string, nodeId: string): string {
  const token = crypto.randomUUID();
  sessionStorage.setItem(keyOf(projectId, nodeId), token);
  sessionStorage.removeItem(consumedKeyOf(projectId, nodeId));
  return token;
}

/** 读持有中的 token（null=无持有——普通执行内容键路径）。渲染读零副作用（不算消费）。 */
export const storedToken = (projectId: string, nodeId: string): string | null =>
  sessionStorage.getItem(keyOf(projectId, nodeId));

/**
 * 轮换：丢弃持有（done 后下一击=新"重新生成"；EXHAUSTED 后不自锁）。
 * 带第三参 execSeq（v3.1 合同二——有 execSeq 的终态必传）：同一 execSeq 只轮换一次+槽上更小则忽略
 * （旧代 done 迟到不再丢新持有）；无第三参=无行终态旧形态——照常轮换、零代际记录。
 */
export function rotateToken(projectId: string, nodeId: string, execSeq?: string): void {
  if (execSeq !== undefined) {
    const prev = sessionStorage.getItem(rotatedSeqKeyOf(projectId, nodeId));
    if (prev !== null && BigInt(execSeq) <= BigInt(prev)) return;   // 同代已轮换（一次）或更小（旧代迟到）——忽略
    sessionStorage.setItem(rotatedSeqKeyOf(projectId, nodeId), execSeq);
    sessionStorage.setItem(rotatedPrevKeyOf(projectId, nodeId), sessionStorage.getItem(keyOf(projectId, nodeId)) ?? '');   // 轮换时持有快照（回滚恢复值）
  }
  sessionStorage.removeItem(keyOf(projectId, nodeId));
}

/**
 * 消费标记（v3.1 合同二第②步）：只在真正发出受理请求的那一次调用（渲染读 token 不算消费）——
 * 回滚三条件之条件三（本轮换出 token 未被消费）的证据单源。无持有为 no-op。
 */
export function markGestureConsumed(projectId: string, nodeId: string): void {
  if (storedToken(projectId, nodeId) === null) return;
  sessionStorage.setItem(consumedKeyOf(projectId, nodeId), '1');
}

/** 消费标记读取（restoreRotatedToken 调用面的 tokenConsumed 判据单源——Y3 T7 收场函数接线）：
 *  在案=本轮持有 token 真发过受理请求（markGestureConsumed 所写；gestureToken 再铸清零=新生命周期）。 */
export const isGestureConsumed = (projectId: string, nodeId: string): boolean =>
  sessionStorage.getItem(consumedKeyOf(projectId, nodeId)) === '1';

/** 回滚三条件读面（restoreRotatedToken 入参——当前投影槽）。 */
export interface RotationRollbackSlot {
  /** 槽状态（非终态判据：非 done 且非 error∧rearmable===false——可 rearm error=可重试非终态） */
  status: string;
  rearmable?: boolean;
  /** 槽上执行代际（十进制 string；缺=无行档） */
  execSeq?: string;
}

/**
 * 回滚（v3.1 合同二第③步）：当前槽非终态∧槽上 execSeq 比已轮换的更大∧本轮换出 token 未被消费
 * ⇒ 恢复轮换前值（旧 token 回持——服务端对得上原手势）。三条件缺一不恢复；恢复后清除轮换窗口
 * 记录（同 execSeq 不二次回滚）。返回是否恢复。
 */
export function restoreRotatedToken(projectId: string, nodeId: string, slot: RotationRollbackSlot & { tokenConsumed: boolean }): boolean {
  const rotatedSeq = sessionStorage.getItem(rotatedSeqKeyOf(projectId, nodeId));
  if (rotatedSeq === null) return false;   // 未轮换过——回滚只针对本轮轮换窗口
  if (slot.status === 'done' || (slot.status === 'error' && slot.rearmable === false)) return false;   // 条件一：槽已终态
  const slotSeq = typeof slot.execSeq === 'string' && /^\d+$/.test(slot.execSeq) ? BigInt(slot.execSeq) : null;
  if (slotSeq === null || slotSeq <= BigInt(rotatedSeq)) return false;   // 条件二：槽 execSeq 不更大（含槽缺）
  if (slot.tokenConsumed) return false;   // 条件三：本轮换出 token 已被消费（真发过受理请求）
  const prev = sessionStorage.getItem(rotatedPrevKeyOf(projectId, nodeId));   // 轮换时持有快照
  sessionStorage.removeItem(rotatedSeqKeyOf(projectId, nodeId));   // 窗口清除——不二次回滚
  sessionStorage.removeItem(rotatedPrevKeyOf(projectId, nodeId));
  if (prev !== null && prev !== '') sessionStorage.setItem(keyOf(projectId, nodeId), prev);   // 恢复轮换前值（快照空=轮换时本无持有——不写）
  return true;
}
