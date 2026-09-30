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
import { GenerationIntentService } from './generation-intent.service';
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
      style: { findMany: vi.fn().mockResolvedValue([]) },
    };
    collabDoc = {
      readCanvas: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
      writeNodeData: vi.fn(),
      writeExecStatus: vi.fn().mockResolvedValue(undefined), // 批0.5-6 claim 接线最小装置
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
      reserve: vi.fn().mockResolvedValue({ success: true }),
      settle: vi.fn().mockResolvedValue({ success: true, settled: true }),
      void_: vi.fn().mockResolvedValue(undefined),
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

    // 批0.5-6 最小装置：意图服务默认放行（created:true）+ complete 默认过门（count=1）——本文件只测产物序/余额口径
    const intentSvc = {
      claim: vi.fn().mockResolvedValue({ created: true, intent: { id: 'intent-1', intentId: 'i-1' } }),
      complete: vi.fn().mockResolvedValue(1),
      fail: vi.fn().mockResolvedValue(undefined),
      void_: vi.fn().mockResolvedValue(undefined),
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
        { provide: GenerationIntentService, useValue: intentSvc },
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
    expect(teamCredit.reserve).toHaveBeenCalledWith('t1', 'default-user', 5, { intentRowId: 'intent-1', intentId: 'i-1' });
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
    expect(teamCredit.reserve).not.toHaveBeenCalled();
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
    teamCredit.reserve.mockResolvedValue({ success: false });

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

  it('node:status credits 为完整余额对象（文本/图片节点），total = credits + subscriptionCredits', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    prisma.pricingRule.findFirst.mockResolvedValue({ creditCost: 5 });
    teamCredit.getBalanceView.mockResolvedValue({ credits: 60, subscriptionCredits: 40, total: 100, quota: 0, used: 0 });

    await service.execute('p1', 'n1', 'default-user');

    // 默认拓扑 n1(textInput) + n2(imageGen)，两条 done 事件均推完整对象
    const dones = gateway.emitNodeStatus.mock.calls.filter((c: any[]) => c[1]?.status === 'done');
    expect(dones).toHaveLength(2);
    for (const c of dones) {
      expect(c[1].credits).toEqual({ credits: 60, subscriptionCredits: 40, total: 100 });
      expect(c[1].credits.total).toBe(c[1].credits.credits + c[1].credits.subscriptionCredits);
    }
  });

  it('node:status credits 为完整余额对象（视频节点）', async () => {
    topology.sort.mockReturnValue([{ id: 'n3', type: 'videoGen', data: { model: 'm1', prompt: 'v' } }]);
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    prisma.pricingRule.findFirst.mockResolvedValue({ creditCost: 5 });
    teamCredit.getBalanceView.mockResolvedValue({ credits: 60, subscriptionCredits: 40, total: 100, quota: 0, used: 0 });

    await service.execute('p1', 'n3', 'default-user');

    const payload = gateway.emitNodeStatus.mock.calls.find((c: any[]) => c[1]?.status === 'done')?.[1];
    expect(payload.credits).toEqual({ credits: 60, subscriptionCredits: 40, total: 100 });
    expect(payload.credits.total).toBe(payload.credits.credits + payload.credits.subscriptionCredits);
  });

  describe('风格拼接与面板 prompt 断链（spec §7.1/§7.2，D12/D28）', () => {
    beforeEach(() => {
      prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' }); // :40 早退基线（B5）
      prisma.pricingRule.findFirst.mockResolvedValue({ creditCost: 5 }); // 对齐既有 12 处基线取值——0 会走 if(vCost>0) 另一分支（P3-5）
      prisma.style.findMany.mockResolvedValue([]);
    });

    it('D12：独立图片节点（无上游文本）data.prompt.text 进 prompt', async () => {
      topology.sort.mockReturnValue([
        { id: 'n2', type: 'imageGen', data: { model: 'm1', prompt: { text: '面板词', html: '面板词' } } },
      ]);
      topology.collectUpstreamData.mockReturnValue({ textContents: [], imageUrl: undefined });
      await service.execute('p1', 'n2', 'u1');
      expect(apiCaller.callImageGen).toHaveBeenCalledWith(expect.objectContaining({ prompt: '面板词' }));
      expect(prisma.style.findMany).not.toHaveBeenCalled(); // 无 styleId 批次零查询（B19）
    });

    it('风格拼接：styleId → 批量 findMany 取 active promptText，join(", ") 到 prompt', async () => {
      prisma.style.findMany.mockResolvedValue([{ id: 'st1', active: true, promptText: '风格词' }]);
      topology.sort.mockReturnValue([
        { id: 'n1', type: 'textInput', data: { content: '上游词' } },
        { id: 'n2', type: 'imageGen', data: { model: 'm1', styleId: 'st1' } },
      ]);
      topology.collectUpstreamData.mockReturnValue({ textContents: ['上游词'], imageUrl: undefined });
      await service.execute('p1', 'n2', 'u1');
      expect(prisma.style.findMany).toHaveBeenCalledWith({ where: { id: { in: ['st1'] } } });
      expect(apiCaller.callImageGen).toHaveBeenCalledWith(expect.objectContaining({ prompt: '上游词, 风格词' }));
    });

    it('inactive/不存在风格 → 忽略不阻塞（B1）', async () => {
      prisma.style.findMany.mockResolvedValue([{ id: 'st1', active: false, promptText: '风格词' }]);
      topology.sort.mockReturnValue([
        { id: 'n2', type: 'imageGen', data: { model: 'm1', styleId: 'st1' } },
      ]);
      topology.collectUpstreamData.mockReturnValue({ textContents: ['上游词'], imageUrl: undefined });
      await service.execute('p1', 'n2', 'u1');
      expect(apiCaller.callImageGen).toHaveBeenCalledWith(expect.objectContaining({ prompt: '上游词' }));
    });

    it('视频分支：finalPrompt 拼风格 + 面板清空 prompt 不传对象（D28 删回退）', async () => {
      prisma.style.findMany.mockResolvedValue([{ id: 'st1', active: true, promptText: '风格词V' }]);
      topology.sort.mockReturnValue([
        { id: 'n3', type: 'videoGen', data: { model: 'vm', styleId: 'st1', prompt: { text: '', html: '' } } },
      ]);
      topology.collectUpstreamData.mockReturnValue({ textContents: [], imageUrl: undefined });
      await service.execute('p1', 'n3', 'u1');
      const arg = apiCaller.callVideoGen.mock.calls[0][0] as { prompt: unknown };
      expect(arg.prompt).toBe('风格词V');           // 纯风格文本（面板为空）
      expect(typeof arg.prompt).toBe('string');      // 不再序列化 PromptValue 对象
    });

    it('B21：有上游文本时面板 prompt 被忽略（|| 链上游优先——有意语义，防误改合并）', async () => {
      topology.sort.mockReturnValue([
        { id: 'n1', type: 'textInput', data: { content: '上游词' } },
        { id: 'n2', type: 'imageGen', data: { model: 'm1', prompt: { text: '面板词', html: '面板词' } } },
      ]);
      topology.collectUpstreamData.mockReturnValue({ textContents: ['上游词'], imageUrl: undefined });
      await service.execute('p1', 'n2', 'u1');
      const arg = apiCaller.callImageGen.mock.calls[0][0] as { prompt: string };
      expect(arg.prompt).toBe('上游词'); // 不含 '面板词'
    });
  });
});
