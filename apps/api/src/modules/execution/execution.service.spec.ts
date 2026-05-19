import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionService } from './execution.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TopologyService } from './topology.service';
import { ValidationService } from './validation.service';
import { ApiCallerService } from './api-caller.service';
import { CreditService } from '../credit/credit.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ExecutionService', () => {
  let service: ExecutionService;
  let prisma: any;
  let topology: any;
  let validation: any;
  let apiCaller: any;
  let credit: any;
  let gateway: any;
  let mockDownloadQueue: any;

  beforeEach(async () => {
    prisma = {
      canvasProject: { findUnique: vi.fn() },
      canvasNode: { update: vi.fn() },
      pricingRule: { findFirst: vi.fn() },
    };
    topology = {
      getScope: vi.fn().mockReturnValue([
        { id: 'n1', type: 'textInput', data: { content: 'hello' } },
        { id: 'n2', type: 'imageGen', data: { model: 'm1', resolution: 'r1' } },
      ]),
      sort: vi.fn().mockReturnValue([
        { id: 'n1', type: 'textInput', data: { content: 'hello' } },
        { id: 'n2', type: 'imageGen', data: { model: 'm1', resolution: 'r1' } },
      ]),
      collectUpstreamData: vi.fn().mockReturnValue({ textContents: ['hello'], imageUrl: undefined }),
    };
    validation = { validateAll: vi.fn().mockResolvedValue({ valid: true, errors: [], totalCost: 5 }) };
    apiCaller = {
      callImageGen: vi.fn().mockResolvedValue({ url: '/mock/test.jpg', width: 1024, height: 1024 }),
      callTextGen: vi.fn().mockResolvedValue({ content: 'hello' }),
      callVideoGen: vi.fn().mockResolvedValue({ url: '/mock/video.mp4' }),
    };
    credit = {
      deduct: vi.fn().mockResolvedValue({ success: true, newBalance: 95 }),
      getBalance: vi.fn().mockResolvedValue({ credits: 95 }),
    };
    gateway = { emitNodeStatus: vi.fn(), emitExecutionComplete: vi.fn() };
    mockDownloadQueue = {
      add: vi.fn().mockResolvedValue({ id: 'download-job-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutionService,
        { provide: PrismaService, useValue: prisma },
        { provide: TopologyService, useValue: topology },
        { provide: ValidationService, useValue: validation },
        { provide: ApiCallerService, useValue: apiCaller },
        { provide: CreditService, useValue: credit },
        { provide: ExecutionGateway, useValue: gateway },
        { provide: 'BullQueue_ai-result-download', useValue: mockDownloadQueue },
      ],
    }).compile();
    service = module.get<ExecutionService>(ExecutionService);
  });

  it('should execute single node successfully', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({
      id: 'p1', nodes: [], edges: [], viewport: {},
    });
    prisma.pricingRule.findFirst.mockResolvedValue({ creditCost: 5 });

    const result = await service.execute('p1', 'n2', 'default-user');
    expect(result.success).toBe(true);
    expect(gateway.emitNodeStatus).toHaveBeenCalled();
    expect(credit.deduct).toHaveBeenCalledWith('default-user', 5);
  });

  it('should return error when validation fails', async () => {
    validation.validateAll.mockResolvedValue({ valid: false, errors: ['余额不足'], totalCost: 0 });
    prisma.canvasProject.findUnique.mockResolvedValue({
      id: 'p1', nodes: [], edges: [], viewport: {},
    });

    const result = await service.execute('p1', undefined, 'default-user');
    expect(result.success).toBe(false);
    expect(result.errors).toContain('余额不足');
    expect(apiCaller.callImageGen).not.toHaveBeenCalled();
    expect(credit.deduct).not.toHaveBeenCalled();
  });

  it('should return error when project not found', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue(null);
    const result = await service.execute('bad-id', undefined, 'u1');
    expect(result.success).toBe(false);
    expect(result.errors).toContain('项目不存在');
  });

  it('should handle credit deduction failure during execution', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({
      id: 'p1', nodes: [], edges: [], viewport: {},
    });
    prisma.pricingRule.findFirst.mockResolvedValue({ creditCost: 5 });
    credit.deduct.mockResolvedValue({ success: false });

    const result = await service.execute('p1', 'n2', 'u1');
    expect(result.success).toBe(false);
    expect(gateway.emitNodeStatus).toHaveBeenCalledWith('p1', expect.objectContaining({ status: 'error' }));
  });

  it('should enqueue ai-result-download after AI returns resultUrl', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({
      id: 'p1', nodes: [], edges: [], viewport: {},
    });
    prisma.pricingRule.findFirst.mockResolvedValue({ creditCost: 5 });

    const result = await service.execute('p1', 'n2', 'default-user');
    expect(result.success).toBe(true);
    expect(mockDownloadQueue.add).toHaveBeenCalledWith(
      'ai-result-download',
      expect.objectContaining({
        userId: 'default-user',
        projectId: 'p1',
        nodeId: 'n2',
        resultUrl: '/mock/test.jpg',
        mimeType: 'image/png',
      }),
    );
  });
});
