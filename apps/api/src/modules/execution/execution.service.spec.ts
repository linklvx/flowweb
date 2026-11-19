import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionService } from './execution.service';
import { ExecutionRequestService } from './execution-request.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TopologyService } from './topology.service';
import { UpstreamMediaService } from './upstream-media.service';
import { ValidationService } from './validation.service';
import { ApiCallerService } from './api-caller.service';
import { TeamCreditService } from '../team/team-credit.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CollabWritePort } from '../collab/collab-write.port';
import { GenerationIntentService } from './generation-intent.service';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NodeBusyError } from './generation-intent.service';
import { ArtifactCommitService, FundsInvariantError } from '../artifact-core/artifact-commit.service';

describe('ExecutionService', () => {
  let service: ExecutionService;
  let prisma: any;
  let topology: any;
  let validation: any;
  let apiCaller: any;
  let teamCredit: any;
  let collabDoc: any;
  let permSvc: { resolve: ReturnType<typeof vi.fn>; assertEditor: ReturnType<typeof vi.fn> };
  let intentSvc: any; // Y0c T12：结构断言族/replay 分支需逐测试改 claim/complete/reanchorDeadline 判据
  let artifactCommit: any;   // T10：image/text finalize（stub——默认 committed）

  beforeEach(async () => {
    prisma = {
      canvasProject: { findUnique: vi.fn() },
      canvasDoc: { findUnique: vi.fn().mockResolvedValue({ generation: 0 }) },   // Y1c T23（M-5）：NodeExecution claim 写点 generation 锚
      modelResolution: { findMany: vi.fn().mockResolvedValue([]) },
      modelDuration: { findMany: vi.fn().mockResolvedValue([]) },
      style: { findMany: vi.fn().mockResolvedValue([]) },
      generationIntent: { findUnique: vi.fn().mockResolvedValue({ status: 'RUNNING', execSeq: 1n, attempts: 1 }) }, // T9 catch fence 读行
      // Y1c T23：NodeExecution 当前行写接线（M-5 裁定=接线）——$queryRaw 零行=fenced 观测位（零副作用）
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    collabDoc = {
      readCanvas: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
      isLeaseServing: vi.fn().mockReturnValue(true), // Y0a-3 T8 计费读门——默认放行（本文件焦点在执行链）
      writeNodeData: vi.fn().mockResolvedValue({ kind: 'business', written: true }),   // T13 typed outcome——business 档（transient/permanent=悬留档）, // Y0b-2 T5：交付判据类型化 {written,reason}
      writeExecStatus: vi.fn().mockResolvedValue(undefined), // 批0.5-6 claim 接线最小装置
      // Y2 B2c：两封闭操作默认桩——readAuthorSlot：无作者键（frozen=false 走胜臂——本文件焦点非作废面）；
      // releaseAuthorSlot：幂等成功（补释放面无断言用例靠 B2c describe 定点覆盖）
      readAuthorSlot: vi.fn().mockImplementation(async (_p: string, id: string) => ({ nodeId: id, kind: 'image', frozen: true, authorMediaId: null, liveMediaId: null })),
      releaseAuthorSlot: vi.fn().mockResolvedValue({ released: true, deletedSlot: false, bindingStats: { written: 0, skipped: { missing: 0, 'cross-team': 0, 'soft-deleted': 0 } } }),
    };
    topology = {
      getScope: vi.fn().mockReturnValue([
        { id: 'n1', type: 'textInput', data: { content: 'hello', model: 'm-text' } },
        { id: 'n2', type: 'imageGen', data: { model: 'm1', resolution: 'r1' } },
      ]),
      sort: vi.fn().mockReturnValue([
        { id: 'n1', type: 'textInput', data: { content: 'hello', model: 'm-text' } },
        { id: 'n2', type: 'imageGen', data: { model: 'm1', resolution: 'r1' } },
      ]),
      collectUpstreamData: vi.fn().mockResolvedValue({ textContents: ['hello'], imageMediaId: undefined }),   // Y1a T8：async+身份形态
    };
    // Y0b-1（E1）：validation 产 plans——动态生成，creditCost 5=reserve 断言锚（对齐既有 12 处基线取值）
    validation = {
      validateAll: vi.fn().mockImplementation(async (nodes: any[]) => ({
        valid: true, errors: [], totalCost: 5,
        plans: nodes.map((n: any) => ({ nodeId: n.id, pricingRuleId: 'pr', modelId: null, resolutionId: null, durationId: null, creditCost: 5 })),
      })),
    };
    apiCaller = {
      callImageGen: vi.fn().mockResolvedValue({ url: '/mock/test.jpg', width: 1024, height: 1024 }),
      callTextGen: vi.fn().mockResolvedValue({ content: 'hello' }),
      callVideoGen: vi.fn().mockResolvedValue({ url: '/mock/video.mp4' }),
    };
    teamCredit = {
      reserve: vi.fn().mockResolvedValue({ success: true, mayCall: true }),
      settle: vi.fn().mockResolvedValue({ success: true, settled: true }),
      void_: vi.fn().mockResolvedValue(undefined),
      // Y3 T8：getBalanceView 桩随 credits 搭车 emit 删除而退役（余额刷新归 D1 REST 事件驱动）。
    };
    // Y3 T8：/execution emit 面删除（gateway fixture 退役——emit 断言随批删/翻）
    permSvc = {
      resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
      assertEditor: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
    };

    // T10：artifactCommit 默认 committed（mediaId 锚）——本文件焦点在执行链序/交付键；finalize 资金面归 artifact-commit.int.spec
    artifactCommit = {
      commitImage: vi.fn().mockResolvedValue({ outcome: 'committed', mediaId: 'media-t10', key: 'artifacts/t/i/1/0-abc' }),
      finalizeText: vi.fn().mockResolvedValue({ outcome: 'committed' }),
      finalizeVideo: vi.fn().mockResolvedValue({ outcome: 'committed', mediaId: 'media-t12', key: 'artifacts/t/i/1/0' }),   // T12：video finalize-first（materialize 异步归 MaterializeJob）
    };
    // 批0.5-6 最小装置：意图服务默认放行（created:true）+ complete 默认过门（count=1）——本文件只测产物序/余额口径
    intentSvc = {
      claim: vi.fn().mockResolvedValue({ created: true, result: 'new', artifactRev: 0, intent: { id: 'intent-1', intentId: 'i-1', execSeq: 1n, attempts: 1 } }),   // T10：claimCapture 返回槽位 rev
      complete: vi.fn().mockResolvedValue(1),
      fail: vi.fn().mockResolvedValue(undefined),
      void_: vi.fn().mockResolvedValue(undefined),
      reanchorDeadline: vi.fn().mockResolvedValue(1), // Y0b-2 T4：外呼前重锚（T9 count 形态）
      touchHeartbeat: vi.fn().mockResolvedValue(undefined),
      ensureProviderRequestId: vi.fn().mockResolvedValue('rid-t9'), // T9 write-ahead
      recordProviderTaskId: vi.fn().mockResolvedValue(undefined),   // T9 taskId 落库
      tickFence: vi.fn().mockResolvedValue(undefined),              // T9 onTick 双职+代际
      markUnknown: vi.fn().mockResolvedValue(1),                     // Y1c T23：text UNKNOWN 档（reserve 保留不自动重呼——收口批 M-3 分档：1=停驻成功）
      observeNodeExecution: vi.fn().mockResolvedValue(undefined),   // Y1c T23 收口 I-1(spec)：NodeExecution 观测锚（统一迁 GenerationIntentService）
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutionService,
        { provide: ExecutionRequestService, useValue: { loadForExecution: vi.fn(), admit: vi.fn() } },   // Y1c T21（冻结路径 spec 最小装置）
        { provide: PrismaService, useValue: prisma },
        { provide: TopologyService, useValue: topology },
        { provide: ValidationService, useValue: validation },
        { provide: ApiCallerService, useValue: apiCaller },
        { provide: TeamCreditService, useValue: teamCredit },
        { provide: ProjectPermissionService, useValue: permSvc },
        { provide: CollabWritePort, useValue: collabDoc },
        { provide: GenerationIntentService, useValue: intentSvc },
        { provide: UpstreamMediaService, useValue: { readUpstreamMediaId: vi.fn().mockResolvedValue(null), canonicalizeMediaRef: vi.fn().mockResolvedValue(undefined), resolveCallUrl: vi.fn().mockResolvedValue(undefined) } },   // Y1a T8：上游身份读源 mock（默认无上游图）
        { provide: ArtifactCommitService, useValue: artifactCommit },   // T10
      ],
    }).compile();
    service = module.get<ExecutionService>(ExecutionService);
  });

  it('should execute single node successfully', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });

    const result = await service.execute('p1', 'n2', 'default-user');
    expect(result.success).toBe(true);
    expect(teamCredit.reserve).toHaveBeenCalledWith('default-user', { intentRowId: 'intent-1', execSeq: 1n });
    // 预校验传项目所属团队 id（账本换源 TeamBalance）
    expect(validation.validateAll).toHaveBeenCalledWith(expect.any(Array), 't1', 'default-user');
  });

  it('should return error when validation fails', async () => {
    validation.validateAll.mockResolvedValue({ valid: false, errors: ['余额不足'], totalCost: 0, plans: [] });
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });

    const result = await service.execute('p1', undefined, 'default-user');
    expect(result.success).toBe(false);
    expect(result.errors[0].error).toContain('余额不足'); // Y0b-2 T5：errors 结构化 {nodeId,status,error}
    expect(apiCaller.callImageGen).not.toHaveBeenCalled();
    expect(teamCredit.reserve).not.toHaveBeenCalled();
  });

  it('should return error when project not found', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue(null);
    const result = await service.execute('bad-id', undefined, 'u1');
    expect(result.success).toBe(false);
    expect(result.errors[0].error).toContain('项目不存在');
  });

  // Y0b-2 T8（Z90/Z117）：Σdeadline 病态批硬闸——3×video=2700s > 默认 EXEC_SYNC_HARD_CAP(1_800_000ms)；
  // 2×video=1800s 恰=帽（默认值语义"同步组 ≤2×video"上限含端点）。env 未设档（EXEC_DEADLINE_VIDEO_MS 缺省 900_000）。
  it('T8：Σ deadlineForKind > EXEC_SYNC_HARD_CAP → 400 EXEC_SCOPE_TOO_LARGE（validation/外呼零触达）', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    topology.sort.mockImplementation((nodes: any[]) => nodes);   // 本用例直通（默认 mock 返固定 n1/n2——Σ 面失真）
    const videoNode = (i: number) => ({ id: `v${i}`, type: 'videoGen', data: { model: 'm' } });
    collabDoc.readCanvas.mockResolvedValue({ nodes: [videoNode(1), videoNode(2), videoNode(3)], edges: [] });
    const err = await service.execute('p1', undefined, 'u1', ['v1', 'v2', 'v3']).catch((e: unknown) => e);
    expect(err).toMatchObject({ errorCode: 'EXEC_SCOPE_TOO_LARGE' });
    expect((err as any).getStatus()).toBe(400);
    expect(validation.validateAll).not.toHaveBeenCalled();   // 门在 plan 校验之前（零外呼零冻结零意图行）
    expect(apiCaller.callVideoGen).not.toHaveBeenCalled();
  });

  it('T8：Σ = EXEC_SYNC_HARD_CAP（2×video）恰放行——判据=时长最坏上界非耗时预估（不误拒合法 2×video 批）', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    topology.sort.mockImplementation((nodes: any[]) => nodes);
    const videoNode = (i: number) => ({ id: `v${i}`, type: 'videoGen', data: { model: 'm' } });
    collabDoc.readCanvas.mockResolvedValue({ nodes: [videoNode(1), videoNode(2)], edges: [] });
    const result = await service.execute('p1', undefined, 'u1', ['v1', 'v2']);
    expect(result.success).toBe(true);   // 走完整执行链（mock 全绿档）
  });

  it('execute：VIEWER 403', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    permSvc.assertEditor.mockRejectedValue(new ForbiddenException('无项目编辑权限'));
    await expect(service.execute('p1', undefined, 'u1', undefined)).rejects.toThrow('无项目编辑权限');
    expect(permSvc.assertEditor).toHaveBeenCalledWith('p1', 'u1');
  });

  it('Y0a-3 计费读门（E49/V21）：lease 未持 → 503 且 getResponse().code=COLLAB_NOT_SERVING（对象体），零读零执行', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    collabDoc.isLeaseServing.mockReturnValue(false);
    const ex = await service.execute('p1', 'n2', 'default-user').catch((e: unknown) => e);
    expect(ex).toBeInstanceOf(ServiceUnavailableException);
    expect((ex as ServiceUnavailableException).getResponse()).toMatchObject({ code: 'COLLAB_NOT_SERVING' });
    expect(collabDoc.readCanvas).not.toHaveBeenCalled(); // fail-closed：不按陈旧快照烧钱
    expect(apiCaller.callImageGen).not.toHaveBeenCalled();
  });

  it('should handle credit deduction failure during execution', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    teamCredit.reserve.mockResolvedValue({ success: false });

    const result = await service.execute('p1', 'n2', 'u1');
    expect(result.success).toBe(false);
    // Y3 T8：emit error 断言随 emit 面删除——error 用户面唯一通道=writeExecStatus Feed（T3 断言族覆盖）
    const errFeed = collabDoc.writeExecStatus.mock.calls.find((c: any[]) => c[2]?.status === 'error');
    expect(errFeed).toBeTruthy();
  });

  it('T15 收口：deliver+done doc 写移除——交付归投影 poller（worker 零 writeBatch/零 done 投影/零退款：node 删除观察归 poller apply 守卫〔Z40 旧调用方契约随之退役〕）', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    teamCredit.rollbackDeliveryFailed = vi.fn().mockResolvedValue(true);
    const n9 = { id: 'n9', type: 'imageGen', data: { model: 'm1', resolution: 'r1' } };
    topology.getScope.mockReturnValue([n9]);
    topology.sort.mockReturnValue([n9]);
    collabDoc.readCanvas.mockResolvedValue({ nodes: [n9], edges: [] });
    collabDoc.writeNodeData.mockResolvedValue({ kind: 'business', written: false, reason: 'node-deleted' });   // 现状守卫语义（T15 后 worker 不再消费——poller apply 同款原语）

    const result = await service.execute('p1', undefined, 'u1', ['n9']);

    // 交付不再阻塞 worker 判定（乐观成功——doc 收敛归投影链；node 删→orphaned+退款在 poller）
    expect(result.success).toBe(true);
    expect(collabDoc.writeNodeData).not.toHaveBeenCalled();
    const doneCalls = collabDoc.writeExecStatus.mock.calls.filter((c: any[]) => c[2]?.status === 'done');
    expect(doneCalls).toHaveLength(0);   // exec done=投影 poller deliverArtifact 复合 op 专写
    expect(teamCredit.rollbackDeliveryFailed).not.toHaveBeenCalled();   // 退款归 poller orphaned 判定（幂等单入口语义保持）
  });

  it('T10：image 腿交付改 fileId=mediaId 同步落地——ai-result-download 入队删除（Media 已随 finalize 落库）', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });

    const result = await service.execute('p1', 'n2', 'default-user');
    expect(result.success).toBe(true);
    expect(artifactCommit.commitImage).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1', nodeId: 'n2', teamId: 't1', userId: 'default-user',
      intentRowId: 'intent-1', execSeq: 1n, expectedRev: 0, sourceUrl: '/mock/test.jpg',
    }));
    // Y3 T8：emit fileId 断言随 emit 面删除——交付锚=commitImage 本体（mediaId 由 finalize 事务产出，
    // 投影 poller deliverArtifact 复合 op 专写）。
  });

  it('T12：video 腿 finalize-first——finalizeVideo(sourceUrl=provider URL)+交付 fileId=mediaId（doc 无 videoUrl）+旧链 complete/settle 直调删除', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    topology.getScope.mockReturnValue([{ id: 'n3', type: 'videoGen', data: { model: 'm1', prompt: 'v' } }]);
    topology.sort.mockReturnValue([{ id: 'n3', type: 'videoGen', data: { model: 'm1', prompt: 'v' } }]);
    const result = await service.execute('p1', 'n3', 'default-user');
    expect(result.success).toBe(true);
    expect(artifactCommit.finalizeVideo).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1', nodeId: 'n3', teamId: 't1', userId: 'default-user',
      intentRowId: 'intent-1', execSeq: 1n, expectedRev: 0,
      sourceUrl: '/mock/video.mp4', sourceMimeType: 'video/mp4',
    }));
    // 旧链退役面：intentService.complete/teamCredit.settle 直调删除（settle 归 finalize 事务内）
    expect(intentSvc.complete).not.toHaveBeenCalled();
    expect(teamCredit.settle).not.toHaveBeenCalled();
    // 交付键唯一 fileId=mediaId——Y3 T8：emit 断言随 emit 面删除（交付值=finalizeVideo 事务产出，
    // 投影 poller 复合 op 专写；doc 无 videoUrl 由 T15 段 writeNodeData 零调断言钉守）。
  });

  it('T12：video replay 产物键=fileId（resultRef=mediaId）——videoUrl 写点删除', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    topology.getScope.mockReturnValue([{ id: 'n3', type: 'videoGen', data: { model: 'm1', prompt: 'v' } }]);
    topology.sort.mockReturnValue([{ id: 'n3', type: 'videoGen', data: { model: 'm1', prompt: 'v' } }]);
    intentSvc.claim.mockResolvedValueOnce({
      created: false, result: 'replay', artifactRev: 0,
      intent: { id: 'intent-replay', intentId: 'i-replay', execSeq: 1n, attempts: 1, resultRef: 'media-replay' },
    });
    const result = await service.execute('p1', 'n3', 'default-user');
    expect(result.success).toBe(true);
    // replay 产物键=fileId（resultRef=mediaId）——Y3 T8：emit 断言随 emit 面删除（重放臂零 emit 零 doc 写，
    // 交付归投影行；本用例价值=重放不进失败链——success 断言钉守）。
  });

  it('T10：text 腿 finalizeText+交付只写 {result}（content 回显删除）', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    collabDoc.readCanvas.mockResolvedValue({ nodes: [{ id: 'n1', type: 'textInput', data: { content: 'hello', model: 'm-text' } }], edges: [] });
    topology.sort.mockImplementation((nodes: any[]) => nodes);   // 直通（默认 mock 返固定 n1+n2——单节点断言被污染）
    const result = await service.execute('p1', undefined, 'default-user', ['n1']);   // n1=textInput（单节点作用域）
    expect(result.success).toBe(true);
    expect(artifactCommit.finalizeText).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1', nodeId: 'n1', resultText: 'hello', expectedRev: 0,
    }));
  });

  it('T10 资金独立判调用方面：superseded → doc 不覆盖用户值（仅 done 投影批）+实扣照计；intent-stale → INTENT_DEADLINE_EXCEEDED 早退', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    const n2Only = { id: 'n2', type: 'imageGen', data: { model: 'm1', resolution: 'r1' } };
    collabDoc.readCanvas.mockResolvedValue({ nodes: [n2Only], edges: [] });
    topology.sort.mockImplementation((nodes: any[]) => nodes);
    artifactCommit.commitImage.mockResolvedValueOnce({ outcome: 'superseded', mediaId: 'media-x' });
    const r1 = await service.execute('p1', undefined, 'default-user', ['n2']);   // 单节点作用域（默认拓扑 n1+n2 双扣）
    expect(r1.success).toBe(true);   // superseded 非节点失败（产物已入库）
    expect(r1.totalCost).toBe(5);    // 照常实扣（无条件退款即红）
    artifactCommit.commitImage.mockResolvedValueOnce({ outcome: 'intent-stale' });
    const r2 = await service.execute('p1', undefined, 'default-user', ['n2']);
    expect(r2.success).toBe(false);
    expect(r2.errors[0]).toMatchObject({ errorCode: 'INTENT_DEADLINE_EXCEEDED' });
    expect(r2.totalCost).toBe(0);
  });

  // Y3 T8：credits 搭车 emit 用例×2 随 /execution 退役删除——余额刷新归 D1 REST 事件驱动（T6 已实现：
  // 终态 Feed→credits:update 空信号→CanvasTopBar 静默重拉；runtimeStore.d1.spec/creditsStore.test 载体）。

  describe('风格拼接与面板 prompt 断链（spec §7.1/§7.2，D12/D28）', () => {
    beforeEach(() => {
      prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' }); // :40 早退基线（B5）
      prisma.style.findMany.mockResolvedValue([]);
    });

    it('D12：独立图片节点（无上游文本）data.prompt.text 进 prompt', async () => {
      topology.getScope.mockReturnValue([
        { id: 'n2', type: 'imageGen', data: { model: 'm1', prompt: { text: '面板词', html: '面板词' } } },
      ]);
      topology.sort.mockReturnValue([
        { id: 'n2', type: 'imageGen', data: { model: 'm1', prompt: { text: '面板词', html: '面板词' } } },
      ]);
      topology.collectUpstreamData.mockResolvedValue({ textContents: [], imageMediaId: undefined });
      await service.execute('p1', 'n2', 'u1');
      expect(apiCaller.callImageGen).toHaveBeenCalledWith(expect.objectContaining({ prompt: '面板词' }));
      expect(prisma.style.findMany).not.toHaveBeenCalled(); // 无 styleId 批次零查询（B19）
    });

    it('风格拼接：styleId → 批量 findMany 取 active promptText，join(", ") 到 prompt', async () => {
      prisma.style.findMany.mockResolvedValue([{ id: 'st1', active: true, promptText: '风格词' }]);
      topology.sort.mockReturnValue([
        { id: 'n1', type: 'textInput', data: { content: '上游词', model: 'm-text' } },
        { id: 'n2', type: 'imageGen', data: { model: 'm1', styleId: 'st1' } },
      ]);
      topology.collectUpstreamData.mockResolvedValue({ textContents: ['上游词'], imageMediaId: undefined });
      await service.execute('p1', 'n2', 'u1');
      expect(prisma.style.findMany).toHaveBeenCalledWith({ where: { id: { in: ['st1'] } } });
      expect(apiCaller.callImageGen).toHaveBeenCalledWith(expect.objectContaining({ prompt: '上游词, 风格词' }));
    });

    it('inactive/不存在风格 → 忽略不阻塞（B1）', async () => {
      prisma.style.findMany.mockResolvedValue([{ id: 'st1', active: false, promptText: '风格词' }]);
      topology.getScope.mockReturnValue([
        { id: 'n2', type: 'imageGen', data: { model: 'm1', styleId: 'st1' } },
      ]);
      topology.sort.mockReturnValue([
        { id: 'n2', type: 'imageGen', data: { model: 'm1', styleId: 'st1' } },
      ]);
      topology.collectUpstreamData.mockResolvedValue({ textContents: ['上游词'], imageMediaId: undefined });
      await service.execute('p1', 'n2', 'u1');
      expect(apiCaller.callImageGen).toHaveBeenCalledWith(expect.objectContaining({ prompt: '上游词' }));
    });

    it('视频分支：finalPrompt 拼风格 + 面板清空 prompt 不传对象（D28 删回退）', async () => {
      prisma.style.findMany.mockResolvedValue([{ id: 'st1', active: true, promptText: '风格词V' }]);
      topology.getScope.mockReturnValue([
        { id: 'n3', type: 'videoGen', data: { model: 'vm', styleId: 'st1', prompt: { text: '', html: '' } } },
      ]);
      topology.sort.mockReturnValue([
        { id: 'n3', type: 'videoGen', data: { model: 'vm', styleId: 'st1', prompt: { text: '', html: '' } } },
      ]);
      topology.collectUpstreamData.mockResolvedValue({ textContents: [], imageMediaId: undefined });
      await service.execute('p1', 'n3', 'u1');
      const arg = apiCaller.callVideoGen.mock.calls[0][0] as { prompt: unknown };
      expect(arg.prompt).toBe('风格词V');           // 纯风格文本（面板为空）
      expect(typeof arg.prompt).toBe('string');      // 不再序列化 PromptValue 对象
    });

    it('B21：有上游文本时面板 prompt 被忽略（|| 链上游优先——有意语义，防误改合并）', async () => {
      topology.sort.mockReturnValue([
        { id: 'n1', type: 'textInput', data: { content: '上游词', model: 'm-text' } },
        { id: 'n2', type: 'imageGen', data: { model: 'm1', prompt: { text: '面板词', html: '面板词' } } },
      ]);
      topology.collectUpstreamData.mockResolvedValue({ textContents: ['上游词'], imageMediaId: undefined });
      await service.execute('p1', 'n2', 'u1');
      const arg = apiCaller.callImageGen.mock.calls[0][0] as { prompt: string };
      expect(arg.prompt).toBe('上游词'); // 不含 '面板词'
    });

    it('Y1c T2/T15：textInput prompt={text}（Y.Map{text:Y.Text} 读模型）直读——无上游时不落 content 串位（:512 改前 .text 恒 miss 根修）', async () => {
      // Y1c T15 迁移后形态：textInputs prompt=Y.Map{text:Y.Text}——readCanvas 读模型={text:string}
      // （改前 T2 时点为 data.prompt:string——:512 data?.prompt?.text 对 string 恒 miss ⇒ 正文
      // content 串位成 prompt，面板 prompt 执行链断供——resolvePromptText 单源两腿对号）。
      const textNode = { id: 'n1', type: 'textInput', data: { content: '正文在案', prompt: { text: '面板提示词' }, model: 'm-text' } };
      topology.getScope.mockReturnValue([textNode]);
      topology.sort.mockReturnValue([textNode]);
      topology.collectUpstreamData.mockResolvedValue({ textContents: [], imageMediaId: undefined }); // 无上游文本
      const result = await service.execute('p1', 'n1', 'u1');
      expect(result.success).toBe(true); // text 腿完整执行（防断言因未执行假红）
      expect(apiCaller.callTextGen).toHaveBeenCalledWith(expect.objectContaining({ prompt: '面板提示词' }));
    });

    it('Y1c T15：audioGen prompt=Y.Text 读模型 string 直读（content 键已退册——不落 content 回落）', async () => {
      // T15 同卡迁：audioGen content:string → prompt:Y.Text——readCanvas 读模型 prompt=string
      //（resolvePromptText string 腿对号；旧 content 回落腿对 audioGen 结构性不可达）。
      const audioNode = { id: 'a1', type: 'audioGen', data: { model: 'm-audio', prompt: '音频旁白词' } };
      topology.getScope.mockReturnValue([audioNode]);
      topology.sort.mockReturnValue([audioNode]);
      topology.collectUpstreamData.mockResolvedValue({ textContents: [], imageMediaId: undefined });
      await service.execute('p1', 'a1', 'u1');
      expect(apiCaller.callImageGen).toHaveBeenCalledWith(expect.objectContaining({ prompt: '音频旁白词' }));
    });
  });

  // ── Y1c T23：text 生成链外呼锚（v1.6 纪律收口——spec §6.3 偏离 36-④）：write-ahead
  //    providerRequestId（kind!=='text' 铸键跳过=零键零锚——rearm 重试无屏障重复外呼根修）
  //    +UNKNOWN 纪律（超时/5xx→reserve 保留不自动重呼不自动解冻——用户显式重试才开新 attempt）。 ──
  describe('Y1c T23：text 链外呼锚+UNKNOWN 纪律', () => {
    const textNode = { id: 'n1', type: 'textInput', data: { content: '正文', prompt: { text: '面板词' }, model: 'm-text' } };
    const primeText = () => {
      prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
      topology.getScope.mockReturnValue([textNode]);
      topology.sort.mockReturnValue([textNode]);
      topology.collectUpstreamData.mockResolvedValue({ textContents: [], imageMediaId: undefined });
    };

    it('红④：text 外呼前铸 write-ahead providerRequestId 并随 callTextGen 下发（X-Idempotency-Key——rearm 屏障）', async () => {
      primeText();
      await service.execute('p1', 'n1', 'u1');
      // 现状（红）：:372 `kind !== 'text'` 才铸键——text 链 ensureProviderRequestId 零调用+callTextGen 零键
      expect(intentSvc.ensureProviderRequestId).toHaveBeenCalledWith('intent-1', 1n);
      expect(apiCaller.callTextGen).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'rid-t9' }));
    });

    it('T23 UNKNOWN：text 外呼超时/5xx（TEXT_PROVIDER_UNKNOWN）→ markUnknown+保留冻结——禁 void_/fail 自动重呼', async () => {
      primeText();
      const { BusinessException } = await import('../../common/exceptions/business.exception');
      apiCaller.callTextGen.mockRejectedValueOnce(new BusinessException('TEXT_PROVIDER_UNKNOWN', 'text 外呼结果不明（超时/5xx）', 504));
      const result = await service.execute('p1', 'n1', 'u1');
      expect(result.success).toBe(false);
      // UNKNOWN 纪律：reserve 在 UNKNOWN 期间保留（不 void_）+不置 FAILED（不 fail）——行入 UNKNOWN 档
      expect(intentSvc.markUnknown).toHaveBeenCalledWith('intent-1', expect.any(String), 1n);
      expect(teamCredit.void_).not.toHaveBeenCalled();
      expect(intentSvc.fail).not.toHaveBeenCalled();
      // 用户可见文案：「可能重复生成、不会重复扣费」（诚实登记——外部 at-least-once）
      const errorEntry = result.errors.find((e: any) => e.nodeId === 'n1');
      expect(errorEntry?.error).toContain('不会重复扣费');
    });

    it('T23 收口 M-3：markUnknown 落库失败窗（行留 RUNNING=UNKNOWN 纪律失效交 reaper）——文案分档换中性承诺+遥测计数，禁推「不会重复扣费」', async () => {
      primeText();
      const { BusinessException } = await import('../../common/exceptions/business.exception');
      apiCaller.callTextGen.mockRejectedValueOnce(new BusinessException('TEXT_PROVIDER_UNKNOWN', 'text 外呼结果不明（超时/5xx）', 504));
      intentSvc.markUnknown.mockRejectedValueOnce(new Error('db down'));   // 停驻失败窗
      const result = await service.execute('p1', 'n1', 'u1');
      expect(result.success).toBe(false);
      const errorEntry = result.errors.find((e: any) => e.nodeId === 'n1');
      expect(errorEntry?.error).toContain('待对账');           // 中性文案（红：现状失败窗仍推确定性承诺）
      expect(errorEntry?.error).not.toContain('不会重复扣费');
    });
  });

  // ── Y0c T12（裁决 4·Z122②）：单节点写段 ≤2 结构断言族——instrument 三写入口
  // （collabDoc.writeExecStatus 按分支逐档断言——T32 后 doc 写面仅此一投影写。）
  // 计数判据=已执行（resolved）的写段：writeBatch reject=基础设施失败零写入不入计（B-1 档）——
  // 「第三写注入⇒红」变红证明见 commit message（临时注入后还原，元纪律⑥）。 ──
  describe('Y0c T12 单节点写段 ≤2 结构断言族（三写入口 instrument）', () => {
    const n2Image = { id: 'n2', type: 'imageGen', data: { model: 'm1', resolution: 'r1' } };
    let cnt: { exec: number; data: number; batch: number };
    let writeEntries: () => number;

    beforeEach(() => {
      cnt = { exec: 0, data: 0, batch: 0 };
      writeEntries = () => cnt.exec + cnt.data;
      // 独立计数实现（T32：writeBatch 门面退役——batch 档归零，计数面=exec 投影/doc data 两档）
      collabDoc.writeExecStatus.mockImplementation(async () => { cnt.exec += 1; });
      collabDoc.writeNodeData.mockImplementation(async () => { cnt.data += 1; return { kind: 'business', written: true }; });
      prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    });

    /** 单节点（n2/imageGen）作用域——计数隔离（默认拓扑 n1+n2 会双节点叠加） */
    const scopedToN2 = () => {
      topology.getScope.mockReturnValue([n2Image]);
      topology.sort.mockReturnValue([n2Image]);
      collabDoc.readCanvas.mockResolvedValue({ nodes: [n2Image], edges: [] });
    };

    // 下界（T12 质量收尾 I-1）：各分支「确实写」——0 写也绿=投影被误删的回归抓不住。
    // T15 收口后：worker 写面只余 exec 投影（loading/skipped/error）——happy 档精确 toBe(1)；
    // 其余档 ≤2 且 ≥1（旧上限随 deliver 批退役自然宽放，下界不动）。
    it('happy：loading 投影唯一写段（T15：deliver+done 归投影 poller——恰 1 段）', async () => {
      scopedToN2();
      await service.execute('p1', 'n2', 'u1');
      expect(writeEntries()).toBe(1); // loading 1——交付批/doc data 写零触达
      expect(cnt.batch).toBe(0);   // T32：writeBatch 门面退役——批档恒 0（写面仅 exec 投影）
    });

    it('plan-missing：PLAN_MISSING error 投影 ⇒ ≤2 且 ≥1', async () => {
      scopedToN2();
      validation.validateAll.mockResolvedValue({
        valid: true, errors: [], totalCost: 0,
        plans: [{ nodeId: 'other', pricingRuleId: 'pr', modelId: null, resolutionId: null, durationId: null, creditCost: 5 }],
      });
      await service.execute('p1', 'n2', 'u1');
      expect(writeEntries()).toBeGreaterThanOrEqual(1); // error 投影写
      expect(writeEntries()).toBeLessThanOrEqual(2);
    });

    it('duplicate-attempt（reserve mayCall:false→skipped 退出）⇒ ≤2 且 ≥1', async () => {
      scopedToN2();
      teamCredit.reserve.mockResolvedValue({ success: true, mayCall: false });
      await service.execute('p1', 'n2', 'u1');
      expect(writeEntries()).toBeGreaterThanOrEqual(1); // loading+skipped 投影写
      expect(writeEntries()).toBeLessThanOrEqual(2);
    });

    it('reserve-fail：onReserveFail error 投影 ⇒ ≤2 且 ≥1', async () => {
      scopedToN2();
      teamCredit.reserve.mockResolvedValue({ success: false, reason: 'INSUFFICIENT_CREDITS' });
      await service.execute('p1', 'n2', 'u1');
      expect(writeEntries()).toBeGreaterThanOrEqual(1); // loading+onReserveFail error 投影写
      expect(writeEntries()).toBeLessThanOrEqual(2);
    });

    it('deadline（complete gated=0→VOIDED error 投影）⇒ ≤2 且 ≥1', async () => {
      scopedToN2();
      intentSvc.complete.mockResolvedValue(0);
      await service.execute('p1', 'n2', 'u1');
      expect(writeEntries()).toBeGreaterThanOrEqual(1); // loading+VOIDED error 投影写
      expect(writeEntries()).toBeLessThanOrEqual(2);
    });

    it('T15：node 删除观察归 poller——worker 交付段零写零退款（written:false 旧契约退役）⇒ 恰 1 段（loading）', async () => {
      scopedToN2();
      teamCredit.rollbackDeliveryFailed = vi.fn().mockResolvedValue(true);
      await service.execute('p1', undefined, 'u1', ['n2']);
      expect(writeEntries()).toBe(1); // loading 1——交付批零触达（node 删→orphaned+退款=投影 poller 面）
      expect(teamCredit.rollbackDeliveryFailed).not.toHaveBeenCalled();
    });

    it('T15：finalize 后残余段抛错（B-1 SUCCEEDED 防御档）⇒ 零退款零 error 投影（交付归投影链——仅 loading 1 段）', async () => {
      scopedToN2();
      teamCredit.rollbackDeliveryFailed = vi.fn().mockResolvedValue(true);
      prisma.generationIntent = { findUnique: vi.fn().mockResolvedValue({ status: 'SUCCEEDED' }) };
      // Y3 T8：残余段 throw 注入位改 releaseAuthorSlot（emit 已删——残余段=release+results 记账）；
      // 但 throw release 会包 AuthorSlotReleaseError 首位 re-throw——改走 results.push 不可注入，
      // 故本档改由「SUCCEEDED 行+finalize committed 正常返回」直证：残余段零写面=writeEntries 仍 1。
      await service.execute('p1', undefined, 'u1', ['n2']);
      expect(writeEntries()).toBe(1); // loading 1——B-1 防御档零投影写（error 会与 poller done 对撞）
      expect(teamCredit.rollbackDeliveryFailed).not.toHaveBeenCalled(); // 退款归 poller orphaned（双跑退款面根除）
    });

    it('claim 过期（reanchorDeadline=0→早退零外呼）⇒ ≤2 且 ≥1', async () => {
      scopedToN2();
      intentSvc.reanchorDeadline.mockResolvedValue(0);
      await service.execute('p1', 'n2', 'u1');
      expect(writeEntries()).toBeGreaterThanOrEqual(1); // loading 投影写（claim 成功即写，先于 reanchor）
      expect(writeEntries()).toBeLessThanOrEqual(2);
    });

    it('NodeBusy skipped（claim throw→Z99 skipped 投影）⇒ ≤2 且 ≥1', async () => {
      scopedToN2();
      intentSvc.claim.mockRejectedValue(new NodeBusyError());
      await service.execute('p1', 'n2', 'u1');
      expect(writeEntries()).toBeGreaterThanOrEqual(1); // skipped 投影写
      expect(writeEntries()).toBeLessThanOrEqual(2);
    });

    it('通用 catch error（外呼抛错→error 投影）⇒ ≤2 且 ≥1', async () => {
      scopedToN2();
      apiCaller.callImageGen.mockRejectedValue(new Error('boom'));
      prisma.generationIntent = { findUnique: vi.fn().mockResolvedValue({ status: 'RUNNING' }) }; // catch 段 B-1 判读（RUNNING≠SUCCEEDED→通用 catch）
      await service.execute('p1', 'n2', 'u1');
      expect(writeEntries()).toBeGreaterThanOrEqual(1); // loading+error 投影写
      expect(writeEntries()).toBeLessThanOrEqual(2);
    });

    it('T15：replay 段收口——SUCCEEDED 重放 ⇒ 零 doc 写（writeBatch/单写入口全零——交付归投影行）+写段 0', async () => {
      scopedToN2();
      intentSvc.claim.mockResolvedValue({
        created: false,
        intent: { id: 'gi-1', intentId: 'i-1', resultRef: '/mock/replay.png', attempts: 2 },
      });

      await service.execute('p1', 'n2', 'u1');
      expect(collabDoc.writeExecStatus).not.toHaveBeenCalled();   // 单写入口零调用
      expect(collabDoc.writeNodeData).not.toHaveBeenCalled();
      // Y3 T8：emit done 断言随 emit 面删除（重放臂零 doc 写零 emit——交付归投影行）。
      expect(writeEntries()).toBe(0);
    });
  });

  // ── F1 资金硬门执行面（用户裁定①）：FundsInvariantError 传播到 catch ⇒ 禁自动退款（void_）/
  //    禁 fail（置 FAILED）——歧义态行保持 RUNNING+冻结原样，交对账第四分支裁决；用户面
  //    FUNDS_INVARIANT_VIOLATION error+error 级日志打点。 ──
  describe('F1 资金硬门：FundsInvariantError catch 分支（不 void_/不 fail——行留 RUNNING 交对账）', () => {
    const n2Image = { id: 'n2', type: 'imageGen', data: { model: 'm1', resolution: 'r1' } };

    it('不 void_、不 intentService.fail、logger.error 打点、writeExecStatus 用户面 error（FUNDS_INVARIANT_VIOLATION——Y3 T8：emit 面已删 Feed=唯一用户面）', async () => {
      prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
      topology.getScope.mockReturnValue([n2Image]);
      topology.sort.mockReturnValue([n2Image]);
      collabDoc.readCanvas.mockResolvedValue({ nodes: [n2Image], edges: [] });
      // 同代 RUNNING 行（默认 prisma.generationIntent.findUnique 夹具——catch 判读不进换代让位/SUCCEEDED 档）
      artifactCommit.commitImage.mockRejectedValueOnce(new FundsInvariantError({
        intentRowId: 'intent-1', execSeq: 1n, creditCost: 5, reservedCredits: 0, creditsConsumed: 0, reservedExecSeq: null,
      }));
      const loggerSpy = vi.spyOn((service as any).logger, 'error');

      const result = await service.execute('p1', undefined, 'u1', ['n2']);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatchObject({ nodeId: 'n2', status: 'error', errorCode: 'FUNDS_INVARIANT_VIOLATION' });
      // 资金禁自动动作：不 void_（解冻退款）、不 fail（置 FAILED）——行留 RUNNING+冻结原样
      expect(teamCredit.void_).not.toHaveBeenCalled();
      expect(intentSvc.fail).not.toHaveBeenCalled();
      // error 级打点（携带意图行 id——资金不变量破缺=对账介入信号）
      expect(loggerSpy).toHaveBeenCalledTimes(1);
      expect(String(loggerSpy.mock.calls[0][0])).toContain('intent-1');
      // 用户面：writeExecStatus errorPatch（文案=暂缓交付待对账——Y3 T8：emit 面已删，Feed=唯一用户面）
      expect(collabDoc.writeExecStatus).toHaveBeenCalledWith('p1', 'n2', expect.objectContaining({
        status: 'error', errorCode: 'FUNDS_INVARIANT_VIOLATION',
      }), expect.anything());
    });
  });

