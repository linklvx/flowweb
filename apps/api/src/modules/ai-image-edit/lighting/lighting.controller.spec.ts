import { Test, type TestingModule } from '@nestjs/testing';
import { LightingController } from './lighting.controller';
import { LightingService } from './lighting.service';
import { ProjectPermissionService } from '../../team/project-permission.service';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { GenerationIntentService, NodeBusyError } from '../../execution/generation-intent.service';
import { PricingResolverService } from '../../execution/pricing-resolver.service';
import { normalizeIntentParams } from '../../execution/normalize-intent-params';
import * as Y from 'yjs';
import { CollabDocumentService } from '../../collab/collab-document.service';
import { WorkerPresenceService } from '../../worker-presence/worker-presence.service';
import { QUEUE_NAMES } from '../../../config/queue.constants';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmitPort } from '../../gateway/emit.port';
import { AuthorSlotService } from '../../collab/author-slot.service';

// T7：SV 支配门夹具——客户端/服务端同 doc ⇒ 支配成立
const svDoc = new Y.Doc();
svDoc.getMap('meta').set('schemaVersion', 2);
const SV_OK = Buffer.from(Y.encodeStateVector(svDoc)).toString('base64');

describe('LightingController', () => {
  let controller: LightingController;
  let service: any;
  let permSvc: { assertEditorWithTeam: ReturnType<typeof vi.fn> };
  let resolver: { resolveByNodeTypeKey: ReturnType<typeof vi.fn> };
  let collabSvc: { readServerSV: ReturnType<typeof vi.fn>; readCanvas: ReturnType<typeof vi.fn> };
  let intentSvc: any;
  let presence: { assertAdmittable: ReturnType<typeof vi.fn> };
  // Y2 B2d：受理回放两档依赖（!created → 作废键等值查+补释放+emit）
  let prismaMock: { artifactProjection: { findUnique: ReturnType<typeof vi.fn> } };
  let emitMock: ReturnType<typeof vi.fn>;
  let authorSlotMock: { releaseAuthorSlot: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    service = {
      createTask: vi.fn().mockResolvedValue({ taskId: 'task-1', status: 'pending', jobId: 'job-9' }),
      getTask: vi.fn().mockResolvedValue({ id: 'task-1', status: 'pending' }),
    };
    permSvc = {
      // Y0b-1（E1）：claim 团队锚经 assertEditorWithTeam 取（零额外查询）
      assertEditorWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 'team-1' }),
    };
    // Y0b-1（E1）：kind 级定价快照（lighting=modelId IS NULL，Z5）
    resolver = {
      resolveByNodeTypeKey: vi.fn().mockResolvedValue({ pricingRuleId: 'pr-kind', modelId: null, resolutionId: null, durationId: null, creditCost: 1 }),
    };
    intentSvc = {
      claim: vi.fn().mockResolvedValue({ created: true, intent: { id: 'row-1', intentId: 'i-1', execSeq: 1n } }),
      attachJob: vi.fn(),
      fail: vi.fn(),
      observeNodeExecution: vi.fn().mockResolvedValue(undefined),   // Y1c T23 收口 I-1(spec)：claim 后 NodeExecution 观测写（M-5 补接线）
    };
    // Y0b-2 T7：SV 支配门依赖（默认=支配成立）
    collabSvc = {
      readServerSV: vi.fn(async () => Y.encodeStateVector(svDoc)),
      readCanvas: vi.fn(async () => ({ nodes: [{ id: 'node1', type: 'imageGen', data: { mediaId: 'm-author' } }], edges: [] })),
    };
    // Y0c T29-II（Z148②）：worker 准入门依赖（默认放行——单进程拓扑常态，裁决①）
    presence = { assertAdmittable: vi.fn().mockResolvedValue(undefined) };
    // Y2 B2d：回放两档依赖（默认=作废键未命中即正常档；各用例 mockResolvedValueOnce 覆写）
    prismaMock = { artifactProjection: { findUnique: vi.fn().mockResolvedValue(null) } };
    emitMock = vi.fn();
    authorSlotMock = { releaseAuthorSlot: vi.fn().mockResolvedValue({ released: true, deletedSlot: true, bindingStats: { upserted: 0, deleted: 0, noop: 1 } }) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LightingController],
      providers: [
        { provide: LightingService, useValue: service },
        { provide: ProjectPermissionService, useValue: permSvc },
        { provide: GenerationIntentService, useValue: intentSvc },
        { provide: PricingResolverService, useValue: resolver },
        { provide: CollabDocumentService, useValue: collabSvc },
        { provide: WorkerPresenceService, useValue: presence },
        { provide: PrismaService, useValue: prismaMock },
        { provide: EmitPort, useValue: { emitNodeStatus: emitMock } },
        { provide: AuthorSlotService, useValue: authorSlotMock },
      ],
    }).compile();

    controller = module.get<LightingController>(LightingController);
  });

  const mockReq = (id = 'user-1') => ({ user: { id } }) as any;

  describe('POST /api/image-edit/lighting/tasks', () => {
    const body = {
      nodeId: 'node-1',
      projectId: 'proj-1',
      originalImageId: 'media-src',
      stateVector: SV_OK,
      params: {
        position: { x: 0, y: 0, z: 6 },
        brightness: 50,
        colorTemperature: 5600,
        rimLight: false,
      },
    };

    it('should return taskId and status on success（T6 信封清剿：裸值；Y3 受理显式结局——新建档带行身份）', async () => {
      const result = await controller.createTask(body, mockReq());
      expect(result).toMatchObject({ taskId: 'task-1', status: 'pending', jobId: 'job-9', replayed: false, intentId: 'i-1', execSeq: '1' });
    });

    it('Y1c T23 收口 I-1(spec)：claim 成功（created）→ observeNodeExecution({projectId,nodeId,execSeq}) 恒达（M-5 补接线）', async () => {
      await controller.createTask(body, mockReq());
      expect(intentSvc.observeNodeExecution).toHaveBeenCalledWith({ projectId: 'proj-1', nodeId: 'node-1', execSeq: 1n });
    });

    it('EDITOR：assertEditor 放行且 userId 取自 req.user（替换 default-user）', async () => {
      await controller.createTask(body, mockReq('user-1'));
      expect(permSvc.assertEditorWithTeam).toHaveBeenCalledWith('proj-1', 'user-1');
      expect(service.createTask).toHaveBeenCalledWith(body, 'user-1', { intentRowId: 'row-1', execSeq: '1', jobId: expect.stringMatching(/^[0-9a-f-]{36}$/) }); // T9 票
    });

    it('VIEWER：403 拒绝且 service.createTask 未被调用', async () => {
      permSvc.assertEditorWithTeam.mockRejectedValue(new ForbiddenException('无项目编辑权限'));
      await expect(controller.createTask(body, mockReq())).rejects.toThrow('无项目编辑权限');
      expect(service.createTask).not.toHaveBeenCalled();
    });

    it('body 无 projectId 时也走 assertEditor（无条件守卫；入参防线是 DTO projectId 必填，省略即 422 拒绝）', async () => {
      const { projectId: _ignored, ...noProject } = body;
      await controller.createTask(noProject as any, mockReq());
      expect(permSvc.assertEditorWithTeam).toHaveBeenCalledWith(undefined, 'user-1');
      expect(service.createTask).toHaveBeenCalled();
    });

    it('省略 projectId 且守卫拒绝 → service 零调用（条件旁路根堵，批0c-3）', async () => {
      permSvc.assertEditorWithTeam.mockRejectedValue(new ForbiddenException('无项目编辑权限'));
      const { projectId: _ignored2, ...noProject } = body;
      await expect(controller.createTask(noProject as any, mockReq())).rejects.toThrow('无项目编辑权限');
      expect(permSvc.assertEditorWithTeam).toHaveBeenCalledWith(undefined, 'user-1');
      expect(service.createTask).not.toHaveBeenCalled();
    });
  });

  describe('批0.5-8 意图表扩面（F13：claim→createTask→attachJob）', () => {
    const body = {
      nodeId: 'node-1',
      projectId: 'proj-1',
      originalImageId: 'media-src',
      regenToken: 'client-int-1',
      stateVector: SV_OK,
      params: {
        position: { x: 0, y: 0, z: 6 },
        brightness: 50,
        colorTemperature: 5600,
        rimLight: false,
      },
    };

    it('claim 参数：kind=lighting + paramsHash=paramsToPrompt 派生稳定串（T6：originalImageId 进哈希）+ regenToken 透传', async () => {
      await controller.createTask(body as any, mockReq());
      expect(intentSvc.claim).toHaveBeenCalledWith(expect.objectContaining({
        projectId: 'proj-1', nodeId: 'node-1', userId: 'user-1',
        gestureToken: 'client-int-1', kind: 'lighting',
        // paramsToPrompt({x:0,y:0,z:6,brightness:50,colorTemperature:5600,rimLight:false}) 纯派生——controller 与 consumer 同函数
        paramsHash: normalizeIntentParams('lighting', { originalImageId: 'media-src', prompt: '主光源从正前方照射，亮度适中，色温5600K' }),
      }));
    });

    it('claim 成功 → createTask 携 intentRowId/intentId + attachJob 回写 jobId（F13 资损盲区）', async () => {
      const result = await controller.createTask(body as any, mockReq());
      expect(service.createTask).toHaveBeenCalledWith(body, 'user-1', { intentRowId: 'row-1', execSeq: '1', jobId: expect.stringMatching(/^[0-9a-f-]{36}$/) }); // T9 票
      expect(intentSvc.attachJob).toHaveBeenCalledTimes(1);
      expect(intentSvc.attachJob).toHaveBeenCalledWith('row-1', 'job-9');
      expect((result as any).taskId).toBe('task-1'); // T6 信封清剿：裸值
    });

    it('双击互斥：claim 抛 NodeBusyError → 409 冒泡 + createTask 零调用', async () => {
      intentSvc.claim.mockRejectedValue(new NodeBusyError());
      await expect(controller.createTask(body as any, mockReq())).rejects.toBeInstanceOf(NodeBusyError);
      expect(service.createTask).not.toHaveBeenCalled();
      expect(intentSvc.attachJob).not.toHaveBeenCalled();
    });

    it('同 token 重放（claim created:false SUCCEEDED）→ createTask 零调用 + 裸值返回既有结果（T6 信封清剿；Y3 受理显式结局 outcome=delivered）', async () => {
      intentSvc.claim.mockResolvedValue({
        created: false,
        intent: { id: 'row-1', intentId: 'i-1', execSeq: 1n, status: 'SUCCEEDED', resultRef: 'media-old' },
      });
      const result = await controller.createTask(body as any, mockReq());
      expect(service.createTask).not.toHaveBeenCalled();
      expect(intentSvc.attachJob).not.toHaveBeenCalled();
      expect(result).toEqual({ replayed: true, outcome: 'delivered', resultRef: 'media-old' });
    });

    it('createTask 失败（积分不足等）→ fail 置 FAILED（防 RUNNING 孤儿锁节点）+ 异常透传', async () => {
      service.createTask.mockRejectedValue(new Error('积分不足，无法提交任务'));
      await expect(controller.createTask(body as any, mockReq())).rejects.toThrow('积分不足');
      expect(intentSvc.fail).toHaveBeenCalledWith('row-1', expect.stringContaining('积分不足'), undefined, 1n);
      expect(intentSvc.attachJob).not.toHaveBeenCalled();
    });

    it('createTask 命中 60s 去重（无新 job）→ fail 释放执行权 + 返回既有任务（replayed；Y3 受理显式结局 outcome=deduped）', async () => {
      service.createTask.mockResolvedValue({ taskId: 'existing-task', status: 'pending' }); // 无 jobId——去重分支
      const result = await controller.createTask(body as any, mockReq());
      expect(intentSvc.attachJob).not.toHaveBeenCalled();
      expect(intentSvc.fail).toHaveBeenCalledWith('row-1', expect.any(String), undefined, 1n);
      expect(result).toEqual({ replayed: true, outcome: 'deduped', taskId: 'existing-task', status: 'pending' }); // Y3：显式结局键
    });
  });

  describe('Y0b-2 T7：SV 支配门（claim 之前——四受理端点同型）', () => {
    const gateBody = {
      nodeId: 'node-1',
      projectId: 'proj-1',
      originalImageId: 'media-src',
      stateVector: SV_OK,
      params: {
        position: { x: 0, y: 0, z: 6 },
        brightness: 50,
        colorTemperature: 5600,
        rimLight: false,
      },
    };

    it('客户端 SV 未被服务端支配 → 409 SYNC_PENDING：零 claim 零 createTask（不烧 attempts）', async () => {
      collabSvc.readServerSV.mockResolvedValue(Y.encodeStateVector(new Y.Doc()));
      const err = await controller.createTask(gateBody as any, mockReq()).catch((e: unknown) => e);
      expect(err).toMatchObject({ errorCode: 'SYNC_PENDING' });
      expect((err as any).getStatus()).toBe(409);
      expect(intentSvc.claim).not.toHaveBeenCalled();
      expect(service.createTask).not.toHaveBeenCalled();
    });

    it('缺 stateVector → 400 SYNC_STATE_VECTOR_REQUIRED（fail-closed）', async () => {
      const { stateVector: _sv, ...noSv } = gateBody;
      const err = await controller.createTask(noSv as any, mockReq()).catch((e: unknown) => e);
      expect(err).toMatchObject({ errorCode: 'SYNC_STATE_VECTOR_REQUIRED' });
      expect((err as any).getStatus()).toBe(400);
      expect(intentSvc.claim).not.toHaveBeenCalled();
    });
  });

  // Y0c T29-II（Z148②）：lighting createTask 独立门点——lighting.service.ts:112 的 add 不经
  // AiImageEditController.runGuarded（任务卡「单点覆盖 4 处」事实勘正：本 controller 是第 4 处
  // add 的唯一用户准入点，同款门序=SV→presence→定价→claim）
  describe('Y0c T29-II（Z148②）：worker 准入门（createTask——claim 之前拒=零退款义务）', () => {
    const gateBody = {
      nodeId: 'node-1', projectId: 'proj-1', originalImageId: 'media-src', stateVector: SV_OK,
      params: { position: { x: 0, y: 0, z: 6 }, brightness: 50, colorTemperature: 5600, rimLight: false },
    };

    it('无消费者 ⇒ 503 WORKER_ABSENT：零定价快照 零 claim 零 createTask 零 fail', async () => {
      presence.assertAdmittable.mockRejectedValue(
        new ServiceUnavailableException({ code: 'WORKER_ABSENT', message: '队列 ai-image-edit 当前无 worker 消费，请稍后重试' }),
      );
      const err = await controller.createTask(gateBody as any, mockReq()).catch((e: unknown) => e);
      expect((err as any).getStatus()).toBe(503);
      expect((err as any).getResponse()).toMatchObject({ code: 'WORKER_ABSENT' });
      expect(presence.assertAdmittable).toHaveBeenCalledWith(QUEUE_NAMES.AI_IMAGE_EDIT);   // lighting job 入 ai-image-edit 付费队列
      expect(resolver.resolveByNodeTypeKey).not.toHaveBeenCalled();
      expect(intentSvc.claim).not.toHaveBeenCalled();
      expect(service.createTask).not.toHaveBeenCalled();
      expect(intentSvc.fail).not.toHaveBeenCalled();
    });

    it('放行路径探门恰一次；SV 门在前（409 时零探测）', async () => {
      await controller.createTask(gateBody as any, mockReq());
      expect(presence.assertAdmittable).toHaveBeenCalledTimes(1);
      expect(presence.assertAdmittable).toHaveBeenCalledWith(QUEUE_NAMES.AI_IMAGE_EDIT);
      presence.assertAdmittable.mockClear();
      collabSvc.readServerSV.mockResolvedValue(Y.encodeStateVector(new Y.Doc()));
      await expect(controller.createTask(gateBody as any, mockReq())).rejects.toMatchObject({ errorCode: 'SYNC_PENDING' });
      expect(presence.assertAdmittable).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/image-edit/lighting/tasks/:taskId', () => {
    it('should return task details with userId from req.user（T6 信封清剿：裸值）', async () => {
      const result = await controller.getTask('task-1', mockReq('user-1'));
      expect(service.getTask).toHaveBeenCalledWith('task-1', 'user-1');
      expect(result).toEqual({ id: 'task-1', status: 'pending' });
    });

    it('T6 信封清剿：任务不存在 → NotFoundException（404 语义交全局 filter——手包 code:404 信封退役）', async () => {
      service.getTask = vi.fn().mockResolvedValue(null);
      await expect(controller.getTask('nonexistent', mockReq())).rejects.toThrow('任务不存在');
    });
  });

  // ══════════ Y2 B1：lighting 链 claim 占位（B2d 换受理读槽真值〔裁决 13〕）══════════
  it('Y2 B2d createTask 前置 claim 受理读槽：frozen true + data.mediaId', async () => {
    await controller.createTask({
      projectId: 'proj1', nodeId: 'node1', params: { position: { x: 0, y: 0, z: 6 }, brightness: 10 }, stateVector: SV_OK,
    } as any, { user: { id: 'u1' } } as any);
    expect(intentSvc.claim).toHaveBeenCalledWith(expect.objectContaining({ authorSlotFrozen: true, authorMediaId: 'm-author' }));
  });

  // ══════════ Y2 B2d（裁决 13）：受理回放两档（!created → 同代作废键等值查询——
  //    命中=emit done 不带 fileId 零释放 / 未命中=带 fileId+releaseAuthorSlot 补释放）══════════
  describe('Y2 B2d：!created 受理回放两档', () => {
    const replayBody = {
      nodeId: 'node-1',
      projectId: 'proj-1',
      originalImageId: 'media-src',
      regenToken: 'client-int-1',
      stateVector: SV_OK,
      params: { position: { x: 0, y: 0, z: 6 }, brightness: 50, colorTemperature: 5600, rimLight: false },
    };

    beforeEach(() => {
      intentSvc.claim.mockResolvedValue({
        created: false,
        intent: { id: 'row-1', intentId: 'i-1', execSeq: 1n, status: 'SUCCEEDED', resultRef: 'media-old' },
      });
    });

    it('作废键命中（该代交付已作废）→ emit done 不带 fileId + 零释放 + 零 createTask（Y3 受理显式结局：outcome=voided 无 resultRef 键）', async () => {
      prismaMock.artifactProjection.findUnique.mockResolvedValueOnce({ artifactId: 'author-void:row-1:1' });
      const result = await controller.createTask(replayBody as any, mockReq());
      expect(service.createTask).not.toHaveBeenCalled();
      expect(prismaMock.artifactProjection.findUnique).toHaveBeenCalledWith({
        where: { artifactId_artifactRev: { artifactId: 'author-void:row-1:1', artifactRev: 0 } },
      });
      expect(emitMock).toHaveBeenCalledWith('proj-1', expect.objectContaining({ nodeId: 'node-1', status: 'done' }));
      expect(emitMock).not.toHaveBeenCalledWith('proj-1', expect.objectContaining({ status: 'done', fileId: expect.anything() }));
      expect(authorSlotMock.releaseAuthorSlot).not.toHaveBeenCalled();
      expect(result).toEqual({ replayed: true, outcome: 'voided' });
      expect('resultRef' in (result as Record<string, unknown>)).toBe(false);
    });

    it('作废键未命中（正常成功交付）→ emit done 带 fileId + releaseAuthorSlot 补释放（Y3 受理显式结局：outcome=delivered 带 resultRef）', async () => {
      prismaMock.artifactProjection.findUnique.mockResolvedValueOnce(null);
      const result = await controller.createTask(replayBody as any, mockReq());
      expect(authorSlotMock.releaseAuthorSlot).toHaveBeenCalledWith('proj-1', 'row-1');
      expect(emitMock).toHaveBeenCalledWith('proj-1', expect.objectContaining({ status: 'done', fileId: 'media-old' }));
      expect(service.createTask).not.toHaveBeenCalled();
      expect(result).toEqual({ replayed: true, outcome: 'delivered', resultRef: 'media-old' });
    });
  });

  // ══════════ Y3 Task3（受理显式结局——controller ruling ⑨）：lighting 四档返回形状
  //  （shared AdmissionOutcome——新建 {replayed:false,intentId,execSeq}/delivered/voided/deduped）══════════
  describe('Y3 Task3：受理显式结局（shared 联合类型形状——先红）', () => {
    const body = {
      nodeId: 'node-1',
      projectId: 'proj-1',
      originalImageId: 'media-src',
      stateVector: SV_OK,
      params: { position: { x: 0, y: 0, z: 6 }, brightness: 50, colorTemperature: 5600, rimLight: false },
    };

    it('新建受理：return {...r, replayed:false, intentId:intent.intentId, execSeq:intent.execSeq.toString()}', async () => {
      const result: any = await controller.createTask(body as any, mockReq());
      expect(result).toMatchObject({ replayed: false, intentId: 'i-1', execSeq: '1' });
      expect(result.jobId).toBe('job-9');   // 既有入队字段保留
      expect(result.taskId).toBe('task-1');
    });

    it('交付重放：return {replayed:true, outcome:"delivered", resultRef:intent.resultRef}', async () => {
      prismaMock.artifactProjection.findUnique.mockResolvedValueOnce(null);   // 作废键未命中=正常交付档
      intentSvc.claim.mockResolvedValue({
        created: false,
        intent: { id: 'row-1', intentId: 'i-1', execSeq: 1n, status: 'SUCCEEDED', resultRef: 'media-old' },
      });
      const result: any = await controller.createTask(replayBodyOf(), mockReq());
      expect(result).toEqual({ replayed: true, outcome: 'delivered', resultRef: 'media-old' });
    });

    it('作废重放：return {replayed:true, outcome:"voided"}——对象上没有 resultRef 键', async () => {
      prismaMock.artifactProjection.findUnique.mockResolvedValueOnce({ artifactId: 'author-void:row-1:1' });   // 作废键命中
      intentSvc.claim.mockResolvedValue({
        created: false,
        intent: { id: 'row-1', intentId: 'i-1', execSeq: 1n, status: 'SUCCEEDED', resultRef: 'media-old' },
      });
      const result: any = await controller.createTask(replayBodyOf(), mockReq());
      expect(result).toEqual({ replayed: true, outcome: 'voided' });
      expect('resultRef' in result).toBe(false);   // 作废档无 resultRef 键
    });

    it('去重档：return {replayed:true, outcome:"deduped", taskId, status}（60s 去重——刚 claim 的行已 fail 掉）', async () => {
      service.createTask.mockResolvedValueOnce({ taskId: 'existing-task', status: 'pending' });   // 无 jobId——去重分支
      const result: any = await controller.createTask(body as any, mockReq());
      expect(result).toEqual({ replayed: true, outcome: 'deduped', taskId: 'existing-task', status: 'pending' });
    });

    /** 60s 去重档=lighting 控制器刚 claim 的行已 fail——去重档零 Feed 写。 */
    it('去重档零 Feed 写（本 controller 零 writeExecStatus 面——维持）', async () => {
      service.createTask.mockResolvedValueOnce({ taskId: 'existing-task', status: 'pending' });
      await controller.createTask(body as any, mockReq());
      expect(intentSvc.fail).toHaveBeenCalledWith('row-1', expect.any(String), undefined, 1n);   // fail 释放执行权（既有）
    });

    function replayBodyOf() {
      return {
        ...body,
        regenToken: 'client-int-1',
      } as any;
    }
  });
});
