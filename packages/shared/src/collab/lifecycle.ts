// packages/shared/src/collab/lifecycle.ts
// Y1c T5b（plan v1.7 Task 5 业务 DDL 段——spec v5.4 §6.5 生命周期义务，G13/G14 收缩形态）：
// NodeLifecycle+DeliveryFence+义务 closed enum 契约冻结。**CONTRACT-FREEZE**——类型+常量+纯函数；
// 消费方=T26（义务观察器——先于/同切片 T22 落地，偏离 38⑳）/T22（deliverArtifact 权威切换）。
// genesis 行=T7/T21 建。契约测试=lifecycle.spec.ts（TDD 红先行）。

// ═══ §1 义务 closed enum（census⑪ 定员——docs/superpowers/census/y1c-t0-census.json item11）══════

/** 义务种类（**closed enum**——新增种类=新功能走 spec 修订非随手加 string；spec §6.5「按需含
 *  EXEC_CANCEL/REFUND/MEDIA_GC/ARTIFACT_INVALIDATE/STORAGE_RELEASE 等」候选经 census⑪ 对照全部
 *  收敛进三值或确认无 node 级义务——留档见 OBLIGATION_EXCLUDED_CANDIDATES） */
export const OBLIGATION_KINDS = ['FEED_TOMBSTONE', 'NODE_DELETED', 'EXEC_FINALIZE'] as const;
export type ObligationKind = typeof OBLIGATION_KINDS[number];

/** 每值消费面注记（census⑪ 逐子系统对照结论） */
export const OBLIGATION_KIND_CONSUMERS: Readonly<Record<ObligationKind, string>> = {
  /** 删除已提交→客户端清 Runtime Store 投影（node.deleted feed 事件=本义务的投递面） */
  FEED_TOMBSTONE: '删除已提交→客户端清 Runtime Store 投影（node.deleted 事件——feed 墓碑）',
  /** 三消费面（census⑪）：①MediaBinding 惰性 reconcile 免周期全扫（帧级 effects 驱动）②ArtifactProjection
   *  投递前拦截免一轮失败投递 ③VideoProject 级联（收编 web fire-and-forget cascadeDeleteVideoProject
   *  缺口——失败留痕现状=明确缺口） */
  NODE_DELETED: 'MediaBinding 帧级 effects 清扫+ArtifactProjection 投递前拦截+VideoProject 级联（收编 web fire-and-forget）——三消费面',
  /** GenerationIntent 资金收口（观察者同事务 buffer——收口悬置窗，免 deadline-reaper 判龄兜底） */
  EXEC_FINALIZE: 'GenerationIntent 资金收口（观察者同事务 buffer——收口悬置窗）',
};

/** 排除候选留档（census⑪「非 T5b enum 候选」结论——禁复活：如需再入册走 spec 修订+census 重跑） */
export const OBLIGATION_EXCLUDED_CANDIDATES: Readonly<Record<string, string>> = {
  MediaFactOutbox: '键域无 nodeId（按 (mediaId,projectId,factType,factVersion)——媒体生命周期驱动非节点删除）',
  'material-library-search': '按 Media 行检索——无 nodeId 引用（grep 零命中 node 键）',
  'public-snapshot': '请求时派生（换代 doc.vacuumed 事件通知缓存失效=已有链）——无持久 per-node 状态',
  'doc-bytes-quota': 'yjs GC+compact/vacuum 异步收敛——无即时义务（NodeArtifact 保留=产品语义：产物=素材库资产不随节点删）',
};

// ═══ §2 NodeLifecycle（lifecycleSeq 数值序+当前行 partial unique）════════════════════════════

/** 生命周期态（二值——undo 重建=新行回 ACTIVE 无第三态） */
export type NodeLifecycleState = 'ACTIVE' | 'DELETED';

