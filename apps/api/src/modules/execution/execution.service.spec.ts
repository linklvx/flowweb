import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionService } from './execution.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TopologyService } from './topology.service';
import { ValidationService } from './validation.service';
import { ApiCallerService } from './api-caller.service';
import { TeamCreditService } from '../team/team-credit.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { ForbiddenException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ExecutionService', () => {
  let service: ExecutionService;
  let prisma: any;
  let topology: any;
  let validation: any;
  let apiCaller: any;
  let teamCredit: any;
  let collabDoc: any;
  let gateway: any;
  let mockDownloadQueue: any;
  let permSvc: { resolve: ReturnType<typeof vi.fn>; assertEditor: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prisma = {
      canvasProject: { findUnique: vi.fn() },
      pricingRule: { findFirst: vi.fn() },
    };
    collabDoc = {
      readCanvas: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
      writeNodeData: vi.fn(),
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
    teamCredit = {
      consume: vi.fn().mockResolvedValue({ success: true }),
      getBalanceView: vi.fn().mockResolvedValue({ credits: 95, subscriptionCredits: 0, total: 95, quota: 0, used: 0 }),
    };
    gateway = { emitNodeStatus: vi.fn(), emitExecutionComplete: vi.fn() };
    mockDownloadQueue = {
      add: vi.fn().mockResolvedValue({ id: 'download-job-1' }),
    };
    permSvc = {
      resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
      assertEditor: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutionService,
        { provide: PrismaService, useValue: prisma },
        { provide: TopologyService, useValue: topology },
        { provide: ValidationService, useValue: validation },
        { provide: ApiCallerService, useValue: apiCaller },
        { provide: TeamCreditService, useValue: teamCredit },
        { provide: ProjectPermissionService, useValue: permSvc },
        { provide: CollabDocumentService, useValue: collabDoc },
        { provide: ExecutionGateway, useValue: gateway },
        { provide: 'BullQueue_ai-result-download', useValue: mockDownloadQueue },
      ],
    }).compile();
    service = module.get<ExecutionService>(ExecutionService);
  });

  it('should execute single node successfully', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    prisma.pricingRule.findFirst.mockResolvedValue({ creditCost: 5 });

    const result = await service.execute('p1', 'n2', 'default-user');
    expect(result.success).toBe(true);
    expect(gateway.emitNodeStatus).toHaveBeenCalled();
    expect(teamCredit.consume).toHaveBeenCalledWith('t1', 'default-user', 5, 'node:n2');
    // 预校验传项目所属团队 id（账本换源 TeamBalance）
    expect(validation.validateAll).toHaveBeenCalledWith(expect.any(Array), 't1', 'default-user');
  });

  it('should return error when validation fails', async () => {
    validation.validateAll.mockResolvedValue({ valid: false, errors: ['余额不足'], totalCost: 0 });
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });

    const result = await service.execute('p1', undefined, 'default-user');
    expect(result.success).toBe(false);
    expect(result.errors).toContain('余额不足');
    expect(apiCaller.callImageGen).not.toHaveBeenCalled();
    expect(teamCredit.consume).not.toHaveBeenCalled();
  });

  it('should return error when project not found', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue(null);
    const result = await service.execute('bad-id', undefined, 'u1');
    expect(result.success).toBe(false);
    expect(result.errors).toContain('项目不存在');
  });

  it('execute：VIEWER 403', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    permSvc.assertEditor.mockRejectedValue(new ForbiddenException('无项目编辑权限'));
    await expect(service.execute('p1', undefined, 'u1', undefined)).rejects.toThrow('无项目编辑权限');
    expect(permSvc.assertEditor).toHaveBeenCalledWith('p1', 'u1');
  });

  it('should handle credit deduction failure during execution', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    prisma.pricingRule.findFirst.mockResolvedValue({ creditCost: 5 });
    teamCredit.consume.mockResolvedValue({ success: false });

    const result = await service.execute('p1', 'n2', 'u1');
    expect(result.success).toBe(false);
    expect(gateway.emitNodeStatus).toHaveBeenCalledWith('p1', expect.objectContaining({ status: 'error' }));
  });

  it('should enqueue ai-result-download after AI returns resultUrl', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
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
