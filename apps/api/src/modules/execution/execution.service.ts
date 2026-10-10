import { Injectable, Inject, Logger, ServiceUnavailableException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TopologyService } from './topology.service';
import { ValidationService } from './validation.service';
import { ApiCallerService } from './api-caller.service';
import { TeamCreditService } from '../team/team-credit.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { isExecutableNode } from './is-executable-node';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CollabDocumentService } from '../collab/collab-document.service';
import { GenerationIntentService, ClaimPricing, NodeBusyError, IntentExhaustedError } from './generation-intent.service';
import { normalizeIntentParams } from './normalize-intent-params';
import { BusinessException } from '../../common/exceptions/business.exception';
import { settleFailureTotal, intentDuplicateAttemptTotal } from './intent-reconcile.metrics';
import { artifactDiscardedTotal } from './exec.metrics';

/** Z95/Z88：组执行错误结构化契约——nodeId 定位+status 分诊（error=节点失败/skipped=别处在飞/重复外呼
 *  非节点失败）+errorCode（客户端轮换/重试判据单源）。success=errors.length===0（真单出口）。 */
export interface ExecutionErrorEntry {
  nodeId: string;
  status: 'error' | 'skipped';
  error: string;
  errorCode?: string;
}

export interface ExecutionResult {
  success: boolean;
  errors: ExecutionErrorEntry[];
  results: Array<{ nodeId: string; type: string; resultUrl?: string; content?: string }>;
  /** 实扣总额（审计口径——settle 成功才计入；emit 已删，组执行响应曾 void 丢弃） */
  totalCost: number;
}

/** 单节点外呼特化腿（NodeExecutor 表项）产出：complete 锚+doc 产物键+结果行+下载队列投递。 */
interface NodeCallOutcome {
  kind: string;                            // reanchor deadline 档表键（intent-key.util deadlineMsForKind）
  callArgs: Record<string, unknown>;       // claim paramsHash 规范化输入（与外呼实参同源）
  call: (onTick: () => Promise<'abort' | void>) => Promise<{ resultRef: string; artifact: Record<string, unknown>; resultRow?: ExecutionResult['results'][number]; fileId?: string; downloadMime?: string }>;
}

