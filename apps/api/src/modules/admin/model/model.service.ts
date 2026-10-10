import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ready } from '../../execution/provider-adapters';
import { BusinessException } from '../../../common/exceptions/business.exception';

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
    providerLabel?: string;
    apiModelName?: string;
    apiUrl: string;
    apiKey?: string;
    sortOrder?: number;
    recommended?: boolean;
    resolutions?: { label: string; width: number; height: number }[];
    durations?: { label: string; seconds: number }[];
  }) {
    const { resolutions, durations, ...modelData } = dto;
    // Y0b-2（Z117①）ready 写边界：create 落 active 默认 true——active∧!ready（无 adapter/无名/无钥）
    // 的"可售"行禁写（启动断言只是快照，运行期 admin 造此行 ⇒ 用户可选外呼 Bearer undefined 401）
    if (!ready({ active: true, provider: modelData.provider, apiModelName: modelData.apiModelName ?? null, apiKey: modelData.apiKey ?? null })) {
      throw new BusinessException('MODEL_NOT_READY', '新建启用模型须齐 provider adapter（moonshot/tencent/dashscope）+apiModelName+apiKey（缺一即 MODEL_NOT_READY）');
    }
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

  async update(id: string, data: { name?: string; provider?: string; providerLabel?: string; apiModelName?: string; apiUrl?: string; apiKey?: string; sortOrder?: number; recommended?: boolean }) {
    // Y0b-2（Z117①）ready 写边界：写后 active 行必须仍 ready（清空 apiKey/改 provider 丢 adapter 均拦）
    const current = await this.prisma.aIModel.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Model not found');
    const merged = {
      active: current.active,
      provider: data.provider ?? current.provider,
      apiModelName: data.apiModelName !== undefined ? data.apiModelName : current.apiModelName,
      apiKey: data.apiKey !== undefined ? data.apiKey : current.apiKey,
    };
    if (merged.active && !ready(merged)) {
      throw new BusinessException('MODEL_NOT_READY', '更新会使启用模型失去外呼就绪（provider/apiModelName/apiKey 不全）——先补齐或先下线');
    }
    return this.prisma.aIModel.update({ where: { id }, data });
  }

  async toggle(id: string) {
    const model = await this.prisma.aIModel.findUnique({ where: { id } });
    if (!model) throw new NotFoundException('Model not found');
    // Y0b-2（Z117①）：上线（active→true）校验 would-be ready（行现态 active=false——谓词按目标态算）；
    // 下线恒放行
    if (!model.active && !ready({ ...model, active: true })) {
      throw new BusinessException('MODEL_NOT_READY', '上线前须齐 provider adapter+apiModelName+apiKey（MODEL_NOT_READY）');
    }
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
