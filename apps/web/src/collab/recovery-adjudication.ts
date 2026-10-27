// apps/web/src/collab/recovery-adjudication.ts
// Y1c T25b 面 B（spec I-1 承接——plan :338 登记）：恢复用户面数据层（纯逻辑——UI 薄壳在
// RecoveryPanel/SyncBanner 消费）。
//   §1 B2 A 场景合并异常检测：DRAFT_MERGE_ANOMALY_KINDS（shared 冻结词表 draft-envelope.ts:95-110）
//      生产消费接通——boot 合并后跑一次，**不阻断**（DRAFT_MERGE_ANOMALY_NON_BLOCKING 冻结语义：
//      只读观察不写回 doc——提示展示后正常收敛）。拓扑判定单源=shared validateParentGraph
//      （dangling-edge/cross-group-parent）+deriveStoryboardCells（格位越界——禁第二套扫描器）。
//   §2 B1 B 场景逐字段裁定：默认保留当前（DRAFT_FIELD_CHOICE_DEFAULT 单源——无 journal/base
//      不自动判优，禁隐式取草稿）；删除显式确认；新增节点经 recovery import REST 导入
//      （importDraftEnvelope 生产接通=B4 接线闭环）。
import {
  deriveStoryboardCells, resolveStoryboardConfig, validateParentGraph,
  resolveAdjudicatedFieldValues,
  DRAFT_MERGE_ANOMALY_KINDS, DRAFT_MERGE_ANOMALY_NON_BLOCKING, type DraftMergeAnomalyKind,
  type DraftEnvelope, type DraftFieldConflict, type DraftFieldChoice,
} from '@flowweb/shared';

export { DRAFT_MERGE_ANOMALY_NON_BLOCKING, DRAFT_MERGE_ANOMALY_KINDS };
export type { DraftMergeAnomalyKind, DraftEnvelope, DraftFieldConflict };
export { DRAFT_FIELD_CHOICE_DEFAULT, resolveAdjudicatedFieldValues } from '@flowweb/shared';
export type { DraftFieldChoice, DraftAdjudication } from '@flowweb/shared';

// sha256Hex re-export 源（rejected-recovery 单源——本模块不复制 crypto 面）
export { sha256Hex as sha256HexSource } from './rejected-recovery';

// ═══ §1 A 场景合并异常检测（不阻断——只读观察）════════════════════════════════════════

export interface DraftMergeAnomalyInput {
  nodes: Array<{ id: string; type: string; parentId?: string | null; data?: Record<string, unknown> }>;
  edges: Array<{ id: string; source?: string; target?: string }>;
}

export type DraftMergeAnomalyReport = Partial<Record<DraftMergeAnomalyKind, number>>;

/** 五 kind 检测（词表单源=DRAFT_MERGE_ANOMALY_KINDS——本函数恒只产出词表内 kind）：
 *  - duplicate-order：同层同 order 键成员（并发/离线合并产物——读序 (order,id) tie-break 容忍不丢节点）；
 *  - duplicate-slot：同组同格位成员（(slot,id) tie-break 挤格容忍——提示展示）；
 *  - dangling-edge：悬挂边（validateParentGraph violations dangling-edge 单源计数）；
 *  - cross-group-parent：跨组 parent（non-group-parent/nested-group 合流——validateParentGraph 单源）；
 *  - cells-out-of-bounds：分镜格位越界/溢出（deriveStoryboardCells overflowIds 单源——slot≥capacity
 *    与满员挤格失败两形态；容量=storyboard config gridRows×gridCols 派生不落 doc）。 */
