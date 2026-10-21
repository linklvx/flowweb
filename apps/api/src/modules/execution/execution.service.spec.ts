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
  let mockDownloadQueue: any;
  let permSvc: { resolve: ReturnType<typeof vi.fn>; assertEditor: ReturnType<typeof vi.fn> };
  let intentSvc: any; // Y0c T12：结构断言族/replay 分支需逐测试改 claim/complete/reanchorDeadline 判据

  beforeEach(async () => {
    prisma = {
      canvasProject: { findUnique: vi.fn() },
      modelResolution: { findMany: vi.fn().mockResolvedValue([]) },
      modelDuration: { findMany: vi.fn().mockResolvedValue([]) },
      style: { findMany: vi.fn().mockResolvedValue([]) },
    };
    collabDoc = {
      readCanvas: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
      isLeaseServing: vi.fn().mockReturnValue(true), // Y0a-3 T8 计费读门——默认放行（本文件焦点在执行链）
      writeNodeData: vi.fn().mockResolvedValue({ written: true }), // Y0b-2 T5：交付判据类型化 {written,reason}
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
    mockDownloadQueue = {
      add: vi.fn().mockResolvedValue({ id: 'download-job-1' }),
    };
    permSvc = {
      resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
      assertEditor: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
    };

    // 批0.5-6 最小装置：意图服务默认放行（created:true）+ complete 默认过门（count=1）——本文件只测产物序/余额口径
    intentSvc = {
      claim: vi.fn().mockResolvedValue({ created: true, intent: { id: 'intent-1', intentId: 'i-1' } }),
      complete: vi.fn().mockResolvedValue(1),
      fail: vi.fn().mockResolvedValue(undefined),
      void_: vi.fn().mockResolvedValue(undefined),
      reanchorDeadline: vi.fn().mockResolvedValue(undefined), // Y0b-2 T4：外呼前重锚
      touchHeartbeat: vi.fn().mockResolvedValue(undefined),
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
        { provide: 'BullQueue_ai-result-download', useValue: mockDownloadQueue },
        { provide: GenerationIntentService, useValue: intentSvc },
        { provide: UpstreamMediaService, useValue: { readUpstreamMediaId: vi.fn().mockResolvedValue(null), canonicalizeMediaRef: vi.fn().mockResolvedValue(undefined), resolveCallUrl: vi.fn().mockResolvedValue(undefined) } },   // Y1a T8：上游身份读源 mock（默认无上游图）
      ],
    }).compile();
    service = module.get<ExecutionService>(ExecutionService);
  });

  it('should execute single node successfully', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });

    const result = await service.execute('p1', 'n2', 'default-user');
    expect(result.success).toBe(true);
    expect(gateway.emitNodeStatus).toHaveBeenCalled();
    expect(teamCredit.reserve).toHaveBeenCalledWith('default-user', { intentRowId: 'intent-1' });
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

  it('Y0c T8 红①（Z40 调用方契约）：deliver 命中 node-deleted ⇒ 批提交（done 同批生效）∧rollbackDeliveryFailed 在批后被独立调用', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
    teamCredit.rollbackDeliveryFailed = vi.fn().mockResolvedValue(true);
    // 单节点 imageGen 走满执行链到 deliver；交付判据失败（节点已删——writeNodeData 现状守卫语义）
    const n9 = { id: 'n9', type: 'imageGen', data: { model: 'm1', resolution: 'r1' } };
    topology.getScope.mockReturnValue([n9]);
    topology.sort.mockReturnValue([n9]);
    collabDoc.readCanvas.mockResolvedValue({ nodes: [n9], edges: [] });
    collabDoc.writeNodeData.mockResolvedValue({ written: false, reason: 'node-deleted' });

    const result = await service.execute('p1', undefined, 'u1', ['n9']);

    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatchObject({ nodeId: 'n9', status: 'error', errorCode: 'NODE_DELETED' });
    // deliver+done 组一批（同 doc 同事务——先红用例③的调用方侧）：一次 writeBatch 含两 op
    expect(docWriter.writeBatch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(docWriter.writeBatch).mock.calls[0][1].map((o: any) => o.op)).toEqual(['writeNodeData', 'writeExecStatus']);
    // 批正常提交：done 投影随批写入（Z75：exec=done∧节点已删=合法终态——不再写 error 投影对撞）
    const doneCalls = collabDoc.writeExecStatus.mock.calls.filter((c: any[]) => c[2]?.status === 'done');
    expect(doneCalls).toHaveLength(1);
    // 退款契约：rollbackDeliveryFailed 在批提交后被独立调用（非批内——Z64/Z92 交付路径唯一退款入口）
    expect(teamCredit.rollbackDeliveryFailed).toHaveBeenCalledWith('intent-1', expect.any(String));
    expect(vi.mocked(docWriter.writeBatch).mock.invocationCallOrder[0])
      .toBeLessThan(teamCredit.rollbackDeliveryFailed.mock.invocationCallOrder[0]);
  });

  it('should enqueue ai-result-download after AI returns resultUrl', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });

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
      collabDoc.writeNodeData.mockImplementation(async () => { cnt.data += 1; });
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
    // happy 档精确 toBe(2)（loading 1+deliver 批 1）；单写档 toBeGreaterThanOrEqual(1)；
    // replay 档封闭断言（恰一次+单写入口零调用）已含下界不动。
    it('happy：loading 投影+deliver+done 组批 ⇒ 恰 2 写段', async () => {
      scopedToN2();
      await service.execute('p1', 'n2', 'u1');
      expect(writeEntries()).toBe(2); // loading 1+deliver 批 1——精确两段
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

    it('node-deleted（deliver written:false→批后退款）⇒ ≤2 且 ≥1', async () => {
      scopedToN2();
      teamCredit.rollbackDeliveryFailed = vi.fn().mockResolvedValue(true);
      vi.mocked(docWriter.writeBatch).mockImplementation(async (_pid: string, ops: readonly any[]) => {
        cnt.batch += 1;
        return ops.map((op, index) => ({ index, op: op.op, written: false, reason: 'node-deleted' }));
      });
      await service.execute('p1', undefined, 'u1', ['n2']);
      expect(writeEntries()).toBeGreaterThanOrEqual(1); // loading+批（written:false 仍计——已执行写段）
      expect(writeEntries()).toBeLessThanOrEqual(2);
    });

    it('delivery-failed（B-1：writeBatch 基础设施 throw→行已 SUCCEEDED→NODE_DELIVERY_FAILED 投影）⇒ ≤2（reject 不入计）且 ≥1', async () => {
      scopedToN2();
      teamCredit.rollbackDeliveryFailed = vi.fn().mockResolvedValue(true);
      prisma.generationIntent = { findUnique: vi.fn().mockResolvedValue({ status: 'SUCCEEDED' }) };
      vi.mocked(docWriter.writeBatch).mockImplementation(async () => { throw new ServiceUnavailableException('drain'); }); // 零写入不入计
      await service.execute('p1', undefined, 'u1', ['n2']);
      expect(writeEntries()).toBeGreaterThanOrEqual(1); // loading+NODE_DELIVERY_FAILED 投影写（批 reject 不入计）
      expect(writeEntries()).toBeLessThanOrEqual(2);
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

    it('红⑤ replay 合并（Y0b-2 T6 回放段）：SUCCEEDED 重放 ⇒ writeBatch 恰一次且含两 op（artifact+done）+单写入口零调用+写段 ≤2', async () => {
      scopedToN2();
      intentSvc.claim.mockResolvedValue({
        created: false,
        intent: { id: 'gi-1', intentId: 'i-1', resultRef: '/mock/replay.png', attempts: 2 },
      });

      await service.execute('p1', 'n2', 'u1');

      expect(docWriter.writeBatch).toHaveBeenCalledTimes(1); // 现红：writeBatch 零调用（两单写）
      const ops = vi.mocked(docWriter.writeBatch).mock.calls[0][1] as any[];
      expect(ops.map((o) => o.op)).toEqual(['writeNodeData', 'writeExecStatus']); // artifact 在前 done 在后
      expect(ops[0].patch).toEqual({ resultUrl: '/mock/replay.png' });            // image 腿产物键
      expect(ops[1].patch).toMatchObject({ status: 'done', intentId: 'i-1', attempts: 2, fileId: '/mock/replay.png' });
      expect(collabDoc.writeExecStatus).not.toHaveBeenCalled();  // 单写入口零调用（合并判据）
      expect(collabDoc.writeNodeData).not.toHaveBeenCalled();
      expect(gateway.emitNodeStatus).toHaveBeenCalledWith('p1', expect.objectContaining({ status: 'done' })); // emit 仍在写前
      expect(writeEntries()).toBeLessThanOrEqual(2);
    });
  });
});
