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
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ExecutionService with nodeIds（整组执行）', () => {
  let service: ExecutionService;
  let prisma: any;
  let topology: any;
  let validation: any;
  let apiCaller: any;
  let teamCredit: any;
  let collabDoc: any;
  let gateway: any;
  let mockDownloadQueue: any;

  beforeEach(async () => {
    prisma = {
      canvasProject: { findUnique: vi.fn() },
      pricingRule: { findFirst: vi.fn().mockResolvedValue(null) },
      style: { findMany: vi.fn().mockResolvedValue([]) },
    };
    collabDoc = {
      readCanvas: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
      isLeaseServing: vi.fn().mockReturnValue(true), // Y0a-3 T8 计费读门——默认放行
      writeNodeData: vi.fn().mockResolvedValue({ written: true }), // Y0b-2 T5：交付判据类型化 {written,reason}
      writeExecStatus: vi.fn().mockResolvedValue(undefined), // 批0.5-6 claim 接线最小装置
    };
    topology = {
      getScope: vi.fn(),
      sort: vi.fn((nodes: any[]) => nodes),
      collectUpstreamData: vi.fn().mockReturnValue({ textContents: [] }),
    };
    // Y0b-1（E1）：validation 产 plans——动态生成（nodeId↔plan 一一对应）
    validation = {
      validateAll: vi.fn().mockImplementation(async (nodes: any[]) => ({
        valid: true, errors: [], totalCost: nodes.length,
        plans: nodes.map((n: any) => ({ nodeId: n.id, pricingRuleId: 'pr', modelId: null, resolutionId: null, durationId: null, creditCost: 1 })),
      })),
    };
    apiCaller = {
      callTextGen: vi.fn().mockResolvedValue({ content: 'ok' }),
      callImageGen: vi.fn(),
      callVideoGen: vi.fn(),
      callAudioGen: vi.fn(),
    };
    teamCredit = { reserve: vi.fn().mockResolvedValue({ success: true }), settle: vi.fn().mockResolvedValue({ success: true, settled: true }), void_: vi.fn().mockResolvedValue(undefined), getBalanceView: vi.fn().mockResolvedValue({ total: 100 }) };
    gateway = { emitNodeStatus: vi.fn() }; // Y0b-2 T5：execution:complete emit 已删（census 清零）
    mockDownloadQueue = { add: vi.fn().mockResolvedValue({ id: 'job-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutionService,
        { provide: PrismaService, useValue: prisma },
        { provide: TopologyService, useValue: topology },
        { provide: ValidationService, useValue: validation },
        { provide: ApiCallerService, useValue: apiCaller },
        { provide: TeamCreditService, useValue: teamCredit },
        { provide: ProjectPermissionService, useValue: { resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'), assertEditor: vi.fn().mockResolvedValue('PROJECT_EDITOR') } },
        { provide: CollabDocumentService, useValue: collabDoc },
        { provide: ExecutionGateway, useValue: gateway },
        { provide: 'BullQueue_ai-result-download', useValue: mockDownloadQueue },
        // 批0.5-6 最小装置：意图服务默认放行（created:true）+ complete 默认过门（count=1）
        { provide: GenerationIntentService, useValue: { claim: vi.fn().mockResolvedValue({ created: true, intent: { id: 'intent-1', intentId: 'i-1' } }), complete: vi.fn().mockResolvedValue(1), fail: vi.fn().mockResolvedValue(undefined), void_: vi.fn().mockResolvedValue(undefined), reanchorDeadline: vi.fn().mockResolvedValue(undefined), touchHeartbeat: vi.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get<ExecutionService>(ExecutionService);
  });

  it('nodeIds 限定执行范围（仅组内节点）', async () => {
    const nodes = [
      { id: 'outside', type: 'textInput', data: { content: 'x' } },
      { id: 'in1', type: 'textInput', data: { content: 'a', model: 'seed-model-kimi' } },
      { id: 'in2', type: 'textInput', data: { content: 'b', model: 'seed-model-kimi' } },
    ];
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    collabDoc.readCanvas.mockResolvedValue({ nodes, edges: [] });

    await service.execute('p1', undefined, 'u1', ['in1', 'in2']);

    const sorted = topology.sort.mock.calls[0][0] as any[];
    expect(sorted.map((n) => n.id)).not.toContain('outside');
    // Each node emits loading + done = 4 calls total for 2 nodes
    expect(gateway.emitNodeStatus).toHaveBeenCalledTimes(4);
  });

  it('collectUpstreamData 收到全量节点（组外上游可读）', async () => {
    const nodes = [
      { id: 'outside', type: 'textInput', data: { content: 'up' } },
      { id: 'in1', type: 'textInput', data: { model: 'seed-model-kimi' } },
    ];
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    collabDoc.readCanvas.mockResolvedValue({ nodes, edges: [{ id: 'e1', source: 'outside', target: 'in1' }] });
    await service.execute('p1', undefined, 'u1', ['in1']);

    const nodesPassed = topology.collectUpstreamData.mock.calls[0][1] as any[];
    expect(nodesPassed.map((n) => n.id)).toContain('outside');
  });
});
