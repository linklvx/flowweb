import { Test, TestingModule } from '@nestjs/testing';
import * as Y from 'yjs';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { GenerationIntentService } from './generation-intent.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { ForbiddenException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// T7：SV 支配门夹具——非空 SV（空 doc 的 SV 是 0 字节 base64 空串，被缺省检查吞）
const svDoc = new Y.Doc();
svDoc.getMap('meta').set('schemaVersion', 2);
const SV_OK = Buffer.from(Y.encodeStateVector(svDoc)).toString('base64');

describe('ExecutionController', () => {
  let controller: ExecutionController;
  let service: { execute: ReturnType<typeof vi.fn> };
  let queue: {
    add: ReturnType<typeof vi.fn>;
    getJob: ReturnType<typeof vi.fn>;
  };
  let permSvc: { resolve: ReturnType<typeof vi.fn>; assertEditor: ReturnType<typeof vi.fn> };
  let collabSvc: { readServerSV: ReturnType<typeof vi.fn> };

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
    collabSvc = { readServerSV: vi.fn(async () => Y.encodeStateVector(svDoc)) };   // 默认=支配成立

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExecutionController],
      providers: [
        { provide: ExecutionService, useValue: service },
        { provide: ProjectPermissionService, useValue: permSvc },
        { provide: getQueueToken('execution'), useValue: queue },
        // 批0.5-6 最小装置：GET intents 依赖
        { provide: GenerationIntentService, useValue: { listByNode: vi.fn().mockResolvedValue([]) } },
        // Y0b-2 T7：SV 支配门依赖（readServerSV）
        { provide: CollabDocumentService, useValue: collabSvc },
      ],
    }).compile();

    controller = module.get<ExecutionController>(ExecutionController);
  });

  describe('execute', () => {
    it('execute：userId 取自 req.user（不读 body.userId）；service.execute 零 SV 实参（T7：判定在门，非载荷）', async () => {
      const req = { user: { id: 'u-auth' } } as any;
      const body = { projectId: 'p1', nodeId: 'n1', stateVector: SV_OK };
      const result = await controller.execute(body, req);
      expect(service.execute).toHaveBeenCalledWith('p1', 'n1', 'u-auth', undefined, undefined);
      expect(result).toEqual({ success: true, errors: [] });
    });

    it('execute：body 携带 userId 字段也被忽略', async () => {
      const req = { user: { id: 'u-auth' } } as any;
      const body = { projectId: 'p1', userId: 'forged', stateVector: SV_OK };
      await controller.execute(body, req);
      expect(service.execute).toHaveBeenCalledWith('p1', undefined, 'u-auth', undefined, undefined);
    });

    it('T7：缺 stateVector → 400 SYNC_STATE_VECTOR_REQUIRED（fail-closed——缺省静默放行是垫片）', async () => {
      const req = { user: { id: 'u-auth' } } as any;
      const err = await controller.execute({ projectId: 'p1' } as any, req).catch((e: unknown) => e);
      expect(err).toMatchObject({ errorCode: 'SYNC_STATE_VECTOR_REQUIRED' });
      expect((err as any).getStatus()).toBe(400);
      expect(service.execute).not.toHaveBeenCalled();   // 门在 service 之前
    });

    it('T7：客户端 SV 未被服务端支配 → 409 SYNC_PENDING，service 零调用（claim 之前拦截）', async () => {
      collabSvc.readServerSV.mockResolvedValue(Y.encodeStateVector(new Y.Doc()));   // 服务端空 doc——不支配
      const req = { user: { id: 'u-auth' } } as any;
      const err = await controller.execute({ projectId: 'p1', stateVector: SV_OK } as any, req).catch((e: unknown) => e);
      expect(err).toMatchObject({ errorCode: 'SYNC_PENDING' });
      expect((err as any).getStatus()).toBe(409);
      expect(collabSvc.readServerSV).toHaveBeenCalledWith('p1');
      expect(service.execute).not.toHaveBeenCalled();
    });

    it('T7：body.stateVector 走 SV 门（SV 请求头退役）——支配成立放行', async () => {
      const req = { user: { id: 'u-auth' } } as any;
      await controller.execute({ projectId: 'p1', nodeIds: ['n1', 'n2'], stateVector: SV_OK } as any, req);
      expect(service.execute).toHaveBeenCalledWith('p1', undefined, 'u-auth', ['n1', 'n2'], undefined);
    });

    // Y0b-2 T8（Z90/Z117）：EXEC_MAX_NODES 硬闸——21 字面量=default 20+1（env 未设档；设 EXEC_MAX_NODES 的测试环境需自调）
    it('T8：nodeIds.length > EXEC_MAX_NODES → 400 EXEC_SCOPE_TOO_LARGE（service 零调用——DTO 级先于一切）', async () => {
      const req = { user: { id: 'u-auth' } } as any;
      const nodeIds = Array.from({ length: 21 }, (_, i) => `n${i}`);
      const err = await controller.execute({ projectId: 'p1', nodeIds, stateVector: SV_OK } as any, req).catch((e: unknown) => e);
      expect(err).toMatchObject({ errorCode: 'EXEC_SCOPE_TOO_LARGE' });
      expect((err as any).getStatus()).toBe(400);
      expect(service.execute).not.toHaveBeenCalled();
    });

    it('T8：恰 =EXEC_MAX_NODES（20）放行（上限含端点——只挡病态批非收紧合法面）', async () => {
      const req = { user: { id: 'u-auth' } } as any;
      const nodeIds = Array.from({ length: 20 }, (_, i) => `n${i}`);
      await controller.execute({ projectId: 'p1', nodeIds, stateVector: SV_OK } as any, req);
      expect(service.execute).toHaveBeenCalled();
    });
  });

  describe('enqueue', () => {
    it('should add job to queue and return jobId（job.data 零 SV——SV 判定受理时已毕不入队）', async () => {
      const req = { user: { id: 'user-1' } } as any;
      const body = { projectId: 'p1', nodeId: 'n2', stateVector: SV_OK };
      const result = await controller.enqueue(body, req);
      expect(permSvc.assertEditor).toHaveBeenCalledWith('p1', 'user-1');
      expect(queue.add).toHaveBeenCalledWith('execution', {
        projectId: 'p1',
        nodeId: 'n2',
        userId: 'user-1',
        regenToken: null, // Y0b-2 T6（Z91）：改名自 intentId 位——缺省 null
      });
      expect(result).toEqual({ jobId: 'job-123', status: 'queued' });
    });

    it('enqueue：VIEWER 403，不入队', async () => {
      permSvc.assertEditor.mockRejectedValue(new ForbiddenException('无项目编辑权限'));
      const req = { user: { id: 'user-1' } } as any;
      await expect(controller.enqueue({ projectId: 'p1', stateVector: SV_OK } as any, req)).rejects.toThrow('无项目编辑权限');
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('T7：缺 stateVector → 400 SYNC_STATE_VECTOR_REQUIRED，零入队', async () => {
      const req = { user: { id: 'user-1' } } as any;
      const err = await controller.enqueue({ projectId: 'p1' } as any, req).catch((e: unknown) => e);
      expect(err).toMatchObject({ errorCode: 'SYNC_STATE_VECTOR_REQUIRED' });
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('T7：SV 未支配 → 409 SYNC_PENDING 零入队（门在 controller 非处理器）', async () => {
      collabSvc.readServerSV.mockResolvedValue(Y.encodeStateVector(new Y.Doc()));
      const req = { user: { id: 'user-1' } } as any;
      await expect(controller.enqueue({ projectId: 'p1', stateVector: SV_OK } as any, req))
        .rejects.toMatchObject({ errorCode: 'SYNC_PENDING' });
      expect(queue.add).not.toHaveBeenCalled();
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
