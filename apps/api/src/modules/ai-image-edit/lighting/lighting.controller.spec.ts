import { Test, type TestingModule } from '@nestjs/testing';
import { LightingController } from './lighting.controller';
import { LightingService } from './lighting.service';
import { ProjectPermissionService } from '../../team/project-permission.service';
import { ForbiddenException } from '@nestjs/common';

describe('LightingController', () => {
  let controller: LightingController;
  let service: any;
  let permSvc: { assertEditor: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    service = {
      createTask: vi.fn().mockResolvedValue({ taskId: 'task-1', status: 'pending' }),
      getTask: vi.fn().mockResolvedValue({ id: 'task-1', status: 'pending' }),
    };
    permSvc = {
      assertEditor: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LightingController],
      providers: [
        { provide: LightingService, useValue: service },
        { provide: ProjectPermissionService, useValue: permSvc },
      ],
    }).compile();

    controller = module.get<LightingController>(LightingController);
  });

  const mockReq = (id = 'user-1') => ({ user: { id } }) as any;

  describe('POST /api/image-edit/lighting/tasks', () => {
    const body = {
      nodeId: 'node-1',
      projectId: 'proj-1',
      originalImageUrl: 'https://example.com/img.jpg',
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
      expect(permSvc.assertEditor).toHaveBeenCalledWith('proj-1', 'user-1');
      expect(service.createTask).toHaveBeenCalledWith(body, 'user-1');
    });

    it('VIEWER：403 拒绝且 service.createTask 未被调用', async () => {
      permSvc.assertEditor.mockRejectedValue(new ForbiddenException('无项目编辑权限'));
      await expect(controller.createTask(body, mockReq())).rejects.toThrow('无项目编辑权限');
      expect(service.createTask).not.toHaveBeenCalled();
    });

    it('body 无 projectId 时跳过 assertEditor（个人任务）', async () => {
      const { projectId: _ignored, ...noProject } = body;
      await controller.createTask(noProject, mockReq());
      expect(permSvc.assertEditor).not.toHaveBeenCalled();
      expect(service.createTask).toHaveBeenCalled();
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
