import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionService } from './execution.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TopologyService } from './topology.service';
import { ValidationService } from './validation.service';
import { ApiCallerService } from './api-caller.service';
import { CreditService } from '../credit/credit.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildLegacyDocState } from '../canvas/canvas-legacy.reader';

describe('ExecutionService with nodeIds（整组执行）', () => {
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
      canvasDoc: { findUnique: vi.fn().mockResolvedValue(null) },
      pricingRule: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    topology = {
      getScope: vi.fn(),
      sort: vi.fn((nodes: any[]) => nodes),
      collectUpstreamData: vi.fn().mockReturnValue({ textContents: [] }),
    };
    validation = { validateAll: vi.fn().mockResolvedValue({ valid: true }) };
    apiCaller = {
      callTextGen: vi.fn().mockResolvedValue({ content: 'ok' }),
      callImageGen: vi.fn(),
      callVideoGen: vi.fn(),
      callAudioGen: vi.fn(),
    };
    credit = { deduct: vi.fn().mockResolvedValue({ success: true }), getBalance: vi.fn().mockResolvedValue({ credits: 100 }) };
    gateway = { emitNodeStatus: vi.fn(), emitExecutionComplete: vi.fn() };
    mockDownloadQueue = { add: vi.fn().mockResolvedValue({ id: 'job-1' }) };

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

  it('nodeIds 限定执行范围（仅组内节点）', async () => {
    const nodes = [
      { id: 'outside', type: 'textInput', data: { content: 'x' } },
      { id: 'in1', type: 'textInput', data: { content: 'a', model: 'seed-model-kimi' } },
      { id: 'in2', type: 'textInput', data: { content: 'b', model: 'seed-model-kimi' } },
    ];
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.canvasDoc.findUnique.mockResolvedValue({ projectId: 'p1', state: buildLegacyDocState(nodes, []) });

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
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.canvasDoc.findUnique.mockResolvedValue({
      projectId: 'p1',
      state: buildLegacyDocState(nodes, [{ id: 'e1', source: 'outside', target: 'in1' }]),
    });
    await service.execute('p1', undefined, 'u1', ['in1']);

    const nodesPassed = topology.collectUpstreamData.mock.calls[0][1] as any[];
    expect(nodesPassed.map((n) => n.id)).toContain('outside');
  });
});
