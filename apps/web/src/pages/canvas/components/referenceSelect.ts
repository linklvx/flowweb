/** 画布参考选择——可选判定纯函数（spec §3.3）。
 * 类型守卫复用 nodeStore.isImageNode（:201-205，恰为 imageGen|imageExtGen——不留第二份节点分类表）；
 * 主图 = data.fileId ?? data.referenceImage（与 ImageGenNode.tsx:82-87 展示解析同源）。 */
import { isImageNode } from '@/stores/nodeStore';

export interface ReferencePickNodeLike {
  id: string;
  type?: string;
  data?: { fileId?: string | null; referenceImage?: string | null } | null;
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
  const fileId = targetNode.data?.fileId ?? targetNode.data?.referenceImage;
  if (!fileId) return { kind: 'ignore' };
  if (currentImageIds.includes(fileId)) return { kind: 'ignore' };
  if (currentImageIds.length >= maxCount) return { kind: 'full', fileId };
  return { kind: 'add', fileId };
}