// ══════════ Y2 B2c：受理捕获+工作集封口+释放（先红——v2.9 a/b/c/d/g/h/i 核心）══════════
describe('Y2 B2c 受理捕获+工作集封口+释放（先红）', () => {
  // 装置复用主 beforeEach（全 mock）；authorSlots 表/释放面在此按用例注入
  beforeEach(() => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
  });
  const NODES = [
    { id: 'n1', type: 'textInput', data: { content: 'hi', model: 'm-text' } },
    { id: 'n2', type: 'imageGen', data: { model: 'm1', resolution: 'r1' } },
    { id: 'n3', type: 'imageGen', data: { model: 'm1', resolution: 'r1' } },
  ];

  it('c-① 工作集封口：带表路径 scope=表键集∩当帧（表外新增节点不入本 job——claim/外呼零触达）', async () => {
    collabDoc.readCanvas.mockResolvedValue({ nodes: NODES, edges: [] });
    topology.getScope.mockReturnValue(NODES);
    topology.sort.mockImplementation((nodes: unknown[]) => nodes);
    await service.execute('p1', undefined, 'u1', undefined, undefined, undefined, undefined, undefined, undefined, { n2: 'm-author-2' });
    const claimedNodes = intentSvc.claim.mock.calls.map((c: any[]) => c[0].nodeId);
    expect(claimedNodes).toEqual(['n2']);   // 表键集={n2}——n1/n3 不入（getScope 结果被封口）
  });

  it('claim 真值：表内 frozen:true+槽值 / 表外防御档 false+null（B2c 起画布 claim 零 false 字面量——真值源=表）', async () => {
    collabDoc.readCanvas.mockResolvedValue({ nodes: NODES, edges: [] });
    topology.getScope.mockReturnValue(NODES);
    topology.sort.mockImplementation((nodes: unknown[]) => nodes);
    await service.execute('p1', undefined, 'u1', undefined, undefined, undefined, undefined, undefined, undefined, { n2: 'm-author-2' });
    const arg = intentSvc.claim.mock.calls[0][0];
    expect(arg.authorSlotFrozen).toBe(true);
    expect(arg.authorMediaId).toBe('m-author-2');
    // 无表直达=受理时点即 execute 开头快照——内存表现算 frozen:true+槽值（动态值非占位字面量；
    // 夹具节点无 mediaId 键 → null 如实）
    intentSvc.claim.mockClear();
    await service.execute('p1', undefined, 'u1');
    for (const c of intentSvc.claim.mock.calls) {
      expect(c[0].authorSlotFrozen).toBe(true);
      expect(c[0].authorMediaId).toBe(null);
    }
  });

  it('回放两档：作废键命中→零释放零 doc 写 / 未命中→release 置位（Y3 T8：emit 面删除断言改释放面）', async () => {
    collabDoc.readCanvas.mockResolvedValue({ nodes: [NODES[1]!], edges: [] });
    topology.sort.mockImplementation((nodes: unknown[]) => nodes);
    collabDoc.readAuthorSlot = vi.fn().mockResolvedValue({ nodeId: 'n2', kind: 'image', frozen: true, authorMediaId: 'm-author-2', liveMediaId: 'm-author-2' });
    collabDoc.releaseAuthorSlot = vi.fn().mockResolvedValue({ released: true, deletedSlot: true, bindingStats: { written: 0, skipped: { missing: 0, 'cross-team': 0, 'soft-deleted': 0 } } });
    prisma.artifactProjection = { findUnique: vi.fn() };

    // 档一：作废键命中（回放臂先查精确作废键）——零释放零 doc 写
    prisma.artifactProjection.findUnique.mockResolvedValueOnce({ artifactId: 'x', state: 'superseded' });
    intentSvc.claim.mockResolvedValueOnce({ created: false, result: 'replay', artifactRev: 0, intent: { id: 'intent-1', intentId: 'i-1', execSeq: 1n, attempts: 1, resultRef: 'm-old', nodeId: 'n2' } });
    await service.execute('p1', undefined, 'u1');
    expect(collabDoc.releaseAuthorSlot).not.toHaveBeenCalled();
    expect(collabDoc.writeExecStatus).not.toHaveBeenCalled();

    // 档二：未命中——release（幂等补释放）+零 doc 写
    prisma.artifactProjection.findUnique.mockResolvedValueOnce(null);
    intentSvc.claim.mockResolvedValueOnce({ created: false, result: 'replay', artifactRev: 0, intent: { id: 'intent-1', intentId: 'i-1', execSeq: 1n, attempts: 1, resultRef: 'm-old', nodeId: 'n2' } });
    await service.execute('p1', undefined, 'u1');
    expect(collabDoc.releaseAuthorSlot).toHaveBeenCalledWith('p1', 'intent-1');
    expect(collabDoc.writeExecStatus).not.toHaveBeenCalled();
  });

  it('g 败臂：fresh finalize superseded→不释放（作者键保留——用户已换面）∧零 doc done 写', async () => {
    collabDoc.readCanvas.mockResolvedValue({ nodes: [{ ...NODES[1]!, data: { ...NODES[1]!.data, mediaId: 'm-author-2' } }], edges: [] });
    topology.sort.mockImplementation((nodes: unknown[]) => nodes);
    collabDoc.readAuthorSlot = vi.fn().mockResolvedValue({ nodeId: 'n2', kind: 'image', frozen: true, authorMediaId: 'm-author-2', liveMediaId: 'm-user-replaced' });
    collabDoc.releaseAuthorSlot = vi.fn();
    // 冻结列=受理捕获；现场槽在外呼返回后已换成别的 id（authorVoid，不释放）
    collabDoc.readCanvas.mockResolvedValue({ nodes: [{ ...NODES[1]!, data: { ...NODES[1]!.data, mediaId: 'm-author-2' } }], edges: [] });
    artifactCommit.commitImage.mockResolvedValueOnce({ outcome: 'superseded', mediaId: 'm-gen' });
    await service.execute('p1', undefined, 'u1');
    expect(collabDoc.releaseAuthorSlot).not.toHaveBeenCalled();   // superseded 不释放（作者键保留）
    const doneCalls = collabDoc.writeExecStatus.mock.calls.filter((c: any[]) => c[2]?.status === 'done');
    expect(doneCalls).toHaveLength(0);   // 作废档零 done 写（Y3 T8：emit fileId 断言随之退役）
  });

  it('h 新鲜 committed：release 失败上抛（AuthorSlotReleaseError 首位 re-throw——emit 已删，顺序锚改「release 后零 doc 写」）∧ slot≠冻结值→deletedSlot=false 幂等', async () => {
    collabDoc.readCanvas.mockResolvedValue({ nodes: [{ ...NODES[1]!, data: { ...NODES[1]!.data, mediaId: 'm-author-2' } }], edges: [] });
    topology.sort.mockImplementation((nodes: unknown[]) => nodes);
    collabDoc.readAuthorSlot = vi.fn().mockResolvedValue({ nodeId: 'n2', kind: 'image', frozen: true, authorMediaId: 'm-author-2', liveMediaId: 'm-author-2' });
    // 现场槽=冻结值（相等→正常胜臂 committed——release 补上）
    collabDoc.readCanvas.mockResolvedValue({ nodes: [{ ...NODES[1]!, data: { ...NODES[1]!.data, mediaId: 'm-author-2' } }], edges: [] });
    collabDoc.releaseAuthorSlot = vi.fn(async () => ({ released: true, deletedSlot: false, bindingStats: { written: 0, skipped: { missing: 0, 'cross-team': 0, 'soft-deleted': 0 } } }));
    artifactCommit.commitImage.mockResolvedValueOnce({ outcome: 'committed', mediaId: 'm-gen', key: 'k' });
    await service.execute('p1', undefined, 'u1');
    expect(collabDoc.releaseAuthorSlot).toHaveBeenCalledWith('p1', 'intent-1');   // release 幂等补上（失败可穿透不产假终态）
    const doneCalls = collabDoc.writeExecStatus.mock.calls.filter((c: any[]) => c[2]?.status === 'done');
    expect(doneCalls).toHaveLength(0);   // worker 侧零 done 写（done=投影 poller 专写——Y3 T8 emit 退役后此锚钉死「无第二写面」）
  });

  it('i same-job-alive：零 release 调用（前置 return 顺序不变量）', async () => {
    collabDoc.readCanvas.mockResolvedValue({ nodes: [NODES[1]!], edges: [] });
    topology.sort.mockImplementation((nodes: unknown[]) => nodes);
    collabDoc.readAuthorSlot = vi.fn();
    collabDoc.releaseAuthorSlot = vi.fn();
    intentSvc.claim.mockResolvedValueOnce({ created: false, result: 'same-job-alive', artifactRev: 0, intent: { id: 'intent-1', intentId: 'i-1', execSeq: 1n, attempts: 1, nodeId: 'n2' } });
    await service.execute('p1', undefined, 'u1');
    expect(collabDoc.readAuthorSlot).not.toHaveBeenCalled();
    expect(collabDoc.releaseAuthorSlot).not.toHaveBeenCalled();
  });
});

