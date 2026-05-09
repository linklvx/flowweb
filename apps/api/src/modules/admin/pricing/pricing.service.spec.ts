import { Test, TestingModule } from '@nestjs/testing';
import { PricingService } from './pricing.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('PricingService', () => {
  let service: PricingService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      pricingRule: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        upsert: vi.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [PricingService, { provide: PrismaService, useValue: prisma }],
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
    prisma.pricingRule.delete.mockResolvedValue({ id: 'r1' });
    await service.delete('r1');
    expect(prisma.pricingRule.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
  });

  it('should calculate price for a model (text node — no resolution/duration)', async () => {
    prisma.pricingRule.findFirst.mockResolvedValue({ id: 'r1', creditCost: 3 });
    const result = await service.calculatePrice({ modelId: 'm1' });
    expect(result).toBe(3);
    expect(prisma.pricingRule.findFirst).toHaveBeenCalledWith({
      where: { modelId: 'm1', resolutionId: null, durationId: null, active: true },
    });
  });

  it('should calculate price with resolution', async () => {
    prisma.pricingRule.findFirst.mockResolvedValue({ id: 'r1', creditCost: 10 });
    const result = await service.calculatePrice({ modelId: 'm1', resolutionId: 'r1' });
    expect(result).toBe(10);
  });

  it('should return 0 if no rule matches', async () => {
    prisma.pricingRule.findFirst.mockResolvedValue(null);
    const result = await service.calculatePrice({ modelId: 'm1' });
    expect(result).toBe(0);
  });

  it('should batch upsert pricing rules', async () => {
    prisma.pricingRule.upsert.mockResolvedValue({ id: 'r1', creditCost: 8 });
    const rules = [{ nodeTypeId: 'nt1', modelId: 'm1', resolutionId: 'r1', creditCost: 8 }];
    const result = await service.batchCreate(rules);
    expect(result).toHaveLength(1);
    expect(prisma.pricingRule.upsert).toHaveBeenCalled();
  });
});
