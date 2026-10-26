// apps/api/src/modules/execution/execution-request.service.ts
// Y1c T21（G4 门——spec v5.4 §6.1，偏离 37⑤+38⑨⑩⑪）：ExecutionRequest 受理冻结服务。
// 受理=「插入前一次性校验（任一失败 4xx 不落半行）→frozenDocSeq 临界区（freeze mutex→PG 一致
// 前缀）→planHash/inputHash 冻结→单事务落 request+plans+input+audit+per-item 资金预留」。
// worker 零 doc 读（loadForExecution 只读子行+ExecutionInput——promptText 自冻结输入，执行读点
// 永不再触 doc）。请求不携带提示词参数（prompt 权威=doc 单源→服务端从 PG 一致前缀恢复冻结）。
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { brotliCompressSync, brotliDecompressSync, gunzipSync } from 'node:zlib';
import * as Y from 'yjs';
import {
  CANVAS_DOC_SCHEMA_VERSION,
  EXEC_ADMISSION_TIMEOUT_MS,
  EXEC_FREEZE_BUDGET_MS,
  EXEC_INPUT_ENCODING_KINDS,
  EXEC_INPUT_RETENTION_AFTER_FINAL_DAYS,
  EXEC_REQUEST_EXPIRES_AT_MS,
  canonicalPlanHashPayload,
  resolvePromptText,
  richTextOfFragment,
  validateExecutionInputLimits,
  validateExecutionScopeNodeIds,
} from '@flowweb/shared';
import type { ExecutionInputEncoding } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ValidationService } from './validation.service';
import { TopologyService } from './topology.service';
import { isExecutableNode } from './is-executable-node';
import { TeamCreditService } from '../team/team-credit.service';
import { CollabProjectActorService } from '../collab/collab-project-actor.service';
import { CanvasDocUpdateRepository } from '../collab/canvas-doc-update.repository';
import { createCanvasDoc } from '../collab/canvas-doc.factory';   // census ⑯ 裸 Y.Doc 收编工厂

export interface AdmitExecutionCommand {
  projectId: string;
  /** 客户端幂等键（项目内唯一——断线重试同键幂等返回原 frozenDocSeq） */
  requestId: string;
  nodeIds: string[];
  /** 客户端下界（save barrier 回执 committedSeq——wire string 化 bigint） */
  docSeq: bigint;
  userId: string;
}

export type AdmitOutcome =
  | {
      ok: true; id: string; requestId: string; frozenDocSeq: bigint;
      planHash: string; inputHash: string; reservedCredit: number; totalCredit: number;
      replayed: boolean;
    }
  | { ok: false; status: number; code: string; detail: string };

/** 冻结输入条目（ExecutionInput JSON 解压后形态——per-node；worker 读面。M-3 dedup 后 wire 形态：
 *  重复文本（共享上游 join 出的 promptText/上游正文）以 sha256 引用单份存——载入时解引用还原）。 */
export interface FrozenNodeInput {
  kind: string;
  /** 冻结 prompt（上游正文优先 join——B21 同构；无上游回落本节点 resolvePromptText；
   *  序列化面长文本可折为 promptTextRef（sha256→sharedTexts），loadForExecution 解引用回填） */
  promptText: string;
  /** 直接父节点冻结正文（上游注入留档——重放对账面；序列化面折为 upstreamTextRefs） */
  upstreamTexts: string[];
  /** 直接父产物媒体身份（NodeArtifact PG——非 doc） */
  upstreamImageMediaId?: string;
  /** 节点身份冻结参数（paramsHash 同源 identity——claim 零重算） */
  args: Record<string, unknown>;
}

export interface FrozenExecutionInput {
  schemaVersion: number;
  nodes: Record<string, FrozenNodeInput>;
  /** M-3 共享文本单份存（sha256hex→正文——N 节点共享上游不虚涨 raw；spec §6.1「共享上游按
   *  sha256 去重只存一份」）：序列化时写入，loadForExecution 解引用后本键剥离（worker 零感知）。 */
  sharedTexts?: Record<string, string>;
}

export interface LoadedExecutionPlan {
  requestId: string; nodeId: string; order: number; type: string;
  model: string | null; resolution: string | null; styleId: string | null; pricingRuleId: string | null;
  creditCost: number; reservedCredit: number; paramsHash: string;
  status: string; generationIntentId: string | null; execSeq: bigint | null;
}

