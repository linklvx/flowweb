/** 画布参考选择——可选判定纯函数（spec §3.3）。
 * 类型守卫复用 nodeStore.isImageNode（:201-205，恰为 imageGen|imageExtGen——不留第二份节点分类表）；
 * 主图 = resolvePrimaryMediaId 单源（Y2 B3——data.fileId ?? referenceImage 退役）。 */
import { isImageNode } from '@/stores/nodeStore';
import { resolvePrimaryMediaId } from '@flowweb/shared';

export interface ReferencePickNodeLike {
  id: string;
  type?: string;
  data?: Record<string, unknown> | null;
}

export type ReferencePickResult =
  | { kind: 'add'; fileId: string }
  | { kind: 'full'; fileId: string }
  | { kind: 'ignore' };

export function decideReferencePick(
  sourceNodeId: string,
  targetNode: ReferencePickNodeLike,
  currentImageIds: string[],
  maxCount: number,
): ReferencePickResult {
  if (targetNode.id === sourceNodeId) return { kind: 'ignore' };
  if (!isImageNode(targetNode)) return { kind: 'ignore' };
  const fileId = resolvePrimaryMediaId({ type: targetNode.type, data: targetNode.data ?? {} }, undefined);   // Y2 B3：主槽判定单源（fileId ?? referenceImage 退役）
  if (!fileId) return { kind: 'ignore' };
  if (currentImageIds.includes(fileId)) return { kind: 'ignore' };
  if (currentImageIds.length >= maxCount) return { kind: 'full', fileId };
  return { kind: 'add', fileId };
}
