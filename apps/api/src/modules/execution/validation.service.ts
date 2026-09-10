import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { availableCredits } from '../team/team.util';
import { isExecutableNode } from './is-executable-node';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  totalCost: number;
}

@Injectable()
export class ValidationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async validateAll(nodes: any[], teamId: string, userId: string): Promise<ValidationResult> {
    const errors: string[] = [];
    let totalCost = 0;

    // Collect model IDs from non-text nodes
    const modelIds = [...new Set(
      nodes.filter(n => isExecutableNode(n) && n.type !== 'textInput')
        .map(n => n.data?.model)
        .filter(Boolean)
    )];

    // Batch check all models
    const models = modelIds.length > 0
      ? await this.prisma.aIModel.findMany({ where: { id: { in: modelIds } } })
      : [];
    const modelMap = new Map(models.map(m => [m.id, m]));

    for (const node of nodes) {
      if (!isExecutableNode(node)) continue;
      if (node.type === 'textInput') continue;
      const data = node.data as any;

      // Check model exists and active
      const model = data.model ? modelMap.get(data.model) : null;
      if (!model || !model.active) {
        errors.push(`节点 ${node.id}: 模型不存在或已下线`);
        continue;
      }

      // Check pricing rule
      const rule = await this.prisma.pricingRule.findFirst({
        where: {
          modelId: data.model,
          resolutionId: data.resolution || null,
          active: true,
        },
      });

      if (!rule) {
        errors.push(`节点 ${node.id}: 无有效定价规则`);
        continue;
      }

      totalCost += rule.creditCost;
    }

    if (errors.length > 0) return { valid: false, errors, totalCost: 0 };

    // 校验口径与 teamCredit.consume 一致：credits + subscriptionCredits（quota 以 consume 为准，不预校验）
    const balance = await this.prisma.teamBalance.findUnique({ where: { teamId } });
    const available = availableCredits(balance ?? { credits: 0, subscriptionCredits: 0 });
    if (available < totalCost) {
      return {
        valid: false,
        errors: [`余额不足: 需要 ${totalCost} 积分，当前 ${available} 积分`],
        totalCost,
      };
    }

    return { valid: true, errors: [], totalCost };
  }
}
