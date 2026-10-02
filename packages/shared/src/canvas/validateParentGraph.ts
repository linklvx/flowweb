export interface ParentGraphViolation { kind: 'dangling' | 'cycle' | 'nested-group' | 'non-group-parent' | 'dangling-cell' | 'dangling-edge'; id: string }

/** parentId/edges/cells 结构校验（F39 v8 收窄 + v11 时机前移）。
 *  导入档校验时机 = 跨用户过滤之前、remap 之前（remap 把悬空折 undefined——挂后 dangling 恒 0 假绿；
 *  过滤剪边不碰 cells——挂后合法模板 cells 变悬空假拒）。
 *  clone 档 = remap 之后，检环+组深≤1（nested-group——O0a-2 两档共用单源升格 fatal；悬空是
 *  服务端剥除的可达真实状态——降级红线保留）。
 *  edges 仅 import 档消费——import 档调用方漏传第三参会静默跳过 dangling-edge 检查。 */
export function validateParentGraph(
  nodes: { id: string; type: string; parentId?: string | null; data?: Record<string, unknown> }[],
  mode: 'import' | 'clone',
  edges: { id: string; source: string; target: string }[] = [],
): { violations: ParentGraphViolation[] } {
  const byId = new Map(nodes.map((nd) => [nd.id, nd]));
  const violations: ParentGraphViolation[] = [];
  // 组深≤1 恒检（O0a-2：原 import 分支行前移——两档共用同一检查，禁第二份深度遍历实现）
  for (const nd of nodes) {
    if (nd.type === 'group' && nd.parentId != null && byId.get(nd.parentId)?.type === 'group') violations.push({ kind: 'nested-group', id: nd.id });
  }
  if (mode === 'import') {
    for (const nd of nodes) {
      if (nd.parentId != null && !byId.has(nd.parentId)) violations.push({ kind: 'dangling', id: nd.id });
      else if (nd.parentId != null && byId.get(nd.parentId)?.type !== 'group') violations.push({ kind: 'non-group-parent', id: nd.id });
      const cells = nd.data?.cells;
      if (nd.type === 'group' && Array.isArray(cells)) {
        for (const c of cells) if (c != null && !byId.has(c as string)) violations.push({ kind: 'dangling-cell', id: nd.id });
      }
    }
    for (const e of edges) {
      if (!byId.has(e.source) || !byId.has(e.target)) violations.push({ kind: 'dangling-edge', id: e.id });
    }
  }
  // 环检测两档共跑；三色标记（1=in-progress、2=done）——回到 in-progress 节点即环，
  // 报该节点为代表（每环恰一条 violation——去重 v3）；悬空 parentId 跳过（byId.has 守卫）
  const STATE = new Map<string, 1 | 2>();
  const walk = (id: string): void => {
    if (STATE.get(id) === 2) return;
    STATE.set(id, 1);
    const p = byId.get(id)?.parentId;
    if (p != null && byId.has(p)) {
      if (STATE.get(p) === 1) violations.push({ kind: 'cycle', id: p });
      else if (STATE.get(p) !== 2) walk(p);
    }
    STATE.set(id, 2);
  };
  for (const nd of nodes) walk(nd.id);
  return { violations };
}
