// apps/api/src/modules/video-project/video-project.regenerate.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { VideoProjectService } from './video-project.service';
import { ExecutionService } from '../execution/execution.service';
import { TopologyService } from '../execution/topology.service';

describe('regenerate（批5-1 直连真实节点——影子信箱删除）', () => {
  let svc: VideoProjectService; let prisma: any; let collab: any; let execution: any;
  const perm = { assertEditor: vi.fn().mockResolvedValue('E') };
  const quota = { assertCanUpload: vi.fn() };

  beforeEach(() => {
    prisma = { videoProject: { findUnique: vi.fn() } };
    // insertNode/removeNode 已随信箱删除——mock 不提供（regenerate 误用即红）；
    // writeNodeData 提供并断言零调用：产物落地（fileId/result 写真实节点）由 execute→ai-download 既有链承载
    collab = { readCanvas: vi.fn(), isLeaseServing: vi.fn(() => true), writeNodeData: vi.fn() }; // Y0a-3 T8 语义读门——默认放行
    execution = { execute: vi.fn().mockResolvedValue({ success: true, results: [{ nodeId: 'src1', type: 'video', resultUrl: 'https://x/v.mp4' }] }) };
    svc = new VideoProjectService(prisma, perm as any, collab as any, execution as any, quota as any);
  });

  it('直连真实节点：execute(workflowId, nodeId=undefined, userId, nodeIds=[sourceNodeId], sv=undefined, retakeId)——nodeIds 模式 scope 恰为目标自身（H1：不连带上游）、无影子插入、regenerate 自身零 doc 写', async () => {
    collab.readCanvas.mockResolvedValue({
      nodes: [{ id: 'src1', type: 'videoGen', position: { x: 1, y: 2 }, data: { model: 'm', prompt: { text: 't' } } }],
      edges: [],
    });
    const r = await svc.regenerate('u1', { sourceNodeId: 'src1', workflowId: 'w1', kind: 'video', retakeId: 'rtk-1' });
    // sv 位（第 5 参）= undefined：直调不带 sv——E2 根因（sv 裁剪致影子不可见）随信箱消失；
    // retakeId 作 intentId 透传 execute 且目标为唯一 exec 节点（nodeIds 单元素）——intentId 归属目标自身，
    // 幂等裁决在 claim 层（同 retakeId 重放 SUCCEEDED → 零外呼零扣费）
    expect(execution.execute).toHaveBeenCalledWith('w1', undefined, 'u1', ['src1'], undefined, 'rtk-1');
    expect(collab.writeNodeData).not.toHaveBeenCalled(); // Media.create/writeNodeData(fileId) 由 execute→ai-download 落真实节点，服务层不重复落地（防双 Media 行）
    // result 原样透传（success=false 早失败语义维持——web 侧 initial 契约）
    expect(r).toEqual({
      retakeId: 'rtk-1',
      result: { success: true, results: [{ nodeId: 'src1', type: 'video', resultUrl: 'https://x/v.mp4' }] },
    });
  });

  it('同 retakeId 重放：服务层恒透传不拦（幂等由 execute 内 claim 层裁决——双发也不在此重复外呼控制）', async () => {
    collab.readCanvas.mockResolvedValue({ nodes: [{ id: 'src1', type: 'videoGen', data: { model: 'm' } }], edges: [] });
    await svc.regenerate('u1', { sourceNodeId: 'src1', workflowId: 'w1', kind: 'video', retakeId: 'rtk-same' });
    await svc.regenerate('u1', { sourceNodeId: 'src1', workflowId: 'w1', kind: 'video', retakeId: 'rtk-same' });
    expect(execution.execute).toHaveBeenCalledTimes(2);
    expect(execution.execute).toHaveBeenLastCalledWith('w1', undefined, 'u1', ['src1'], undefined, 'rtk-same');
  });

  it('kind=audio → audioGen 类型匹配后同样直连', async () => {
    collab.readCanvas.mockResolvedValue({ nodes: [{ id: 'a1', type: 'audioGen', data: { model: 'm' } }], edges: [] });
    await svc.regenerate('u1', { sourceNodeId: 'a1', workflowId: 'w1', kind: 'audio', retakeId: 'rtk-a' });
    expect(execution.execute).toHaveBeenCalledWith('w1', undefined, 'u1', ['a1'], undefined, 'rtk-a');
  });

  it('源节点类型不匹配：400（video/audio 两分支显式传 kind——防"缺省 kind 因错误原因通过"）', async () => {
    collab.readCanvas.mockResolvedValue({ nodes: [{ id: 'x', type: 'videoEdit', data: {} }], edges: [] });
    await expect(svc.regenerate('u1', { sourceNodeId: 'x', workflowId: 'w1', kind: 'video', retakeId: 'r1' })).rejects.toThrow(BadRequestException);
    await expect(svc.regenerate('u1', { sourceNodeId: 'x', workflowId: 'w1', kind: 'audio', retakeId: 'r1' })).rejects.toThrow(BadRequestException);
    expect(execution.execute).not.toHaveBeenCalled();
  });
  it('源节点不存在：400', async () => {
    collab.readCanvas.mockResolvedValue({ nodes: [], edges: [] });
    await expect(svc.regenerate('u1', { sourceNodeId: 'nope', workflowId: 'w1', kind: 'video', retakeId: 'r1' })).rejects.toThrow(BadRequestException);
    expect(execution.execute).not.toHaveBeenCalled();
  });
});

