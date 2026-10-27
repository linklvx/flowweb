// packages/shared/src/collab/draft-envelope.ts
// Y1c T5c（plan v1.7 Task 5 客户端/恢复段——spec v5.4 §4.5，偏离 38⑬）：DraftEnvelope 类型+三场景表
// （B=用户裁定式）契约冻结。**CONTRACT-FREEZE**——类型+常量+纯函数；零生产行为变更
// （消费方=T25 恢复实现/T10 web 恢复 UI/T19 导出）。复用纪律：nodes/edges 载体=T4 doc-codec
// canonical 快照类型（CanvasNodeSnapshot/CanvasEdgeSnapshot——禁重抄第二份形状）；8MiB 数字与
// T5b EXEC_INPUT_RAW_MAX_BYTES 同值不同义（本文件为 recovery import REST 载荷上限——execution-request.ts:117
// 同款「字面量直书+注释锚」先例，禁互引双义真源）。契约测试=draft-envelope.spec.ts（TDD 红先行）。
import type { CanvasNodeSnapshot, CanvasEdgeSnapshot } from '../canvas/doc-codec';

// ═══ §1 DraftEnvelope 类型化导出清单（§4.5 末段——非 CRDT update 裸字节）═════════════════════

/** 草稿信封（类型化导出清单——**非 CRDT update 裸字节**：nodes/edges=T4 canonical 快照（语义快照，
 *  墓碑/事务壳不随行）；hashes=64hex 内容摘要（sha256 计算点归 T25 web 实现——shared 无 crypto
 *  先例，canonicalPlanHashPayload 同款纪律）。恢复/拒帧/换代三场景共用本载体。
 *  **T25 修正 #9（确认点① 裁定 #9——plan 登记修订通道）**：+historyId（捕获纪元——SystemHistory
 *  epoch 标识；跨纪元（PITR/bump 后）草稿导入归 C 场景 import-as-new，纪元不构成导入阻断）。 */
export interface DraftEnvelope {
  draftId: string;
  projectId: string;
  generation: number;
  schemaVersion: number;
  /** 捕获纪元（SystemHistory historyId——#9：纪元漂移可检测；导入面=C 场景 typed 内容非 CRDT，
   *  纪元不匹配不拒只随行报告） */
  historyId: string;
  /** 捕获时刻（epoch ms——stale 判定/审计面） */
  capturedAtMs: number;
  /** 来源标签（per-tab 本地记录的 tab 维度——§3.4 boot mergeUpdates 并集的成员身份） */
  tabId: string;
  nodes: CanvasNodeSnapshot[];
  edges: CanvasEdgeSnapshot[];
  /** 历史/来源载荷透传（doc meta 同域——读侧不解释） */
  meta: Record<string, unknown>;
  /** 内容摘要（nodes/edges 各一枚 64hex——完整性校验非增量基座） */
  hashes: DraftEnvelopeHashes;
}

export interface DraftEnvelopeHashes {
  nodes: string;
  edges: string;
}

/** recovery import REST 载荷上限（§3.2 v5.4⑱：client→server 大差量恢复走 DraftEnvelope REST ≤8MiB——
 *  HTTP seed 端点废止；超限=导出文件+fail-closed 不开导入）。8MiB=8*1024*1024 字面量直书以配
 *  as const——doc-protocol.ts:476 COLLAB_WS_MAX_PAYLOAD_BYTES 同款先例。 */
export const DRAFT_ENVELOPE_MAX_BYTES = 8_388_608 as const;

/** 导入契约（§4.5 末段）：单飞+幂等键+资格+超限处置——REST 面由 T25 实装，本表冻结语义。 */
export const DRAFT_IMPORT_CONTRACT = {
  singleFlight: '导入=单飞（每项目同时一个 draftId——重复并发导入后到拒绝）',
  idempotency: '幂等键（draftId 键幂等：重试同结果——传输层去重≠业务层幂等两层不混〔§4.4 同款纪律〕）',
  eligibility: 'OWNER/EDITOR 且仅本人 draft（他人 draft 拒收——候选 doc 全量校验〔Schema/权限/图结构/XML 白名单〕恢复流程非兼容层）',
  overLimit: `超限（>${DRAFT_ENVELOPE_MAX_BYTES}）=导出文件+fail-closed 不开导入`,
} as const;

