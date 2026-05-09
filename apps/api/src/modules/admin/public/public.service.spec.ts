import { Test, TestingModule } from '@nestjs/testing';
import { PublicService } from './public.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('PublicService', () => {
  let service: PublicService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      nodeType: { findUnique: vi.fn() },
      pricingRule: { findFirst: vi.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [PublicService, { provide: PrismaService, useValue: prisma }],
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
    prisma.pricingRule.findFirst.mockResolvedValue({ creditCost: 5 });
    const result = await service.calculatePrice('m1');
    expect(result).toBe(5);
  });

  it('should calculate price with modelId + resolutionId', async () => {
    prisma.pricingRule.findFirst.mockResolvedValue({ creditCost: 8 });
    const result = await service.calculatePrice('m1', 'r1');
    expect(result).toBe(8);
  });

  it('should return 0 when no rule matches', async () => {
    prisma.pricingRule.findFirst.mockResolvedValue(null);
    const result = await service.calculatePrice('m1');
    expect(result).toBe(0);
  });
});
