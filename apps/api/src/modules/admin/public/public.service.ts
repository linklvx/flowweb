import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { normalizeDimensions } from '../../execution/pricing-input.util';
import { PricingResolverService } from '../../execution/pricing-resolver.service';

@Injectable()
export class PublicService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PricingResolverService) private readonly resolver: PricingResolverService,
  ) {}

  async getModelsByNodeKey(key: string) {
    const nodeType = await this.prisma.nodeType.findUnique({
      where: { key },
      include: {
        models: {
          where: { active: true },
          include: { resolutions: true, durations: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    if (!nodeType) throw new NotFoundException(`Node type '${key}' not found`);
    return nodeType.models;
  }

  async calculatePrice(modelId: string, resolutionId?: string, durationId?: string | number): Promise<number> {
    // Y0b-1（三轮 P3）：报价=实扣同源——同 normalizeDimensions 归一化（label/id 双收）+同 resolver。
    // 无规则抛 PRICING_RULE_MISSING（4xx）——web 侧禁 .catch(0)（那是 ?? 0 的客户端镜像），改显示"定价不可用"
    const { resolutionId: resId, durationId: durId } = await normalizeDimensions(this.prisma, modelId, resolutionId, durationId);
    const r = await this.resolver.resolve({ modelId, resolutionId: resId, durationId: durId });
    return r.creditCost;
  }
}
