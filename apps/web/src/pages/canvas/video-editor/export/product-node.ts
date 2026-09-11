// apps/web/src/pages/canvas/video-editor/export/product-node.ts
import { useCanvasStore } from '@/stores/canvasStore';
import { autoOutEdgeId } from '@/stores/autoEdgeIds'; // 该边走 AutoEdge 通道不入撤销栈

const GAP = 80;
const PRODUCT_STEP = 400; // 产物节点近似宽 + 间隔（水平排开，重叠时步长递增——简化避让）

/** confirm 成功后自动建产物节点 + auto-out 输出边（一次性，不参与 reconcile） */
export function createProductNode(editNodeId: string, videoProjectId: string, fileId: string, projectTitle: string): string {
  const { nodes, addNode, addEdge } = useCanvasStore.getState();
  const editNode = nodes.find((n) => n.id === editNodeId);
  if (!editNode) throw new Error(`剪辑节点不存在: ${editNodeId}`);
  const sw = (editNode as { measured?: { width?: number }; width?: number }).measured?.width
    ?? (editNode as { width?: number }).width ?? 320;
  const count = nodes.filter(
    (n) => (n as { data?: Record<string, unknown> }).data?.origin === 'video-edit'
      && (n as { data?: Record<string, unknown> }).data?.videoProjectId === videoProjectId,
  ).length;
  const position = { x: editNode.position.x + sw + GAP + count * PRODUCT_STEP, y: editNode.position.y };
  const label = `${projectTitle} · 导出 ${count + 1}`;
  const nodeId = addNode('videoGen', position, { origin: 'video-edit', videoProjectId, status: 'done', fileId, label });
  addEdge(editNodeId, nodeId, undefined, undefined, autoOutEdgeId(editNodeId, nodeId));
  return nodeId;
}
