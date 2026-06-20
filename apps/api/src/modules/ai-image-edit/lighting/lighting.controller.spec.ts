import { Test, type TestingModule } from '@nestjs/testing';
import { LightingController } from './lighting.controller';
import { LightingService } from './lighting.service';

describe('LightingController', () => {
  let controller: LightingController;
  let service: any;

  beforeEach(async () => {
    service = {
      createTask: vi.fn().mockResolvedValue({ taskId: 'task-1', status: 'pending' }),
      getTask: vi.fn().mockResolvedValue({ id: 'task-1', status: 'pending' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LightingController],
      providers: [{ provide: LightingService, useValue: service }],
    }).compile();

    controller = module.get<LightingController>(LightingController);
  });

  describe('POST /api/image-edit/lighting/tasks', () => {
    it('should return taskId and status on success', async () => {
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

      const result = await controller.createTask(body);
      expect(result.code).toBe(0);
      expect(result.data.taskId).toBe('task-1');
      expect(result.data.status).toBe('pending');
    });
  });

  describe('GET /api/image-edit/lighting/tasks/:taskId', () => {
    it('should return task details', async () => {
      const result = await controller.getTask('task-1');
      expect(result.code).toBe(0);
      expect(result.data.id).toBe('task-1');
    });

    it('should return 404 for non-existent task', async () => {
      service.getTask = vi.fn().mockResolvedValue(null);
      const result = await controller.getTask('nonexistent');
      expect(result.code).toBe(404);
    });
  });
});