export interface LoadedExecution {
  request: {
    id: string; requestId: string; projectId: string; generation: number; state: string;
    frozenDocSeq: bigint; planHash: string; inputHash: string; teamId: string; userId: string; kind: string;
  };
  plans: LoadedExecutionPlan[];
  input: FrozenExecutionInput;
}

const sha256hex = (u: Uint8Array | string) => createHash('sha256').update(u).digest('hex');

/** M-3 共享文本去重阈值（超此长度的重复文本折 sha256 引用——短文本引用反而膨胀，直存） */
const FROZEN_TEXT_DEDUP_MIN_BYTES = 64;

/** M-3 序列化：重复文本（promptText/upstreamTexts，>阈值）以 sha256 引用单份存 sharedTexts
 *  ——N 节点共享同一上游不虚涨 raw（spec §6.1「共享上游按 sha256 去重只存一份」）。 */
function serializeFrozenInput(entries: Record<string, FrozenNodeInput>): string {
  const sharedTexts: Record<string, string> = {};
  const seen = new Map<string, string>();   // 正文→sha256（重复文本复用同引用）
  const refOf = (text: string): { text?: string; ref?: string } => {
    if (Buffer.byteLength(text, 'utf8') < FROZEN_TEXT_DEDUP_MIN_BYTES) return { text };
    const hit = seen.get(text);
    if (hit) return { ref: hit };
    const sha = sha256hex(text);
    seen.set(text, sha);
    sharedTexts[sha] = text;
    return { ref: sha };
  };
  const nodes: Record<string, unknown> = {};
  for (const [id, e] of Object.entries(entries)) {
    const p = refOf(e.promptText);
    const upstreamTexts = e.upstreamTexts.length === 1 ? [refOf(e.upstreamTexts[0]!)] : e.upstreamTexts.map((t) => refOf(t));
    nodes[id] = {
      kind: e.kind,
      ...(p.ref ? { promptTextRef: p.ref } : { promptText: p.text }),
      ...(e.upstreamTexts.length > 0 ? { upstreamTextRefs: upstreamTexts } : {}),
      ...(e.upstreamImageMediaId ? { upstreamImageMediaId: e.upstreamImageMediaId } : {}),
      args: e.args,
    };
  }
  return JSON.stringify({ schemaVersion: CANVAS_DOC_SCHEMA_VERSION, nodes, ...(Object.keys(sharedTexts).length > 0 ? { sharedTexts } : {}) });
}

/** M-3 载入：解引用还原 worker 读面（promptText/upstreamTexts 回填+sharedTexts 剥离——零感知）。 */
function deserializeFrozenInput(parsed: FrozenExecutionInput & {
  nodes?: Record<string, Record<string, unknown>>;
  sharedTexts?: Record<string, string>;
}): FrozenExecutionInput {
  const shared = parsed.sharedTexts ?? {};
  const nodes: Record<string, FrozenNodeInput> = {};
  for (const [id, rawNode] of Object.entries(parsed.nodes ?? {})) {
    const resolve = (v: unknown, fallback: string): string => {
      if (typeof v === 'string') return v;
      if (v && typeof v === 'object' && typeof (v as { ref?: unknown }).ref === 'string') return shared[(v as { ref: string }).ref] ?? fallback;
      return fallback;
    };
    const upstreamRefs = rawNode.upstreamTextRefs as Array<unknown> | undefined;
    nodes[id] = {
      kind: String(rawNode.kind),
      promptText: resolve(rawNode.promptTextRef !== undefined ? { ref: rawNode.promptTextRef } : rawNode.promptText, ''),
      upstreamTexts: (upstreamRefs ?? []).map((r) => resolve(r, '')),
      ...(typeof rawNode.upstreamImageMediaId === 'string' ? { upstreamImageMediaId: rawNode.upstreamImageMediaId } : {}),
      args: (rawNode.args ?? {}) as Record<string, unknown>,
    };
  }
  return { schemaVersion: parsed.schemaVersion, nodes };
}

/** slice 读值解码（Y 容器→plain：Y.Text→string/Y.Map→对象/Y.Array→数组/XmlFragment→RichTextValue
 *  ——doc-codec decodeYValue 同构窄面：doc-codec 内部函数不导出，本处受理 slice 专用）。 */
