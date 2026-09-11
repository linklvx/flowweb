import type { ProjectData } from '../types';

/** 上游素材节点被删（clip 仍引用 sourceNodeId 但画布无该节点）→ 片段标红"素材已删除"（spec 生命周期第 3 条；
 *  导出前置拦截缺失 mediaId 在 Plan 4）。 */
export function missingSourceNodeIds(data: ProjectData | null, nodeIds: Set<string>): Set<string> {
  const missing = new Set<string>();
  if (!data) return missing;
  for (const c of Object.values(data.clips)) {
    if (c.type === 'subtitle') continue;
    if (c.sourceNodeId && !nodeIds.has(c.sourceNodeId)) missing.add(c.sourceNodeId);
  }
  return missing;
}
