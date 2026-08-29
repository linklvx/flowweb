import { Test, TestingModule } from '@nestjs/testing';
import { ValidationService } from './validation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ValidationService', () => {
  let service: ValidationService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      aIModel: { findMany: vi.fn() },
      pricingRule: { findFirst: vi.fn() },
      teamBalance: { findUnique: vi.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ValidationService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<ValidationService>(ValidationService);
  });

  it('should pass when all checks succeed', async () => {
    prisma.aIModel.findMany.mockResolvedValue([{ id: 'm1', active: true }]);
    prisma.pricingRule.findFirst.mockResolvedValue({ creditCost: 5 });
    prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-team', credits: 100, subscriptionCredits: 0 });

    const nodes = [{ id: 'n1', type: 'imageGen', data: { model: 'm1' } }];
    const result = await service.validateAll(nodes as any, 't-team', 'u1');
    expect(result.valid).toBe(true);
    expect(result.totalCost).toBe(5);
  });

  it('余额校验读项目团队 TeamBalance，口径 credits+subscriptionCredits', async () => {
    prisma.aIModel.findMany.mockResolvedValue([{ id: 'm1', active: true }]);
    prisma.pricingRule.findFirst.mockResolvedValue({ creditCost: 5 });
    prisma.teamBalance.findUnique.mockResolvedValue({ credits: 5, subscriptionCredits: 10 });
    const result = await service.validateAll(
      [{ id: 'n1', type: 'imageGen', data: { model: 'm1' } }], 't-team', 'u1',
    );
    expect(prisma.teamBalance.findUnique).toHaveBeenCalledWith({ where: { teamId: 't-team' } });
    expect(result.valid).toBe(true); // totalCost 5 在 15 内
  });

  it('总额不足时 invalid 且错误消息含双池合计', async () => {
    prisma.aIModel.findMany.mockResolvedValue([{ id: 'm1', active: true }]);
    prisma.pricingRule.findFirst.mockResolvedValue({ creditCost: 5 });
    prisma.teamBalance.findUnique.mockResolvedValue({ credits: 1, subscriptionCredits: 2 });
    const result = await service.validateAll(
      [{ id: 'n1', type: 'imageGen', data: { model: 'm1' } }], 't-team', 'u1',
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('当前 3 积分');
  });

  it('should skip textInput nodes (no model needed)', async () => {
    prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-team', credits: 100, subscriptionCredits: 0 });
    const nodes = [{ id: 'n1', type: 'textInput', data: { content: 'hello' } }];
    const result = await service.validateAll(nodes as any, 't-team', 'u1');
    expect(result.valid).toBe(true);
    expect(result.totalCost).toBe(0);
  });

  it('should fail when model not found or inactive', async () => {
    prisma.aIModel.findMany.mockResolvedValue([]);
    const nodes = [{ id: 'n1', type: 'imageGen', data: { model: 'm1' } }];
    const result = await service.validateAll(nodes as any, 't-team', 'u1');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('模型');
  });

  it('should fail when pricing rule not found', async () => {
    prisma.aIModel.findMany.mockResolvedValue([{ id: 'm1', active: true }]);
    prisma.pricingRule.findFirst.mockResolvedValue(null);
    const nodes = [{ id: 'n1', type: 'imageGen', data: { model: 'm1' } }];
    const result = await service.validateAll(nodes as any, 't-team', 'u1');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('定价规则');
  });

  it('should fail when balance insufficient', async () => {
    prisma.aIModel.findMany.mockResolvedValue([{ id: 'm1', active: true }]);
    prisma.pricingRule.findFirst.mockResolvedValue({ creditCost: 10 });
    prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-team', credits: 5, subscriptionCredits: 0 });

    const nodes = [
      { id: 'n1', type: 'imageGen', data: { model: 'm1' } },
      { id: 'n2', type: 'imageGen', data: { model: 'm1' } },
    ];
    const result = await service.validateAll(nodes as any, 't-team', 'u1');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('余额');
  });
});