function plainOf(v: unknown): unknown {
  if (v instanceof Y.Text) return v.toString();
  if (v instanceof Y.XmlFragment) return richTextOfFragment(v);
  if (v instanceof Y.Map) {
    const out: Record<string, unknown> = {};
    for (const [k, inner] of v.entries()) out[k] = plainOf(inner);
    return out;
  }
  if (v instanceof Y.Array) return v.toArray().map(plainOf);
  return v;
}

@Injectable()
export class ExecutionRequestService {
  private readonly logger = new Logger(ExecutionRequestService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ValidationService) private readonly validation: ValidationService,
    @Inject(TopologyService) private readonly topology: TopologyService,
    @Inject(TeamCreditService) private readonly teamCredit: TeamCreditService,
    /** 常驻 doc 冻结读（live 临界区）；null/缺席=直接走 PG 前缀重建档（int/无 actor 上下文） */
    @Optional() @Inject(CollabProjectActorService) private readonly actor: CollabProjectActorService | null,
    @Inject(CanvasDocUpdateRepository) private readonly repo: CanvasDocUpdateRepository,
  ) {}

  // ═══ 冻结读：候选 doc 构造（live 临界区 ∨ PG 前缀重建——两者读面同构 slice）═════════════

  /** PG 前缀重建候选 doc（freeze 预算 500ms 超时回退档+doc 非常驻档——spec §6.1 v5.4⑪）：
   *  repo.hydrateWithRecovery 单 RR 事务（MVCC 一致前缀）→ fresh doc 重放。 */
  private async rebuildCandidateDoc(projectId: string): Promise<{ doc: Y.Doc; pgSeq: bigint; generation: number } | null> {
    const row = await this.repo.hydrateWithRecovery(projectId);
    const doc = createCanvasDoc();
    try {
      if (row.state) Y.applyUpdate(doc, new Uint8Array(row.state));
      for (const u of row.updates) Y.applyUpdate(doc, new Uint8Array(u));
      return { doc, pgSeq: row.pgSeq ?? 0n, generation: row.generation ?? 0 };
    } catch (err) {
      doc.destroy();
      this.logger.error(`candidate doc rebuild failed for ${projectId}: ${(err as Error).message}`);
      return null;
    }
  }

  /** 只读 scope 节点+直接父节点（禁全量 readCanvas——spec §6.1；edges=拓扑序必读集合）。 */
  private readSlice(doc: Y.Doc, nodeIds: readonly string[]) {
    const nodesMap = doc.getMap('nodes') as Y.Map<unknown>;
    const edgesMap = doc.getMap('edges') as Y.Map<unknown>;
    const edges: Array<{ id: string; source: string; target: string }> = [];
    for (const [id, raw] of edgesMap.entries()) {
      // 边信封=Y.Map（fillDoc 形态）——.get 读键（属性访问恒 undefined=拓扑退化为请求序的暗坑，二轮收口根修）
      const src = raw instanceof Y.Map ? raw.get('source') : (raw as { source?: unknown })?.source;
      const tgt = raw instanceof Y.Map ? raw.get('target') : (raw as { target?: unknown })?.target;
      if (typeof src === 'string' && typeof tgt === 'string') edges.push({ id, source: src, target: tgt });
    }
    const scope = new Set(nodeIds);
    const parentIds = new Set<string>();
    for (const e of edges) if (scope.has(e.target) && nodesMap.has(e.source) && !scope.has(e.source)) parentIds.add(e.source);
    const nodes: Array<{ id: string; type: string; data: Record<string, unknown> }> = [];
    for (const id of [...scope, ...parentIds]) {
      const raw = nodesMap.get(id);
      if (!(raw instanceof Y.Map)) continue;
      const data: Record<string, unknown> = {};
      const dm = raw.get('data');
      if (dm instanceof Y.Map) {
        for (const [k, v] of dm.entries()) data[k] = plainOf(v);
      } else if (dm && typeof dm === 'object') {
        for (const [k, v] of Object.entries(dm as Record<string, unknown>)) data[k] = v;
      }
      nodes.push({ id, type: String(raw.get('type') ?? ''), data });
    }
    return { nodes, edges };
  }

  /** NodeArtifact 槽位媒体身份（直接父产物——PG 读非 doc；upstream-media.service 同源键形态）。 */
  private async readUpstreamMediaId(projectId: string, nodeId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ mediaId: string | null }[]>`
      SELECT "mediaId" FROM "NodeArtifact"
      WHERE "projectId" = ${projectId}::text AND "nodeId" = ${nodeId}::text
        AND role = 'primary' AND "targetField" = 'fileId'
      ORDER BY rev DESC LIMIT 1`;
    return rows[0]?.mediaId ?? null;
  }

  /** 冻结 slice 组装（候选 doc 上）：前缀校验+拓扑+per-node 冻结输入（prompt=上游正文优先）。 */
  private async buildFrozenSlice(projectId: string, doc: Y.Doc, nodeIds: readonly string[]): Promise<
    | { ok: false; status: number; code: string; detail: string }
    | { ok: true; ordered: Array<{ id: string; type: string; data: Record<string, unknown> }>; entries: Record<string, FrozenNodeInput> }
  > {
    const { nodes, edges } = this.readSlice(doc, nodeIds);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    // 前缀校验：nodeIds 全在冻结前缀（属本项目）——任一 miss=4xx 不落半行（G4 红④）
    const unknown = nodeIds.filter((id) => !byId.has(id));
    if (unknown.length > 0) return { ok: false, status: 400, code: 'UNKNOWN_NODE_IDS', detail: `节点不在冻结前缀：${unknown.join(',').slice(0, 200)}` };
    const scopeNodes = nodeIds.map((id) => byId.get(id)!);
    // 拓扑无环+≥1 executable（插入前一次性）
    const ordered = this.topology.sort(scopeNodes, edges);
    if (ordered.length < scopeNodes.length) return { ok: false, status: 400, code: 'CYCLE', detail: '组内存在循环依赖，无法确定执行顺序' };
    if (!ordered.some((n) => isExecutableNode(n))) return { ok: false, status: 400, code: 'EMPTY_SCOPE', detail: '执行范围为空（无可执行节点）' };
    const entries: Record<string, FrozenNodeInput> = {};
    for (const node of ordered) {
      const upstreamTexts: string[] = [];
      let upstreamImageMediaId: string | undefined;
      for (const e of edges) {
        if (e.target !== node.id) continue;
        const parent = byId.get(e.source);
        if (!parent) continue;
        if (parent.type === 'textInput') {
          const content = parent.data.content as string | { text?: string } | undefined;
          const text = typeof content === 'string' ? content : (content?.text ?? '');
          if (text) upstreamTexts.push(text);
        } else if (parent.type === 'imageGen' || parent.type === 'imageExtGen' || parent.type === 'videoGen') {
          if (!upstreamImageMediaId) upstreamImageMediaId = (await this.readUpstreamMediaId(projectId, parent.id)) ?? undefined;
        }
      }
      const promptText = upstreamTexts.join(' ') || resolvePromptText(node.data as never);
      entries[node.id] = {
        kind: node.type === 'textInput' ? 'text' : node.type === 'videoGen' ? 'video' : 'image',
        promptText,
        upstreamTexts,
        ...(upstreamImageMediaId ? { upstreamImageMediaId } : {}),
        args: frozenIdentityArgs(node, promptText, upstreamImageMediaId),
      };
    }
    return { ok: true, ordered, entries };
  }

  // ═══ 受理（admit）══════════════════════════════════════════════════════════════════════

  async admit(cmd: AdmitExecutionCommand): Promise<AdmitOutcome> {
    const { projectId, requestId, userId } = cmd;
    // ①纯数组面校验（shared 单源——非空/去重/≤EXEC_MAX_NODES）+requestId 长度界（I3/M3：
    //  客户端幂等键 8-128——防无界键进 PG 唯一索引/日志面）
    if (cmd.requestId.length < 8 || cmd.requestId.length > 128) {
      return { ok: false, status: 400, code: 'REQUEST_ID_INVALID', detail: `requestId 长度 ${cmd.requestId.length} 越界（8-128）` };
    }
    const scopeCheck = validateExecutionScopeNodeIds(cmd.nodeIds);
    if (!scopeCheck.ok) return { ok: false, status: 400, code: scopeCheck.code, detail: scopeCheck.detail };
    // M-8：SystemHistory 行缺席=fail-closed（historyId 权威缺失——受理拒绝 500，非静默 'unknown'
    //  落行：REQUEST_STALE 判定不可凭空值进行）
    const history = await this.prisma.systemHistory.findUnique({ where: { id: 1 }, select: { historyId: true } });
    if (!history) {
      return { ok: false, status: 500, code: 'SYSTEM_HISTORY_MISSING', detail: 'SystemHistory 权威行缺失（fail-closed——受理拒绝；恢复链归 T13/T29）' };
    }

    // ②幂等前置：同 (projectId,requestId) 在档 → 三档（REQUEST_STALE/IDEMPOTENCY_CONFLICT/幂等返回原值）
    const existing = await this.prisma.executionRequest.findUnique({ where: { projectId_requestId: { projectId, requestId } } });
    if (existing) {
      if (history && existing.historyId !== history.historyId) {
        return { ok: false, status: 409, code: 'REQUEST_STALE', detail: 'PITR/恢复后同 requestId 重试（historyId 不匹配）——请求已过期' };
      }
      // 幂等身份域终裁（R-I-1 二轮）：**nodeIds 集比对，docSeq 出域**——requestId=意图身份（客户端
      // 逐意图铸造）；数组序=服务端 Kahn 拓扑派生非客户端语义（同集同 doc 确定性同序——请求序≠拓扑序
      // 的合法重放不得 409）；docSeq=咨询性（重试携带新 docSeq 恒重放原冻结计划）。意图变更（改集/改
      // model/prompt 后重发同 requestId）=客户端误用 requestId：集不同→409。更强 @frozenDocSeq 前缀
      // 重建比对（哈希级）留档不实现（重算会因受理后前缀推进误伤合法重试——收益/代价不成比）。
      const existingPlans = await this.prisma.executionNodePlan.findMany({
        where: { requestId: existing.id }, select: { nodeId: true },
      });
      const sameSet = existingPlans.length === cmd.nodeIds.length
        && cmd.nodeIds.every((id) => existingPlans.some((p) => p.nodeId === id));
      if (!sameSet) {
        return { ok: false, status: 409, code: 'IDEMPOTENCY_CONFLICT', detail: '同 requestId 不同 body（nodeIds 集不匹配——意图变更须换新 requestId）' };
      }
      return {
        ok: true, id: existing.id, requestId, frozenDocSeq: existing.frozenDocSeq,
        planHash: existing.planHash, inputHash: existing.inputHash,
        reservedCredit: existing.reservedCredit, totalCredit: existing.totalCredit, replayed: true,
      };
    }

    // ③行级关闸（maintenance active→409/503 不落行——spec §6.6 REQUESTED 同事务写 maintenanceId）
    const docHead = await this.prisma.canvasDoc.findUnique({ where: { projectId }, select: { maintenanceId: true } });
    if (docHead?.maintenanceId) return { ok: false, status: 503, code: 'MAINTENANCE_ACTIVE', detail: `维护窗口进行中（maintenanceId=${docHead.maintenanceId}）——受理拒绝` };

    // ④frozenDocSeq 临界区：live freeze mutex（常驻 doc）→gate 超时/doc 缺席回退 PG 前缀重建候选 doc
    let built: Awaited<ReturnType<ExecutionRequestService['buildFrozenSlice']>>;
    let frozenDocSeq: bigint;
    let generation = 0;
    if (this.actor) {
      const r = await this.actor.withFrozenPrefix(
        projectId,
        (ctx) => this.buildFrozenSlice(projectId, ctx.doc, cmd.nodeIds),
        { gateBudgetMs: EXEC_FREEZE_BUDGET_MS, flushBudgetMs: EXEC_ADMISSION_TIMEOUT_MS },
      );
      if (r.ok) {
        built = r.value;
        frozenDocSeq = r.pgSeq;
        generation = r.generation ?? 0;
      } else if (r.reason === 'flush-timeout') {
        return { ok: false, status: 503, code: 'ADMISSION_TIMEOUT', detail: 'frozenDocSeq 临界区 flush 超时（2s）——不落行' };
      } else {
        const fb = await this.rebuildViaCandidate(projectId, cmd.nodeIds);
        if ('error' in fb) return fb.error;
        built = fb.built; frozenDocSeq = fb.pgSeq; generation = fb.generation;
      }
    } else {
      const fb = await this.rebuildViaCandidate(projectId, cmd.nodeIds);
      if ('error' in fb) return fb.error;
      built = fb.built; frozenDocSeq = fb.pgSeq; generation = fb.generation;
    }
    if (!built.ok) return { ok: false, status: built.status, code: built.code, detail: built.detail };
    const { ordered, entries } = built;
    if (cmd.docSeq > frozenDocSeq) {
      return { ok: false, status: 409, code: 'DOCSEQ_NOT_PERSISTED', detail: `客户端下界 docSeq=${cmd.docSeq} 超服务端冻结前缀 frozenDocSeq=${frozenDocSeq}` };
    }

    // ⑤定价快照（冻结节点→ValidationService——错误面 4xx 不落半行）
    const project = await this.prisma.canvasProject.findUnique({ where: { id: projectId }, select: { teamId: true } });
    if (!project) return { ok: false, status: 404, code: 'PROJECT_NOT_FOUND', detail: '项目不存在' };
    const teamId = project.teamId;
    const vr = await this.validation.validateAll(ordered, teamId, userId);
    if (!vr.valid) return { ok: false, status: 400, code: 'VALIDATION_FAILED', detail: vr.errors.join('; ').slice(0, 500) };
    const planMap = new Map(vr.plans.map((p) => [p.nodeId, p]));

    // ⑥输入预算（shared 单源——raw≤8MiB∧stored≤2MiB 任一超限 413+256KiB prompt+媒体 200·50；
    //    插入前判定=零半行，不截断不分片——brotli〔node:zlib〕）
    const promptBytes = Math.max(...ordered.map((n) => Buffer.byteLength(entries[n.id]!.promptText, 'utf8')));
    const upstreamMediaCount = new Set(Object.values(entries).map((e) => e.upstreamImageMediaId).filter(Boolean)).size;
    // M-3/R-M-1/R2（二轮真修）：引用图计数读 n.data.prompt（slice plainOf 产物——XmlFragment 域
    // 解码为 RichTextValue{...,referencedImageIds}）内嵌引用；手工 data.imageUrls 数组兜底并计。
    // （上轮读 args.prompt 恒 string=死分支——本轮改读真源。）
    const referencedImageCount = ordered.reduce((acc, n) => {
      const promptVal = n.data.prompt as unknown;
      const fromPrompt = (promptVal && typeof promptVal === 'object' && Array.isArray((promptVal as { referencedImageIds?: unknown[] }).referencedImageIds))
        ? (promptVal as { referencedImageIds: unknown[] }).referencedImageIds.length
        : 0;
      const fromData = Array.isArray(n.data.imageUrls) ? (n.data.imageUrls as unknown[]).length : 0;
      return acc + fromPrompt + fromData;
    }, 0);
    const raw = Buffer.from(serializeFrozenInput(entries), 'utf8');
    const compressed = brotliCompressSync(raw);
    const limits = validateExecutionInputLimits({
      rawBytes: raw.byteLength, storedBytes: compressed.byteLength,
      promptBytes, upstreamMediaCount, referencedImageCount,
    });
    if (!limits.ok) return { ok: false, status: 413, code: limits.code, detail: limits.detail };

    // ⑦planHash（只盖不可变字段——canonical 单源）/inputHash（=contentHash 单源）
    const id = randomUUID();
    const planRows = ordered.map((n, i) => {
      const plan = planMap.get(n.id);
      const d = n.data;
      return {
        requestId: id, nodeId: n.id, order: i, type: n.type,
        model: plan?.modelId ?? null,
        resolution: plan?.resolutionId ?? null,
        styleId: typeof d.styleId === 'string' ? d.styleId : null,
        pricingRuleId: plan?.pricingRuleId ?? null,
        creditCost: plan?.creditCost ?? 0,
        reservedCredit: plan?.creditCost ?? 0,
        paramsHash: sha256hex(JSON.stringify([entries[n.id]!.kind, entries[n.id]!.args])),
        // M-4：非 executable（EXECUTABLE_TYPES 外——group/剪辑产物等）受理即 SKIPPED——
        // remaining 收口（PENDING/EXECUTING 计数）可达终态；值域注记：PENDING/EXECUTING/SETTLED/
        // VOIDED/SKIPPED 五值（SKIPPED=T21 收口新增——零成本零执行分支语义）。
        status: isExecutableNode(n) ? 'PENDING' : 'SKIPPED',
      };
    });
    const planHash = sha256hex(canonicalPlanHashPayload(planRows as never[]));
    const contentHash = sha256hex(compressed);
    const totalCredit = planRows.reduce((s, p) => s + p.creditCost, 0);
    const kind = planRows.find((p) => p.creditCost > 0)?.type ?? planRows[0]!.type;

    // ⑧单事务落库：request+plans+input+audit+per-item 资金预留（任一失败整体回滚=零半行）
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.executionRequest.create({ data: {
          id, requestId, projectId, generation, historyId: history.historyId,
          docSeq: cmd.docSeq, frozenDocSeq, userId, teamId, kind, state: 'ADMITTED',
          reservedCredit: totalCredit, totalCredit, planHash, inputHash: contentHash,
          expiresAt: new Date(Date.now() + EXEC_REQUEST_EXPIRES_AT_MS),
        } });
        await tx.executionNodePlan.createMany({ data: planRows });
        await tx.executionInput.create({ data: {
          requestId: id, encoding: EXEC_INPUT_ENCODING_KINDS[1] as ExecutionInputEncoding,
          content: compressed, contentHash, rawBytes: raw.byteLength, storedBytes: compressed.byteLength,
          schemaVersion: CANVAS_DOC_SCHEMA_VERSION,
          expiresAt: new Date(Date.now() + EXEC_INPUT_RETENTION_AFTER_FINAL_DAYS * 24 * 3_600_000),
        } });
        await tx.docAuditEvent.create({ data: {
          id: randomUUID(), projectId, kind: 'execute', userId, requestId,
          payload: { planHash, inputHash: contentHash, frozenDocSeq: frozenDocSeq.toString(), nodeCount: ordered.length },
        } });
        // per-item 预留（同事务——余额不足=整体回滚零半行；Y1a team-credit 资金 CAS 纪律衔接）
        const reserve = await this.teamCredit.reserveForExecutionRequest(userId, {
          executionRequestId: id, teamId,
          items: planRows.filter((p) => p.reservedCredit > 0).map((p) => ({ nodeId: p.nodeId, amount: p.reservedCredit })),
        }, tx);
        if (!reserve.success) {
          throw Object.assign(new Error(`reserve failed: ${reserve.reason}`), { admissionReserveFailed: true, reason: reserve.reason });
        }
      }, { timeout: 15_000, maxWait: 5_000 });
    } catch (err) {
      // I3：并发同 requestId 撞 @@unique(projectId,requestId)（检查后-插入前竞窗）→ 复读在档行
      // 走 replay 幂等路径（同请求净效果恰一次）；detail 固定文案禁泄漏 (err).message。
      if ((err as { code?: string }).code === 'P2002') {
        const winner = await this.prisma.executionRequest.findUnique({ where: { projectId_requestId: { projectId, requestId } } });
        if (winner) {
          // 集比对域（R-I-1 终裁同款——P2002 复读与前置检查同域）
          const winnerPlans = await this.prisma.executionNodePlan.findMany({ where: { requestId: winner.id }, select: { nodeId: true } });
          const sameSet = winnerPlans.length === cmd.nodeIds.length
            && cmd.nodeIds.every((id) => winnerPlans.some((p) => p.nodeId === id));
          if (sameSet) {
            return { ok: true, id: winner.id, requestId, frozenDocSeq: winner.frozenDocSeq, planHash: winner.planHash, inputHash: winner.inputHash, reservedCredit: winner.reservedCredit, totalCredit: winner.totalCredit, replayed: true };
          }
          return { ok: false, status: 409, code: 'IDEMPOTENCY_CONFLICT', detail: '同 requestId 不同 body（nodeIds 集不匹配——意图变更须换新 requestId）' };
        }
      }
      const reason = (err as { reason?: string }).reason;
      if (reason === 'QUOTA_EXCEEDED') return { ok: false, status: 429, code: 'QUOTA_EXCEEDED', detail: '月度配额超限（execreq 在飞预留计入——稍后重试或缩减范围）' };
      return { ok: false, status: reason === 'CREDIT_INSUFFICIENT' ? 402 : 500, code: reason ?? 'ADMISSION_FAILED', detail: '受理事务失败（幂等键同键重试安全——CREDIT_INSUFFICIENT 余额不足外均为瞬态）' };
    }
    return { ok: true, id, requestId, frozenDocSeq, planHash, inputHash: contentHash, reservedCredit: totalCredit, totalCredit, replayed: false };
  }

  /** freeze 回退：PG 前缀重建候选 doc→slice 组装（doc 用毕即毁）。 */
  private async rebuildViaCandidate(projectId: string, nodeIds: readonly string[]): Promise<
    | { error: AdmitOutcome }
    | { built: Awaited<ReturnType<ExecutionRequestService['buildFrozenSlice']>>; pgSeq: bigint; generation: number }
  > {
    const fb = await this.rebuildCandidateDoc(projectId);
    if (!fb) return { error: { ok: false, status: 503, code: 'ADMISSION_TIMEOUT', detail: 'freeze 回退 PG 前缀重建失败——不落行' } };
    try {
      const built = await this.buildFrozenSlice(projectId, fb.doc, nodeIds);
      if (!built.ok) return { error: { ok: false, status: built.status, code: built.code, detail: built.detail } };
      return { built, pgSeq: fb.pgSeq, generation: fb.generation };
    } finally {
      fb.doc.destroy();
    }
  }

  // ═══ worker 读面（零 doc 读——只读子行+ExecutionInput）══════════════════════════════════

  /** 加载冻结请求（worker 消费）：request+plans（order 升序）+解压 input。 */
  async loadForExecution(projectId: string, requestId: string): Promise<LoadedExecution | null> {
    const request = await this.prisma.executionRequest.findUnique({ where: { projectId_requestId: { projectId, requestId } } });
    if (!request) return null;
    const plans = await this.prisma.executionNodePlan.findMany({ where: { requestId: request.id }, orderBy: { order: 'asc' } });
    const inputRow = await this.prisma.executionInput.findUnique({ where: { requestId: request.id } });
    if (!inputRow) return null;
    const buf = Buffer.from(inputRow.content);
    const raw = inputRow.encoding === 'json+gzip' ? gunzipSync(buf) : brotliDecompressSync(buf);
    const input = deserializeFrozenInput(JSON.parse(raw.toString('utf8')));
    return {
      request: {
        id: request.id, requestId: request.requestId, projectId: request.projectId, generation: request.generation,
        state: request.state, frozenDocSeq: request.frozenDocSeq, planHash: request.planHash, inputHash: request.inputHash,
        teamId: request.teamId, userId: request.userId, kind: request.kind,
      },
      plans: plans.map((p) => ({
        requestId: p.requestId, nodeId: p.nodeId, order: p.order, type: p.type, model: p.model,
        resolution: p.resolution, styleId: p.styleId, pricingRuleId: p.pricingRuleId, creditCost: p.creditCost,
        reservedCredit: p.reservedCredit, paramsHash: p.paramsHash, status: p.status,
        generationIntentId: p.generationIntentId, execSeq: p.execSeq,
      })),
      input,
    };
  }

  // ═══ sweeper：未 claim 过期请求逐 item void（spec §6.1 资金预留续章）════════════════════

  /** 过期未执行（state=ADMITTED∧expiresAt<now）→ 逐 item void+state=VOIDED（幂等——终态不再命中）。 */
  async sweepExpired(now: Date = new Date()): Promise<number> {
    const expired = await this.prisma.executionRequest.findMany({
      where: { state: 'ADMITTED', expiresAt: { lt: now } }, select: { id: true }, take: 100,
    });
    let swept = 0;
    for (const e of expired) {
      const ok = await this.teamCredit.voidForExecutionRequest(e.id, 'expired-unclaimed');
      if (ok) swept += 1;
    }
    return swept;
  }
}

