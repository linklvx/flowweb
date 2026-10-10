import { Test, TestingModule } from '@nestjs/testing';
import { ValidationService } from './validation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingResolverService } from './pricing-resolver.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ValidationService', () => {
  let service: ValidationService;
  let prisma: any;
  let resolver: any;

  beforeEach(async () => {
    prisma = {
      teamBalance: { findUnique: vi.fn() },
      modelResolution: { findMany: vi.fn().mockResolvedValue([]) },
      modelDuration: { findMany: vi.fn().mockResolvedValue([]) },
      // Y0b-2（Z101）：executable 预检读模型行——默认给可售行（active+tencent+apiModelName）
      aIModel: { findUnique: vi.fn().mockResolvedValue({ id: 'm1', active: true, provider: 'tencent', apiModelName: 'hy' }) },
    };
    // Y0b-1：定价单源 resolver stub——validation 不再直接查 pricingRule（E48/Z28）
    resolver = {
      resolve: vi.fn(),
      resolveByNodeTypeKey: vi.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidationService,
        { provide: PrismaService, useValue: prisma },
        { provide: PricingResolverService, useValue: resolver },
      ],
    }).compile();
    service = module.get<ValidationService>(ValidationService);
  });

  it('should pass when all checks succeed', async () => {
    resolver.resolve.mockResolvedValue({ creditCost: 5 });
    prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-team', credits: 100, subscriptionCredits: 0 });

    const nodes = [{ id: 'n1', type: 'imageGen', data: { model: 'm1' } }];
    const result = await service.validateAll(nodes as any, 't-team', 'u1');
    expect(result.valid).toBe(true);
    expect(result.totalCost).toBe(5);
  });

  it('余额校验读项目团队 TeamBalance，口径 credits+subscriptionCredits', async () => {
    resolver.resolve.mockResolvedValue({ creditCost: 5 });
    prisma.teamBalance.findUnique.mockResolvedValue({ credits: 5, subscriptionCredits: 10 });
    const result = await service.validateAll(
      [{ id: 'n1', type: 'imageGen', data: { model: 'm1' } }], 't-team', 'u1',
    );
    expect(prisma.teamBalance.findUnique).toHaveBeenCalledWith({ where: { teamId: 't-team' } });
    expect(result.valid).toBe(true); // totalCost 5 在 15 内
  });

  it('总额不足时 invalid 且错误消息含双池合计', async () => {
    resolver.resolve.mockResolvedValue({ creditCost: 5 });
    prisma.teamBalance.findUnique.mockResolvedValue({ credits: 1, subscriptionCredits: 2 });
    const result = await service.validateAll(
      [{ id: 'n1', type: 'imageGen', data: { model: 'm1' } }], 't-team', 'u1',
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('当前 3 积分');
  });

  it('textInput 不再跳过（Y0b-1 E48：totalCost 曾系统性少算 text）——经同链 resolver 计价', async () => {
    resolver.resolve.mockResolvedValue({ creditCost: 2 });
    prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-team', credits: 100, subscriptionCredits: 0 });
    const nodes = [{ id: 'n1', type: 'textInput', data: { content: 'hello', model: 'm-text' } }];
    const result = await service.validateAll(nodes as any, 't-team', 'u1');
    expect(result.valid).toBe(true);
    expect(result.totalCost).toBe(2);
    expect(resolver.resolve).toHaveBeenCalledWith({ modelId: 'm-text', resolutionId: null, durationId: null });
  });

  it('主链节点缺模型 ⇒ MODEL_NOT_SELECTED 进 errors（Y0b-1 Z21：空值显式 4xx 非静默跳过）', async () => {
    prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-team', credits: 100, subscriptionCredits: 0 });
    const nodes = [{ id: 'n1', type: 'imageGen', data: {} }];
    const result = await service.validateAll(nodes as any, 't-team', 'u1');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('n1');
    expect(result.errors[0]).toContain('模型');
  });

  it('无有效定价规则 ⇒ resolver 抛错转 errors 数组（旧 findFirst null→errors 语义保留，查询改单源）', async () => {
    resolver.resolve.mockRejectedValue(new Error('无有效定价规则（nodeType=nt1 model=m1 res=null dur=null）'));
    const nodes = [{ id: 'n1', type: 'imageGen', data: { model: 'm1' } }];
    const result = await service.validateAll(nodes as any, 't-team', 'u1');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('定价规则');
  });

  it('Y0b-2（Z101）selectable 预检：引用停用模型 ⇒ MODEL_NOT_AVAILABLE 且不触达 resolver（claim 前零冻结零 attempts）', async () => {
    prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-team', credits: 100, subscriptionCredits: 0 });
    // gpt4 形态：active=false（或 provider 无 adapter/apiModelName 缺）
    prisma.aIModel.findUnique.mockResolvedValue({ id: 'm-gpt4', active: false, provider: 'openai', apiModelName: null, apiKey: null });
    const nodes = [{ id: 'n1', type: 'textInput', data: { model: 'm-gpt4', content: 'x' } }];
    const result = await service.validateAll(nodes as any, 't-team', 'u1');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('MODEL_NOT_AVAILABLE');
    expect(result.errors[0]).toContain('n1');
    expect(resolver.resolve).not.toHaveBeenCalled(); // 不可售模型不进定价解析——错误面单义
    expect(result.plans).toHaveLength(0);
  });

  it('Y0b-2（Z101）provider 无 adapter 的 active 行（sdxl 形态）同判 MODEL_NOT_AVAILABLE', async () => {
    prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-team', credits: 100, subscriptionCredits: 0 });
    prisma.aIModel.findUnique.mockResolvedValue({ id: 'm-sdxl', active: true, provider: 'stability', apiModelName: 'sdxl-3', apiKey: null });
    const result = await service.validateAll([{ id: 'n2', type: 'imageGen', data: { model: 'm-sdxl' } }] as any, 't-team', 'u1');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('MODEL_NOT_AVAILABLE');
  });

  it('kind 级节点（erase）不在 EXECUTABLE_TYPES 白名单——validateAll 跳过（计费走 ai-image-edit processor 的 resolver）', async () => {
    prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-team', credits: 100, subscriptionCredits: 0 });
    const nodes = [{ id: 'n1', type: 'erase', data: {} }];
    const result = await service.validateAll(nodes as any, 't-team', 'u1');
    expect(result.valid).toBe(true);
    expect(result.totalCost).toBe(0);
    expect(resolver.resolveByNodeTypeKey).not.toHaveBeenCalled();
  });

  it('should fail when balance insufficient', async () => {
    resolver.resolve.mockResolvedValue({ creditCost: 10 });
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
