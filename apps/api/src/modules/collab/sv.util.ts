import * as Y from 'yjs';

/** 解码 state vector 为 client→clock Map（yjs 公开 API） */
export const decodeStateVector = Y.decodeStateVector;

/** serverSV 是否覆盖 requiredSV 的全部 clock（spec 3.2 等待条件） */
export function svSatisfied(serverSV: Uint8Array, requiredSV: Uint8Array): boolean {
  const server = Y.decodeStateVector(serverSV);
  for (const [client, clock] of Y.decodeStateVector(requiredSV)) {
    if ((server.get(client) ?? 0) < clock) return false;
  }
  return true;
}

/** SV 支配性（Y0a-1 纯函数锚——Y1c-1 破坏后结构锚的基础件）：rowSv 全部 clock ⊆ snapSv。
 *  委托 svSatisfied 单源；?? 0 语义=snap 缺该 client 且 clock>0 即不支配（真实 SV 不含 0 clock 条目，
 *  与更严缺省仅 clock=0 边界差——不构成语义分歧）。禁在本文件外再写 SV 解码/比较。 */
export const svDominates = (rowSv: Uint8Array, snapSv: Uint8Array): boolean => svSatisfied(snapSv, rowSv);
