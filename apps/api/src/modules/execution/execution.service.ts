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
import { GenerationIntentService, ClaimPricing } from './generation-intent.service';
import { normalizeIntentParams } from './normalize-intent-params';
import { BusinessException } from '../../common/exceptions/business.exception';
import { settleFailureTotal, intentDuplicateAttemptTotal } from './intent-reconcile.metrics';

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

  /** 批0.5-9 reserve 失败三连：意图置 VOIDED（零扣费终态——重试照常扣费，与 FAILED 分义不混：
   *  FAILED=外呼失败且冻结已退；VOIDED=从未扣费）+ WS error + exec map error（best-effort）。 */
  private async onReserveFail(projectId: string, node: any, intent: any, msg: string) {
    await this.intentService.void_(intent.id, msg);
    this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'error', error: msg });
    await this.collabDoc.writeExecStatus(projectId, node.id, { status: 'error', error: msg }).catch(() => {});
  }

  /** intentId 形参=客户端手势 token（Z109：wire 名不变、语义=gestureToken——行身份由 claim 铸造）。 */
  async execute(projectId: string, nodeId: string | undefined, userId: string, nodeIds?: string[], sv?: Uint8Array, intentId?: string, jobId?: string) {
    // 0c-6：权限守卫最先——非成员不可用"项目不存在"响应区分不存在 vs 无权（存在性 oracle）
    await this.perm.assertEditor(projectId, userId);

    // 1. Load project
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: projectId },
    });
    if (!project) return { success: false, errors: ['项目不存在'] };

    // Y0a-3（§3.2 计费读）：租约失守/drain→503 fail-closed（按陈旧快照烧钱比拒服务更糟——E49）。
    // V21：**对象响应体**（Object.assign 挂异常属性不会进 getResponse()——客户端拿不到 code）；
    // Retry-After 由 collab-not-serving.filter.ts 统一落。
    if (!this.collabDoc.isLeaseServing())
      throw new ServiceUnavailableException({ code: 'COLLAB_NOT_SERVING', message: 'collab not serving' });
    const canvas = await this.collabDoc.readCanvas(projectId, sv);
    const allNodes = canvas.nodes as any[];
    const allEdges = canvas.edges as any[];

    // 2. Determine scope
    const scopeNodes = nodeIds
      ? allNodes.filter((n) => nodeIds.includes(n.id))
      : nodeId
        ? this.topology.getScope(allNodes, allEdges, nodeId)
        : allNodes;

    // 3. Topological sort
    const orderedNodes = this.topology.sort(scopeNodes, allEdges);

    // 4. Global pre-validation
    const validationResult = await this.validation.validateAll(orderedNodes, project.teamId, userId);
    if (!validationResult.valid) {
      return { success: false, errors: validationResult.errors };
    }
    // Y0b-1（E1/Z10 前半）：plan 快照表——claim 定价与 reserve 金额皆自此读（零额外解析）
    const planMap = new Map(validationResult.plans.map((p) => [p.nodeId, p]));

    // 5. Execute sequentially
    let totalDeducted = 0;
    const results: any[] = [];
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
    for (const node of orderedNodes) {
      if (!isExecutableNode(node)) continue; // 防剪辑/产物节点闪 loading 与误执行（批5-1 删信箱后无影子直调例外——regenerate 直连真实节点，白名单单判据）
      this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'loading' });
      let claimed: any = null; // 本节点已获执行权的意图行（catch 路径 fail 用——claim 未成功则不碰他人在飞行）

      try {
        // Collect upstream data (use full node list when nodeIds mode to allow reading from outside group)
        const upstreamSource = nodeIds ? allNodes : scopeNodes;
        const upstream = this.topology.collectUpstreamData(node.id, upstreamSource, allEdges);
        const data = node.data as any;
        const prompt = upstream.textContents.join(' ') || data?.prompt?.text || data?.content || '';

        // Text nodes: call real text API (Kimi)
        if (node.type === 'textInput') {
          const textArgs = {
            prompt: prompt || 'Hello',
            model: data?.model, // Y0b-1（Z30）：删 'seed-model-kimi' 字面量兜底——缺模型走 MODEL_NOT_SELECTED 显式 4xx
            apiUrl: '',
          };
          // Y0b-1（E1）：claim 固化 pricing 快照——四轮 P1-6：! 断言=TypeError 500，显式 4xx 暴露节点集分叉
          const plan = planMap.get(node.id);
          if (!plan) throw new BusinessException('PLAN_MISSING', `节点 ${node.id} 无定价快照（validation/execution 节点集分叉？）`, HttpStatus.BAD_REQUEST);
          const cost = plan.creditCost; // plan 固化快照——reserve 前零额外解析
          const { intent, created } = await this.claimForNode(projectId, node, userId, intentId, 'text', textArgs, plan, project.teamId, jobId);
          if (!created) {
            // SUCCEEDED 幂等重放——零外呼零扣费，回放既有产物引用（幂等组②）
            this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'done', fileId: intent.resultRef ?? undefined });
            continue;
          }
          claimed = intent;
          await this.collabDoc.writeExecStatus(projectId, node.id, { status: 'loading', jobId: jobId ?? null, intentId: intent.intentId }).catch(() => {}); // best-effort

          if (cost > 0) {
            const reserveResult = await this.teamCredit.reserve(userId, { intentRowId: intent.id });
            if (reserveResult.mayCall === false) {
              // Z35：alreadyReserved=他人在飞（stall 重排）——静默退出零副作用（不 void_/不 fail/不写 exec/不 emit）
              intentDuplicateAttemptTotal.inc();
              this.logger.warn(`[reserve] 意图 ${intent.intentId} 重复外呼企图——静默退出（悬挂收敛归 reconcile）`);
              return { success: false, errors: [] };
            }
            if (!reserveResult.success) {
              await this.onReserveFail(projectId, node, intent, `扣费失败：${reserveResult.reason ?? 'RESERVE_FAILED'}`);
              return { success: false, errors: [`节点 ${node.id}: 扣费失败：${reserveResult.reason ?? 'RESERVE_FAILED'}`] };
            }
          }

          const textResult = await this.apiCaller.callTextGen(textArgs);
          results.push({ nodeId: node.id, type: 'text', content: textResult.content });

          if (cost > 0) {
            const settled = await this.teamCredit.settle({ intentRowId: intent.id });
            if (settled.success) totalDeducted += cost; // P8：已消费才计入——emit 的 totalCost=实扣真值（冻结≠消费）
            else { settleFailureTotal.inc(); this.logger.warn(`[reserve-settle] 意图 ${intent.intentId} settle 失败（对账第四分支兜底——产物照发）`); }
          }

          // F13 产物门序：complete count===1（意图仍有效）才写 doc。text 无 Media/URL 锚点——
          // resultRef = 'text:'+产物摘要（观测用占位；产物完整性由 writeNodeData 落地本身保证）
          const gated = await this.intentService.complete(intent.id, `text:${String(textResult.content).slice(0, 100)}`);
          if (gated !== 1) {
            this.logger.warn(`[intent-reconcile] 意图 ${intent.intentId} 已被 VOIDED——跳过产物写入（外呼产物留作物证）`);
            continue;
          }

          // 看到产物 ⇒ 已扣费（F4：text/video 曾先写产物后扣费=免费产品洞）
          await this.collabDoc.writeNodeData(projectId, node.id, {
            content: data.content || prompt,
            result: textResult.content,
          });
          await this.collabDoc.writeExecStatus(projectId, node.id, { status: 'done', jobId: jobId ?? null, intentId: intent.intentId });

          const bal = await this.teamCredit.getBalanceView(project.teamId, userId);
          this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'done', credits: this.balancePayload(bal) });
          continue;
        }

        // Video nodes
        if (node.type === 'videoGen') {
          const vData = data as any;
          const vStyleText = styleTextOf(vData);
          const vFinalPrompt = [prompt, vStyleText].filter(Boolean).join(', ');
          const videoArgs = {
            prompt: vFinalPrompt,
            model: vData?.model,
            mode: vData?.mode || 'text-to-video',
            imageUrl: upstream.imageUrl || vData?.startImageUrl,
            startImageUrl: vData?.startImageUrl,
            endImageUrl: vData?.endImageUrl,
            imageUrls: vData?.imageUrls,
            ratio: vData?.ratio,
            quality: vData?.quality,
            duration: vData?.duration,
            audio: vData?.audio,
          };
          // Y0b-1（E1）：video duration 维的定价快照已在 validation plans（预检=实扣同键）
          const plan = planMap.get(node.id);
          if (!plan) throw new BusinessException('PLAN_MISSING', `节点 ${node.id} 无定价快照（validation/execution 节点集分叉？）`, HttpStatus.BAD_REQUEST);
          const vCost = plan.creditCost; // plan 固化快照——reserve 前零额外解析
          const { intent, created } = await this.claimForNode(projectId, node, userId, intentId, 'video', videoArgs, plan, project.teamId, jobId);
          if (!created) {
            this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'done', fileId: intent.resultRef ?? undefined });
            continue;
          }
          claimed = intent;
          await this.collabDoc.writeExecStatus(projectId, node.id, { status: 'loading', jobId: jobId ?? null, intentId: intent.intentId }).catch(() => {}); // best-effort

          if (vCost > 0) {
            const vReserve = await this.teamCredit.reserve(userId, { intentRowId: intent.id });
            if (vReserve.mayCall === false) {
              // Z35：alreadyReserved=他人在飞（stall 重排）——静默退出零副作用（不 void_/不 fail/不写 exec/不 emit）
              intentDuplicateAttemptTotal.inc();
              this.logger.warn(`[reserve] 意图 ${intent.intentId} 重复外呼企图——静默退出（悬挂收敛归 reconcile）`);
              return { success: false, errors: [] };
            }
            if (!vReserve.success) {
              await this.onReserveFail(projectId, node, intent, `扣费失败：${vReserve.reason ?? 'RESERVE_FAILED'}`);
              return { success: false, errors: [`节点 ${node.id}: 扣费失败：${vReserve.reason ?? 'RESERVE_FAILED'}`] };
            }
          }

          const result = await this.apiCaller.callVideoGen(videoArgs);

          if (vCost > 0) {
            const vSettled = await this.teamCredit.settle({ intentRowId: intent.id });
            if (vSettled.success) totalDeducted += vCost; // P8：已消费才计入——emit 的 totalCost=实扣真值（冻结≠消费）
            else { settleFailureTotal.inc(); this.logger.warn(`[reserve-settle] 意图 ${intent.intentId} settle 失败（对账第四分支兜底——产物照发）`); }
          }

          // F13 产物门序——video 产物锚点 = videoUrl（writeNodeData 所写产物字段值）
          const gated = await this.intentService.complete(intent.id, result.url);
          if (gated !== 1) {
            this.logger.warn(`[intent-reconcile] 意图 ${intent.intentId} 已被 VOIDED——跳过产物写入（外呼产物留作物证）`);
            continue;
          }

          // 看到产物 ⇒ 已扣费（F4：text/video 曾先写产物后扣费=免费产品洞）
          await this.collabDoc.writeNodeData(projectId, node.id, { videoUrl: result.url });
          await this.collabDoc.writeExecStatus(projectId, node.id, { status: 'done', jobId: jobId ?? null, intentId: intent.intentId, fileId: result.url });

          const newBalance = await this.teamCredit.getBalanceView(project.teamId, userId);

          // Enqueue AI result download for MinIO storage
          if (result.url) {
            await this.downloadQueue.add('ai-result-download', {
              userId,
              projectId,
              nodeId: node.id,
              taskId: `task-${Date.now()}`,
              resultUrl: result.url,
              mimeType: 'video/mp4',
            });
            this.logger.log(`Enqueued AI result download for node ${node.id}`);
          }

          this.gateway.emitNodeStatus(projectId, {
            nodeId: node.id, status: 'done', credits: this.balancePayload(newBalance),
          });
          results.push({ nodeId: node.id, type: 'video', resultUrl: result.url });
          continue;
        }

        const imageUrl = upstream.imageUrl;

        // Call Image API
        const iStyleText = styleTextOf(data);
        const iFinalPrompt = [prompt, iStyleText].filter(Boolean).join(', '); // 分隔符对齐 combinePrompt（api-caller.service.ts:86）
        const imageArgs = {
          prompt: iFinalPrompt,
          extraPrompt: data?.extraPrompt,
          style: data?.style,
          model: data?.model,
          resolution: data?.resolution,
          imageUrl,
        };
        // Y0b-1（E1）：image resolution 维的定价快照已在 validation plans（label→行 id 归一化在预检完成）
        const plan = planMap.get(node.id);
        if (!plan) throw new BusinessException('PLAN_MISSING', `节点 ${node.id} 无定价快照（validation/execution 节点集分叉？）`, HttpStatus.BAD_REQUEST);
        const cost = plan.creditCost; // plan 固化快照——reserve 前零额外解析
        const { intent, created } = await this.claimForNode(projectId, node, userId, intentId, 'image', imageArgs, plan, project.teamId, jobId);
        if (!created) {
          this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'done', fileId: intent.resultRef ?? undefined });
          continue;
        }
        claimed = intent;
        await this.collabDoc.writeExecStatus(projectId, node.id, { status: 'loading', jobId: jobId ?? null, intentId: intent.intentId }).catch(() => {}); // best-effort

        if (cost > 0) {
          const reserveResult = await this.teamCredit.reserve(userId, { intentRowId: intent.id });
          if (reserveResult.mayCall === false) {
            // Z35：alreadyReserved=他人在飞（stall 重排）——静默退出零副作用（不 void_/不 fail/不写 exec/不 emit）
            intentDuplicateAttemptTotal.inc();
            this.logger.warn(`[reserve] 意图 ${intent.intentId} 重复外呼企图——静默退出（悬挂收敛归 reconcile）`);
            return { success: false, errors: [] };
          }
          if (!reserveResult.success) {
            await this.onReserveFail(projectId, node, intent, `扣费失败：${reserveResult.reason ?? 'RESERVE_FAILED'}`);
            return { success: false, errors: [`节点 ${node.id}: 扣费失败：${reserveResult.reason ?? 'RESERVE_FAILED'}`] };
          }
        }

        const result = await this.apiCaller.callImageGen(imageArgs);

        results.push({ nodeId: node.id, type: 'image', resultUrl: result.url });

        if (cost > 0) {
          const settled = await this.teamCredit.settle({ intentRowId: intent.id });
          if (settled.success) totalDeducted += cost; // P8：已消费才计入——emit 的 totalCost=实扣真值（冻结≠消费）
          else { settleFailureTotal.inc(); this.logger.warn(`[reserve-settle] 意图 ${intent.intentId} settle 失败（对账第四分支兜底——产物照发）`); }
        }

        // F13 产物门序——image 产物锚点 = resultUrl（media.create 在 ai-result-download 侧异步落地，
        // 本服务以 writeNodeData 所写 URL 为锚；Media 行落地后由下载侧补强）
        const gated = await this.intentService.complete(intent.id, result.url);
        if (gated !== 1) {
          this.logger.warn(`[intent-reconcile] 意图 ${intent.intentId} 已被 VOIDED——跳过产物写入（外呼产物留作物证）`);
          continue;
        }

        await this.collabDoc.writeNodeData(projectId, node.id, { resultUrl: result.url });
        await this.collabDoc.writeExecStatus(projectId, node.id, { status: 'done', jobId: jobId ?? null, intentId: intent.intentId, fileId: result.url });

        const newBalance = await this.teamCredit.getBalanceView(project.teamId, userId);

        // Enqueue AI result download for MinIO storage
        if (result.url) {
          await this.downloadQueue.add('ai-result-download', {
            userId,
            projectId,
            nodeId: node.id,
            taskId: `task-${Date.now()}`,
            resultUrl: result.url,
            mimeType: 'image/png',
          });
          this.logger.log(`Enqueued AI result download for node ${node.id}`);
        }

        this.gateway.emitNodeStatus(projectId, {
          nodeId: node.id, status: 'done', credits: this.balancePayload(newBalance),
        });

      } catch (err: any) {
        // 409 族（NODE_BUSY/INTENT_*）冒泡透出（errorCode 经 BusinessException getResponse）——
        // claim 未获执行权：不 fail 他人在飞行、不写 exec map（防覆盖在飞执行的 loading）
        if (err instanceof BusinessException) throw err;
        // F13：意图终态必达——外呼/扣费抛错置 FAILED（SIGKILL 场景 process catch 不执行，由 processor failed 钩子兜底）
        // 批0.5-9：失败先 void_ 解冻（约束②——冻结退还），再置 FAILED（重试 rearm 后照常重新 reserve）
        if (claimed) {
          await this.teamCredit.void_({ intentRowId: claimed.id })
            .catch((e) => this.logger.warn(`[reserve-settle] 意图 ${claimed.intentId} void_ 解冻失败（reconcile 超龄兜底）: ${e}`));
          await this.intentService.fail(claimed.id, String(err));
        }
        this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'error', error: err.message });
        await this.collabDoc.writeExecStatus(projectId, node.id, {
          status: 'error', error: String(err?.message ?? err).slice(0, 200),
          ...(claimed ? { intentId: claimed.intentId } : {}),
        }).catch(() => {}); // error 展示不受门序限（无产物即无资损方向）——doc 写失败不吞原始错误
        return { success: false, errors: [`节点 ${node.id}: ${err.message}`] };
      }
    }

    // 6. Complete
    this.gateway.emitExecutionComplete(projectId, { totalCost: totalDeducted });
    return { success: true, errors: [], results };
  }
}
