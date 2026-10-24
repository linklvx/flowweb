// packages/shared/src/collab/frame-effects.ts
// Y1c T5b（plan v1.7 Task 5 业务 DDL 段——spec v5.4 §6.5，偏离 38⑮）：FrameEffects/ProjectDocIndex 契约冻结
// ——**解 T24↔T26 循环引用**（**修正 #1：ProjectDocIndex 由 T9 建**，T24 复用做 NORMALIZE/frame-local 校验，
// T26 复用同实例持久化义务——两卡共此契约面，禁第二套 Yjs update 语义解析器）。**CONTRACT-FREEZE**——
// 类型+常量；消费方=T9（actor 收集器+建 ProjectDocIndex——修正 #1）/T24（复用索引做字段校验）/
// T26（复用同实例持久化义务）。契约测试=frame-effects.spec.ts。
import * as Y from 'yjs';
import { VIDEO_WORK_NODE_TYPES } from '../types/video-work';

// ═══ §1 FrameEffect union（八 kind——均带 walSeq）══════════════════════════════════════

/** effect 种类（closed——八值；新增=spec 修订：生命周期语义面非随手加） */
export const FRAME_EFFECT_KINDS = [
  'NODE_CREATED', 'NODE_DELETED', 'NODE_RESTORED',
  'EDGE_ADDED', 'EDGE_REMOVED',
  'MEDIA_REF_ADDED', 'MEDIA_REF_REMOVED',
  'FIELD_CHANGED',
] as const;
export type FrameEffectKind = typeof FRAME_EFFECT_KINDS[number];

/** NODE_CREATED/NODE_RESTORED 载荷 type 值域（修正 #1——必填节点类型）：与节点类型词表同源=
 *  VIDEO_WORK_NODE_TYPES（真值 CanvasView nodeTypes 注册表——与 DOC_SCHEMA_V4 键集同锚 census ① 八类型；
 *  **引用非重抄**，禁第二份清单——spec 断言两侧集合相等）。 */
export const FRAME_EFFECT_NODE_TYPE_VOCABULARY = VIDEO_WORK_NODE_TYPES;
export type FrameNodeTypeName = (typeof VIDEO_WORK_NODE_TYPES)[number];

/** type 值域守卫（运行时准入面——T9 actor 收集器/导入路径消费；词表外值拒绝）。 */
export function isFrameNodeTypeName(v: unknown): v is FrameNodeTypeName {
  return typeof v === 'string' && (FRAME_EFFECT_NODE_TYPE_VOCABULARY as readonly string[]).includes(v);
}

/** 单帧 effect（spec §6.5 v5.4⑮——均带 walSeq=触发帧身份；delete+restore 同帧=两枚 effect 两行义务）：
 *  - 节点/媒体/字段面带 nodeId；边面带 edgeId+source+target（DocEdgeRecord 同域——两端都进反查索引）
 *  - **NODE_CREATED/NODE_RESTORED 带必填 type**（修正 #1——节点类型，值域=FRAME_EFFECT_NODE_TYPE_VOCABULARY
 *    词表同源；T24 字段校验/T26 义务持久化消费）
 *  - FIELD_CHANGED{nodeId,key}=逐键粒度（gate frame-local 字段权限校验的输入——T24） */
export type FrameEffect =
  | { kind: 'NODE_CREATED'; nodeId: string; type: FrameNodeTypeName; walSeq: bigint }
  | { kind: 'NODE_DELETED'; nodeId: string; walSeq: bigint }
  | { kind: 'NODE_RESTORED'; nodeId: string; type: FrameNodeTypeName; walSeq: bigint }
  | { kind: 'EDGE_ADDED'; edgeId: string; source: string; target: string; walSeq: bigint }
  | { kind: 'EDGE_REMOVED'; edgeId: string; source: string; target: string; walSeq: bigint }
  | { kind: 'MEDIA_REF_ADDED'; nodeId: string; mediaId: string; walSeq: bigint }
  | { kind: 'MEDIA_REF_REMOVED'; nodeId: string; mediaId: string; walSeq: bigint }
  | { kind: 'FIELD_CHANGED'; nodeId: string; key: string; walSeq: bigint };

