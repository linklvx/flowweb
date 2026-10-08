import { Test, TestingModule } from '@nestjs/testing';
import { PublicService } from './public.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { PricingResolverService } from '../../execution/pricing-resolver.service';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { NotFoundException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('PublicService', () => {
  let service: PublicService;
  let prisma: any;
  let resolver: any;

  beforeEach(async () => {
    prisma = {
      nodeType: { findUnique: vi.fn() },
      modelResolution: { findMany: vi.fn().mockResolvedValue([]) },
      modelDuration: { findMany: vi.fn().mockResolvedValue([]) },
    };
    // Y0b-1：报价=实扣同源——calculatePrice 经 normalizeDimensions+resolver（第十处改道）
    resolver = {
      resolve: vi.fn(),
      resolveByNodeTypeKey: vi.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublicService,
        { provide: PrismaService, useValue: prisma },
        { provide: PricingResolverService, useValue: resolver },
      ],
    }).compile();
    service = module.get<PublicService>(PublicService);
  });

  it('should get models by node type key with active filter and sort', async () => {
    prisma.nodeType.findUnique.mockResolvedValue({
      id: 'nt1',
      models: [
        {
          id: 'm1',
          name: 'SD XL',
          provider: 'Stability',
          active: true,
          recommended: true,
          sortOrder: 1,
          resolutions: [{ id: 'r1', label: '1024×1024', width: 1024, height: 1024 }],
          durations: [],
        },
      ],
    });
    const result = await service.getModelsByNodeKey('image');
    expect(result).toHaveLength(1);
    expect(result[0].resolutions).toHaveLength(1);
    expect(prisma.nodeType.findUnique).toHaveBeenCalledWith({
      where: { key: 'image' },
      include: {
        models: {
          where: { active: true },
          include: { resolutions: true, durations: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
  });

  it('should throw NotFoundException for unknown node type key', async () => {
    prisma.nodeType.findUnique.mockResolvedValue(null);
    await expect(service.getModelsByNodeKey('unknown')).rejects.toThrow(NotFoundException);
  });

  it('should calculate price with modelId only', async () => {
    resolver.resolve.mockResolvedValue({ pricingRuleId: 'r1', creditCost: 5 });
    const result = await service.calculatePrice('m1');
    expect(result).toBe(5);
    expect(resolver.resolve).toHaveBeenCalledWith({ modelId: 'm1', resolutionId: null, durationId: null });
  });

  it('should calculate price with modelId + resolutionId（模型声明该行——id 可解析直通）', async () => {
    prisma.modelResolution.findMany.mockResolvedValue([{ id: 'r1', label: '2048×2048' }]);
    resolver.resolve.mockResolvedValue({ pricingRuleId: 'r1', creditCost: 8 });
    const result = await service.calculatePrice('m1', 'r1');
    expect(result).toBe(8);
    expect(resolver.resolve).toHaveBeenCalledWith({ modelId: 'm1', resolutionId: 'r1', durationId: null });
  });

  it('无规则 ⇒ PRICING_RULE_MISSING 业务错误（?? 0 免费旁路消灭——报价 fail-closed）', async () => {
    resolver.resolve.mockRejectedValue(new BusinessException('PRICING_RULE_MISSING', '无有效定价规则'));
    await expect(service.calculatePrice('m1')).rejects.toMatchObject({ errorCode: 'PRICING_RULE_MISSING' });
  });

  it('label 归一化：分辨率 label 经 normalizeDimensions 归到行 id（Y0b-1 三轮 P3 报价同源）', async () => {
    prisma.modelResolution.findMany.mockResolvedValue([{ id: 'res-2048', label: '2048×2048' }]);
    resolver.resolve.mockResolvedValue({ pricingRuleId: 'r1', creditCost: 6 });
    const result = await service.calculatePrice('m1', '2048×2048');
    expect(result).toBe(6);
    expect(resolver.resolve).toHaveBeenCalledWith({ modelId: 'm1', resolutionId: 'res-2048', durationId: null });
  });
});