@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TopologyService) private readonly topology: TopologyService,
    @Inject(ValidationService) private readonly validation: ValidationService,
    @Inject(ApiCallerService) private readonly apiCaller: ApiCallerService,
    @Inject(TeamCreditService) private readonly teamCredit: TeamCreditService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(CollabDocumentService) private readonly collabDoc: CollabDocumentService,
    @Inject(ExecutionGateway) private readonly gateway: ExecutionGateway,
    @InjectQueue('ai-result-download') private readonly downloadQueue: Queue,
    @Inject(GenerationIntentService) private readonly intentService: GenerationIntentService,
  ) {}

  /** D1：余额推送统一完整三字段对象（原文本节点推 total、图片/视频只推 credits，口径不一） */
  private balancePayload(bal: { credits: number; subscriptionCredits: number; total: number } | null | undefined) {
    return bal ? { credits: bal.credits, subscriptionCredits: bal.subscriptionCredits, total: bal.total } : undefined;
  }

  /** Y0b-2 T4：onTick 双职回调（Z69）——pollLoop 每 tick ①touchHeartbeat 续生命线
   *  （heartbeatAt>=deadlineAt ⇒ reaper deadline 批不收：轮询活着）②读意图状态：
   *  reaper 已收敛（VOIDED/FAILED）⇒ 'abort' 停外呼（资金已退，外呼产物留作废）。 */
  private intentOnTick(intentRowId: string) {
    return async (): Promise<'abort' | void> => {
      await this.intentService.touchHeartbeat(intentRowId);
      const row = await this.prisma.generationIntent.findUnique({
        where: { id: intentRowId }, select: { status: true },
      });
      if (row && row.status !== 'RUNNING') return 'abort';
    };
  }

  /** 批0.5-6：意图 claim 前置（外呼之前）。kind/params = 各分支实读外呼参数——
   *  normalizeIntentParams 白名单拾取（0.5-2），sv/nonce 不进哈希。
   *  Y0b-2（Z109）：入参 intentId=客户端手势 token（wire 名不变）——无条件透传 gestureToken 整批施加
   *  （组执行全节点同 token：idemKey 含 nodeId 故无碰撞）；行身份 intentId 由 claim 内部铸造
   *  （旧"首个 exec 落 token、其余派 UUID"的门随 T1 删——token 不再是行键，无需选择落点）。
   *  Y0b-1（E1）：pricing/teamId 必填透传——定价快照自 validation plans（预估=plan 同源，TOCTOU 消除）。 */
  private claimForNode(
    projectId: string, node: any, userId: string, gestureToken: string | undefined,
    kind: string, params: Record<string, unknown>, pricing: ClaimPricing, teamId: string, jobId?: string,
  ) {
    return this.intentService.claim({
      projectId, nodeId: node.id, userId, gestureToken, kind,
      paramsHash: normalizeIntentParams(kind, params),
      // Y0b-1（E1）：NodePlan → ClaimPricing 五字段投影（nodeId 是 plan 路由键非快照列——不进 claim）
      pricing: {
        pricingRuleId: pricing.pricingRuleId, modelId: pricing.modelId, resolutionId: pricing.resolutionId,
        durationId: pricing.durationId, creditCost: pricing.creditCost,
      },
      teamId, jobId,
    });
  }

  /** Y0b-2 T5（Z95/Z111）：终态 error 投影 patch——errorCode+rearmable+attempts 与 status:'error' 同 patch
   *  （writeExecStatus 终态守卫约束事后补写会被吞；INTENT_EXHAUSTED 例外传 rearmable:false——客户端轮换判据单源）。 */
  private errorPatch(errorCode: string, error: string, attempts: number, rearmable = attempts < 3, intentId?: string) {
    return {
      status: 'error', errorCode, error: String(error).slice(0, 200), rearmable, attempts,
      ...(intentId ? { intentId } : {}),
    };
  }

  /** 批0.5-9 reserve 失败三连：意图置 VOIDED（零扣费终态——重试照常扣费，与 FAILED 分义不混：
   *  FAILED=外呼失败且冻结已退；VOIDED=从未扣费）+ WS error + exec map error（best-effort）。 */
  private async onReserveFail(projectId: string, node: any, intent: any, msg: string, errorCode: string) {
    await this.intentService.void_(intent.id, msg);
    this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'error', error: msg });
    await this.collabDoc.writeExecStatus(projectId, node.id, this.errorPatch(errorCode, msg, intent.attempts ?? 0, (intent.attempts ?? 0) < 3, intent.intentId)).catch(() => {});
  }

  /** intentId 形参=客户端手势 token（Z109：wire 名不变、语义=gestureToken——行身份由 claim 铸造）。 */
  async execute(
    projectId: string, nodeId: string | undefined, userId: string, nodeIds?: string[], sv?: Uint8Array, intentId?: string, jobId?: string,
  ): Promise<ExecutionResult> {
    // 0c-6：权限守卫最先——非成员不可用"项目不存在"响应区分不存在 vs 无权（存在性 oracle）
    await this.perm.assertEditor(projectId, userId);

    // 1. Load project
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      return { success: false, errors: [{ nodeId: '', status: 'error', error: '项目不存在' }], results: [], totalCost: 0 };
    }

    // Y0a-3（§3.2 计费读）：租约失守/drain→503 fail-closed（按陈旧快照烧钱比拒服务更糟——E49）。
    // V21：**对象响应体**（Object.assign 挂异常属性不会进 getResponse()——客户端拿不到 code）；
    // Retry-After 由 collab-not-serving.filter.ts 统一落。
    if (!this.collabDoc.isLeaseServing())
      throw new ServiceUnavailableException({ code: 'COLLAB_NOT_SERVING', message: 'collab not serving' });
    // Y0b-2 T3（分源钉死）：计费/语义读恒活读（readCanvas/withDoc——发起方必有 WS⇒doc 常驻⇒零装载
    // 成本）；快照出口 readCanvasSnapshotCached 仅无客户端面（video-work 等）——本处禁改走快照。
    const canvas = await this.collabDoc.readCanvas(projectId, sv);
    const allNodes = canvas.nodes as any[];
    const allEdges = canvas.edges as any[];

    // 2. Determine scope
    const scopeNodes = nodeIds
      ? allNodes.filter((n) => nodeIds.includes(n.id))
      : nodeId
        ? this.topology.getScope(allNodes, allEdges, nodeId)
        : allNodes;

    // Y0b-2 T5（Z44）：请求级错误——循环前 throw 合法（4xx；零外呼零冻结零 attempts 消耗）。
    if (nodeIds) {
      const known = new Set(allNodes.map((n) => n.id));
      const unknown = nodeIds.filter((id) => !known.has(id));
      if (unknown.length > 0)
        throw new BusinessException('UNKNOWN_NODE_IDS', `节点不存在：${unknown.join(',').slice(0, 200)}`, HttpStatus.BAD_REQUEST);
    }
    // 3. Topological sort
    const orderedNodes = this.topology.sort(scopeNodes, allEdges);
    if (orderedNodes.length < scopeNodes.length)
      throw new BusinessException('CYCLE', '组内存在循环依赖，无法确定执行顺序', HttpStatus.BAD_REQUEST);
    if (!orderedNodes.some(isExecutableNode))
      throw new BusinessException('EMPTY_SCOPE', '执行范围为空（无可执行节点）', HttpStatus.BAD_REQUEST);

    // 4. Global pre-validation
    const validationResult = await this.validation.validateAll(orderedNodes, project.teamId, userId);
    if (!validationResult.valid) {
      // 请求级失败（4xx 语义保持返回体非 throw）——errors 结构化跨端（Z95）
      return {
        success: false,
        errors: validationResult.errors.map((e: string) => ({ nodeId: '', status: 'error' as const, error: e })),
        results: [],
        totalCost: 0,
      };
    }
    // Y0b-1（E1/Z10 前半）：plan 快照表——claim 定价与 reserve 金额皆自此读（零额外解析）
    const planMap = new Map(validationResult.plans.map((p) => [p.nodeId, p]));

    // 5. Execute sequentially
    let totalDeducted = 0;
    const results: ExecutionResult['results'] = [];
    const errors: ExecutionErrorEntry[] = [];
    // 风格批量预取（spec §7.1/B19——validation.service.ts:29 同款 in 查询先例）
    const styleIds = [...new Set(orderedNodes.map((n) => (n.data as any)?.styleId).filter(Boolean))];
    const styleRows = styleIds.length
      ? await this.prisma.style.findMany({ where: { id: { in: styleIds as string[] } } })
      : [];
    const styleMap = new Map(styleRows.map((s) => [s.id, s]));
    const styleTextOf = (data: any): string => {
      const s = data?.styleId ? styleMap.get(data.styleId) : undefined;
      return s?.active ? s.promptText : '';
    };
    // Z90 期间不变量：禁加"断连即取消"（req.on('close') 全仓零命中=服务端不因断连中止）——
    // 加了会把 504"回执丢失"退化成"工作丢失但仍扣费"；断连恢复对齐归 exec 投影/intents 读面。
    for (const node of orderedNodes) {
      if (!isExecutableNode(node)) continue; // 防剪辑/产物节点闪 loading 与误执行（批5-1 删信箱后无影子直调例外——regenerate 直连真实节点，白名单单判据）
      this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'loading' });
      await this.runNodeLifecycle({
        projectId, node, userId, gestureToken: intentId, jobId,
        teamId: project.teamId, planMap, styleTextOf,
        upstreamSource: nodeIds ? allNodes : scopeNodes, allEdges, // nodeIds 模式读全量（上游可在组外）
        results, errors, onDeducted: (c) => { totalDeducted += c; },
      });
    }

    // 6. 真单出口（Y0b-2 T5）：emit execution:complete 已删（web 零消费者）——总额进 return 作审计口径。
    return { success: errors.length === 0, errors, results, totalCost: totalDeducted };
  }

  /** Y0b-2 T5：runNodeLifecycle 单序列（真单出口的节点级实现——永不 throw，失败面全落 errors/exec 投影）：
   *  plan 校验（pre-call miss ⇒ artifactDiscarded{precall-miss}+error 投影）→claim（NodeBusy ⇒ 投影 skipped+reason
   *  〔Z99 禁 error——"别处在飞"非节点失败〕）→loading 投影→reserve（失败 onReserveFail+return；
   *  mayCall:false ⇒ skipped 投影+return〔Z35 静默退出——悬挂收敛归 reconcile〕）→reanchorDeadline
   *  （count===0=A-2 迟归 job 行已终态——早退不再 submit）→外呼（onTick 双职）→complete CAS（gated≠1 ⇒
   *  discarded{deadline-voided}+终态 error 投影〔Z95 补〕+return）→settle（失败 settleFailureTotal+照发）→
   *  writeNodeData（written:false ⇒ discarded{node-deleted}+rollbackDeliveryFailed+终态 error 投影+return
   *  ——Z64/Z92 交付路径唯一退款入口；drain/租约 503 是抛错走悬留闭环非 written:false）→done 投影+
   *  results.push+余额推送+下载队列。 */
  private async runNodeLifecycle(ctx: {
    projectId: string; node: any; userId: string; gestureToken?: string; jobId?: string;
    teamId: string; planMap: Map<string, any>; upstreamSource: any[]; allEdges: any[];
    styleTextOf: (data: any) => string;
    results: ExecutionResult['results']; errors: ExecutionErrorEntry[];
    onDeducted: (cost: number) => void;
  }): Promise<void> {
    const { projectId, node, userId, gestureToken, jobId, teamId, planMap, upstreamSource, allEdges, results, errors, onDeducted } = ctx;
    // A-3（T4 I-2）：poll-abort ⇒ 行已终态，清理由 reaper 完成——onTick 抛出的 PROVIDER_POLL_ABORTED
    // 在下方 catch 被降级为逐节点 error（不 re-throw）；该降级安全仅因"onTick abort ⇔ 行已终态
    // （reaper 已收敛资金）"这一不变量——若 abort 语义扩围须重审此处。
    let claimed: any = null; // 本节点已获执行权的意图行（catch 路径 fail 用——claim 未成功则不碰他人在飞行）
    try {
      // plan 校验=pre-call 断言（同源 allNodes→validation plans）：miss 即节点集分叉/断言被绕过
      const plan = planMap.get(node.id);
      if (!plan) {
        artifactDiscardedTotal.inc({ cause: 'precall-miss' }); // 断言恒 0——非 0 即 pre-call 断言被绕过
        const msg = `节点 ${node.id} 无定价快照（validation/execution 节点集分叉？）`;
        await this.collabDoc.writeExecStatus(projectId, node.id, this.errorPatch('PLAN_MISSING', msg, 0, false)).catch(() => {}); // 请求级投影传 0 代（0 代不得覆盖任何 ≥1 代）
        errors.push({ nodeId: node.id, status: 'error', error: msg, errorCode: 'PLAN_MISSING' });
        return;
      }
      const cost = plan.creditCost; // plan 固化快照——reserve 前零额外解析

      // ── claim（外呼实参白名单规范化——paramsHash 与外呼同源）──
      const claimPack = this.nodeClaimPack(node, ctx);
      const { intent, created } = await this.claimForNode(projectId, node, userId, gestureToken, claimPack.kind, claimPack.callArgs, plan, teamId, jobId);
      if (!created) {
        // SUCCEEDED 幂等重放——零外呼零扣费，回放既有产物引用（幂等组②）
        // Y0b-2 T6（T5 Minor#5 补投影）：回放路径补 done 终态投影+node data——改前只 emit，
        // 回放时 doc exec 停 loading（对齐只能等 visibilitychange）；text 的 resultRef 是
        // `text:${content.slice(0,100)}` 截断占位，补写会截断真实产物——禁补（emit/投影照写）。
        this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'done', fileId: intent.resultRef ?? undefined });
        await this.collabDoc.writeExecStatus(projectId, node.id, {
          status: 'done', intentId: intent.intentId,
          attempts: typeof intent.attempts === 'number' ? intent.attempts : 0,
          ...(intent.resultRef ? { fileId: intent.resultRef } : {}),
        }).catch(() => {});
        if (claimPack.kind !== 'text' && intent.resultRef) {
          const artifact = claimPack.kind === 'video' ? { videoUrl: intent.resultRef } : { resultUrl: intent.resultRef };
          await this.collabDoc.writeNodeData(projectId, node.id, artifact).catch(() => {}); // best-effort——节点已删等失败不挡回放
        }
        return;
      }
      claimed = intent;
      const attempts: number = typeof intent.attempts === 'number' ? intent.attempts : 0;
      await this.collabDoc.writeExecStatus(projectId, node.id, { status: 'loading', jobId: jobId ?? null, intentId: intent.intentId, attempts }).catch(() => {}); // best-effort

      // ── reserve（外呼之前——余额不足即拒=零外呼零沉没）──
      if (cost > 0) {
        const reserveResult = await this.teamCredit.reserve(userId, { intentRowId: intent.id });
        if (reserveResult.mayCall === false) {
          // Z35：alreadyReserved=他人在飞（stall 重排）——静默退出（不 void_/不 fail/不 emit）；
          // 投影 skipped 非终态（Z88）——在飞 worker 的 done 照常落地
          intentDuplicateAttemptTotal.inc();
          this.logger.warn(`[reserve] 意图 ${intent.intentId} 重复外呼企图——skipped 退出（悬挂收敛归 reconcile）`);
          await this.collabDoc.writeExecStatus(projectId, node.id, { status: 'skipped', reason: 'INTENT_DUPLICATE_ATTEMPT', attempts, intentId: intent.intentId }).catch(() => {});
          errors.push({ nodeId: node.id, status: 'skipped', error: 'INTENT_DUPLICATE_ATTEMPT' });
          return;
        }
        if (!reserveResult.success) {
          const errorCode = reserveResult.reason ?? 'RESERVE_FAILED';
          const msg = `扣费失败：${errorCode}`;
          await this.onReserveFail(projectId, node, intent, msg, errorCode);
          errors.push({ nodeId: node.id, status: 'error', error: msg, errorCode });
          return;
        }
      }

      // ── 外呼前重锚（A-2：count===0=行已终态——Z84 宽限后 VOID 的迟归 job 早退不再 submit）──
      const reanchored = await this.intentService.reanchorDeadline(intent.id, claimPack.kind);
      if (reanchored === 0) {
        this.logger.warn(`[reanchor] 意图 ${intent.intentId} 行已终态（迟归 job）——早退零外呼（终态投影归 reaper）`);
        return;
      }

      // ── 外呼（text 链单次 fetch 无轮询；image/video onTick 双职=心跳续命+reaper 收敛即 abort）──
      const outcome = await claimPack.call(this.intentOnTick(intent.id));

      // ── complete CAS（F13 产物门序：看到产物 ⇒ 意图仍有效——count===1 才投递）──
      const gated = await this.intentService.complete(intent.id, outcome.resultRef);
      if (gated !== 1) {
        artifactDiscardedTotal.inc({ cause: 'deadline-voided' });
        this.logger.warn(`[intent-reconcile] 意图 ${intent.intentId} 已被 VOIDED——跳过产物写入（外呼产物留作物证）`);
        await this.collabDoc.writeExecStatus(projectId, node.id, this.errorPatch('INTENT_DEADLINE_EXCEEDED', '生成已被系统回收（超时）——产物未投递', attempts, attempts < 3, intent.intentId)).catch(() => {});
        this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'error', error: '生成已被系统回收（超时）' });
        errors.push({ nodeId: node.id, status: 'error', error: '生成已被系统回收（超时）', errorCode: 'INTENT_DEADLINE_EXCEEDED' });
        return;
      }

      // ── settle（complete→settle→deliver 序：冻结转实扣；失败计数+产物照发——对账第四分支兜底）──
      if (cost > 0) {
        const settled = await this.teamCredit.settle({ intentRowId: intent.id });
        if (settled.success) onDeducted(cost); // P8：已消费才计入——totalCost=实扣真值（冻结≠消费）
        else { settleFailureTotal.inc(); this.logger.warn(`[reserve-settle] 意图 ${intent.intentId} settle 失败（对账第四分支兜底——产物照发）`); }
      }

      // ── deliver（Z64/Z92：written:false=节点已删——rollbackDeliveryFailed 交付路径唯一退款入口）──
      const deliver = await this.collabDoc.writeNodeData(projectId, node.id, outcome.artifact);
      if (!deliver.written) {
        artifactDiscardedTotal.inc({ cause: 'node-deleted' });
        const msg = '节点已被删除——产物未投递，已退款';
        const rolled = await this.teamCredit.rollbackDeliveryFailed(intent.id, '交付失败：节点已删（written:false）')
          .catch((e) => { this.logger.warn(`[deliver-refund] 意图 ${intent.intentId} 交付退款失败（悬留闭环兜底）: ${e}`); return false; });
        this.logger.warn(`[deliver-refund] 意图 ${intent.intentId} 节点已删（${deliver.reason}）——rollbackDeliveryFailed=${rolled}`);
        await this.collabDoc.writeExecStatus(projectId, node.id, this.errorPatch('NODE_DELETED', msg, attempts, attempts < 3, intent.intentId)).catch(() => {});
        this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'error', error: msg });
        errors.push({ nodeId: node.id, status: 'error', error: msg, errorCode: 'NODE_DELETED' });
        return;
      }

      // ── done 投影+结果行+余额推送+下载队列（MinIO 异步归档）──
      // 三附带步骤一律 best-effort（T6 审查 Important①）：writeNodeData 已成功=交付完成，此后投影/
      // 下载入队/余额读任一抛错若裸 await 落 catch，会被 B-1 的"SUCCEEDED∧交付抛错"识别误判为交付
      // 失败⇒rollbackDeliveryFailed 退款——产物已交付+退款=错账面。收窄 B-1 识别=交付本身（writeNodeData）抛错。
      await Promise.resolve(this.collabDoc.writeExecStatus(projectId, node.id, {
        status: 'done', jobId: jobId ?? null, intentId: intent.intentId, attempts,
        ...(outcome.fileId ? { fileId: outcome.fileId } : {}),
      })).catch((e: unknown) => this.logger.warn(`done 投影 best-effort 失败 node=${node.id}: ${(e as Error).message}`));
      if (outcome.resultRow) results.push(outcome.resultRow);
      if (outcome.downloadMime && outcome.resultRef) {
        await Promise.resolve(this.downloadQueue.add('ai-result-download', {
          userId, projectId, nodeId: node.id, taskId: `task-${Date.now()}`, resultUrl: outcome.resultRef, mimeType: outcome.downloadMime,
        })).catch((e: unknown) => this.logger.warn(`下载入队 best-effort 失败 node=${node.id}: ${(e as Error).message}`));
        this.logger.log(`Enqueued AI result download for node ${node.id}`);
      }
      const bal = await Promise.resolve(this.teamCredit.getBalanceView(teamId, userId))
        .catch(() => null);
      this.gateway.emitNodeStatus(projectId, {
        nodeId: node.id, status: 'done', ...(outcome.fileId ? { fileId: outcome.fileId } : {}), credits: bal ? this.balancePayload(bal) : undefined,
      });
    } catch (err: any) {
      // A-3：BusinessException（409 族/PROVIDER_POLL_ABORTED 等）降级逐节点 error+continue——:367 整批
      // throw 已退役（Z44 部分成功语义）；F13：意图终态必达——外呼/扣费抛错置 FAILED（SIGKILL 场景
      // process catch 不执行，由 processor failed 钩子兜底）；失败先 void_ 解冻（约束②），再置 FAILED。
      // Y0b-2 T6（B-1 settle 后交付死区根修）：行已 SUCCEEDED（complete+settle 均核销）∧交付抛错
      // （writeNodeData 503 drain/租约等）——void_（CAS reserved>0）与 fail（ACTIVE 守卫）双双 no-op，
      // 行永留 SUCCEEDED（reserved=0）⇒ settleStranded 判龄永不命中+用户重试回放零退款双扣。
      // 识别 ⇒ rollbackDeliveryFailed（CAS SUCCEEDED→退款 VOIDED——与 written:false 同入口语义）。
      if (claimed) {
        const row = await this.prisma.generationIntent.findUnique({
          where: { id: claimed.id }, select: { status: true },
        }).catch(() => null);
        const attempts: number = typeof claimed.attempts === 'number' ? claimed.attempts : 0;
        if (row?.status === 'SUCCEEDED') {
          const msg = '生成成功但交付失败（已退款）——请重试';
          const rolled = await this.teamCredit.rollbackDeliveryFailed(claimed.id, '交付失败：settle 后交付抛错')
            .catch((e) => { this.logger.warn(`[deliver-refund] 意图 ${claimed.intentId} B-1 交付退款失败（悬留闭环兜底）: ${e}`); return false; });
          this.logger.warn(`[deliver-refund] 意图 ${claimed.intentId} settle 后交付抛错（行已 SUCCEEDED）——rollbackDeliveryFailed=${rolled}`);
          await this.collabDoc.writeExecStatus(projectId, node.id, this.errorPatch('NODE_DELIVERY_FAILED', msg, attempts, attempts < 3, claimed.intentId)).catch(() => {});
          this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'error', error: msg });
          errors.push({ nodeId: node.id, status: 'error', error: msg, errorCode: 'NODE_DELIVERY_FAILED' });
          return;
        }
        await this.teamCredit.void_({ intentRowId: claimed.id })
          .catch((e) => this.logger.warn(`[reserve-settle] 意图 ${claimed.intentId} void_ 解冻失败（reconcile 超龄兜底）: ${e}`));
        await this.intentService.fail(claimed.id, String(err));
      }
      const attempts: number = typeof claimed?.attempts === 'number' ? claimed.attempts : 0;
      if (err instanceof NodeBusyError) {
        // Z99：NodeBusy=别处在飞非节点失败——投影 skipped+reason（禁 error）；不 fail 他人在飞行、不 void_
        await this.collabDoc.writeExecStatus(projectId, node.id, {
          status: 'skipped', reason: String(err?.message ?? err), attempts,
          ...(claimed ? { intentId: claimed.intentId } : {}),
        }).catch(() => {});
        errors.push({ nodeId: node.id, status: 'skipped', error: String(err?.message ?? err), errorCode: 'NODE_BUSY' });
        return;
      }
      const errorCode = err instanceof BusinessException ? err.errorCode : 'EXECUTION_FAILED';
      const rearmable = err instanceof IntentExhaustedError ? false : attempts < 3; // INTENT_EXHAUSTED：rearmable:false（轮换判据单源）
      await this.collabDoc.writeExecStatus(projectId, node.id, this.errorPatch(errorCode, err?.message ?? err, attempts, rearmable, claimed?.intentId)).catch(() => {}); // error 展示不受门序限（无产物即无资损方向）——doc 写失败不吞原始错误
      this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'error', error: err?.message ?? String(err) });
      errors.push({ nodeId: node.id, status: 'error', error: String(err?.message ?? err), errorCode });
    }
  }

  /** NodeExecutor 表（Y0b-2 T5）：三 exec（text/video/image）显式 switch——kind（reanchor 档键）+
   *  外呼实参（paramsHash 同源）+call 腿（产物锚/doc 产物键/结果行/下载投递）。image 腿覆盖
   *  imageGen/imageExtGen/multiImageGen/audioGen（旧 fall-through 语义显式化）；未知类型=
   *  UNSUPPORTED_NODE_TYPE 显式 4xx（非静默按 image 处理）。 */
  private nodeClaimPack(node: any, ctx: {
    node: any; upstreamSource: any[]; allEdges: any[]; styleTextOf: (data: any) => string;
  }): NodeCallOutcome {
    const { upstreamSource, allEdges, styleTextOf } = ctx;
    const upstream = this.topology.collectUpstreamData(node.id, upstreamSource, allEdges);
    const data = node.data as any;
    const prompt = upstream.textContents.join(' ') || data?.prompt?.text || data?.content || '';

    if (node.type === 'textInput') {
      const callArgs = {
        prompt: prompt || 'Hello',
        model: data?.model, // Y0b-1（Z30）：删 'seed-model-kimi' 字面量兜底——缺模型走 MODEL_NOT_SELECTED 显式 4xx
        apiUrl: '',
      };
      return {
        kind: 'text',
        callArgs,
        call: async () => {
          // text 链单次 fetch 无轮询无 onTick——重锚即外呼前唯一心跳写点
          const textResult = await this.apiCaller.callTextGen(callArgs);
          return {
            resultRef: `text:${String(textResult.content).slice(0, 100)}`, // 无 Media/URL 锚点——观测用占位
            artifact: { content: data.content || prompt, result: textResult.content },
            resultRow: { nodeId: node.id, type: 'text', content: textResult.content },
          };
        },
      };
    }
    if (node.type === 'videoGen') {
      const vStyleText = styleTextOf(data);
      const vFinalPrompt = [prompt, vStyleText].filter(Boolean).join(', ');
      const callArgs = {
        prompt: vFinalPrompt,
        model: data?.model,
        mode: data?.mode || 'text-to-video',
        imageUrl: upstream.imageUrl || data?.startImageUrl,
        startImageUrl: data?.startImageUrl,
        endImageUrl: data?.endImageUrl,
        imageUrls: data?.imageUrls,
        ratio: data?.ratio,
        quality: data?.quality,
        duration: data?.duration,
        audio: data?.audio,
      };
      return {
        kind: 'video',
        callArgs,
        call: async (onTick) => {
          const result = await this.apiCaller.callVideoGen({ ...callArgs, onTick });
          return {
            resultRef: result.url, // video 产物锚点 = videoUrl（writeNodeData 所写产物字段值）
            artifact: { videoUrl: result.url },
            resultRow: { nodeId: node.id, type: 'video', resultUrl: result.url },
            fileId: result.url,
            downloadMime: 'video/mp4',
          };
        },
      };
    }
    if (node.type === 'imageGen' || node.type === 'imageExtGen' || node.type === 'multiImageGen' || node.type === 'audioGen') {
      const iStyleText = styleTextOf(data);
      const iFinalPrompt = [prompt, iStyleText].filter(Boolean).join(', '); // 分隔符对齐 combinePrompt（api-caller.service.ts:86）
      const callArgs = {
        prompt: iFinalPrompt,
        extraPrompt: data?.extraPrompt,
        style: data?.style,
        model: data?.model,
        resolution: data?.resolution,
        imageUrl: upstream.imageUrl,
      };
      return {
        kind: 'image',
        callArgs,
        call: async (onTick) => {
          const result = await this.apiCaller.callImageGen({ ...callArgs, onTick });
          return {
            resultRef: result.url, // image 产物锚点 = resultUrl（media.create 在 ai-result-download 侧异步落地）
            artifact: { resultUrl: result.url },
            resultRow: { nodeId: node.id, type: 'image', resultUrl: result.url },
            fileId: result.url,
            downloadMime: 'image/png',
          };
        },
      };
    }
    throw new BusinessException('UNSUPPORTED_NODE_TYPE', `节点 ${node.id} 类型 ${node.type} 无执行分支`, HttpStatus.BAD_REQUEST);
  }
}
