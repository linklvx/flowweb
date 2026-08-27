import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TopologyService } from './topology.service';
import { ValidationService } from './validation.service';
import { ApiCallerService } from './api-caller.service';
import { TeamCreditService } from '../team/team-credit.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CollabDocumentService } from '../collab/collab-document.service';

@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TopologyService) private readonly topology: TopologyService,
    @Inject(ValidationService) private readonly validation: ValidationService,
    @Inject(ApiCallerService) private readonly apiCaller: ApiCallerService,
    @Inject(TeamCreditService) private readonly teamCredit: TeamCreditService,
    @Inject(CollabDocumentService) private readonly collabDoc: CollabDocumentService,
    @Inject(ExecutionGateway) private readonly gateway: ExecutionGateway,
    @InjectQueue('ai-result-download') private readonly downloadQueue: Queue,
  ) {}

  async execute(projectId: string, nodeId: string | undefined, userId: string, nodeIds?: string[]) {
    // 1. Load project
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: projectId },
    });
    if (!project) return { success: false, errors: ['项目不存在'] };

    const canvas = await this.collabDoc.readCanvas(projectId);
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
    const validationResult = await this.validation.validateAll(orderedNodes, userId);
    if (!validationResult.valid) {
      return { success: false, errors: validationResult.errors };
    }

    // 5. Execute sequentially
    let totalDeducted = 0;
    const results: any[] = [];
    for (const node of orderedNodes) {
      this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'loading' });

      try {
        // Collect upstream data (use full node list when nodeIds mode to allow reading from outside group)
        const upstreamSource = nodeIds ? allNodes : scopeNodes;
        const upstream = this.topology.collectUpstreamData(node.id, upstreamSource, allEdges);
        const data = node.data as any;
        const prompt = upstream.textContents.join(' ') || data?.content || '';

        // Text nodes: call real text API (Kimi)
        if (node.type === 'textInput') {
          const textResult = await this.apiCaller.callTextGen({
            prompt: prompt || 'Hello',
            model: data?.model || 'seed-model-kimi',
            apiUrl: '',
          });
          results.push({ nodeId: node.id, type: 'text', content: textResult.content });

          await this.collabDoc.writeNodeData(projectId, node.id, {
            content: data.content || prompt,
            result: textResult.content,
          });

          const rule = await this.prisma.pricingRule.findFirst({
            where: { modelId: data?.model || 'seed-model-kimi', resolutionId: null, durationId: null, active: true },
          });
          const cost = rule?.creditCost ?? 0;
          if (cost > 0) {
            const deductResult = await this.teamCredit.consume(project.teamId, userId, cost, `node:${node.id}`);
            if (!deductResult.success) {
              this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'error', error: '扣费失败' });
              return { success: false, errors: [`节点 ${node.id}: 扣费失败`] };
            }
            totalDeducted += cost;
          }

          const bal = await this.teamCredit.getBalanceView(project.teamId, userId);
          this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'done', credits: bal?.total });
          continue;
        }

        // Video nodes
        if (node.type === 'videoGen') {
          const vData = data as any;
          const result = await this.apiCaller.callVideoGen({
            prompt: prompt || vData?.prompt || '',
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
          });

          await this.collabDoc.writeNodeData(projectId, node.id, { videoUrl: result.url });

          // 视频成功后补扣（Task11：对齐惯例）
          const vRule = await this.prisma.pricingRule.findFirst({
            where: { modelId: vData?.model, resolutionId: null, durationId: null, active: true },
          });
          const vCost = vRule?.creditCost ?? 0;
          if (vCost > 0) {
            const vDeduct = await this.teamCredit.consume(project.teamId, userId, vCost, `node:${node.id}`);
            if (!vDeduct.success) {
              this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'error', error: '扣费失败' });
              return { success: false, errors: [`节点 ${node.id}: 扣费失败`] };
            }
            totalDeducted += vCost;
          }

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
            nodeId: node.id, status: 'done', credits: newBalance?.credits,
          });
          results.push({ nodeId: node.id, type: 'video', resultUrl: result.url });
          continue;
        }

        const imageUrl = upstream.imageUrl;

        // Call Image API
        const result = await this.apiCaller.callImageGen({
          prompt,
          extraPrompt: data?.extraPrompt,
          style: data?.style,
          model: data?.model,
          resolution: data?.resolution,
          imageUrl,
        });

        results.push({ nodeId: node.id, type: 'image', resultUrl: result.url });

        // Get cost from pricing rule
        const rule = await this.prisma.pricingRule.findFirst({
          where: {
            modelId: data?.model,
            resolutionId: data?.resolution || null,
            active: true,
          },
        });
        const cost = rule?.creditCost ?? 0;

        // Deduct credits (team pool)
        if (cost > 0) {
          const deductResult = await this.teamCredit.consume(project.teamId, userId, cost, `node:${node.id}`);
          if (!deductResult.success) {
            this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'error', error: '扣费失败，请重试' });
            return { success: false, errors: [`节点 ${node.id}: 扣费失败`] };
          }
          totalDeducted += cost;
        }

        await this.collabDoc.writeNodeData(projectId, node.id, { resultUrl: result.url });

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
          nodeId: node.id, status: 'done', credits: newBalance?.credits,
        });

      } catch (err: any) {
        this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'error', error: err.message });
        return { success: false, errors: [`节点 ${node.id}: ${err.message}`] };
      }
    }

    // 6. Complete
    this.gateway.emitExecutionComplete(projectId, { totalCost: totalDeducted });
    return { success: true, errors: [], results };
  }
}
