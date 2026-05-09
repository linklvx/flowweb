import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class ModelService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findByNodeType(nodeTypeId: string) {
    return this.prisma.aIModel.findMany({
      where: { nodeTypeId },
      include: { resolutions: true, durations: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findById(id: string) {
    const model = await this.prisma.aIModel.findUnique({
      where: { id },
      include: { resolutions: true, durations: true },
    });
    if (!model) throw new NotFoundException('Model not found');
    return model;
  }

  async create(dto: {
    nodeTypeId: string;
    name: string;
    provider: string;
    apiUrl: string;
    apiKey?: string;
    sortOrder?: number;
    recommended?: boolean;
    resolutions?: { label: string; width: number; height: number }[];
    durations?: { label: string; seconds: number }[];
  }) {
    const { resolutions, durations, ...modelData } = dto;
    const model = await this.prisma.aIModel.create({ data: modelData });
    if (resolutions?.length) {
      for (const r of resolutions) {
        await this.prisma.modelResolution.create({ data: { ...r, modelId: model.id } });
      }
    }
    if (durations?.length) {
      for (const d of durations) {
        await this.prisma.modelDuration.create({ data: { ...d, modelId: model.id } });
      }
    }
    return this.findById(model.id);
  }

  async update(id: string, data: { name?: string; provider?: string; apiUrl?: string; sortOrder?: number; recommended?: boolean }) {
    return this.prisma.aIModel.update({ where: { id }, data });
  }

  async toggle(id: string) {
    const model = await this.prisma.aIModel.findUnique({ where: { id } });
    if (!model) throw new NotFoundException('Model not found');
    return this.prisma.aIModel.update({ where: { id }, data: { active: !model.active } });
  }

  async delete(id: string) {
    return this.prisma.aIModel.delete({ where: { id } });
  }

  async addResolution(modelId: string, data: { label: string; width: number; height: number }) {
    return this.prisma.modelResolution.create({ data: { ...data, modelId } });
  }

  async removeResolution(id: string) {
    return this.prisma.modelResolution.delete({ where: { id } });
  }

  async addDuration(modelId: string, data: { label: string; seconds: number }) {
    return this.prisma.modelDuration.create({ data: { ...data, modelId } });
  }

  async removeDuration(id: string) {
    return this.prisma.modelDuration.delete({ where: { id } });
  }
}