/** 负控：无 basePgSeq 3-way merge（§4.5 v5.3 表前句——自动三方合并在无服务端基座时不可判定，
 *  整族不做；跨代原地合并不做〔另立 feature 才可〕）。 */
export const DRAFT_NO_THREE_WAY_MERGE =
  '无 basePgSeq 3-way merge——自动三方合并在无服务端基座时不可判定，整族不做（跨代原地合并同禁）' as const;

// ═══ §2 三场景分型纯函数（§4.5 三场景表）════════════════════════════════════════════════════

/** 三场景（§4.5 表）：A=同代两标签 boot 并集；B=同代拒帧恢复用户裁定；C=跨代 import-as-new。 */
export type DraftScenario = 'merge-boot' | 'adjudicate' | 'import-as-new';

/** 触发上下文：boot=多标签本地记录并集装载（§3.4）；frame-denied=拒帧（4411/4412）后恢复；
 *  import=换代（4410/vacuum）后新 #g 导入。 */
export type DraftScenarioTrigger = 'boot' | 'frame-denied' | 'import';

export interface DraftScenarioInput {
  draftGeneration: number;
  currentGeneration: number;
  trigger: DraftScenarioTrigger;
}

/** 三场景分型（纯函数——真值表由测试冻结）：
 *  - 跨代（draftGeneration≠currentGeneration，无论方向）→ import-as-new（C：nodeId 稳定不重映射、
 *    作新节点导入——跨代原地合并不做）；
 *  - 同代+boot → merge-boot（A：Y.mergeUpdates CRDT 并集——两标签独立 clientID raw merge 安全〔§3.4〕）；
 *  - 同代+frame-denied → adjudicate（B：客户端重置到服务端状态+草稿逐字段用户裁定）；
 *  - 同代+import 触发=DRAFT_SCENARIO_INVALID（换代导入语义要求跨代——fail-fast 防调用方错配场景）。 */
export function resolveDraftScenario(i: DraftScenarioInput): DraftScenario {
  if (i.draftGeneration !== i.currentGeneration) return 'import-as-new';
  if (i.trigger === 'boot') return 'merge-boot';
  if (i.trigger === 'frame-denied') return 'adjudicate';
  throw new Error(
    `DRAFT_SCENARIO_INVALID: 换代导入（import）触发但代际相同（draft=${i.draftGeneration} current=${i.currentGeneration}）——同代拒帧走 adjudicate/boot，跨代语义要求 generation 不匹配`,
  );
}

// ═══ §3 A 场景：boot 合并后异常提示契约（ProjectDocIndex 检测项——不阻断）═══════════════════

/** A 场景合并后异常检测项（§4.5 表 A 行 v5.4：boot 合并后跑一次 ProjectDocIndex 异常检测——
 *  **不阻断合并**，不宣称无冲突面：CRDT 并集≠用户语义无冲突〔A 删 B 改同节点等〕）。
 *  检测实现=T24 ProjectDocIndex（rebuild(doc) 后查询——本清单为查询面契约非第二套扫描器）。 */
export const DRAFT_MERGE_ANOMALY_KINDS = [
  'duplicate-order',        // 重复 order 键（同层序冲突——Y1a 序域）
  'duplicate-slot',         // 重复 slot 格位（分镜子格位冲突）
  'dangling-edge',          // 悬挂边（边引用缺失节点——读侧 NORMALIZE 同族〔§3.2〕）
  'cross-group-parent',     // 跨组 parent（父子跨组边界破坏）
  'cells-out-of-bounds',    // cells 越界（分镜格位索引越界）
] as const;
export type DraftMergeAnomalyKind = typeof DRAFT_MERGE_ANOMALY_KINDS[number];

