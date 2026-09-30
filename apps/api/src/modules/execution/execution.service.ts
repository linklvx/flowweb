import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
import { GenerationIntentService } from './generation-intent.service';
import { normalizeIntentParams } from './normalize-intent-params';
import { BusinessException } from '../../common/exceptions/business.exception';

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
   *  组执行 intentId 派生（裁定）：每节点独立 UUID——意图生命周期（attempts/reconcile/退款）按节点独立，
   *  不做 ${intentId}:${nodeId} 派生；入参 intentId 仅落首个执行节点（单节点执行即目标节点），其余派新 UUID。 */
  private claimForNode(
    projectId: string, node: any, userId: string, intentId: string | undefined,
    kind: string, params: Record<string, unknown>, jobId?: string,
  ) {
    return this.intentService.claim({
      projectId, nodeId: node.id, userId, intentId: intentId ?? randomUUID(), kind,
      paramsHash: normalizeIntentParams(kind, params), jobId,
    });
  }

  /** 批0.5-9 reserve 失败三连：意图置 VOIDED（零扣费终态——重试照常扣费，与 FAILED 分义不混：
   *  FAILED=外呼失败且冻结已退；VOIDED=从未扣费）+ WS error + exec map error（best-effort）。 */
  private async onReserveFail(projectId: string, node: any, intent: any, msg: string) {
    await this.intentService.void_(intent.id, msg);
    this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'error', error: msg });
    await this.collabDoc.writeExecStatus(projectId, node.id, { status: 'error', error: msg }).catch(() => {});
  }

  async execute(projectId: string, nodeId: string | undefined, userId: string, nodeIds?: string[], sv?: Uint8Array, intentId?: string, jobId?: string) {
    // 0c-6：权限守卫最先——非成员不可用"项目不存在"响应区分不存在 vs 无权（存在性 oracle）
    await this.perm.assertEditor(projectId, userId);

    // 1. Load project
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: projectId },
    });
    if (!project) return { success: false, errors: ['项目不存在'] };

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
    let execIdx = 0; // 组执行 intentId 派生用：入参 intentId 仅落首个执行节点（claimForNode 注释裁定）
    for (const node of orderedNodes) {
      if (!isExecutableNode(node) && !(nodeId === node.id && String(node.id).startsWith('shadow-'))) continue; // 防剪辑/产物节点闪 loading 与误执行；__ephemeral 影子全局排除出白名单，但单 nodeId 直调（regenerate 唯一合法入口，影子 id 以 shadow- 开头）放行——nodeIds 批量模式 nodeId 为 undefined 不会误放行
      const isFirstExec = execIdx === 0;
      execIdx++;
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
            model: data?.model || 'seed-model-kimi',
            apiUrl: '',
          };
          const { intent, created } = await this.claimForNode(projectId, node, userId, isFirstExec ? intentId : undefined, 'text', textArgs, jobId);
          if (!created) {
            // SUCCEEDED 幂等重放——零外呼零扣费，回放既有产物引用（幂等组②）
            this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'done', fileId: intent.resultRef ?? undefined });
            continue;
          }
          claimed = intent;
          await this.collabDoc.writeExecStatus(projectId, node.id, { status: 'loading', jobId: jobId ?? null, intentId: intent.intentId }).catch(() => {}); // best-effort

          // 批0.5-9 两阶段扣费：reserve 外呼之前（余额不足即拒=零外呼）→ 外呼 → settle 核销
          const rule = await this.prisma.pricingRule.findFirst({
            where: { modelId: data?.model || 'seed-model-kimi', resolutionId: null, durationId: null, active: true },
          });
          const cost = rule?.creditCost ?? 0;
          if (cost > 0) {
            const reserveResult = await this.teamCredit.reserve(project.teamId, userId, cost, { intentRowId: intent.id, intentId: intent.intentId });
            if (!reserveResult.success) {
              await this.onReserveFail(projectId, node, intent, `扣费失败：${reserveResult.reason ?? 'RESERVE_FAILED'}`);
              return { success: false, errors: [`节点 ${node.id}: 扣费失败：${reserveResult.reason ?? 'RESERVE_FAILED'}`] };
            }
          }

          const textResult = await this.apiCaller.callTextGen(textArgs);
          results.push({ nodeId: node.id, type: 'text', content: textResult.content });

          if (cost > 0) {
            const settled = await this.teamCredit.settle({ intentRowId: intent.id, intentId: intent.intentId });
            if (!settled.success) this.logger.warn(`[reserve-settle] 意图 ${intent.intentId} settle 未达（冻结由 reconcile 兜底）`);
            totalDeducted += cost;
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
          const { intent, created } = await this.claimForNode(projectId, node, userId, isFirstExec ? intentId : undefined, 'video', videoArgs, jobId);
          if (!created) {
            this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'done', fileId: intent.resultRef ?? undefined });
            continue;
          }
          claimed = intent;
          await this.collabDoc.writeExecStatus(projectId, node.id, { status: 'loading', jobId: jobId ?? null, intentId: intent.intentId }).catch(() => {}); // best-effort

          // 批0.5-9 两阶段扣费：reserve 外呼之前（余额不足即拒=零外呼）
          const vRule = await this.prisma.pricingRule.findFirst({
            where: { modelId: vData?.model, resolutionId: null, durationId: null, active: true },
          });
          const vCost = vRule?.creditCost ?? 0;
          if (vCost > 0) {
            const vReserve = await this.teamCredit.reserve(project.teamId, userId, vCost, { intentRowId: intent.id, intentId: intent.intentId });
            if (!vReserve.success) {
              await this.onReserveFail(projectId, node, intent, `扣费失败：${vReserve.reason ?? 'RESERVE_FAILED'}`);
              return { success: false, errors: [`节点 ${node.id}: 扣费失败：${vReserve.reason ?? 'RESERVE_FAILED'}`] };
            }
          }

          const result = await this.apiCaller.callVideoGen(videoArgs);

          if (vCost > 0) {
            const vSettled = await this.teamCredit.settle({ intentRowId: intent.id, intentId: intent.intentId });
            if (!vSettled.success) this.logger.warn(`[reserve-settle] 意图 ${intent.intentId} settle 未达（冻结由 reconcile 兜底）`);
            totalDeducted += vCost;
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
        const { intent, created } = await this.claimForNode(projectId, node, userId, isFirstExec ? intentId : undefined, 'image', imageArgs, jobId);
        if (!created) {
          this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'done', fileId: intent.resultRef ?? undefined });
          continue;
        }
        claimed = intent;
        await this.collabDoc.writeExecStatus(projectId, node.id, { status: 'loading', jobId: jobId ?? null, intentId: intent.intentId }).catch(() => {}); // best-effort

        // Get cost from pricing rule——批0.5-9 两阶段扣费：reserve 外呼之前（余额不足即拒=零外呼）
        const rule = await this.prisma.pricingRule.findFirst({
          where: {
            modelId: data?.model,
            resolutionId: data?.resolution || null,
            active: true,
          },
        });
        const cost = rule?.creditCost ?? 0;

        if (cost > 0) {
          const reserveResult = await this.teamCredit.reserve(project.teamId, userId, cost, { intentRowId: intent.id, intentId: intent.intentId });
          if (!reserveResult.success) {
            await this.onReserveFail(projectId, node, intent, `扣费失败：${reserveResult.reason ?? 'RESERVE_FAILED'}`);
            return { success: false, errors: [`节点 ${node.id}: 扣费失败：${reserveResult.reason ?? 'RESERVE_FAILED'}`] };
          }
        }

        const result = await this.apiCaller.callImageGen(imageArgs);

        results.push({ nodeId: node.id, type: 'image', resultUrl: result.url });

        if (cost > 0) {
          const settled = await this.teamCredit.settle({ intentRowId: intent.id, intentId: intent.intentId });
          if (!settled.success) this.logger.warn(`[reserve-settle] 意图 ${intent.intentId} settle 未达（冻结由 reconcile 兜底）`);
          totalDeducted += cost;
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
          await this.teamCredit.void_({ intentRowId: claimed.id, intentId: claimed.intentId })
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
