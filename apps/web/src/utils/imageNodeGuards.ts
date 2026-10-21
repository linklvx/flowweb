// apps/web/src/utils/imageNodeGuards.ts
import type { Node } from '@xyflow/react';
// 批1-6（B2 合并视图）：完成判定合并视图。循环依赖同 canvasStore 裁定：
// nodeStore → canvasStore → 本模块 → nodeStore，均函数体内延迟使用（顶层仅声明）。
// Y1b T16（spec :55 Z18''「exec 降 cache——资金/执行/交付判定全读 PG」）：完成判定不再读 doc exec
// 投影——交付判定唯一权威=data.fileId/referenceImage（PG NodeArtifact→投影 poller 写 doc 的
// 服务端所有权面；T15 起 deliverArtifact 同 withSession(write) 事务原子写 data.fileId+exec done
// ——exec done 可见则 fileId 必已可见，exec 子句的历史使命〔断连恢复直写竞态窗〕随直写收口消亡）。
// raw 写 exec（外部 Yjs update 直改 exec map）自此仅构成显示漂移（alignExecFromIntents 重连对账
// 可修复），不影响交付判定——execStatusView 系纯展示投影。
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
