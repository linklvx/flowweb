import type { ProjectData, VideoClip, ImageClip, AudioClip } from '../types';
import { autoEdgeId } from '@/stores/autoEdgeIds';
import { useCanvasStore } from '@/stores/canvasStore';

export interface AutoEdgeOp {
  toAdd: { id: string; source: string; target: string }[];
  toRemove: string[];
}

/** 纯函数对账（spec 定稿算法）：expected = 时间轴引用的源节点集合；mine = target 指向本剪辑节点的 auto: 边；补缺删余。手动边（无前缀）不碰 */
export function planAutoEdgeOps(
  data: ProjectData,
  edges: { id: string; source: string; target: string }[],
  editNodeId: string,
): AutoEdgeOp {
  const expected = new Set(
    Object.values(data.clips)
      .filter((c): c is VideoClip | ImageClip | AudioClip =>
        c.type !== 'subtitle' && !!c.sourceNodeId)
      .map((c) => c.sourceNodeId!),
  );
  const mine = edges.filter(e => e.target === editNodeId && e.id.startsWith('auto:'));
  const have = new Set(mine.map(e => e.source));
  const toAdd: AutoEdgeOp['toAdd'] = [];
  for (const src of expected) {
    if (!have.has(src)) toAdd.push({ id: autoEdgeId(editNodeId, src), source: src, target: editNodeId });
  }
  const toRemove = mine.filter(e => !expected.has(e.source)).map(e => e.id);
  return { toAdd, toRemove };
}

/** store 落地（编辑器每次片段增删 commit 后调用；幂等——addEdge 同 id no-op）。
 *  素材缺失态守卫（spec 生命周期 L120）：上游节点已删 → clip 仍引用但边不重建（防悬空边入库并经协作层持久化） */
export function ensureAutoEdges(editNodeId: string, data: ProjectData): void {
  const cs = useCanvasStore.getState();
  const ops = planAutoEdgeOps(data, cs.edges, editNodeId);
  const nodeIds = new Set(cs.nodes.map((n) => n.id));
  for (const a of ops.toAdd) {
    if (!nodeIds.has(a.source)) continue;
    cs.addEdge(a.source, a.target, undefined, undefined, a.id);
  }
  for (const r of ops.toRemove) cs.removeEdge(r);
}
