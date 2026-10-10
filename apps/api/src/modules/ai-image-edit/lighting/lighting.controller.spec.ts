import { Test, type TestingModule } from '@nestjs/testing';
import { LightingController } from './lighting.controller';
import { LightingService } from './lighting.service';
import { ProjectPermissionService } from '../../team/project-permission.service';
import { ForbiddenException } from '@nestjs/common';
import { GenerationIntentService, NodeBusyError } from '../../execution/generation-intent.service';
import { PricingResolverService } from '../../execution/pricing-resolver.service';
import { normalizeIntentParams } from '../../execution/normalize-intent-params';
import * as Y from 'yjs';
import { CollabDocumentService } from '../../collab/collab-document.service';

// T7：SV 支配门夹具——客户端/服务端同 doc ⇒ 支配成立
const svDoc = new Y.Doc();
svDoc.getMap('meta').set('schemaVersion', 2);
const SV_OK = Buffer.from(Y.encodeStateVector(svDoc)).toString('base64');

describe('LightingController', () => {
  let controller: LightingController;
  let service: any;
  let permSvc: { assertEditorWithTeam: ReturnType<typeof vi.fn> };
  let resolver: { resolveByNodeTypeKey: ReturnType<typeof vi.fn> };
  let collabSvc: { readServerSV: ReturnType<typeof vi.fn> };
  let intentSvc: any;

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
      claim: vi.fn().mockResolvedValue({ created: true, intent: { id: 'row-1', intentId: 'i-1' } }),
      attachJob: vi.fn(),
      fail: vi.fn(),
    };
    // Y0b-2 T7：SV 支配门依赖（默认=支配成立）
    collabSvc = { readServerSV: vi.fn(async () => Y.encodeStateVector(svDoc)) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LightingController],
      providers: [
        { provide: LightingService, useValue: service },
        { provide: ProjectPermissionService, useValue: permSvc },
        { provide: GenerationIntentService, useValue: intentSvc },
        { provide: PricingResolverService, useValue: resolver },
        { provide: CollabDocumentService, useValue: collabSvc },
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

    it('should return taskId and status on success（T6 信封清剿：裸值——拦截器单层包裹）', async () => {
      const result = await controller.createTask(body, mockReq());
      expect(result).toEqual({ taskId: 'task-1', status: 'pending', jobId: 'job-9' });
    });

    it('EDITOR：assertEditor 放行且 userId 取自 req.user（替换 default-user）', async () => {
      await controller.createTask(body, mockReq('user-1'));
      expect(permSvc.assertEditorWithTeam).toHaveBeenCalledWith('proj-1', 'user-1');
      expect(service.createTask).toHaveBeenCalledWith(body, 'user-1', 'row-1', 'i-1');
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
      expect(service.createTask).toHaveBeenCalledWith(body, 'user-1', 'row-1', 'i-1');
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

    it('同 token 重放（claim created:false SUCCEEDED）→ createTask 零调用 + 裸值返回既有结果（T6 信封清剿）', async () => {
      intentSvc.claim.mockResolvedValue({
        created: false,
        intent: { id: 'row-1', intentId: 'i-1', status: 'SUCCEEDED', resultRef: 'media-old' },
      });
      const result = await controller.createTask(body as any, mockReq());
      expect(service.createTask).not.toHaveBeenCalled();
      expect(intentSvc.attachJob).not.toHaveBeenCalled();
      expect(result).toEqual({ replayed: true, resultRef: 'media-old' });
    });

    it('createTask 失败（积分不足等）→ fail 置 FAILED（防 RUNNING 孤儿锁节点）+ 异常透传', async () => {
      service.createTask.mockRejectedValue(new Error('积分不足，无法提交任务'));
      await expect(controller.createTask(body as any, mockReq())).rejects.toThrow('积分不足');
      expect(intentSvc.fail).toHaveBeenCalledWith('row-1', expect.stringContaining('积分不足'));
      expect(intentSvc.attachJob).not.toHaveBeenCalled();
    });

    it('createTask 命中 60s 去重（无新 job）→ fail 释放执行权 + 返回既有任务（replayed）', async () => {
      service.createTask.mockResolvedValue({ taskId: 'existing-task', status: 'pending' }); // 无 jobId——去重分支
      const result = await controller.createTask(body as any, mockReq());
      expect(intentSvc.attachJob).not.toHaveBeenCalled();
      expect(intentSvc.fail).toHaveBeenCalledWith('row-1', expect.any(String));
      expect(result).toEqual({ replayed: true, taskId: 'existing-task', status: 'pending' }); // T6 信封清剿：裸值
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
});
