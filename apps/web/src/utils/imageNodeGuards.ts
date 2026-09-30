// apps/web/src/utils/imageNodeGuards.ts
import type { Node } from '@xyflow/react';
// 批1-6（B2 合并视图）：exec 投影终态参与完成判定。循环依赖同 canvasStore 裁定：
// nodeStore → canvasStore → 本模块 → nodeStore，均函数体内延迟使用（顶层仅声明）。
import { execStatusOf } from '@/stores/nodeStore';

/** spec 5.1：含完成图片节点判定（imageGen/imageExtGen: fileId||referenceImage——上传图无 status:done；multiImageGen: images 有 success）。
 *  批1-6 合并视图：imageGen/imageExtGen 另认 exec 投影 done（服务端已写终态、data.fileId 异步回写未达——断连恢复形态） */
export function isImageCompletedNode(node: Node): boolean {
  const d = node.data as any;
  if (node.type === 'imageGen' || node.type === 'imageExtGen') {
    return !!(d?.fileId || d?.referenceImage) || execStatusOf(node.id) === 'done';
  }
  if (node.type === 'multiImageGen') {
    return Array.isArray(d?.images) && d.images.some((i: any) => i?.status === 'success');
  }
  return false;
}