describe('批5 评审 H1：retake 幂等闭环（retakeId 归目标节点 + 上游不连带执行）', () => {
  // 拓扑：textInput --e1--> videoGen（videoGen 带上游——nodeId 模式 getScope 会收上游闭包+自身的形态）
  const UPSTREAM_TEXT = { id: 't1', type: 'textInput', data: { model: 'seed-model-kimi', content: 'upstream text' } };
  const TARGET_VIDEO = { id: 'vg1', type: 'videoGen', data: { model: 'v1' } };
  const CANVAS = { nodes: [UPSTREAM_TEXT, TARGET_VIDEO], edges: [{ id: 'e1', source: 't1', target: 'vg1' }] };

  /** 真实 ExecutionService 驱动（装置复用 execution.intent.spec makeService 骨架）：
   *  topology.getScope mock 成生产 nodeId 模式真实形态（上游闭包+自身——topology.service.ts getScope），
   *  sort/collectUpstreamData 用真实实现——regenerate 的分派路径真实，intent 归属判定不依赖 mock 偏置。
   *  intentService 状态化：同 (nodeId,intentId) complete 后，重放 claim → created:false（SUCCEEDED 幂等——模拟真实 claim 行为）。 */
  function makeFixture() {
    const prisma = {
      canvasProject: { findUnique: vi.fn().mockResolvedValue({ id: 'w1', teamId: 'team-1' }) },
      pricingRule: { findFirst: vi.fn().mockResolvedValue({ creditCost: 1 }) },
      style: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const realTopo = new TopologyService();
    const topology = {
      getScope: vi.fn().mockReturnValue([UPSTREAM_TEXT, TARGET_VIDEO]),
      sort: realTopo.sort.bind(realTopo),
      collectUpstreamData: realTopo.collectUpstreamData.bind(realTopo),
    };
    // Y0b-1（E1）：validateAll 产 plans——execution planMap 消费（creditCost:1 对齐 reserve 次数断言）
    const validation = { validateAll: vi.fn().mockImplementation(async (nodes: any[]) => ({
      valid: true, errors: [], totalCost: nodes.length,
      plans: nodes.map((n: any) => ({ nodeId: n.id, pricingRuleId: 'pr', modelId: null, resolutionId: null, durationId: null, creditCost: 1 })),
    })) };
    const apiCaller = {
      callTextGen: vi.fn().mockResolvedValue({ content: 'AI结果' }),
      callVideoGen: vi.fn().mockResolvedValue({ url: 'http://v/1.mp4' }),
      callImageGen: vi.fn().mockResolvedValue({ url: 'http://img' }),
    };
    const teamCredit = {
      reserve: vi.fn().mockResolvedValue({ success: true }),
      settle: vi.fn().mockResolvedValue({ success: true, settled: true }),
      void_: vi.fn().mockResolvedValue(undefined),
      getBalanceView: vi.fn().mockResolvedValue({ credits: 1, subscriptionCredits: 0, total: 1 }),
    };
    const perm = { assertEditor: vi.fn().mockResolvedValue(undefined) };
    const collab = {
      readCanvas: vi.fn().mockResolvedValue(CANVAS),
      isLeaseServing: vi.fn(() => true), // Y0a-3 T8 计费/语义读门——默认放行
      writeNodeData: vi.fn(),
      writeExecStatus: vi.fn().mockResolvedValue(undefined),
    };
    const gateway = { emitNodeStatus: vi.fn(), emitExecutionComplete: vi.fn() };
    const downloadQueue = { add: vi.fn() };
    const succeeded = new Map<string, string>(); // "nodeId:intentId" -> resultRef（complete 落地）
    const intentService = {
      claim: vi.fn(async (input: any) => {
        const key = `${input.nodeId}:${input.intentId}`;
        if (succeeded.has(key)) {
          return { created: false, intent: { id: `row:${key}`, intentId: input.intentId, status: 'SUCCEEDED', resultRef: succeeded.get(key) } };
        }
        return { created: true, intent: { id: `row:${key}`, intentId: input.intentId } };
      }),
      complete: vi.fn(async (rowId: string, resultRef: string) => { succeeded.set(rowId.slice('row:'.length), resultRef); return 1; }),
      fail: vi.fn().mockResolvedValue(undefined),
      void_: vi.fn().mockResolvedValue(undefined),
      reanchorDeadline: vi.fn().mockResolvedValue(undefined), // Y0b-2 T4：外呼前重锚
      touchHeartbeat: vi.fn().mockResolvedValue(undefined),
    };
    const execSvc: any = new (ExecutionService as any)(
      prisma, topology, validation, apiCaller, teamCredit, perm, collab, gateway, downloadQueue, intentService,
    );
    const vsvc = new VideoProjectService(
      { videoProject: { findUnique: vi.fn() } } as any, perm as any, collab as any, execSvc as any, { assertCanUpload: vi.fn() } as any,
    );
    return { vsvc, apiCaller, teamCredit, intentService };
  }

  it('H1：videoGen 带上游 textInput——regenerate 只执行 videoGen（上游零外呼零扣费）+ retakeId 落 videoGen 自身', async () => {
    const { vsvc, apiCaller, teamCredit, intentService } = makeFixture();
    await vsvc.regenerate('u1', { sourceNodeId: 'vg1', workflowId: 'w1', kind: 'video', retakeId: 'rtk-1' });
    expect(apiCaller.callTextGen).not.toHaveBeenCalled(); // 上游不连带（旧 shadow 模式影子是孤节点无此行为——回归堵）
    expect(intentService.claim).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'vg1', gestureToken: 'rtk-1' })); // Y0b-2 Z109：token 透传目标节点（nodeIds=[目标] 使其唯一 exec）
    expect(apiCaller.callVideoGen).toHaveBeenCalledTimes(1);
    expect(teamCredit.reserve).toHaveBeenCalledTimes(1); // 只扣目标一份（上游连带重复扣费根堵）
    // 上游数据注入仍在：只执行目标、但 prompt 读取上游产物（nodeIds 模式 upstreamSource=allNodes）
    expect(apiCaller.callVideoGen).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('upstream text') }));
  });

  it('H1：同 retakeId 重放——claim SUCCEEDED 幂等命中（videoGen 零外呼零扣费，闭环成立的前提是 retakeId 已落目标节点）', async () => {
    const { vsvc, apiCaller, teamCredit } = makeFixture();
    await vsvc.regenerate('u1', { sourceNodeId: 'vg1', workflowId: 'w1', kind: 'video', retakeId: 'rtk-same' }); // 首次成功
    await vsvc.regenerate('u1', { sourceNodeId: 'vg1', workflowId: 'w1', kind: 'video', retakeId: 'rtk-same' }); // 同 retakeId 重放
    expect(apiCaller.callVideoGen).toHaveBeenCalledTimes(1); // 重放零外呼（旧实现 videoGen 派新 UUID → 新意图再外呼）
    expect(teamCredit.reserve).toHaveBeenCalledTimes(1);    // 重放零扣费（claim ⑤ SUCCEEDED 重放幂等）
  });
});
