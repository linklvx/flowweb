// packages/shared/src/collab/runtime-projection.ts
// Y1c T5c（plan v1.7 Task 5 客户端/恢复段——spec v5.4 §6.4/§7，偏离 38⑭）：RuntimeProjection 契约
// +mergeRuntimeProjection（**shared 唯一 merge 函数——真实现**）+composeRenderModel 合成+四读径契约
// +Runtime Store 离线语义。**CONTRACT-FREEZE**（merge/compose 为真纯函数实现非仅类型）；消费方=
// T22 feed 投递/T10 web Runtime Store/公开快照与导出面。复用纪律：媒体事实**不进投影**（修正批 #3）
// ——natural 尺寸/downscaledFrom 走既有 media-facts 通道（feed 事件只带 mediaId 引用）；
// wire 纪律=BigInt 一律 string（§5.2——行面 bigint/wire string 双口径先例，merge 进程内用 bigint
// 比较）。契约测试=runtime-projection.spec.ts（TDD 红先行）。
// **T22 前修正批（#3/#10/#4）**：#3=删 mediaFacts 表+exec 槽分槽（execStatus/artifact 各自
// nodeVersion 版本化）+node.restored 复活语义；#10=换代必须全量 snapshot（mergeRuntimeProjection
// 收 RuntimeProjectionUpdate{projection,fullSnapshot}——跨代增量禁并入）；#4=execSeq 注释族分离
// 收口（执行代际族 GenerationIntent/NodeExecution——非 lifecycleSeq〔生命周期族〕）。
import type { CanvasReadModel, CanvasReadModelNode, CanvasReadModelEdge } from '../canvas/doc-codec';

// ═══ §1 RuntimeProjection 契约类型（§6.4 v5.4⑬——wire/IDB 持久化面；修正批 #3 分槽）══════════

/** 节点执行状态投影（exec.status 事件族）。execSeq=执行代际族（GenerationIntent/NodeExecution
 *  更新守卫——比较单源 compareExecSeq；**#4：与 lifecycleSeq/fenceSeq〔生命周期族——NodeLifecycle/
 *  DeliveryFence〕全文分离、两族序永不互换互指**）；nodeVersion=该节点末次变更 feedSeq（单名单义 §5.2）。 */
export interface RuntimeProjectionExecStatusFact {
  status: string;
  errorCode?: string;
  attempts?: number;
  artifactRev?: number;
  /** 执行代际（GenerationIntent 代际——wire=string；#4 族分离） */
  execSeq?: string;
  /** 该字段版本的比较基准（同字段 nodeVersion 大者胜） */
  nodeVersion: string;
}

/** 节点产物槽投影（exec.artifact 事件族——#3 新分槽：与 execStatus 独立版本化。
 *  mediaId=媒体身份引用——natural 尺寸/downscaledFrom 不进投影（media-facts 通道按 mediaId 查）。 */
export interface RuntimeProjectionArtifactFact {
  mediaId?: string;
  resultRef?: string;
  artifactRev: number;
  nodeVersion: string;
}

/** 删除墓碑（node.deleted=FEED_TOMBSTONE——lifecycleSeq 与 NodeLifecycle 同源〔lifecycle.ts〕；
 *  node.restored 事件以更高 nodeVersion 字段复活——deletedAt 保留历史但不再是 active）。 */
export interface RuntimeProjectionTombstone {
  lifecycleSeq: string;
  nodeVersion: string;
}

/** 单节点投影（三槽可选——execStatus/artifact/deletedAt；#3 分槽形态）。 */
export interface RuntimeNodeProjectionEntry {
  execStatus?: RuntimeProjectionExecStatusFact;
  artifact?: RuntimeProjectionArtifactFact;
  deletedAt?: RuntimeProjectionTombstone;
}

/** RuntimeProjection（spec §6.4 v5.4⑬ 冻结形状+修正批 #3）：IDB 持久化
 *  {projectId,generation,feedSeq,pgSeq,projection,fetchedAt} 的 projection 域本体。
 *  mediaFacts 表已废止（#3）——媒体事实走既有 media-facts 通道，投影只持节点域引用。 */
export interface RuntimeProjection {
  projectId: string;
  generation: number;
  /** RuntimeEvent per-project 序（跨代不重置——§7）；wire=string */
  feedSeq: string;
  /** 对外唯一「已保存」水位（§5.1）；wire=string */
  pgSeq: string;
  nodes: Record<string, RuntimeNodeProjectionEntry>;
}

/** BigInt wire=string 纪律字段清单（§5.2——census/bigint-json gate 消费锚）。 */
export const RUNTIME_PROJECTION_WIRE_STRING_FIELDS = [
  'feedSeq', 'pgSeq', 'nodeVersion', 'execSeq', 'lifecycleSeq',
] as const;