/** 身份参数冻结（paramsHash 同源——claim 零重算：受理时从冻结前缀铸造一次）。 */
function frozenIdentityArgs(
  node: { id: string; type: string; data: Record<string, unknown> },
  promptText: string,
  upstreamImageMediaId?: string,
): Record<string, unknown> {
  const d = node.data;
  if (node.type === 'textInput') {
    return { prompt: promptText || 'Hello', model: d.model ?? null, apiUrl: '' };
  }
  if (node.type === 'videoGen') {
    return {
      prompt: promptText, model: d.model ?? null, mode: d.mode ?? 'text-to-video',
      imageMediaId: upstreamImageMediaId ?? null,
      startImageMediaId: d.startImageUrl ? 'manual-ref' : null,   // 手工 URL 身份归一归 claim 腿（受理面无 URL 解析）
      endImageMediaId: d.endImageUrl ? 'manual-ref' : null,
      ratio: d.ratio ?? null, quality: d.quality ?? null, duration: d.duration ?? null, audio: d.audio ?? null,
    };
  }
  return {
    prompt: promptText, extraPrompt: d.extraPrompt ?? null, style: d.style ?? null,
    model: d.model ?? null, resolution: d.resolution ?? null, imageMediaId: upstreamImageMediaId ?? null,
  };
}
