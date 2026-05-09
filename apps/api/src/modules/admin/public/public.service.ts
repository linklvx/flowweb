import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class PublicService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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

  async calculatePrice(modelId: string, resolutionId?: string, durationId?: string): Promise<number> {
    const rule = await this.prisma.pricingRule.findFirst({
      where: {
        modelId,
        resolutionId: resolutionId || null,
        durationId: durationId || null,
        active: true,
      },
    });
    return rule?.creditCost ?? 0;
  }
}
