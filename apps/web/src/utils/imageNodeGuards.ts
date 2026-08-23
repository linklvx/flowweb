// apps/web/src/utils/imageNodeGuards.ts
import type { Node } from '@xyflow/react';

/** spec 5.1：含完成图片节点判定（imageGen/imageExtGen: fileId||referenceImage——上传图无 status:done；multiImageGen: images 有 success） */
export function isImageCompletedNode(node: Node): boolean {
  const d = node.data as any;
  if (node.type === 'imageGen' || node.type === 'imageExtGen') {
    return !!(d?.fileId || d?.referenceImage);
  }
  if (node.type === 'multiImageGen') {
    return Array.isArray(d?.images) && d.images.some((i: any) => i?.status === 'success');
  }
  return false;
}
