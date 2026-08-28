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
