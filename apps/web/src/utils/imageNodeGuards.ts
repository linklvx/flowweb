// apps/web/src/utils/imageNodeGuards.ts
import type { Node } from '@xyflow/react';

/** spec 5.1：含完成图片节点判定（imageGen/imageExtGen: done+fileId；multiImageGen: images 有 success） */
export function isImageCompletedNode(node: Node): boolean {
  const d = node.data as any;
  if (node.type === 'imageGen' || node.type === 'imageExtGen') {
    return d?.status === 'done' && !!d?.fileId;
  }
  if (node.type === 'multiImageGen') {
    return Array.isArray(d?.images) && d.images.some((i: any) => i?.status === 'success');
  }
  return false;
}
