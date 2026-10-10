import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { GenerationIntentService } from './generation-intent.service';
import { ForbiddenException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ExecutionController', () => {
  let controller: ExecutionController;
  let service: { execute: ReturnType<typeof vi.fn> };
  let queue: {
    add: ReturnType<typeof vi.fn>;
    getJob: ReturnType<typeof vi.fn>;
  };
  let permSvc: { resolve: ReturnType<typeof vi.fn>; assertEditor: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    service = {
      execute: vi.fn().mockResolvedValue({ success: true, errors: [] }),
    };
    queue = {
      add: vi.fn().mockResolvedValue({ id: 'job-123' }),
      getJob: vi.fn().mockResolvedValue({
        id: 'job-123',
        getState: vi.fn().mockResolvedValue('completed'),
        progress: 100,
      }),
    };
    permSvc = {
      resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
      assertEditor: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExecutionController],
      providers: [
        { provide: ExecutionService, useValue: service },
        { provide: ProjectPermissionService, useValue: permSvc },
        { provide: getQueueToken('execution'), useValue: queue },
        // 批0.5-6 最小装置：GET intents 依赖
        { provide: GenerationIntentService, useValue: { listByNode: vi.fn().mockResolvedValue([]) } },
      ],
    }).compile();

    controller = module.get<ExecutionController>(ExecutionController);
  });

  describe('execute', () => {
    it('execute：userId 取自 req.user（不读 body.userId）', async () => {
      const req = { user: { id: 'u-auth' } } as any;
      const body = { projectId: 'p1', nodeId: 'n1' };
      const result = await controller.execute(body, req);
      expect(service.execute).toHaveBeenCalledWith('p1', 'n1', 'u-auth', undefined, undefined, undefined); // 第6参 intentId（批0.5-6，无头为 undefined）
      expect(result).toEqual({ success: true, errors: [] });
    });

    it('execute：body 携带 userId 字段也被忽略', async () => {
      const req = { user: { id: 'u-auth' } } as any;
      const body = { projectId: 'p1', userId: 'forged' };
      await controller.execute(body, req);
      expect(service.execute).toHaveBeenCalledWith('p1', undefined, 'u-auth', undefined, undefined, undefined);
    });

    it('should decode x-yjs-sv header to Uint8Array', async () => {
      const req = { user: { id: 'u-auth' } } as any;
      const body = { projectId: 'p1' };
      const b64 = Buffer.from('hello').toString('base64');
      await controller.execute(body, req, b64);
      const svArg = service.execute.mock.calls[0][4] as Uint8Array;
      expect([...svArg]).toEqual([104, 101, 108, 108, 111]);
    });
  });

  describe('enqueue', () => {
    it('should add job to queue and return jobId', async () => {
      const req = { user: { id: 'user-1' } } as any;
      const body = { projectId: 'p1', nodeId: 'n2' };
      const result = await controller.enqueue(body, req);
      expect(permSvc.assertEditor).toHaveBeenCalledWith('p1', 'user-1');
      expect(queue.add).toHaveBeenCalledWith('execution', {
        projectId: 'p1',
        nodeId: 'n2',
        userId: 'user-1',
        sv: null,
        regenToken: null, // Y0b-2 T6（Z91）：改名自 intentId 位——缺省 null
      });
      expect(result).toEqual({ jobId: 'job-123', status: 'queued' });
    });

    it('enqueue：VIEWER 403，不入队', async () => {
      permSvc.assertEditor.mockRejectedValue(new ForbiddenException('无项目编辑权限'));
      const req = { user: { id: 'user-1' } } as any;
      await expect(controller.enqueue({ projectId: 'p1' }, req)).rejects.toThrow('无项目编辑权限');
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('should handle missing user on request', async () => {
      const req = {} as any;
      const body = { projectId: 'p1' };
      const result = await controller.enqueue(body, req);
      expect(queue.add).toHaveBeenCalledWith('execution', {
        projectId: 'p1',
        nodeId: undefined,
        userId: undefined,
        sv: null,
        regenToken: null,
      });
      expect(result.status).toBe('queued');
    });

    it('should pass x-yjs-sv base64 into job payload', async () => {
      const req = { user: { id: 'user-1' } } as any;
      const body = { projectId: 'p1' };
      await controller.enqueue(body, req, 'abc==');
      expect(queue.add).toHaveBeenCalledWith('execution', {
        projectId: 'p1',
        nodeId: undefined,
        userId: 'user-1',
        sv: 'abc==',
        regenToken: null,
      });
    });
  });

  describe('getJob', () => {
    it('should return job state and progress', async () => {
      queue.getJob.mockResolvedValue({
        id: 'job-123',
        data: { projectId: 'p1' },
        getState: vi.fn().mockResolvedValue('completed'),
        progress: 100,
      });
      const result = await controller.getJob('job-123', { user: { id: 'user-1' } } as any);
      expect(queue.getJob).toHaveBeenCalledWith('job-123');
      expect(result).toEqual({ id: 'job-123', state: 'completed', progress: 100 });
    });

    it('should return error when job not found', async () => {
      queue.getJob.mockResolvedValue(null);
      const result = await controller.getJob('nonexistent', { user: { id: 'user-1' } } as any);
      expect(result).toEqual({ error: 'Job not found' });
    });

    it('job 无 projectId → default-deny 404（fail-closed）', async () => {
      queue.getJob.mockResolvedValue({
        id: 'job-x',
        data: {},
        getState: vi.fn().mockResolvedValue('completed'),
        progress: 100,
      });
      const result = await controller.getJob('job-x', { user: { id: 'user-1' } } as any);
      expect(result).toEqual({ error: 'Job not found' });
    });
  });
});
