// apps/web/src/pages/canvas/video-editor/export/product-node.ts
import { useCanvasStore } from '@/stores/canvasStore';
import { NODE_TYPES } from '@/stores/nodeStore';
import { autoOutEdgeId } from '@/stores/autoEdgeIds'; // 该边走 AutoEdge 通道不入撤销栈

const GAP = 80;
const PRODUCT_STEP = 400; // 产物节点近似宽 + 间隔（水平排开，重叠时步长递增——简化避让）

/** confirm 成功后自动建产物节点 + auto-out 输出边（一次性，不参与 reconcile）。
 *  Y4a T8 re-key：第二参名+data 键 videoProjectId→sourceNodeId（doc-schema-v5 矩阵 videoGen 槽键——
 *  T3 已换键，旧键写入会被键集外拒；=剪辑节点自身 canvas nodeId） */
export function createProductNode(editNodeId: string, sourceNodeId: string, fileId: string, projectTitle: string): string {
  const { nodes, addNode, addEdge } = useCanvasStore.getState();
  const editNode = nodes.find((n) => n.id === editNodeId);
  if (!editNode) throw new Error(`剪辑节点不存在: ${editNodeId}`);
  // O0b-2 A 类三档链（doc wh 第一/measured 第二/常量最后——C0-3 定档；B7-1 形态断言：链首非 .measured）
  const sw = (editNode as { width?: number }).width
    ?? (editNode as { measured?: { width?: number } }).measured?.width ?? 320;
  const count = nodes.filter(
    (n) => (n as { data?: Record<string, unknown> }).data?.origin === 'video-edit'
      && (n as { data?: Record<string, unknown> }).data?.sourceNodeId === sourceNodeId,
  ).length;
  const position = { x: editNode.position.x + sw + GAP + count * PRODUCT_STEP, y: editNode.position.y };
  const label = `${projectTitle} · 导出 ${count + 1}`;
  const nodeId = addNode(NODE_TYPES.VIDEO_GEN, position, { origin: 'video-edit', sourceNodeId, mediaId: fileId, label });   // Y2 B3：导出产物=作者放置只写 mediaId
  addEdge(editNodeId, nodeId, undefined, undefined, autoOutEdgeId(editNodeId, nodeId));
  return nodeId;
}
