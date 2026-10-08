import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { availableCredits } from '../team/team.util';
import { isExecutableNode } from './is-executable-node';
import { resolvePricingKey } from './pricing-input.util';
import { PricingResolverService } from './pricing-resolver.service';

/** Y0b-1（E1）：逐节点定价快照——execute 的 claim 消费（预估=plan 同源，TOCTOU 消除）。
 *  五字段即 ClaimPricing 形状（pricing-resolver ResolvedPricing 的投影）。 */
export interface NodePlan {
  nodeId: string;
  pricingRuleId: string;
  modelId: string | null;
  resolutionId: string | null;
  durationId: string | null;
  creditCost: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  totalCost: number;
  /** Y0b-1（E1）：节点解析成功即累计——余额不足档 plans 仍完整（用户恰恰这时最需要看构成）；
   *  仅节点解析错误档为部分集（解析失败的节点无 plan——execute 侧 PLAN_MISSING 显式 4xx 兜底）。 */
  plans: NodePlan[];
}

@Injectable()
export class ValidationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PricingResolverService) private readonly resolver: PricingResolverService,
  ) {}

  async validateAll(nodes: any[], teamId: string, userId: string): Promise<ValidationResult> {
    const errors: string[] = [];
    let totalCost = 0;
    const plans: NodePlan[] = [];

    for (const node of nodes) {
      if (!isExecutableNode(node)) continue;
      // Y0b-1（E48/E49/Z20/Z21/Z28）：textInput 不再跳过（totalCost 曾系统性少算 text）；
      // 全四键单源 resolvePricingKey（label→id 归一化禁回退；video duration 维预检=实扣同键——
      // 旧实现两形状分叉：预检随机命中 10/18/25、实扣 ?? 0=免费）
      try {
        const key = await resolvePricingKey(this.prisma, node);
        const r = key.modelId
          ? await this.resolver.resolve({ modelId: key.modelId, resolutionId: key.resolutionId, durationId: key.durationId })
          : await this.resolver.resolveByNodeTypeKey(key.pricingKey!);
        totalCost += r.creditCost;
        plans.push({
          nodeId: node.id, pricingRuleId: r.pricingRuleId, modelId: r.modelId,
          resolutionId: r.resolutionId, durationId: r.durationId, creditCost: r.creditCost,
        });
      } catch (e: any) {
        errors.push(`节点 ${node.id}: ${e.message}`);
      }
    }

    if (errors.length > 0) return { valid: false, errors, totalCost: 0, plans };

    // 校验口径与 teamCredit.consume 一致：credits + subscriptionCredits（quota 以 consume 为准，不预校验）
    const balance = await this.prisma.teamBalance.findUnique({ where: { teamId } });
    const available = availableCredits(balance ?? { credits: 0, subscriptionCredits: 0 });
    if (available < totalCost) {
      return {
        valid: false,
        errors: [`余额不足: 需要 ${totalCost} 积分，当前 ${available} 积分`],
        totalCost,
        plans, // 余额不足档 plans 照常累计非 []（三轮 M2——构成可见性）
      };
    }

    return { valid: true, errors: [], totalCost, plans };
  }
}