/** 「合并提示」语义注记（§4.5 表 A 行用户可见列=正常收敛+异常提示）：提示不阻断、不回滚、
 *  不写回 doc（只读观察——与 §3.2 NORMALIZE 面「只读不写回」同纪律）。 */
export const DRAFT_MERGE_ANOMALY_NON_BLOCKING = {
  policy: '不阻断合并（提示展示后正常收敛——CRDT 并集是合法 doc 态）',
  noConflictFreeClaim: '不宣称无冲突面（CRDT 并集≠用户语义无冲突：A 删 B 改同节点等语义冲突由用户在 B/C 场景裁定）',
  read_only: '只读观察不写回 doc',
} as const;

// ═══ §4 B 场景：用户裁定数据结构（§4.5 表 B 行——v5.4 改用户裁定式）══════════════════════════

/** 单字段冲突（「当前值 vs 草稿值」二选一面的一行）：无 journal/base 不自动判优——
 *  默认保留当前（DRAFT_FIELD_CHOICE_DEFAULT），用户显式选草稿才覆盖。 */
export interface DraftFieldConflict {
  nodeId: string;
  key: string;
  currentValue: unknown;
  draftValue: unknown;
}

/** 二选一值域（'current'|'draft'——默认 current）。 */
export type DraftFieldChoice = 'current' | 'draft';
export const DRAFT_FIELD_CHOICE_DEFAULT: DraftFieldChoice = 'current';

/** 用户裁定结果（B 场景确认面载荷）：
 *  - adoptedNodeIds=新增节点直接导入（用户确认数——逐 id 确认非批量勾选）；
 *  - fieldChoices=修改字段逐字段二选一（未列字段=默认保留当前）；
 *  - deletionConfirmations=删除/恢复显式确认（nodeId 清单——不自动复活）。 */
export interface DraftAdjudication {
  adoptedNodeIds: string[];
  fieldChoices: Record<string, Record<string, DraftFieldChoice>>;
  deletionConfirmations: string[];
}

/** 裁定后的字段取值（resolveAdjudicatedFieldValues 出口一行）。 */
export interface DraftFieldResolution {
  nodeId: string;
  key: string;
  chosen: DraftFieldChoice;
  value: unknown;
}

/** 裁定应用纯函数：冲突清单×用户裁定→逐字段取值。规则：显式选择优先；**未选择=默认保留当前**
 *  （DRAFT_FIELD_CHOICE_DEFAULT——无 journal/base 不自动判优，禁隐式取草稿）。 */
export function resolveAdjudicatedFieldValues(
  conflicts: readonly DraftFieldConflict[],
  adjudication: DraftAdjudication,
): DraftFieldResolution[] {
  return conflicts.map((c) => {
    const choice = adjudication.fieldChoices[c.nodeId]?.[c.key] ?? DRAFT_FIELD_CHOICE_DEFAULT;
    return { nodeId: c.nodeId, key: c.key, chosen: choice, value: choice === 'draft' ? c.draftValue : c.currentValue };
  });
}

/** 负控注记（§4.5 表 B 行）：客户端重置到服务端状态+草稿转 read model（剥服务端字段）——
 *  不重放被拒原始 update；typed 自动重放（无 journal/base=LWW 覆盖）已废止。 */
export const DRAFT_ADJUDICATION_NO_AUTO_REPLAY =
  '无 journal/base 禁自动重放——不重放被拒原始 update（typed 自动重放 LWW 覆盖式已废止〔v5.4〕；草稿转 read model 剥服务端字段）' as const;

// ═══ §5 C 场景：import-as-new 确认面三行+nodeId 冲突处置（§4.5 表 C 行）═════════════════════

/** 确认面第一行：内容节点数（nodes/edges 计数——导入规模告知）。 */
export interface DraftContentCounts {
  nodeCount: number;
  edgeCount: number;
}

/** 确认面第二行：丢弃引用数（边指向缺失节点丢弃并报告+悬挂 parent——数量告知）。 */
export interface DraftDroppedRefs {
  danglingEdges: number;
  missingParentNodes: number;
}

