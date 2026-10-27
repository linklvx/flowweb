// packages/shared/src/canvas/graph-normalize.ts
// Y1c T24（spec v5.4 §3.2 NORMALIZE 面——偏离 37①/38⑮）：引用类语义全后移读侧——读侧确定性屏蔽
// +graph_anomaly_total{kind} 词表单源。语义单源=validateParentGraph（F39 v8——dangling/cycle/
// nested-group/non-group-parent/dangling-edge 五种 violation 的既有判定；本模块只做**确定性屏蔽**
// 与 kind 映射，禁第二份深度遍历）。
// kind 映射（spec §3.2 NORMALIZE 行词汇）：dangling-edge=边引用不存在节点；duplicate-edge=同
// source→target 重复边（validateParentGraph 域外——本模块补唯一的拓扑屏蔽第二面）；dangling-parent
// =parentId 指向缺失节点；parent-cycle=父链环；cross-group-parent=non-group-parent/nested-group
// 合流（parentId 语义域=组挂靠）。media-ref-missing=媒体引用指向不存在资源——**存在性判定归
// PG Media 表 join（T26 MediaBinding reconcile/执行受理域）**，读侧 codec 无 PG 面：词表登记、
// 计数接线归 T26（spec §3.2「mention/image=mediaId 存在性归执行受理/ProjectDocIndex 不入 gate」）。
import { validateParentGraph } from './validateParentGraph';

/** graph_anomaly_total{kind} label 词表（closed——api 侧 metric labelNames 同源引用）。 */
export const GRAPH_ANOMALY_KINDS = [
  'dangling-edge',
  'duplicate-edge',
  'dangling-parent',
  'parent-cycle',
  'cross-group-parent',
  // 'media-ref-missing'——存在性归 PG join（T26 reconcile 接线；读侧无 PG 面），词面登记禁散落字面量
  'media-ref-missing',
] as const;
export type GraphAnomalyKind = typeof GRAPH_ANOMALY_KINDS[number];

export interface GraphNormalizeInput {
  nodes: Array<{ id: string; type: string; parentId?: string | null; data?: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string }>;
}

export interface GraphNormalizeResult<T extends GraphNormalizeInput> {
  nodes: T['nodes'];
  edges: T['edges'];
  /** 各 kind 屏蔽计数（不含 media-ref-missing——恒 0 占位键不出） */
  masked: Partial<Record<GraphAnomalyKind, number>>;
}

/**
 * 读侧确定性屏蔽（toReadModel 消费——REST/执行/导出/公开快照/前端 reconcile 同一语义）：悬挂边/
 * 重复边/悬挂 parentId/父链环/跨组 parent 全部确定性剥除（同输入恒同输出——禁随机/时序依赖）。
 * 屏蔽非修写：doc 原文不动（并发删除+建边=合法 CRDT 中间态，NORMALIZE 只在读者呈现层收敛）。
 */
export function maskGraphAnomalies<T extends GraphNormalizeInput>(input: T): GraphNormalizeResult<T> {
  const masked: Partial<Record<GraphAnomalyKind, number>> = {};
  const inc = (k: GraphAnomalyKind): void => { masked[k] = (masked[k] ?? 0) + 1; };
  // ① 重复边（同 source→target：保 id 序最小者——确定性）——validateParentGraph 域外补面
  const seenPair = new Set<string>();
  const dedupEdges = input.edges.filter((e) => {
    const pk = `${e.source}\u0000${e.target}`;
    if (seenPair.has(pk)) { inc('duplicate-edge'); return false; }
    seenPair.add(pk);
    return true;
  });
  // ② 拓扑/父链（语义单源=validateParentGraph——dangling-edge 同源计入）
  const violations = validateParentGraph(input.nodes, 'import', dedupEdges).violations;
  const badEdges = new Set(violations.filter((v) => v.kind === 'dangling-edge').map((v) => v.id));
  const badParent = new Set<string>();
  for (const v of violations) {
    if (v.kind === 'dangling') { badParent.add(v.id); inc('dangling-parent'); }
    else if (v.kind === 'cycle') { badParent.add(v.id); inc('parent-cycle'); }
    else if (v.kind === 'non-group-parent' || v.kind === 'nested-group') { badParent.add(v.id); inc('cross-group-parent'); }
  }
  const nodes = badParent.size === 0
    ? input.nodes
    : input.nodes.map((n) => (badParent.has(n.id) && n.parentId != null ? { ...n, parentId: undefined } : n));
  const edges = badEdges.size === 0 ? dedupEdges : dedupEdges.filter((e) => !badEdges.has(e.id));
  if (badEdges.size > 0) masked['dangling-edge'] = (masked['dangling-edge'] ?? 0) + badEdges.size;
  return { nodes, edges, masked };
}