// ═══ §2 effects 收集管线（修正 #1——apply 后 actor 临界区内为准；spec §6.5 v5.4⑮）═════════

/** 计算时点权威（修正 #1——头注语义冻结）：effects 以 **apply 后 actor 临界区内**为准
 *  （原「pre-apply 时从 decodeUpdate+当前索引计算」废止——apply 前推算与实际生效面存在漂移）；
 *  per-transaction 收集器语义维持。 */
export const FRAME_EFFECTS_TIMING_AUTHORITY = {
  computePoint: 'apply-post-actor-critical-section',
  collector: 'per-transaction 收集器语义维持（afterTransaction+根 observeDeep+typeIdToNodeId 映射——apply 前清空 apply 后取走；失败/pending 丢弃不残留）',
} as const;

/** 收集管线次序冻结（修正 #1）：actor 在 **apply 后临界区内**收集 effects
 *  （per-transaction 收集器=afterTransaction+根 observeDeep+typeIdToNodeId 映射——**apply 前清空 apply 后取走**；
 *  失败/pending 丢弃不残留），与 walSeq 一起进 observer buffer，**与对应帧前缀的 PG 批同事务落库**
 *  （帧↔义务原子）。T9 装收集器；T26 消费 buffer。 */
export const FRAME_EFFECTS_COLLECTION_PIPELINE = [
  'per-transaction-collector',
  'tag-walSeq-into-observer-buffer',
  'pg-batch-same-transaction',
] as const;
export type FrameEffectsCollectionStep = typeof FRAME_EFFECTS_COLLECTION_PIPELINE[number];

// ═══ §3 ProjectDocIndex 契约面（轻量反向索引——修正 #1：T9 建/T24·T26 复用）═════════════════

/** ProjectDocIndex 契约（spec §6.5 v5.4⑮——incident-edge/media 反查 O(1)；**只消费 effects 不直接
 *  observeDeep**）：**修正 #1——由 T9 建**（actor 临界区内随收集器落索引），T24 复用做 NORMALIZE/
 *  frame-local 字段校验（§3.2），T26 复用**同一实例**持久化义务——禁止第二套解析器。
 *  实现（Y.Map 结构映射 typeIdToNodeId）归 T9；此处冻结成员面与签名。 */
export interface ProjectDocIndex {
  /** nodeId→节点类型（未知 nodeId=undefined——frame-local 校验判「节点不存在」用） */
  nodeType(nodeId: string): string | undefined;
  /** incident-edge 反向索引：nodeId→关联边 id 集（悬挂边检测/级联面反查） */
  readonly edgesByNode: ReadonlyMap<string, ReadonlySet<string>>;
  /** nodeId→引用 mediaId 集（mediaRefs 增量镜像——T26 义务/MediaBinding reconcile 免周期全扫） */
  readonly mediaRefsByNode: ReadonlyMap<string, ReadonlySet<string>>;
  /** 增量维护——只消费 FrameEffect 序列（apply 后索引与 appliedSeq 同源推进） */
  apply(effects: readonly FrameEffect[]): void;
  /** 崩溃重建——从 doc（WAL/PG 前缀重放产物）全量重建 */
  rebuild(doc: Y.Doc): void;
}

/** 重建契约：索引与 appliedSeq **同源**、崩溃从 WAL/PG 前缀重建（rebuild(doc)——T13/T24 恢复路径）、
 *  只消费 effects 不直接 observeDeep、义务可从帧前缀确定性重建（不依赖进程内状态）。 */
export const PROJECT_DOC_INDEX_REBUILD_CONTRACT = {
  sameSourceAs: 'appliedSeq',
  rebuild: '崩溃后从 WAL/PG 前缀重建（rebuild(doc) 全量重建——与 appliedSeq 对齐）',
  consume: '只消费 effects——不直接 observeDeep（禁第二套 Yjs update 语义解析器）',
  builders: 'T9 建索引（修正 #1——actor 临界区）；T24/T26 复用同实例（NORMALIZE/frame-local 字段校验+义务持久化——帧↔义务原子）',
} as const;