/** 确认面第三行：不恢复产物·执行历史·计费记录（导入后状态 unknown，执行按钮可用需重新生成）。 */
export interface DraftNotRestoredNotice {
  artifacts: true;
  executionHistory: true;
  billingRecords: true;
}

/** 第三行固定三行文案单源（UI 消费——禁散落字面量；「导入后状态 unknown」与 §7 unknown≠idle 同义）。 */
export const DRAFT_IMPORT_NOT_RESTORED = {
  artifacts: '产物不恢复（导入后节点产物状态 unknown）',
  executionHistory: '执行历史不恢复',
  billingRecords: '计费记录不恢复',
  execButtonNote: '导入后状态 unknown，执行按钮可用需重新生成（§6.4 fail-closed）',
} as const;

/** C 场景确认面（固定三行——§4.5 表 C 行用户可见列）。 */
export interface DraftImportConfirmation {
  contentCounts: DraftContentCounts;
  droppedRefs: DraftDroppedRefs;
  notRestored: DraftNotRestoredNotice;
}

/** nodeId 冲突处置枚举（用户选——**nodeId 稳定不重映射**：重映射断 parentId/cells/meta/PG bindings；
 *  与现有 nodeId 冲突=跳过/替换用户选，**不自动改 ID**〔v5.4〕）。 */
export const NODE_ID_CONFLICT_POLICIES = ['skip', 'replace'] as const;
export type NodeIdConflictPolicy = typeof NODE_ID_CONFLICT_POLICIES[number];

/** T25 修正 #9：逐节点冲突默认 skip（无用户选择的冲突节点默认跳过——不自动替换不自动改 ID；
 *  与 B 场景 DRAFT_FIELD_CHOICE_DEFAULT='current' 同纪律：默认取保守侧〔服务端现态〕）。 */
export const NODE_ID_CONFLICT_DEFAULT_POLICY: NodeIdConflictPolicy = 'skip';

/** 逐节点三分派（import=新节点导入/skip=冲突跳过/replace=冲突替换——互斥穷尽）。 */
export type ImportNodeDispositionKind = 'import' | 'skip' | 'replace';
export interface ImportNodeDisposition {
  nodeId: string;
  disposition: ImportNodeDispositionKind;
}

/** C 场景逐节点冲突裁定（纯函数——T25 修正 #9「C 场景逐节点冲突+默认 skip」）：
 *  - 非冲突节点（existing 不含）→ 恒 import（显式选择不生效——replace/skip 只对冲突面有意义）；
 *  - 冲突节点 → 显式选择优先，**未选择=NODE_ID_CONFLICT_DEFAULT_POLICY（skip）**。 */
export function resolveImportNodeConflicts(
  existingNodeIds: ReadonlySet<string>,
  envelopeNodeIds: readonly string[],
  choices?: Partial<Record<string, NodeIdConflictPolicy>>,
): ImportNodeDisposition[] {
  return envelopeNodeIds.map((nodeId) => {
    if (!existingNodeIds.has(nodeId)) return { nodeId, disposition: 'import' } as const;
    const chosen = choices?.[nodeId];
    const disposition: ImportNodeDispositionKind = chosen === 'replace' ? 'replace' : NODE_ID_CONFLICT_DEFAULT_POLICY;
    return { nodeId, disposition };
  });
}

/** C 场景导入纪律注记（服务端候选 doc 全量校验=Schema/权限/图结构/XML 白名单——恢复流程非兼容层；
 *  唯一允许 clone 的场所〔§3.2〕）。 */
export const DRAFT_IMPORT_AS_NEW_CONTRACT = {
  nodeIdStable: 'nodeId 稳定不重映射（冲突=skip|replace 用户选——不自动改 ID）',
  droppedRefsReported: '边指向缺失节点丢弃并报告（确认面第二行）',
  fullValidation: '服务端候选 doc 全量校验（Schema/权限/图结构/XML 白名单——恢复流程非兼容层）',
  onlyCloneSite: 'recovery import=唯一允许 clone 的场所（§3.2）',
} as const;