// ═══ §2 mergeRuntimeProjection（shared 唯一 merge 函数——真实现；#10 全量 snapshot 门）════════

/** merge 入参形态（修正批 #10：换代必须全量 snapshot）：
 *  - projection=本次合入的投影（增量=单事件派生单节点槽；快照=服务端全量折叠态）；
 *  - fullSnapshot=true ⇒ 全量替换（首连快照/换代/游标失效三形态唯一入口——清投影重建+统一 cursor）；
 *    fullSnapshot=false ∧ generation≠current ⇒ 整体忽略（跨代增量禁并入——调用方必须拉全量快照）。 */
export interface RuntimeProjectionUpdate {
  projection: RuntimeProjection;
  fullSnapshot: boolean;
}

/** 十进制 string→bigint（fail-fast：非十进制形态=数据损坏即刻暴露——compareExecSeq 同款纪律）。 */
const seq = (s: string): bigint => {
  if (!/^\d+$/.test(s)) throw new Error(`RUNTIME_PROJECTION_SEQ_INVALID: "${s}" 非十进制整数字符串（wire 纪律破坏——fail-fast）`);
  return BigInt(s);
};

const maxSeq = (a: string, b: string): string => (seq(a) >= seq(b) ? a : b);

/** 单槽大者胜（incoming 严格大于才替换；等值保持当前——幂等重放稳定）。 */
function mergeSlot<T extends { nodeVersion: string }>(current: T | undefined, incoming: T | undefined): T | undefined {
  if (incoming === undefined) return current;
  if (current === undefined) return incoming;
  return seq(incoming.nodeVersion) > seq(current.nodeVersion) ? incoming : current;
}

/** 墓碑是否 active（deletedAt 版本**严格大于**该节点全部在位字段版本——§6.4「deletedAt 版本大于
 *  任何字段版本则清空」；等值不清〔undo 重建同帧形态〕；无字段时 active）。 */
export function isActiveTombstone(entry: RuntimeNodeProjectionEntry): boolean {
  if (entry.deletedAt === undefined) return false;
  const t = seq(entry.deletedAt.nodeVersion);
  const execV = entry.execStatus !== undefined ? seq(entry.execStatus.nodeVersion) : -1n;
  const artV = entry.artifact !== undefined ? seq(entry.artifact.nodeVersion) : -1n;
  return t > execV && t > artV;
}

/** **shared 唯一 merge 函数**（§6.4 merge 规则+修正批 #3/#10——进程内 bigint 比较，出口 wire=string）：
 *  1. fullSnapshot=true ⇒ **全量替换**（清投影重建——snapshot=全量替换+统一 cursor，仅接受
 *     nodeVersion>cursor 的后续增量）；
 *  2. #10 换代门：fullSnapshot=false ∧ generation≠current ⇒ 整体忽略（新代/旧代增量都不并入——
 *     换代必须走全量快照〔doc.vacuumed 事件/游标失效两档触发〕；旧 generation 隔离〔§7〕）；
 *  3. 同代逐节点逐槽 nodeVersion **大者胜**（execStatus/artifact 独立比较——分槽各自版本化）；
 *     等值保持当前；
 *  4. deletedAt 墓碑：合并后 active 墓碑（版本严格大于全部字段版本）→清空该节点 execStatus/artifact
 *     （node.restored 以更高版本字段复活——墓碑行保留但非 active）；
 *  5. feedSeq/pgSeq 水位取大（不倒退——同代增量合并面）。 */
export function mergeRuntimeProjection(current: RuntimeProjection, incoming: RuntimeProjectionUpdate): RuntimeProjection {
  const inc = incoming.projection;
  if (incoming.fullSnapshot) return inc;   // 全量替换（清投影重建——统一 cursor 随快照体）
  if (inc.generation !== current.generation) return current;   // #10：跨代增量禁并入（新旧两向都拒）
  const nodes: Record<string, RuntimeNodeProjectionEntry> = { ...current.nodes };
  for (const [nodeId, incEntry] of Object.entries(inc.nodes)) {
    const cur = nodes[nodeId];
    if (cur === undefined) {
      nodes[nodeId] = incEntry;
      continue;
    }
    let merged: RuntimeNodeProjectionEntry = {
      execStatus: mergeSlot(cur.execStatus, incEntry.execStatus),
      artifact: mergeSlot(cur.artifact, incEntry.artifact),
      deletedAt: mergeSlot(cur.deletedAt, incEntry.deletedAt),
    };
    if (isActiveTombstone(merged)) {
      merged = { deletedAt: merged.deletedAt };   // 清空该节点字段（墓碑胜）
    }
    nodes[nodeId] = merged;
  }
  return {
    projectId: current.projectId,
    generation: current.generation,
    feedSeq: maxSeq(current.feedSeq, inc.feedSeq),
    pgSeq: maxSeq(current.pgSeq, inc.pgSeq),
    nodes,
  };
}

