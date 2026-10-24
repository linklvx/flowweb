import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionService } from './execution.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TopologyService } from './topology.service';
import { UpstreamMediaService } from './upstream-media.service';
import { ValidationService } from './validation.service';
import { ApiCallerService } from './api-caller.service';
import { TeamCreditService } from '../team/team-credit.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CollabWritePort } from '../collab/collab-write.port';
import { EmitPort } from '../gateway/emit.port';
import { GenerationIntentService } from './generation-intent.service';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CollabDocWriterService } from '../collab/collab-doc-writer.service';
import { docWriterStubOf } from '../collab/test-utils/doc-writer-stub';
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
  let docWriter: ReturnType<typeof docWriterStubOf>;
  let gateway: any;
  let permSvc: { resolve: ReturnType<typeof vi.fn>; assertEditor: ReturnType<typeof vi.fn> };
  let intentSvc: any; // Y0c T12：结构断言族/replay 分支需逐测试改 claim/complete/reanchorDeadline 判据
  let artifactCommit: any;   // T10：image/text finalize（stub——默认 committed）

  beforeEach(async () => {
    prisma = {
      canvasProject: { findUnique: vi.fn() },
      modelResolution: { findMany: vi.fn().mockResolvedValue([]) },
      modelDuration: { findMany: vi.fn().mockResolvedValue([]) },
      style: { findMany: vi.fn().mockResolvedValue([]) },
      generationIntent: { findUnique: vi.fn().mockResolvedValue({ status: 'RUNNING', execSeq: 1n, attempts: 1 }) }, // T9 catch fence 读行
    };
    collabDoc = {
      readCanvas: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
      isLeaseServing: vi.fn().mockReturnValue(true), // Y0a-3 T8 计费读门——默认放行（本文件焦点在执行链）
      writeNodeData: vi.fn().mockResolvedValue({ kind: 'business', written: true }),   // T13 typed outcome——business 档（transient/permanent=悬留档）, // Y0b-2 T5：交付判据类型化 {written,reason}
      writeExecStatus: vi.fn().mockResolvedValue(undefined), // 批0.5-6 claim 接线最小装置
    };
    docWriter = docWriterStubOf(collabDoc); // Y0c T8：deliver+done 组批经 writeBatch——stub 按 op 分派回记录器（断言零改动）
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
      getBalanceView: vi.fn().mockResolvedValue({ credits: 95, subscriptionCredits: 0, total: 95, quota: 0, used: 0 }),
    };
    gateway = { emitNodeStatus: vi.fn() }; // Y0b-2 T5：execution:complete emit 已删（web 零消费者——census 清零）
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
        { provide: CollabWritePort, useValue: collabDoc },
        { provide: CollabDocWriterService, useValue: docWriter },
        { provide: EmitPort, useValue: gateway },
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
    expect(gateway.emitNodeStatus).toHaveBeenCalled();
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
    expect(gateway.emitNodeStatus).toHaveBeenCalledWith('p1', expect.objectContaining({ status: 'error' }));
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
    expect(docWriter.writeBatch).not.toHaveBeenCalled();
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
    expect(docWriter.writeBatch).not.toHaveBeenCalled();   // T15：交付归投影 poller（fileId=mediaId 键面在彼）
    const dones = gateway.emitNodeStatus.mock.calls.filter((c: any[]) => c[1]?.status === 'done' && c[1]?.fileId);
    expect(dones.at(-1)![1].fileId).toBe('media-t10');   // emit fileId=mediaId（即时 UX——旧 { resultUrl } 404 面根修维持）
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
    // 交付键唯一 fileId=mediaId（旧红：现状 { videoUrl: '/mock/video.mp4' }——VideoGenNode 渲染 fileId=404 不可达）
    expect(docWriter.writeBatch).not.toHaveBeenCalled();   // T15：交付归投影 poller（doc 无 videoUrl 键面维持）
    const dones = gateway.emitNodeStatus.mock.calls.filter((c: any[]) => c[1]?.status === 'done' && c[1]?.fileId);
    expect(dones.at(-1)![1].fileId).toBe('media-t12');   // 旧链 emit fileId=result.url（404 面）根修
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
    expect(docWriter.writeBatch).not.toHaveBeenCalled();   // T15：回放 doc 写移除（投影行在案=poller 交付）
    const dones = gateway.emitNodeStatus.mock.calls.filter((c: any[]) => c[1]?.status === 'done' && c[1]?.fileId);
    expect(dones.at(-1)![1].fileId).toBe('media-replay');   // replay fileId=mediaId（旧 videoUrl 写点删除维持）
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
    expect(docWriter.writeBatch).not.toHaveBeenCalled();   // T15：交付归投影 poller（交付值=NodeArtifact.resultText 权威——content 回显删除面维持）
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
    expect(docWriter.writeBatch).not.toHaveBeenCalled();   // T15：superseded doc 零覆盖（投影行已记 superseded——poller 终态免投）
    artifactCommit.commitImage.mockResolvedValueOnce({ outcome: 'intent-stale' });
    const r2 = await service.execute('p1', undefined, 'default-user', ['n2']);
    expect(r2.success).toBe(false);
    expect(r2.errors[0]).toMatchObject({ errorCode: 'INTENT_DEADLINE_EXCEEDED' });
    expect(r2.totalCost).toBe(0);
  });

  it('node:status credits 为完整余额对象（文本/图片节点），total = credits + subscriptionCredits', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
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
    // Y0b-2 T5 CYCLE 守卫：getScope/sort 夹具须一致（sort 丢节点=环——真实拓扑两者恒一致除环外）
    topology.getScope.mockReturnValue([{ id: 'n3', type: 'videoGen', data: { model: 'm1', prompt: 'v' } }]);
    topology.sort.mockReturnValue([{ id: 'n3', type: 'videoGen', data: { model: 'm1', prompt: 'v' } }]);
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    teamCredit.getBalanceView.mockResolvedValue({ credits: 60, subscriptionCredits: 40, total: 100, quota: 0, used: 0 });

    await service.execute('p1', 'n3', 'default-user');

    const payload = gateway.emitNodeStatus.mock.calls.find((c: any[]) => c[1]?.status === 'done')?.[1];
    expect(payload.credits).toEqual({ credits: 60, subscriptionCredits: 40, total: 100 });
    expect(payload.credits.total).toBe(payload.credits.credits + payload.credits.subscriptionCredits);
  });

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

    it('Y1c T2（bug② 后半）：textInput data.prompt:string 直读——无上游时不落 content 串位（:512 .text 恒 miss 根修）', async () => {
      // TextConfigPanel:211 每键击落 doc 的形态=data.prompt:string（nodeStore TextNodeData）——
      // 现状 :512 data?.prompt?.text 对 string 恒 miss ⇒ 正文 content 串位成 prompt（面板 prompt 执行链断供）。
      const textNode = { id: 'n1', type: 'textInput', data: { content: '正文在案', prompt: '面板提示词', model: 'm-text' } };
      topology.getScope.mockReturnValue([textNode]);
      topology.sort.mockReturnValue([textNode]);
      topology.collectUpstreamData.mockResolvedValue({ textContents: [], imageMediaId: undefined }); // 无上游文本
      const result = await service.execute('p1', 'n1', 'u1');
      expect(result.success).toBe(true); // text 腿完整执行（防断言因未执行假红）
      expect(apiCaller.callTextGen).toHaveBeenCalledWith(expect.objectContaining({ prompt: '面板提示词' })); // 今日红：.text miss → content '正文在案' 串位
    });
  });

  // ── Y0c T12（裁决 4·Z122②）：单节点写段 ≤2 结构断言族——instrument 三写入口
  // （collabDoc.writeExecStatus/collabDoc.writeNodeData/docWriter.writeBatch）按分支逐档断言。
  // 计数判据=已执行（resolved）的写段：writeBatch reject=基础设施失败零写入不入计（B-1 档）——
  // 「第三写注入⇒红」变红证明见 commit message（临时注入后还原，元纪律⑥）。 ──
  describe('Y0c T12 单节点写段 ≤2 结构断言族（三写入口 instrument）', () => {
    const n2Image = { id: 'n2', type: 'imageGen', data: { model: 'm1', resolution: 'r1' } };
    let cnt: { exec: number; data: number; batch: number };
    let writeEntries: () => number;

    beforeEach(() => {
      cnt = { exec: 0, data: 0, batch: 0 };
      writeEntries = () => cnt.exec + cnt.data + cnt.batch;
      // 独立计数实现（docWriterStubOf 会把批 op 分派回 collabDoc 记录器——双重计数破坏判据）
      collabDoc.writeExecStatus.mockImplementation(async () => { cnt.exec += 1; });
      collabDoc.writeNodeData.mockImplementation(async () => { cnt.data += 1; return { kind: 'business', written: true }; });
      vi.mocked(docWriter.writeBatch).mockImplementation(async (_pid: string, ops: readonly any[]) => {
        cnt.batch += 1;
        return ops.map((op, index) => ({ index, op: op.op, written: true }));
      });
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
      expect(vi.mocked(docWriter.writeBatch)).not.toHaveBeenCalled();
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
      vi.mocked(gateway.emitNodeStatus).mockImplementation(((_pid: string, p: any) => { if (p?.status === 'done') throw new ServiceUnavailableException('emit down'); }) as any); // finalize 后残余段 throw 注入（done emit 位）
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

    it('T15：replay 段收口——SUCCEEDED 重放 ⇒ 零 doc 写（writeBatch/单写入口全零——交付归投影行）+emit done 照发+写段 0', async () => {
      scopedToN2();
      intentSvc.claim.mockResolvedValue({
        created: false,
        intent: { id: 'gi-1', intentId: 'i-1', resultRef: '/mock/replay.png', attempts: 2 },
      });

      await service.execute('p1', 'n2', 'u1');

      expect(docWriter.writeBatch).not.toHaveBeenCalled();    // T15：回放 doc 写移除（投影行在案=poller 交付）
      expect(collabDoc.writeExecStatus).not.toHaveBeenCalled();   // 单写入口零调用
      expect(collabDoc.writeNodeData).not.toHaveBeenCalled();
      expect(gateway.emitNodeStatus).toHaveBeenCalledWith('p1', expect.objectContaining({ status: 'done', fileId: '/mock/replay.png' })); // emit 即时 UX（fileId=resultRef=mediaId 语义）
      expect(writeEntries()).toBe(0);
    });
  });

  // ── F1 资金硬门执行面（用户裁定①）：FundsInvariantError 传播到 catch ⇒ 禁自动退款（void_）/
  //    禁 fail（置 FAILED）——歧义态行保持 RUNNING+冻结原样，交对账第四分支裁决；用户面
  //    FUNDS_INVARIANT_VIOLATION error+error 级日志打点。 ──
  describe('F1 资金硬门：FundsInvariantError catch 分支（不 void_/不 fail——行留 RUNNING 交对账）', () => {
    const n2Image = { id: 'n2', type: 'imageGen', data: { model: 'm1', resolution: 'r1' } };

    it('不 void_、不 intentService.fail、logger.error 打点、writeExecStatus/emitNodeStatus 用户面 error（FUNDS_INVARIANT_VIOLATION）', async () => {
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
      // 用户面：writeExecStatus errorPatch + emitNodeStatus error（文案=暂缓交付待对账）
      expect(collabDoc.writeExecStatus).toHaveBeenCalledWith('p1', 'n2', expect.objectContaining({
        status: 'error', errorCode: 'FUNDS_INVARIANT_VIOLATION',
      }), expect.anything());
      expect(gateway.emitNodeStatus).toHaveBeenCalledWith('p1', expect.objectContaining({
        nodeId: 'n2', status: 'error', error: expect.stringContaining('资金核销异常'),
      }));
    });
  });
});
