import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TopologyService } from './topology.service';
import { ValidationService } from './validation.service';
import { ApiCallerService } from './api-caller.service';
import { CreditService } from '../credit/credit.service';
import { ExecutionGateway } from '../gateway/execution.gateway';

@Injectable()
export class ExecutionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TopologyService) private readonly topology: TopologyService,
    @Inject(ValidationService) private readonly validation: ValidationService,
    @Inject(ApiCallerService) private readonly apiCaller: ApiCallerService,
    @Inject(CreditService) private readonly credit: CreditService,
    @Inject(ExecutionGateway) private readonly gateway: ExecutionGateway,
  ) {}

  async execute(projectId: string, nodeId: string | undefined, userId: string) {
    // 1. Load project
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: projectId },
      include: { nodes: true, edges: true },
    });
    if (!project) return { success: false, errors: ['项目不存在'] };

    const allNodes = project.nodes as any[];
    const allEdges = project.edges as any[];

    // 2. Determine scope
    const scopeNodes = nodeId
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
        // Collect upstream data
        const upstream = this.topology.collectUpstreamData(node.id, scopeNodes, allEdges);
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

          await this.prisma.canvasNode.update({
            where: { id: node.id },
            data: { data: { ...data, content: data.content || prompt, result: textResult.content } },
          });

          const rule = await this.prisma.pricingRule.findFirst({
            where: { modelId: data?.model || 'seed-model-kimi', resolutionId: null, durationId: null, active: true },
          });
          const cost = rule?.creditCost ?? 0;
          if (cost > 0) {
            const deductResult = await this.credit.deduct(userId, cost);
            if (!deductResult.success) {
              this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'error', error: '扣费失败' });
              return { success: false, errors: [`节点 ${node.id}: 扣费失败`] };
            }
            totalDeducted += cost;
          }

          const bal = await this.credit.getBalance(userId);
          this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'done', credits: bal?.credits });
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

        // Deduct credits (optimistic lock)
        if (cost > 0) {
          const deductResult = await this.credit.deduct(userId, cost);
          if (!deductResult.success) {
            this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'error', error: '扣费失败，请重试' });
            return { success: false, errors: [`节点 ${node.id}: 扣费失败`] };
          }
          totalDeducted += cost;
        }

        // Save result to node
        await this.prisma.canvasNode.update({
          where: { id: node.id },
          data: { data: { ...data, resultUrl: result.url } },
        });

        const newBalance = await this.credit.getBalance(userId);
        this.gateway.emitNodeStatus(projectId, {
          nodeId: node.id, status: 'done', resultUrl: result.url, credits: newBalance?.credits,
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