// ═══ §3 composeRenderModel（read model ⊕ projection——渲染层合成）══════════════════════════════

/** 渲染面节点（read model 原字段+runtime overlay——**服务端派生字段永不进 doc**：overlay 只存在于
 *  渲染合成面，doc/data 写面零接触）。runtime 三面：execStatus（状态族）/artifact（产物媒体引用族）/
 *  无（零投影透传）。 */
export interface CanvasRenderNode extends CanvasReadModelNode {
  runtime?: {
    execStatus?: RuntimeProjectionExecStatusFact;
    artifact?: RuntimeProjectionArtifactFact;
  };
}

export interface CanvasRenderModel {
  nodes: CanvasRenderNode[];
  edges: CanvasReadModelEdge[];
}

/** 合成纯函数（§6.4：`CanvasRenderModel=CanvasReadModel⊕RuntimeProjection`）：
 *  - active 墓碑节点从渲染面剔除（FEED_TOMBSTONE——客户端清投影）；旧墓碑+新字段=复活形态保留；
 *  - 有投影节点挂 runtime overlay（execStatus/artifact）；无投影节点零 runtime 键透传
 *    （unknown≠idle——UI 面按 unknown 渲染：生成按钮禁用不显示 idle〔§7〕）；
 *  - edges 原样透传（overlay 语义——边结构过滤归渲染面 deriveRenderCanvas 既有域）。 */
export function composeRenderModel(readModel: CanvasReadModel, projection: RuntimeProjection): CanvasRenderModel {
  const nodes: CanvasRenderNode[] = [];
  for (const node of readModel.nodes) {
    const entry = projection.nodes[node.id];
    if (entry !== undefined && isActiveTombstone(entry)) continue;   // 墓碑剔除
    const runtime = entry !== undefined && (entry.execStatus !== undefined || entry.artifact !== undefined)
      ? { execStatus: entry.execStatus, artifact: entry.artifact }
      : undefined;
    nodes.push(runtime === undefined ? { ...node } : { ...node, runtime });
  }
  return { nodes, edges: readModel.edges.map((e) => ({ ...e })) };
}

// ═══ §4 四读径契约（§6.4——doc 无服务端字段后的完整读者面）══════════════════════════════════

/** 四读径契约注记（冻结——T10/T22/T25 消费）。 */
export const FOUR_READ_PATHS = {
  /** ①公开快照/分享页：toPublicReadModel(renderModel,policy)——快照发布时**服务端做 PG projection
   *   join**+缓存键加 projectionSeq/feedSeq（(pid,g,snapshotRev) 三元会拼「旧文档+新图片」——§5.3
   *   缓存键双轨基础上扩第四维）。 */
  publicSnapshot: '公开快照=toPublicReadModel(renderModel,policy)——发布时服务端 PG projection join+缓存键加 projectionSeq/feedSeq（旧快照键会拼旧文档+新图片）',
  /** ②用户导出/备份：render model（serializeCanvas 仅 doc 备份不作用户导出——语义快照无投影）。 */
  userExport: '用户导出/备份=render model（serializeCanvas 仅 doc 备份不作用户导出）',
  /** ③复制/粘贴/duplicate：typed 命令（见 COPY_PASTE_COMMAND_CONTRACT）。 */
  copyPaste: '复制/粘贴/duplicate=typed BindMedia/CloneBinding 命令（源 nodeId/mediaId 作命令参数非 doc 字段）',
  /** ④video-work clone：服务端用 render model 复制（不读 doc 猜 fileId）。 */
  videoWorkClone: 'video-work clone=服务端用 render model 复制（不读 doc 猜 fileId）',
} as const;

/** 公开快照缓存键（§5.3 双轨的公开轨+projectionSeq 第四维——projectionSeq=feedSeq 水位，wire=string）。 */
export interface PublicSnapshotCacheKeyInput {
  projectId: string;
  generation: number;
  snapshotRev: string | number;
  projectionSeq: string;
}

export function formatPublicSnapshotCacheKey(k: PublicSnapshotCacheKeyInput): string {
  return `public-snapshot:${k.projectId}:g${k.generation}:r${k.snapshotRev}:p${k.projectionSeq}`;
}

/** ③复制/粘贴 typed 命令：BindMedia=源节点媒体绑到目标节点（源 nodeId/mediaId 作**命令参数**——
 *  非 doc 字段）；CloneBinding=源节点绑定关系克隆到目标节点。服务端校验权限/归属后写 PG binding
 *  +发 feed（T22/T25 实装）。 */
export interface BindMediaCommand {
  type: 'BindMedia';
  sourceNodeId: string;
  mediaId: string;
  targetNodeId: string;
}

