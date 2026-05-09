import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

interface CreateRuleDto {
  nodeTypeId: string; modelId: string;
  resolutionId?: string; durationId?: string;
  creditCost: number;
}

interface CalculateDto {
  modelId: string; resolutionId?: string; durationId?: string;
}

@Injectable()
export class PricingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findAll(filters: { nodeTypeId?: string; modelId?: string; active?: boolean }) {
    return this.prisma.pricingRule.findMany({
      where: {
        nodeTypeId: filters.nodeTypeId,
        modelId: filters.modelId,
        active: filters.active,
      },
      include: { model: true, resolution: true, duration: true },
      orderBy: { creditCost: 'asc' },
    });
  }

  async create(dto: CreateRuleDto) {
    return this.prisma.pricingRule.create({ data: dto as any });
  }

  async update(id: string, data: { creditCost?: number; active?: boolean }) {
    return this.prisma.pricingRule.update({ where: { id }, data });
  }

  async delete(id: string) {
    return this.prisma.pricingRule.delete({ where: { id } });
  }

  async batchCreate(rules: CreateRuleDto[]) {
    const results = [];
    for (const rule of rules) {
      const r = await this.prisma.pricingRule.upsert({
        where: {
          nodeTypeId_modelId_resolutionId_durationId: {
            nodeTypeId: rule.nodeTypeId, modelId: rule.modelId,
            resolutionId: rule.resolutionId ?? null,
            durationId: rule.durationId ?? null,
          },
        },
        update: { creditCost: rule.creditCost },
        create: {
          nodeTypeId: rule.nodeTypeId, modelId: rule.modelId,
          resolutionId: rule.resolutionId, durationId: rule.durationId,
          creditCost: rule.creditCost,
        },
      });
      results.push(r);
    }
    return results;
  }

  async calculatePrice(dto: CalculateDto): Promise<number> {
    const rule = await this.prisma.pricingRule.findFirst({
      where: {
        modelId: dto.modelId,
        resolutionId: dto.resolutionId ?? null,
        durationId: dto.durationId ?? null,
        active: true,
      },
    });
    return rule?.creditCost ?? 0;
  }
}