export function detectDraftMergeAnomalies(input: DraftMergeAnomalyInput): DraftMergeAnomalyReport {
  const report: DraftMergeAnomalyReport = {};
  const inc = (k: DraftMergeAnomalyKind, n = 1): void => { report[k] = (report[k] ?? 0) + n; };

  // ① duplicate-order（同层=parentId 域；order 域成员=data.order 字符串键）
  const orderSeen = new Map<string, number>();
  for (const n of input.nodes) {
    const o = n.data?.order;
    if (typeof o !== 'string' || o === '') continue;
    const k = `${n.parentId ?? ''}\u0000${o}`;
    orderSeen.set(k, (orderSeen.get(k) ?? 0) + 1);
  }
  for (const c of orderSeen.values()) if (c > 1) inc('duplicate-order', c);

  // ② duplicate-slot（同组同 slot 整数格位）+⑤ cells-out-of-bounds（分镜容量越界——derive 单源）
  const childrenOf = new Map<string, Array<{ id: string; data: Record<string, unknown> }>>();
  const slotSeen = new Map<string, number>();
  for (const n of input.nodes) {
    if (n.parentId == null) continue;
    if (!childrenOf.has(n.parentId)) childrenOf.set(n.parentId, []);
    childrenOf.get(n.parentId)!.push({ id: n.id, data: n.data ?? {} });   // data 缺省兜空（deriveStoryboardCells data 必填形）
    const s = n.data?.slot;
    if (typeof s === 'number' && Number.isInteger(s) && s >= 0) {
      const k = `${n.parentId}\u0000${s}`;
      slotSeen.set(k, (slotSeen.get(k) ?? 0) + 1);
    }
  }
  for (const c of slotSeen.values()) if (c > 1) inc('duplicate-slot', c);
  for (const n of input.nodes) {
    if (n.type !== 'group' || n.data?.groupType !== 'storyboard') continue;
    const cfg = resolveStoryboardConfig(n.data);   // 入参=组 data（storyboard 键内配置——resolveStoryboardConfig 签名）
    const { overflowIds } = deriveStoryboardCells(childrenOf.get(n.id) ?? [], cfg.gridRows * cfg.gridCols);
    if (overflowIds.length > 0) inc('cells-out-of-bounds', overflowIds.length);
  }

  // ③④ 拓扑（validateParentGraph 单源——dangling-edge 计数+跨组 parent 合流）
  // 读模型边端点可选（source?: string——CanvasReadModelEdge 形）：缺失端点映射 '' 兜（byId 恒
  //  miss=dangling-edge 判定——与 undefined 端点语义等值）
  const violations = validateParentGraph(input.nodes, 'import', input.edges.map((e) => ({ id: e.id, source: e.source ?? '', target: e.target ?? '' }))).violations;
  for (const v of violations) {
    if (v.kind === 'dangling-edge') inc('dangling-edge');
    else if (v.kind === 'non-group-parent' || v.kind === 'nested-group') inc('cross-group-parent');
  }
  return report;
}

// ═══ §2 B 场景逐字段裁定数据面（默认保留当前——shared 冻结纪律消费）══════════════════

export interface RecoveryAdjudicationNodeRef { id: string; type: string; data?: Record<string, unknown> }

export interface RecoveryAdjudicationView {
  /** 修改字段冲突行（「当前 vs 草稿」二选一面——等值字段不入：无冲突面零行） */
  conflicts: DraftFieldConflict[];
  /** 新增节点（draft-only——逐 id 确认导入非批量勾选） */
  additions: RecoveryAdjudicationNodeRef[];
  /** 删除确认候选（current-only=用户本地已删、服务端现存的节点——显式确认才删） */
  deletions: RecoveryAdjudicationNodeRef[];
}

const jsonEq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** 单节点 data 键并集逐键深比对（JSON 等值——RichText 域容器/数组同构比对）→冲突行。
 *  视图（buildRecoveryAdjudicationView）与 typed 载荷（buildAdjudicatedImport）共用本 diff——
 *  判定面单源（禁两套键差分）。 */