// ══════════ Y3 Task3：feedError 全调用点改道（断言①②⑤⑥⑦+⑮——先红）══════════
//    errorPatch :167 退役——一切 error 投影经 shared feedError（句子封闭+身份键恒写+rearmable 按码）；
//    loading/skipped 补 execSeq（mergeSlot 代际规则生效前提）；作废臂零 done 写（归 poller）。
describe('Y3 Task3：feedError 改道+execSeq 补臂+作废臂零 done 写（先红）', () => {
  const n2Image = { id: 'n2', type: 'imageGen', data: { model: 'm1', resolution: 'r1' } };
  const scopedToN2 = () => {
    topology.getScope.mockReturnValue([n2Image]);
    topology.sort.mockReturnValue([n2Image]);
    collabDoc.readCanvas.mockResolvedValue({ nodes: [n2Image], edges: [] });
  };

  /** ⑤ 主路径 PLAN_MISSING：Feed error='节点缺少定价快照'（封闭句——无节点 id 拼接）+无行档
   *  rearmable:false+无 intentId 键（feedError(code,'PLAN_MISSING',null)）。 */
  it('⑤⑥ PLAN_MISSING：Feed={errorCode:"PLAN_MISSING",error:"节点缺少定价快照"} 封闭句（无节点 id 子串）+无行档 rearmable:false+无 intentId/execSeq 键', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    scopedToN2();
    validation.validateAll.mockResolvedValue({
      valid: true, errors: [], totalCost: 0,
      plans: [{ nodeId: 'other', pricingRuleId: 'pr', modelId: null, resolutionId: null, durationId: null, creditCost: 5 }],
    });
    await service.execute('p1', 'n2', 'u1');
    const planCall = collabDoc.writeExecStatus.mock.calls.find((c: any[]) => c[2]?.errorCode === 'PLAN_MISSING');
    expect(planCall).toBeTruthy();
    const patch = planCall![2] as Record<string, unknown>;
    expect(patch.error).toBe('节点缺少定价快照');   // 封闭句——旧句「节点 n2 无定价快照…」被整段替
    expect(patch.error).not.toContain(n2Image.id);   // 不拼节点 id
    expect(patch.rearmable).toBe(false);              // 无行档 rearmable:false（旧 attempts<3 默认值结构上仍 false——本断言钉形状）
    expect(patch.attempts).toBe(0);
    expect('intentId' in patch).toBe(false);          // 无行档不写身份键
    expect('execSeq' in patch).toBe(false);
    // errors[] 展示面（HTTP 响应非 Feed——原 msg 保留可拼 id）
    // （errors[].error 保持原样——发起者响应体非团队投影面，零禁令）
  });

  /** ⑦ TEXT_PROVIDER_UNKNOWN 两档：marked 选 TEXT_UNKNOWN_HELD/unmarked 选 TEXT_UNKNOWN_UNMARKED
   *  （无 err.message 前缀）+attempts=行值+rearmable 恒 true（attempts=3 档也 true）。 */
  it('⑦ TEXT_PROVIDER_UNKNOWN 两档：marked→TEXT_UNKNOWN_HELD/unmarked→TEXT_UNKNOWN_UNMARKED（封闭句正文——无 err.message 前缀）+rearmable 恒 true', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    const { BusinessException: BE } = await import('../../common/exceptions/business.exception');
    // marked=1 档（markUnknown 成功——可能重复生成句）
    {
      const textNode = { id: 'n1', type: 'textInput', data: { content: 'hi', model: 'm-text' } };
      topology.getScope.mockReturnValue([textNode]);
      topology.sort.mockReturnValue([textNode]);
      collabDoc.readCanvas.mockResolvedValue({ nodes: [textNode], edges: [] });
      topology.collectUpstreamData.mockResolvedValue({ textContents: [], imageMediaId: undefined });
      apiCaller.callTextGen.mockRejectedValueOnce(new BE('TEXT_PROVIDER_UNKNOWN', 'boom http 原文', 504));
      intentSvc.markUnknown.mockResolvedValueOnce(1);   // 停驻成功
      intentSvc.claim.mockResolvedValueOnce({ created: true, result: 'new', artifactRev: 0, intent: { id: 'intent-1', intentId: 'i-1', execSeq: 4n, attempts: 3 } });
      // catch 段 fence 读行——同代 RUNNING（execSeq 同步=4n：旧代让位早退不分流）
      prisma.generationIntent.findUnique.mockResolvedValueOnce({ status: 'RUNNING', execSeq: 4n, attempts: 3 });
      const result = await service.execute('p1', 'n1', 'u1');
      const feedCall = collabDoc.writeExecStatus.mock.calls.find((c: any[]) => c[2]?.errorCode === 'TEXT_PROVIDER_UNKNOWN');
      expect(feedCall).toBeTruthy();
      const patch = feedCall![2] as Record<string, unknown>;
      expect(patch.error).toBe('可能重复生成、不会重复扣费（请稍后查询或重试）');   // 封闭句——无 boom 前缀
      expect(patch.error).not.toContain('boom');
      expect(patch.rearmable).toBe(true);   // 恒 true（attempts=3 档也 true）
      expect(patch.attempts).toBe(3);
      expect(patch.intentId).toBe('i-1');
      expect(patch.execSeq).toBe('4');
      expect(result.success).toBe(false);
    }
    // marked=0 档（markUnknown 落库失败——待对账句）
    {
      const textNode = { id: 'n1', type: 'textInput', data: { content: 'hi', model: 'm-text' } };
      topology.getScope.mockReturnValue([textNode]);
      topology.sort.mockReturnValue([textNode]);
      collabDoc.readCanvas.mockResolvedValue({ nodes: [textNode], edges: [] });
      apiCaller.callTextGen.mockRejectedValueOnce(new BE('TEXT_PROVIDER_UNKNOWN', 'boom http 原文', 504));
      intentSvc.markUnknown.mockResolvedValueOnce(0);   // 停驻失败——中性文案
      intentSvc.claim.mockResolvedValueOnce({ created: true, result: 'new', artifactRev: 0, intent: { id: 'intent-1', intentId: 'i-1', execSeq: 4n, attempts: 1 } });
      prisma.generationIntent.findUnique.mockResolvedValueOnce({ status: 'RUNNING', execSeq: 4n, attempts: 1 });
      await service.execute('p1', 'n1', 'u1');
      const feedCall = collabDoc.writeExecStatus.mock.calls.filter((c: any[]) => c[2]?.errorCode === 'TEXT_PROVIDER_UNKNOWN').at(-1)!;
      const patch = feedCall[2] as Record<string, unknown>;
      expect(patch.error).toBe('外呼结果不明，扣费状态待对账（请稍后查询或重试）');   // 封闭句
      expect(patch.error).not.toContain('boom');
      expect(patch.rearmable).toBe(true);
      expect(patch.attempts).toBe(1);
    }
  });

  /** ② 冻结 generic catch（非冻结路径 FundsInvariantError 已有 spec；此处=冻结路径 generic 兜底档）：
   *  Feed error='生成失败'/attempts=行值（非 0）/rearmable=attempts<3（非恒 false）/intentId=行值。
   *  （冻结 catch 现写 errorPatch(code, err.message, 0, false, claimed?.intentId)——红锚=attempts 0+rearmable false。） */
  it('② 冻结 generic catch：Feed error="生成失败"（err.message 不进 Feed）+attempts=行值非 0+rearmable=attempts<3+intentId=行值', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    const frozen = {
      request: { id: 'req-1', requestId: 'REQ-generic', projectId: 'p1', generation: 0, state: 'EXECUTING', frozenDocSeq: 0n, planHash: 'h', inputHash: 'h', teamId: 't1', userId: 'u1', kind: 'text' },
      plans: [{
        requestId: 'req-1', nodeId: 'n2', order: 0, type: 'textInput', model: null, resolution: null, styleId: null,
        pricingRuleId: 'pr', creditCost: 0, reservedCredit: 0, paramsHash: 'h', status: 'PENDING',
        generationIntentId: null, execSeq: null, authorSlotFrozen: false, authorMediaId: null,
      }],
      input: { nodes: { n2: { kind: 'text', promptText: 'hi', upstreamTexts: [], args: {} } } },
    };
    const reqSvc = { loadForExecution: vi.fn().mockResolvedValue(frozen), transitionRequestTerminal: vi.fn().mockResolvedValue(undefined) };
    // 冻结路径所需 prisma 面（updateMany CAS / findUnique 复读 / 行回写 / remaining count）
    const prismaFrozen = {
      ...prisma,
      executionRequest: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn() },
      executionNodePlan: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(0) },
      generationIntent: { update: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue({ status: 'RUNNING', execSeq: 7n }) },
    };
    // 直构冻结路径实例（构造参数顺序同主 fixture——ExecutionRequestService stub 注入；依赖面
    // 全 mock 形态 as-cast（直构类型门——行为面消费 assertEditor 一方法））
    const svc2 = new ExecutionService(
      prismaFrozen as never, topology as never, validation as never, apiCaller as never, teamCredit as never,
      permSvc as never, collabDoc as never, intentSvc as never,
      { readUpstreamMediaId: vi.fn().mockResolvedValue(null), canonicalizeMediaRef: vi.fn().mockResolvedValue(undefined), resolveCallUrl: vi.fn().mockResolvedValue(undefined) } as never,
      { finalizeText: vi.fn().mockRejectedValue(new Error('boom http')) } as never,
      reqSvc as never,
    );
    apiCaller.callTextGen.mockResolvedValueOnce({ content: 'ok' });
    intentSvc.claim.mockResolvedValueOnce({ created: true, result: 'new', artifactRev: 0, intent: { id: 'intent-1', intentId: 'i-fz', execSeq: 7n, attempts: 2 } });
    collabDoc.writeExecStatus.mockClear();
    await svc2.execute('p1', undefined, 'u1', undefined, undefined, undefined, undefined, undefined, 'REQ-generic');
    const errCall = collabDoc.writeExecStatus.mock.calls.find((c: any[]) => c[2]?.status === 'error' && c[1] === 'n2');
    expect(errCall).toBeTruthy();
    const patch = errCall![2] as Record<string, unknown>;
    expect(patch.error).toBe('生成失败');   // 表外句整段换（err.message 不进 Feed——只进日志）
    expect(patch.attempts).toBe(2);        // 行值（旧=0 红）
    expect(patch.rearmable).toBe(true);    // attempts<3（旧=false 红）
    expect(patch.intentId).toBe('i-fz');
    expect(patch.execSeq).toBe('7');
  });

  // ══════════ Y3 Task3 review-fix（plan Review Focus 3：冻结三臂 pin 断言——组末提交前补）══════════
  //  实现已正确（T3 主实现批）——本组为钉回归断言（与作废臂零 done 写同款 pinning-regression 处置：
  //  写断言→期望即刻绿；若红=真实发现上报不强行绿）。
  describe('Y3 T3 冻结三臂（review-fix pin：③资金/④intent-stale/⑤缺节点）', () => {
    /** 冻结路径直构装置（② 测试同款——可定制 finalizeText 行为/冻结夹具/依赖桩记录器）。 */
    const makeFrozenSvc = (over: {
      frozen?: Record<string, unknown>;
      finalizeText?: ReturnType<typeof vi.fn>;
      reqState?: string;
    } = {}) => {
      const frozen = {
        request: { id: 'req-1', requestId: 'REQ-fix', projectId: 'p1', generation: 0, state: over.reqState ?? 'EXECUTING', frozenDocSeq: 0n, planHash: 'h', inputHash: 'h', teamId: 't1', userId: 'u1', kind: 'text' },
        plans: [{
          requestId: 'req-1', nodeId: 'n2', order: 0, type: 'textInput', model: null, resolution: null, styleId: null,
          pricingRuleId: 'pr', creditCost: 0, reservedCredit: 0, paramsHash: 'h', status: 'PENDING',
          generationIntentId: null, execSeq: null, authorSlotFrozen: false, authorMediaId: null,
        }],
        input: { nodes: { n2: { kind: 'text', promptText: 'hi', upstreamTexts: [], args: {} } } },
        ...(over.frozen ?? {}),
      } as never;
      const reqSvc = { loadForExecution: vi.fn().mockResolvedValue(frozen), transitionRequestTerminal: vi.fn().mockResolvedValue(undefined) };
      const prismaFrozen = {
        ...prisma,
        executionRequest: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn() },
        executionNodePlan: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(0) },
        generationIntent: { update: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue({ status: 'RUNNING', execSeq: 7n }) },
      };
      // 依赖桩记录器（资金/终态动作面——③ 断言「不 void 不 fail」的消费判据）
      const teamCreditFrozen = {
        ...teamCredit,
        voidForExecutionRequestItem: vi.fn().mockResolvedValue(undefined),
      };
      const intentSvcFrozen = { ...intentSvc, fail: vi.fn().mockResolvedValue(undefined) };
      const frozenSvc = new ExecutionService(
        prismaFrozen as never, topology as never, validation as never, apiCaller as never, teamCreditFrozen as never,
        permSvc as never, collabDoc as never, intentSvcFrozen as never,
        { readUpstreamMediaId: vi.fn().mockResolvedValue(null), canonicalizeMediaRef: vi.fn().mockResolvedValue(undefined), resolveCallUrl: vi.fn().mockResolvedValue(undefined) } as never,
        { finalizeText: over.finalizeText ?? vi.fn().mockResolvedValue({ outcome: 'committed' }) } as never,
        reqSvc as never,
      );
      return { frozenSvc, teamCreditFrozen, intentSvcFrozen, reqSvc };
    };

    /** ③ 冻结资金臂（controller ruling 插入点）：FundsInvariantError ⇒ 不 voidForExecutionRequestItem/
     *  不 void_/不 fail（行留 RUNNING+冻结原样交对账）+Feed=暂缓交付句（rearmable:false+行身份）。 */
    it('③ 冻结 FundsInvariantError：不 voidForExecutionRequestItem/不 void_/不 fail+Feed=FUNDS_HELD 句（rearmable:false+行身份）', async () => {
      prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
      const { frozenSvc, teamCreditFrozen, intentSvcFrozen } = makeFrozenSvc({
        finalizeText: vi.fn().mockRejectedValue(new FundsInvariantError({
          intentRowId: 'intent-1', execSeq: 7n, creditCost: 5, reservedCredits: 0, creditsConsumed: 0, reservedExecSeq: null,
        })),
      });
      apiCaller.callTextGen.mockResolvedValueOnce({ content: 'ok' });
      intentSvc.claim.mockResolvedValueOnce({ created: true, result: 'new', artifactRev: 0, intent: { id: 'intent-1', intentId: 'i-fz3', execSeq: 7n, attempts: 2 } });
      collabDoc.writeExecStatus.mockClear();
      const r = await frozenSvc.execute('p1', undefined, 'u1', undefined, undefined, undefined, undefined, undefined, 'REQ-fix');
      // 资金禁自动动作三连（catch 内 AuthorSlotReleaseError 重抛之后、void 链之前的分支早退）
      expect(teamCreditFrozen.voidForExecutionRequestItem).not.toHaveBeenCalled();
      expect(teamCreditFrozen.void_).not.toHaveBeenCalled();
      expect(intentSvcFrozen.fail).not.toHaveBeenCalled();
      // Feed=暂缓交付句（FUNDS_HELD）+rearmable:false+行身份
      const feed = collabDoc.writeExecStatus.mock.calls.find((c: any[]) => c[2]?.errorCode === 'FUNDS_INVARIANT_VIOLATION' && c[1] === 'n2');
      expect(feed).toBeTruthy();
      const patch = feed![2] as Record<string, unknown>;
      expect(patch.error).toBe('生成结果暂缓交付（资金核销异常，待对账处理）');
      expect(patch.rearmable).toBe(false);
      expect(patch.attempts).toBe(2);
      expect(patch.intentId).toBe('i-fz3');
      expect(patch.execSeq).toBe('7');
      // errors[] 仍显式（HTTP 响应面）
      expect(r.errors.find((e: any) => e.nodeId === 'n2')).toMatchObject({ status: 'error', errorCode: 'FUNDS_INVARIANT_VIOLATION' });
    });

    /** ④ 冻结 intent-stale：per-item void 照旧调用+补 Feed 执行链超时句（EXEC_DEADLINE——行身份）。 */
    it('④ 冻结 intent-stale：per-item void 照旧+Feed=EXEC_DEADLINE 句（intentId/attempts/execSeq 行身份）', async () => {
      prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
      const { frozenSvc, teamCreditFrozen } = makeFrozenSvc({
        finalizeText: vi.fn().mockResolvedValue({ outcome: 'intent-stale' }),
      });
      apiCaller.callTextGen.mockResolvedValueOnce({ content: 'ok' });
      intentSvc.claim.mockResolvedValueOnce({ created: true, result: 'new', artifactRev: 0, intent: { id: 'intent-1', intentId: 'i-fz4', execSeq: 7n, attempts: 2 } });
      collabDoc.writeExecStatus.mockClear();
      const r = await frozenSvc.execute('p1', undefined, 'u1', undefined, undefined, undefined, undefined, undefined, 'REQ-fix');
      // per-item void 照旧（既有语义——:919 前置行）
      expect(teamCreditFrozen.voidForExecutionRequestItem).toHaveBeenCalledWith({ executionRequestId: 'req-1', nodeId: 'n2' });
      // Feed=执行链超时句（EXEC_DEADLINE——同码异句 id；行身份）
      const feed = collabDoc.writeExecStatus.mock.calls.find((c: any[]) => c[2]?.errorCode === 'INTENT_DEADLINE_EXCEEDED' && c[1] === 'n2');
      expect(feed).toBeTruthy();
      const patch = feed![2] as Record<string, unknown>;
      expect(patch.error).toBe('生成已被系统回收（超时）——产物未投递');
      expect(patch.intentId).toBe('i-fz4');
      expect(patch.attempts).toBe(2);
      expect(patch.execSeq).toBe('7');
      // errors[] 照旧（HTTP 响应面）
      expect(r.errors.find((e: any) => e.nodeId === 'n2')).toMatchObject({ status: 'error', errorCode: 'INTENT_DEADLINE_EXCEEDED' });
    });

    /** ⑤ 冻结缺节点：errors[] 码改 FROZEN_INPUT_MISSING+Feed={errorCode:'FROZEN_INPUT_MISSING',
     *  error:'节点缺少冻结输入'} 无行档 shape（attempts 0/rearmable:false/无 intentId/execSeq 键——
     *  plan Review Focus 4：封闭句枚举断言覆盖 FROZEN_INPUT_MISSING 档不拼节点 id）。 */
    it('⑤ 冻结缺节点：errors[]+Feed 均码 FROZEN_INPUT_MISSING/句「节点缺少冻结输入」（无行档 shape——attempts 0/rearmable:false/无身份键）', async () => {
      prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
      // 冻结输入缺节点：plans 含 n2，input.nodes 空
      const { frozenSvc } = makeFrozenSvc({ frozen: { input: { nodes: {} } } });
      collabDoc.writeExecStatus.mockClear();
      const r = await frozenSvc.execute('p1', undefined, 'u1', undefined, undefined, undefined, undefined, undefined, 'REQ-fix');
      // errors[]（HTTP 响应面）——码改 FROZEN_INPUT_MISSING+句不拼 PLAN_MISSING
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatchObject({ nodeId: 'n2', status: 'error', errorCode: 'FROZEN_INPUT_MISSING', error: '节点缺少冻结输入' });
      // Feed 写（此前零 Feed 写——红锚面已被主实现批钉；此处锁形状）
      const feed = collabDoc.writeExecStatus.mock.calls.find((c: any[]) => c[2]?.errorCode === 'FROZEN_INPUT_MISSING' && c[1] === 'n2');
      expect(feed).toBeTruthy();
      const patch = feed![2] as Record<string, unknown>;
      expect(patch.status).toBe('error');
      expect(patch.error).toBe('节点缺少冻结输入');   // 封闭句（REVIEW FOCUS 4：不拼节点 id）
      expect(patch.error).not.toContain('n2');          // 句面无节点 id 子串
      expect(patch.attempts).toBe(0);                   // 无行档 attempts 0
      expect(patch.rearmable).toBe(false);              // 无行档 rearmable:false
      expect('intentId' in patch).toBe(false);          // 无行档不写身份键
      expect('execSeq' in patch).toBe(false);
      // 缺节点早退——claim 零触达（不烧意图行）
      expect(intentSvc.claim).not.toHaveBeenCalled();
    });
  });

  /** ⑮ loading/skipped 补 execSeq：:416/:865/:379/:430/:616 载荷含 execSeq（行 execSeq.toString()）。 */
  it('⑮ loading 补 execSeq：claim 成功后的 loading 投影含 execSeq=行值.toString()（mergeSlot 代际前提）', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    scopedToN2();
    intentSvc.claim.mockResolvedValueOnce({ created: true, result: 'new', artifactRev: 0, intent: { id: 'intent-1', intentId: 'i-1', execSeq: 6n, attempts: 1 } });
    await service.execute('p1', 'n2', 'u1');
    const loading = collabDoc.writeExecStatus.mock.calls.find((c: any[]) => c[2]?.status === 'loading');
    expect(loading).toBeTruthy();
    expect((loading![2] as Record<string, unknown>).execSeq).toBe('6');   // 红：现载荷无 execSeq
  });

  it('⑮ skipped 两档补 execSeq：INTENT_SAME_JOB_ALIVE 档+INTENT_DUPLICATE_ATTEMPT 档载荷含 execSeq', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    scopedToN2();
    // same-job-alive 档
    intentSvc.claim.mockResolvedValueOnce({ created: false, result: 'same-job-alive', artifactRev: 0, intent: { id: 'intent-1', intentId: 'i-sja', execSeq: 9n, attempts: 1 } });
    await service.execute('p1', 'n2', 'u1');
    let skipped = collabDoc.writeExecStatus.mock.calls.find((c: any[]) => c[2]?.status === 'skipped');
    expect(skipped).toBeTruthy();
    expect((skipped![2] as Record<string, unknown>).execSeq).toBe('9');   // 红：现载荷无 execSeq
    // duplicate-attempt 档（reserve mayCall:false）
    collabDoc.writeExecStatus.mockClear();
    intentSvc.claim.mockResolvedValueOnce({ created: true, result: 'new', artifactRev: 0, intent: { id: 'intent-1', intentId: 'i-dup', execSeq: 10n, attempts: 1 } });
    teamCredit.reserve.mockResolvedValueOnce({ success: true, mayCall: false });
    await service.execute('p1', 'n2', 'u1');
    skipped = collabDoc.writeExecStatus.mock.calls.find((c: any[]) => c[2]?.status === 'skipped');
    expect(skipped).toBeTruthy();
    expect((skipped![2] as Record<string, unknown>).execSeq).toBe('10');
  });

  it('⑮ :616 NODE_BUSY skipped 补 execSeq（带 claimed intentId 档——claim 抛错档无行则无身份键）', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    scopedToN2();
    intentSvc.claim.mockRejectedValueOnce(new NodeBusyError());
    await service.execute('p1', 'n2', 'u1');
    const skipped = collabDoc.writeExecStatus.mock.calls.find((c: any[]) => c[2]?.status === 'skipped');
    expect(skipped).toBeTruthy();
    // claim 抛错=claimed null——无行档无 execSeq/intentId（裸项目档）
    const patch = skipped![2] as Record<string, unknown>;
    expect('execSeq' in patch).toBe(false);
    expect('intentId' in patch).toBe(false);
  });

  /** 作废臂零 done 写（v2.8——作废终态归 poller，四臂只交 authorVoid）：主路径 deliverFileId 档
   *  committed.outcome='committed'∧authorVoid=true ⇒ worker 零 done 投影（旧链写 done 不带 fileId——零写）。 */
  it('作废臂零 done 写：authorVoid=true∧committed ⇒ writeExecStatus 零 done 调用（作废终态归 poller）', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    scopedToN2();
    collabDoc.readAuthorSlot.mockResolvedValueOnce({ nodeId: 'n2', kind: 'image', frozen: true, authorMediaId: 'm-a', liveMediaId: 'm-user-new' });   // 现场≠冻结 ⇒ authorVoid
    artifactCommit.commitImage.mockResolvedValueOnce({ outcome: 'committed', mediaId: 'm-void', key: 'k' });
    await service.execute('p1', 'n2', 'u1');
    const doneCalls = collabDoc.writeExecStatus.mock.calls.filter((c: any[]) => c[2]?.status === 'done');
    expect(doneCalls).toHaveLength(0);   // 作废臂零 done 写（作废终态归 poller）
    // release 零调用（作废不释放）——Y3 T8：emit fileId 断言随 emit 面删除（零 done 写已钉同一语义）
    expect(collabDoc.releaseAuthorSlot).not.toHaveBeenCalled();
  });
});
});
