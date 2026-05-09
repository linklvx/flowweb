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
      userBalance: { findUnique: vi.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ValidationService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<ValidationService>(ValidationService);
  });

  it('should pass when all checks succeed', async () => {
    prisma.aIModel.findMany.mockResolvedValue([{ id: 'm1', active: true }]);
    prisma.pricingRule.findFirst.mockResolvedValue({ creditCost: 5 });
    prisma.userBalance.findUnique.mockResolvedValue({ userId: 'u1', credits: 100 });

    const nodes = [{ id: 'n1', type: 'imageGen', data: { model: 'm1' } }];
    const result = await service.validateAll(nodes as any, 'u1');
    expect(result.valid).toBe(true);
    expect(result.totalCost).toBe(5);
  });

  it('should skip textInput nodes (no model needed)', async () => {
    prisma.userBalance.findUnique.mockResolvedValue({ userId: 'u1', credits: 100 });
    const nodes = [{ id: 'n1', type: 'textInput', data: { content: 'hello' } }];
    const result = await service.validateAll(nodes as any, 'u1');
    expect(result.valid).toBe(true);
    expect(result.totalCost).toBe(0);
  });

  it('should fail when model not found or inactive', async () => {
    prisma.aIModel.findMany.mockResolvedValue([]);
    const nodes = [{ id: 'n1', type: 'imageGen', data: { model: 'm1' } }];
    const result = await service.validateAll(nodes as any, 'u1');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('模型');
  });

  it('should fail when pricing rule not found', async () => {
    prisma.aIModel.findMany.mockResolvedValue([{ id: 'm1', active: true }]);
    prisma.pricingRule.findFirst.mockResolvedValue(null);
    const nodes = [{ id: 'n1', type: 'imageGen', data: { model: 'm1' } }];
    const result = await service.validateAll(nodes as any, 'u1');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('定价规则');
  });

  it('should fail when balance insufficient', async () => {
    prisma.aIModel.findMany.mockResolvedValue([{ id: 'm1', active: true }]);
    prisma.pricingRule.findFirst.mockResolvedValue({ creditCost: 10 });
    prisma.userBalance.findUnique.mockResolvedValue({ userId: 'u1', credits: 5 });

    const nodes = [
      { id: 'n1', type: 'imageGen', data: { model: 'm1' } },
      { id: 'n2', type: 'imageGen', data: { model: 'm1' } },
    ];
    const result = await service.validateAll(nodes as any, 'u1');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('余额');
  });
});
