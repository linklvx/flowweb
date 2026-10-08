import { Test, TestingModule } from '@nestjs/testing';
import { PricingService } from './pricing.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { PricingResolverService } from '../../execution/pricing-resolver.service';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { HttpStatus } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('PricingService', () => {
  let service: PricingService;
  let prisma: any;
  let resolver: any;

  beforeEach(async () => {
    prisma = {
      pricingRule: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      },
      modelResolution: { findMany: vi.fn().mockResolvedValue([]) },
      modelDuration: { findMany: vi.fn().mockResolvedValue([]) },
    };
    // Y0b-1：calculatePrice 经 resolver 单源（E48）——服务不再直接查 pricingRule
    resolver = {
      resolve: vi.fn(),
      resolveByNodeTypeKey: vi.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PricingService,
        { provide: PrismaService, useValue: prisma },
        { provide: PricingResolverService, useValue: resolver },
      ],
    }).compile();
    service = module.get<PricingService>(PricingService);
  });

  it('should find rules with nodeTypeId and modelId filters', async () => {
    await service.findAll({ nodeTypeId: 'nt1', modelId: 'm1' });
    expect(prisma.pricingRule.findMany).toHaveBeenCalledWith({
      where: { nodeTypeId: 'nt1', modelId: 'm1', active: undefined },
      include: { model: true, resolution: true, duration: true },
      orderBy: { creditCost: 'asc' },
    });
  });

  it('should create a pricing rule', async () => {
    prisma.pricingRule.create.mockResolvedValue({ id: 'r1', creditCost: 5 });
    const result = await service.create({ nodeTypeId: 'nt1', modelId: 'm1', resolutionId: 'r1', creditCost: 5 });
    expect(result.creditCost).toBe(5);
  });

  it('should update a pricing rule', async () => {
    prisma.pricingRule.update.mockResolvedValue({ id: 'r1', creditCost: 10 });
    const result = await service.update('r1', { creditCost: 10 });
    expect(result.creditCost).toBe(10);
  });

  it('should delete a pricing rule', async () => {
    prisma.pricingRule.findUnique.mockResolvedValue({ id: 'r1', nodeTypeId: 'nt1', modelId: 'm1' });
    prisma.modelResolution.findMany.mockResolvedValue([{ id: 'res1' }]);
    prisma.modelDuration.findMany.mockResolvedValue([]);
    // res1 档有其他 active 规则——删除放行
    prisma.pricingRule.count.mockResolvedValue(1);
    prisma.pricingRule.delete.mockResolvedValue({ id: 'r1' });
    await service.delete('r1');
    expect(prisma.pricingRule.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
  });

  it('should calculate price via resolver (text node — no resolution/duration)', async () => {
    resolver.resolve.mockResolvedValue({ pricingRuleId: 'r1', creditCost: 3 });
    const result = await service.calculatePrice({ modelId: 'm1' });
    expect(result).toBe(3);
    expect(resolver.resolve).toHaveBeenCalledWith({ modelId: 'm1', resolutionId: null, durationId: null });
    expect(prisma.pricingRule.findFirst).not.toHaveBeenCalled();
  });

  it('should calculate price with resolution via resolver', async () => {
    resolver.resolve.mockResolvedValue({ pricingRuleId: 'r1', creditCost: 10 });
    const result = await service.calculatePrice({ modelId: 'm1', resolutionId: 'r1' });
    expect(result).toBe(10);
    expect(resolver.resolve).toHaveBeenCalledWith({ modelId: 'm1', resolutionId: 'r1', durationId: null });
  });

  it('should fail closed when no rule matches（?? 0 免费旁路消灭）', async () => {
    resolver.resolve.mockRejectedValue(new BusinessException('PRICING_RULE_MISSING', '无有效定价规则', HttpStatus.BAD_REQUEST));
    await expect(service.calculatePrice({ modelId: 'm1' })).rejects.toMatchObject({ errorCode: 'PRICING_RULE_MISSING' });
  });

  it('batchCreate：无同键规则 → findFirst 判重后 create（可空列 null 化显式比对——F8）', async () => {
    prisma.pricingRule.findFirst.mockResolvedValue(null);
    prisma.pricingRule.create.mockResolvedValue({ id: 'r1', creditCost: 8 });
    const rules = [{ nodeTypeId: 'nt1', modelId: 'm1', resolutionId: 'r1', creditCost: 8 }];
    const result = await service.batchCreate(rules);
    expect(result).toHaveLength(1);
    expect(prisma.pricingRule.findFirst).toHaveBeenCalledWith({
      where: { nodeTypeId: 'nt1', modelId: 'm1', resolutionId: 'r1', durationId: null },
    });
    expect(prisma.pricingRule.create).toHaveBeenCalledWith({
      data: { nodeTypeId: 'nt1', modelId: 'm1', resolutionId: 'r1', durationId: null, creditCost: 8 },
    });
  });

  it('batchCreate：同键规则已在 → 按 id update creditCost + active:true 重激活（Y0b-1 完整形态）', async () => {
    prisma.pricingRule.findFirst.mockResolvedValue({ id: 'r0', creditCost: 5 });
    prisma.pricingRule.update.mockResolvedValue({ id: 'r0', creditCost: 8 });
    const rules = [{ nodeTypeId: 'nt1', modelId: 'm1', resolutionId: 'r1', creditCost: 8 }];
    const result = await service.batchCreate(rules);
    expect(result).toHaveLength(1);
    expect(prisma.pricingRule.update).toHaveBeenCalledWith({ where: { id: 'r0' }, data: { creditCost: 8, active: true } });
    expect(prisma.pricingRule.create).not.toHaveBeenCalled();
  });

  describe('写侧守卫（四轮 Z37 覆盖级——禁用/删除不得使声明维度组合失守）', () => {
    it('updateRule 置 active:false 且该档无其他 active 规则 ⇒ 409 PRICING_LAST_ACTIVE_RULE', async () => {
      prisma.pricingRule.findUnique.mockResolvedValue({
        id: 'r1', nodeTypeId: 'nt1', modelId: 'm1', resolutionId: null, durationId: null,
      });
      prisma.modelResolution.findMany.mockResolvedValue([]);
      prisma.modelDuration.findMany.mockResolvedValue([]);
      prisma.pricingRule.count.mockResolvedValue(0);   // 排除自身后无 active
      const ex = await service.update('r1', { active: false }).catch((e) => e);
      expect(ex).toBeInstanceOf(BusinessException);
      expect(ex.errorCode).toBe('PRICING_LAST_ACTIVE_RULE');
      expect(ex.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(prisma.pricingRule.update).not.toHaveBeenCalled();
    });

    it('updateRule 置 active:false 但同档有其他 active 规则 ⇒ 放行', async () => {
      prisma.pricingRule.findUnique.mockResolvedValue({
        id: 'r1', nodeTypeId: 'nt1', modelId: 'm1', resolutionId: null, durationId: null,
      });
      prisma.modelResolution.findMany.mockResolvedValue([]);
      prisma.modelDuration.findMany.mockResolvedValue([]);
      prisma.pricingRule.count.mockResolvedValue(2);
      prisma.pricingRule.update.mockResolvedValue({ id: 'r1', active: false });
      await service.update('r1', { active: false });
      expect(prisma.pricingRule.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { active: false } });
    });

    it('声明分辨率档失守 ⇒ 409（有 res 行 ⇒ 每行 (model,res,null) 需 active 规则）', async () => {
      prisma.pricingRule.findUnique.mockResolvedValue({
        id: 'r1', nodeTypeId: 'nt1', modelId: 'm1', resolutionId: 'res1', durationId: null,
      });
      prisma.modelResolution.findMany.mockResolvedValue([{ id: 'res1' }, { id: 'res2' }]);
      prisma.modelDuration.findMany.mockResolvedValue([]);
      // res1 档有其他 active、res2 档无——失守
      prisma.pricingRule.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
      const ex = await service.delete('r1').catch((e) => e);
      expect(ex).toBeInstanceOf(BusinessException);
      expect(ex.errorCode).toBe('PRICING_LAST_ACTIVE_RULE');
      expect(ex.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(prisma.pricingRule.delete).not.toHaveBeenCalled();
    });

    it('kind 级规则（modelId IS NULL）不得清零 ⇒ 409', async () => {
      prisma.pricingRule.findUnique.mockResolvedValue({
        id: 'rk', nodeTypeId: 'nt-kind', modelId: null, resolutionId: null, durationId: null,
      });
      prisma.pricingRule.count.mockResolvedValue(0);
      await expect(service.delete('rk')).rejects.toMatchObject({ errorCode: 'PRICING_LAST_ACTIVE_RULE' });
    });

    it('kind 级规则有其他 active 同类 ⇒ 放行', async () => {
      prisma.pricingRule.findUnique.mockResolvedValue({
        id: 'rk', nodeTypeId: 'nt-kind', modelId: null, resolutionId: null, durationId: null,
      });
      prisma.pricingRule.count.mockResolvedValue(3);
      prisma.pricingRule.delete.mockResolvedValue({ id: 'rk' });
      await service.delete('rk');
      expect(prisma.pricingRule.delete).toHaveBeenCalledWith({ where: { id: 'rk' } });
    });
  });
});
