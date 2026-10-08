import { Test, type TestingModule } from '@nestjs/testing';
import { LightingController } from './lighting.controller';
import { LightingService } from './lighting.service';
import { ProjectPermissionService } from '../../team/project-permission.service';
import { ForbiddenException } from '@nestjs/common';
import { GenerationIntentService, NodeBusyError } from '../../execution/generation-intent.service';
import { PricingResolverService } from '../../execution/pricing-resolver.service';
import { normalizeIntentParams } from '../../execution/normalize-intent-params';

describe('LightingController', () => {
  let controller: LightingController;
  let service: any;
  let permSvc: { assertEditorWithTeam: ReturnType<typeof vi.fn> };
  let resolver: { resolveByNodeTypeKey: ReturnType<typeof vi.fn> };
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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LightingController],
      providers: [
        { provide: LightingService, useValue: service },
        { provide: ProjectPermissionService, useValue: permSvc },
        { provide: GenerationIntentService, useValue: intentSvc },
        { provide: PricingResolverService, useValue: resolver },
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
      params: {
        position: { x: 0, y: 0, z: 6 },
        brightness: 50,
        colorTemperature: 5600,
        rimLight: false,
      },
    };

    it('should return taskId and status on success', async () => {
      const result = await controller.createTask(body, mockReq());
      expect(result.code).toBe(0);
      expect(result.data.taskId).toBe('task-1');
      expect(result.data.status).toBe('pending');
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
      intentId: 'client-int-1',
      params: {
        position: { x: 0, y: 0, z: 6 },
        brightness: 50,
        colorTemperature: 5600,
        rimLight: false,
      },
    };

    it('claim 参数：kind=lighting + paramsHash=paramsToPrompt 派生稳定串 + intentId 透传', async () => {
      await controller.createTask(body as any, mockReq());
      expect(intentSvc.claim).toHaveBeenCalledWith(expect.objectContaining({
        projectId: 'proj-1', nodeId: 'node-1', userId: 'user-1',
        intentId: 'client-int-1', kind: 'lighting',
        // paramsToPrompt({x:0,y:0,z:6,brightness:50,colorTemperature:5600,rimLight:false}) 纯派生——controller 与 consumer 同函数
        paramsHash: normalizeIntentParams('lighting', { prompt: '主光源从正前方照射，亮度适中，色温5600K' }),
      }));
    });

    it('claim 成功 → createTask 携 intentRowId/intentId + attachJob 回写 jobId（F13 资损盲区）', async () => {
      const result = await controller.createTask(body as any, mockReq());
      expect(service.createTask).toHaveBeenCalledWith(body, 'user-1', 'row-1', 'i-1');
      expect(intentSvc.attachJob).toHaveBeenCalledTimes(1);
      expect(intentSvc.attachJob).toHaveBeenCalledWith('row-1', 'job-9');
      expect(result.code).toBe(0);
      expect(result.data.taskId).toBe('task-1');
    });

    it('双击互斥：claim 抛 NodeBusyError → 409 冒泡 + createTask 零调用', async () => {
      intentSvc.claim.mockRejectedValue(new NodeBusyError());
      await expect(controller.createTask(body as any, mockReq())).rejects.toBeInstanceOf(NodeBusyError);
      expect(service.createTask).not.toHaveBeenCalled();
      expect(intentSvc.attachJob).not.toHaveBeenCalled();
    });

    it('同 intentId 重放（claim created:false SUCCEEDED）→ createTask 零调用 + 返回既有结果', async () => {
      intentSvc.claim.mockResolvedValue({
        created: false,
        intent: { id: 'row-1', intentId: 'i-1', status: 'SUCCEEDED', resultRef: 'media-old' },
      });
      const result = await controller.createTask(body as any, mockReq());
      expect(service.createTask).not.toHaveBeenCalled();
      expect(intentSvc.attachJob).not.toHaveBeenCalled();
      expect(result).toEqual({ code: 0, data: { replayed: true, resultRef: 'media-old' } });
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
      expect(result).toEqual({ code: 0, data: { replayed: true, taskId: 'existing-task', status: 'pending' } });
    });
  });

  describe('GET /api/image-edit/lighting/tasks/:taskId', () => {
    it('should return task details with userId from req.user', async () => {
      const result = await controller.getTask('task-1', mockReq('user-1'));
      expect(service.getTask).toHaveBeenCalledWith('task-1', 'user-1');
      expect(result.code).toBe(0);
      expect(result.data?.id).toBe('task-1');
    });

    it('should return 404 for non-existent task', async () => {
      service.getTask = vi.fn().mockResolvedValue(null);
      const result = await controller.getTask('nonexistent', mockReq());
      expect(result.code).toBe(404);
    });
  });
});
