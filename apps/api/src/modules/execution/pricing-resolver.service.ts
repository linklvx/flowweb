// apps/api/src/modules/execution/pricing-resolver.service.ts —— Y0b-1（E48/E49/Z5/Z20）：定价唯一解析器
// 冻结契约 1/3：任何直接 findFirst PricingRule / MODEL_CONFIG 判存在性 / 编译期常量定扣费额的新代码=违规。
// fail-closed：无 active 规则/未知模型/键缺失 ⇒ 业务错误（零外呼零冻结）；creditCost:0 行=唯一合法免费。
// Z5 终裁：全四键精确匹配、无解析阶梯；modelId IS NULL = kind 级规则（编辑 4 kind/multiImageGen）。
import { Inject, Injectable, HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';

export interface ResolvedPricing {
  pricingRuleId: string;
  nodeTypeId: string;
  modelId: string | null;
  resolutionId: string | null;
  durationId: string | null;
  creditCost: number;
}

@Injectable()
export class PricingResolverService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 主链：modelId 必给——nodeTypeId 自 AIModel 行派生（单值确定，消除 NodeType 键猜测）。
   *  Z21：键缺失先于 Prisma 校验（undefined 进 findUnique=PrismaClientValidationError 500）。 */
  async resolve(input: { modelId: string; resolutionId?: string | null; durationId?: string | null }): Promise<ResolvedPricing> {
    if (!input.modelId) {
      throw new BusinessException('PROVIDER_UNKNOWN_MODEL', '模型键缺失（节点未配置模型——kind 级规则走 resolveByNodeTypeKey）', HttpStatus.BAD_REQUEST);
    }
    const model = await this.prisma.aIModel.findUnique({ where: { id: input.modelId } });
    if (!model || !model.active) {
      throw new BusinessException('PROVIDER_UNKNOWN_MODEL', `模型不存在或已停用: ${input.modelId}`, HttpStatus.BAD_REQUEST);
    }
    return this.resolveExact(model.nodeTypeId, model.id, input.resolutionId ?? null, input.durationId ?? null);
  }

  /** kind 级路径（Z5）：NodeType by key → (nodeTypeId, modelId IS NULL, null, null) 精确匹配。
   *  无"唯一 active 模型"断言、无假模型行——多模型分叉对本路径无影响。 */
  async resolveByNodeTypeKey(nodeTypeKey: string): Promise<ResolvedPricing> {
    const nt = await this.prisma.nodeType.findUnique({ where: { key: nodeTypeKey } });
    if (!nt) throw new BusinessException('PRICING_RULE_MISSING', `节点类型未登记: ${nodeTypeKey}`, HttpStatus.BAD_REQUEST);
    return this.resolveExact(nt.id, null, null, null);
  }

  private async resolveExact(nodeTypeId: string, modelId: string | null, resolutionId: string | null, durationId: string | null): Promise<ResolvedPricing> {
    const rules = await this.prisma.pricingRule.findMany({
      where: { nodeTypeId, modelId, resolutionId, durationId, active: true },
    });
    if (rules.length > 1) throw new Error(`pricing-resolver: 同键命中 ${rules.length} 行——pricing_rule_natural_key 索引疑似缺失`);
    const rule = rules[0];
    if (!rule) {
      throw new BusinessException('PRICING_RULE_MISSING',
        `无有效定价规则（nodeType=${nodeTypeId} model=${modelId} res=${resolutionId} dur=${durationId}）`, HttpStatus.BAD_REQUEST);
    }
    return { pricingRuleId: rule.id, nodeTypeId, modelId, resolutionId, durationId, creditCost: rule.creditCost };
  }
}
