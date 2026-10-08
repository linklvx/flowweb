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
      // Y0b-1 假唯一删：四键无唯一索引（PG unique 对 NULL 不去重——原 upsert 本就判不了重），
      // 判重走显式查询：同键在则按 id 更新，否则创建。
      const existing = await this.prisma.pricingRule.findFirst({
        where: {
          nodeTypeId: rule.nodeTypeId, modelId: rule.modelId,
          resolutionId: rule.resolutionId ?? null, durationId: rule.durationId ?? null,
        },
      });
      const r = existing
        ? await this.prisma.pricingRule.update({ where: { id: existing.id }, data: { creditCost: rule.creditCost } })
        : await this.prisma.pricingRule.create({
            data: {
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