function diffNodeData(nodeId: string, draftData: Record<string, unknown>, currentData: Record<string, unknown>): DraftFieldConflict[] {
  const conflicts: DraftFieldConflict[] = [];
  for (const key of new Set([...Object.keys(draftData), ...Object.keys(currentData)])) {
    if (key in draftData && !(key in currentData)) {
      conflicts.push({ nodeId, key, currentValue: undefined, draftValue: draftData[key] });
    } else if (!(key in draftData) && key in currentData) {
      conflicts.push({ nodeId, key, currentValue: currentData[key], draftValue: undefined });
    } else if (!jsonEq(draftData[key], currentData[key])) {
      conflicts.push({ nodeId, key, currentValue: currentData[key], draftValue: draftData[key] });
    }
  }
  return conflicts;
}

/** 裁定视图（纯函数）：envelope（draft）×current（服务端重置态）三分派。等值键=非冲突面
 *  （无需用户裁定）。 */
export function buildRecoveryAdjudicationView(
  envelope: DraftEnvelope,
  currentNodes: readonly RecoveryAdjudicationNodeRef[],
): RecoveryAdjudicationView {
  const currentById = new Map(currentNodes.map((n) => [n.id, n]));
  const draftIds = new Set(envelope.nodes.map((n) => n.id));
  const conflicts: DraftFieldConflict[] = [];
  const additions: RecoveryAdjudicationNodeRef[] = [];
  const deletions: RecoveryAdjudicationNodeRef[] = [];
  for (const d of envelope.nodes) {
    const cur = currentById.get(d.id);
    if (cur === undefined) {
      additions.push({ id: d.id, type: d.type, data: d.data as Record<string, unknown> | undefined });
      continue;
    }
    conflicts.push(...diffNodeData(d.id, (d.data ?? {}) as Record<string, unknown>, cur.data ?? {}));
  }
  for (const c of currentNodes) {
    if (!draftIds.has(c.id)) deletions.push(c);
  }
  return { conflicts, additions, deletions };
}

/** T25b 收口 I-3：裁定结果 → typed REST 导入载荷（**禁 doc 写承载裁定**——DRAFT_ADJUDICATION_
 *  NO_AUTO_REPLAY 冻结注记：被拒 doc 的本地写整帧再拒=裁定服务端侧静默丢失；裁定三面全经
 *  importDraftEnvelope 承载）。规则：
 *  - 新增节点（draft-only）：采纳集内才入载荷（conflict 面不适用——非冲突节点恒 import）；
 *  - 冲突节点（两端共有）：**任一字段选 draft** 才入载荷并标 conflictChoices='replace'（#9 默认
 *    skip 不覆盖——replace 显式用户裁定）；载荷字段取值=current 选域回写**服务端值**、draft 选域
 *    保草稿值（信封自洽——禁未裁定字段混入草稿值覆盖服务端）；
 *  - 删除确认（current-only）：deletionNodeIds typed 承载（服务端现存节点显式删除）；
 *  - 边：两端 ∈ 载荷节点∪服务端现存集才保留（悬挂端丢弃——服务端候选 doc 全量校验同链）；
 *  - 全 current+零采纳+零删除=null（零动作面零 REST 短路）。 */
export interface AdjudicatedImport {
  envelope: DraftEnvelope;
  conflictChoices: Record<string, 'skip' | 'replace'>;
  deletionNodeIds: string[];
}