export interface CloneBindingCommand {
  type: 'CloneBinding';
  sourceNodeId: string;
  targetNodeId: string;
}

/** 复制/粘贴纪律（§6.4 ③行）：复制只复制用户域字段；产物身份族一律清空重产生；cells 格位保留但
 *  媒体引用清空；跨团队粘贴加 media ACL；lifecycleSeq 新生成、NodeArtifact 不挂旧产物。 */
export const COPY_PASTE_COMMAND_CONTRACT = {
  paramsNotDocFields: '源 nodeId/mediaId 作命令参数（非 doc 字段）——服务端校验权限/归属后写 PG binding+发 feed',
  clearedIds: '复制只复制用户域字段——mediaId/fileId/artifactId 一律清空由目标节点重新产生',
  cells: '组 cells 格位保留媒体引用清空（格位结构是用户域；引用身份是产物域）',
  crossTeam: '跨团队粘贴加 media ACL（源团队私有媒体不随粘贴外泄）',
  lifecycle: 'lifecycleSeq 新生成、NodeArtifact 不挂旧产物（复制≠产物继承）',
} as const;

// ═══ §5 Runtime Store 离线语义（§6.4/§7——IDB TTL/stale/unknown）══════════════════════════════

/** IDB 投影 TTL=7 天（§7「IDB 持久化…TTL 7 天，换代清整族」——与 RuntimeEvent 保留期同值对齐：
 *  超过事件保留期的投影无增量可续，过期即弃；真源=RUNTIME_EVENT_RETENTION_DAYS 同值派生非
 *  第二字面量）。 */
export const RUNTIME_STORE_TTL_DAYS = 7 as const;
// 7 天毫秒值（7*24*60*60*1000=604_800_000——字面量直书以配 as const，doc-protocol.ts:381 同款先例）
export const RUNTIME_STORE_TTL_MS = 604_800_000 as const;

/** 三态新鲜度（§6.4/§7）：fresh=在线最新；stale=离线上次已知（stale 角标）；unknown=从未收到过
 *  （或 TTL 过期弃用）——**unknown 不显示 idle**（防重复点击；生成按钮禁用）。 */
export type RuntimeStoreFreshness = 'fresh' | 'stale' | 'unknown';

export interface RuntimeStoreFreshnessInput {
  /** 投影存在性+捕获时刻（IDB 记录 {…,fetchedAt} 域——null=从未收到过） */
  projection: { fetchedAtMs: number } | null;
  /** feed 通道可达性（离线=显示上次已知投影+stale 角标——内容编辑不受影响） */
  feedReachable: boolean;
  nowMs: number;
}

/** 新鲜度判定（纯函数）：无投影→unknown；TTL 过期→unknown（弃用）；不可达→stale；否则 fresh。
 *  判定次序：存在性→TTL→可达性（过期优先于 stale——过期投影不可作「上次已知」展示）。 */
export function resolveRuntimeStoreFreshness(i: RuntimeStoreFreshnessInput): RuntimeStoreFreshness {
  if (i.projection === null) return 'unknown';
  if (i.nowMs - i.projection.fetchedAtMs > RUNTIME_STORE_TTL_MS) return 'unknown';
  return i.feedReachable ? 'fresh' : 'stale';
}

/** stale 角标文案（§6.4「上次已知（截至 HH:mm）」——本地时区零填充 HH:mm；UI 消费单源）。 */
export function formatRuntimeStaleLabel(fetchedAtMs: number): string {
  const d = new Date(fetchedAtMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `上次已知（截至 ${hh}:${mm}）`;
}

/** unknown≠idle 单源注记（§7 UI 契约首句——feed 未首达=exec unknown，生成按钮禁用**不显示 idle**）。 */
export const UNKNOWN_NOT_IDLE =
  'unknown≠idle：从未收到过投影=unknown（生成按钮禁用，不显示 idle——防重复点击）' as const;

/** Runtime Store UI 契约注记（§6.4/§7 冻结）。 */
export const RUNTIME_STORE_UI_CONTRACT = {
  idbPayload: 'IDB 持久化 {projectId,generation,feedSeq,pgSeq,projection,fetchedAt}——TTL 7 天',
  generationClearsFamily: '换代清整族（doc.vacuumed 事件/4410 discardLocalCache——旧代投影不并入新代）',
  execButton: '离线/unknown 执行按钮禁用（fail-closed）——内容编辑不受影响',
  serverFieldsNeverInDoc: '服务端派生字段永不进 doc（渲染经 RuntimeProjection overlay——writer:server 字段一律禁入 doc〔§3.1〕）',
  offlineContentEdit: '离线=上次已知投影+stale 角标（内容编辑不受影响——doc 写面与投影读面正交）',
} as const;