/** NodeLifecycle 行（spec §6.5——服务端只读观察已受理帧的 nodes/edges 事务产物；incarnation=PG lifecycleSeq）：
 *  - lifecycleSeq=per-project 单调数值序（DB sequence——BigInt wire string 化）
 *  - **当前行 partial unique**：UNIQUE(projectId,nodeId) WHERE is_current——历史行保留
 *    （义务可从帧前缀确定性重建）；两项目同 nodeId 不互串（键含 projectId） */
export interface NodeLifecycleRow {
  projectId: string;
  nodeId: string;
  lifecycleSeq: bigint;
  isCurrent: boolean;
  state: NodeLifecycleState;
  /** 触发帧（义务与该帧前缀 PG 批同事务落库——帧↔义务原子） */
  walSeq: bigint;
  createdAtMs: number;
}

/** 当前行 partial unique DDL 注记（migration 归 T7/T21——活跃唯一性在 partial unique 非应用层判重） */
export const NODE_LIFECYCLE_CURRENT_ROW_UNIQUE =
  'UNIQUE(projectId, nodeId) WHERE is_current——历史行保留（义务可从帧前缀确定性重建）' as const;

/** 语义四则（spec §6.5——T26 观察器用例锚）：
 *  - delete 已删=no-op 不二次退款
 *  - undo 重建=新 lifecycleSeq+恢复态（ACTIVE 新行）
 *  - delete+restore 同帧=两行（两 lifecycleSeq——次序可分辨）
 *  - delete 义务只对 ACTIVE 当前态发（DELETED/从未在册均 no-op） */
export const NODE_LIFECYCLE_SEMANTICS = {
  deleteAlreadyDeleted: 'delete 已删=no-op 不二次退款',
  undoRestore: 'undo 重建=新 lifecycleSeq+恢复态（新行 ACTIVE）',
  deleteRestoreSameFrame: 'delete+restore 同帧=两行（两 lifecycleSeq）',
  crossProjectIsolation: '两项目同 nodeId 不互串（键含 projectId）',
} as const;

/** 删除义务发射判定（纯函数——truth table 锁定 T26 观察器判据） */
export function shouldEmitDeleteObligation(current: NodeLifecycleState | undefined): boolean {
  return current === 'ACTIVE';
}

/** 义务行（observer 按 walSeq buffer 与对应帧前缀 PG 批**同事务**落库；崩溃后重放帧前缀确定性重建
 *  ——不依赖进程内状态；由 actor 的 FrameEffects 生成，不做第二套 Yjs update 语义解析器） */
export interface LifecycleObligationRow {
  projectId: string;
  nodeId: string;
  kind: ObligationKind;
  /** 触发帧（帧↔义务原子锚） */
  walSeq: bigint;
  createdAtMs: number;
}

// ═══ §3 DeliveryFence（交付 fencing——偏离 38⑳：T21→T26→T22 排序）══════════════════════════

/** DeliveryFence 行（spec §6.5——交付事务写 artifact 前的 fence 校验载体；T26 维护 delete/restore+当前态） */
export interface DeliveryFenceRow {
  projectId: string;
  nodeId: string;
  /** =该节点当前 NodeLifecycle.lifecycleSeq（fence 匹配判据——BigInt wire string 化） */
  fenceSeq: bigint;
  state: NodeLifecycleState;
  updatedAtMs: number;
}

/** fence 校验契约：交付事务写 artifact 前必须检查 `fenceSeq==当前 lifecycleSeq` 且 state 允许
 *  （ACTIVE）——**不匹配=丢弃不退款**；deliverArtifact 的 node-deleted 权威观察点自 T22 起从 doc
 *  （data.written:false）切换为本表；T26 观察器必须**先于/同切片 T22** 落地。 */
export const DELIVERY_FENCE_CONTRACT = {
  check: '交付事务写 artifact 前：fenceSeq==当前 lifecycleSeq 且 state=ACTIVE——不匹配=丢弃不退款',
  authoritySwitch: 'deliverArtifact 的 node-deleted 权威观察点自 T22 起从 doc（data.written:false）切换为本表',
  observerOrder: 'T26 观察器（delete/restore 维护+当前态）必须先于/同切片 T22 落地（P3 排序 T21→T26→T22）',
} as const;