export async function buildAdjudicatedImport(
  envelope: DraftEnvelope,
  serverNodes: readonly RecoveryAdjudicationNodeRef[],
  adjudication: { adoptedIds: readonly string[]; fieldChoices: Record<string, Record<string, DraftFieldChoice>>; deletionIds: readonly string[] },
): Promise<AdjudicatedImport | null> {
  const serverById = new Map(serverNodes.map((n) => [n.id, n]));
  const adopted = new Set(adjudication.adoptedIds);
  const nodes: DraftEnvelope['nodes'] = [];
  const conflictChoices: Record<string, 'skip' | 'replace'> = {};
  for (const d of envelope.nodes) {
    const server = serverById.get(d.id);
    if (server === undefined) {
      if (adopted.has(d.id)) nodes.push(d);   // 采纳新增（非冲突面恒 import）
      continue;
    }
    // 冲突节点：**服务端值起底+仅显式 draft 选域覆写**（微批 I-1/I-5 根修——修前 {...draftData}
    // 起底=未触碰字段以草稿值静默覆盖服务端，违 §4.5 B 行「未选择=默认保留当前」冻结语义）。
    // 判定单源=shared resolveAdjudicatedFieldValues（choices[key] ?? DRAFT_FIELD_CHOICE_DEFAULT
    // 语义由冻结函数承载——本模块零第二套裁定规则；diff 面=diffNodeData 与视图共用）。
    const draftData = (d.data ?? {}) as Record<string, unknown>;
    const serverData = server.data ?? {};
    const nodeConflicts = diffNodeData(d.id, draftData, serverData);
    const resolutions = resolveAdjudicatedFieldValues(nodeConflicts, {
      adoptedNodeIds: [], fieldChoices: adjudication.fieldChoices, deletionConfirmations: [],
    });
    if (!resolutions.some((r) => r.chosen === 'draft')) continue;   // 全 current=服务端现态已正确零写
    const mergedData: Record<string, unknown> = { ...serverData };   // 服务端值起底（未触碰/等值字段恒服务端态）
    for (const r of resolutions) {
      if (r.chosen === 'draft') mergedData[r.key] = r.value;         // 显式 draft 选域=草稿值覆写
      else if (r.value === undefined) delete mergedData[r.key];      // current 选域且服务端缺键=域不携（信封自洽）
    }
    nodes.push({ ...d, data: mergedData } as DraftEnvelope['nodes'][number]);
    conflictChoices[d.id] = 'replace';
  }
  const deletionNodeIds = [...adjudication.deletionIds];
  if (nodes.length === 0 && deletionNodeIds.length === 0) return null;
  const known = new Set<string>([...nodes.map((n) => n.id), ...serverById.keys()]);
  const edges = envelope.edges.filter((e) => typeof e.source === 'string' && typeof e.target === 'string' && known.has(e.source) && known.has(e.target));
  const { sha256Hex } = await import('./rejected-recovery');
  const [nodesHash, edgesHash] = await Promise.all([
    sha256Hex(JSON.stringify(nodes)),
    sha256Hex(JSON.stringify(edges)),
  ]);
  return {
    envelope: {
      ...envelope,
      draftId: `${envelope.draftId}-adj-${Date.now()}`,
      nodes,
      edges,
      hashes: { nodes: nodesHash, edges: edgesHash },
    },
    conflictChoices,
    deletionNodeIds,
  };
}

/** 采纳信封（新增节点导入载荷）：仅采纳节点+两端均在采纳集（或既有集）的边，新 draftId+重算
 *  hashes（服务端 hash 完整性门——改写载荷必须重签）。空采纳=null（调用面短路零 REST）。
 *  端点判定宽松化：边源/目标任一在「采纳集∪服务端现存集」即保留（服务端候选 doc 全量校验
 *  兜悬挂边丢弃——收口 I-6 同链）。 */
export async function buildAdoptedEnvelope(
  envelope: DraftEnvelope,
  adoptedIds: readonly string[],
  currentIds: readonly string[] = [],
): Promise<DraftEnvelope | null> {
  if (adoptedIds.length === 0) return null;
  const keep = new Set(adoptedIds);
  const known = new Set([...adoptedIds, ...currentIds]);
  const nodes = envelope.nodes.filter((n) => keep.has(n.id));
  const edges = envelope.edges.filter((e) => typeof e.source === 'string' && typeof e.target === 'string' && known.has(e.source) && known.has(e.target));
  const { sha256Hex } = await import('./rejected-recovery');
  const [nodesHash, edgesHash] = await Promise.all([
    sha256Hex(JSON.stringify(nodes)),
    sha256Hex(JSON.stringify(edges)),
  ]);
  return {
    ...envelope,
    draftId: `${envelope.draftId}-adopt-${Date.now()}`,
    nodes,
    edges,
    hashes: { nodes: nodesHash, edges: edgesHash },
  };
}
