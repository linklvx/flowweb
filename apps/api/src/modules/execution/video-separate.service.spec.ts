import { Test, TestingModule } from '@nestjs/testing';
import { VideoSeparateService } from './video-separate.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { VIDEO_SEPARATE_QUEUE } from './video-separate.constants';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('VideoSeparateService', () => {
  let service: VideoSeparateService;
  let mockPrisma: any;
  let mockRedis: any;
  let mockQueue: any;
  let mockMinio: any;
  let mockGateway: any;

  beforeEach(async () => {
    mockRedis = {
      set: vi.fn(),
      incr: vi.fn(),
      decr: vi.fn(),
      expire: vi.fn(),
      del: vi.fn().mockResolvedValue(undefined),
    };
    mockPrisma = {
      media: { findFirst: vi.fn(), findUnique: vi.fn() },
      team: { findFirst: vi.fn().mockResolvedValue({ id: 'team-1' }) },
      teamMember: { findFirst: vi.fn().mockResolvedValue(null) },
      videoSeparateTask: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
      },
    };
    mockQueue = { add: vi.fn() };
    mockMinio = { generatePresignedGetUrl: vi.fn() };
    mockGateway = {
      emitSeparateStatus: vi.fn(),
      emitNodeStatus: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VideoSeparateService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
        { provide: getQueueToken(VIDEO_SEPARATE_QUEUE), useValue: mockQueue },
        { provide: MinioService, useValue: mockMinio },
        { provide: ExecutionGateway, useValue: mockGateway },
      ],
    }).compile();

    service = module.get<VideoSeparateService>(VideoSeparateService);
  });

  describe('submitSeparate', () => {
    const baseParams = {
      fileId: 'file-1',
      nodeId: 'node-1',
      mode: 'split',
      userId: 'user-1',
      workflowId: 'wf-1',
    };

    const mockMedia = {
      id: 'file-1',
      size: 10485760,
      mimeType: 'video/mp4',
      originalName: 'test_video.mp4',
      key: 'uploads/user-1/test_video.mp4',
      projectId: null,
    };

    it('should create task and enqueue on success', async () => {
      mockPrisma.media.findFirst.mockResolvedValue(mockMedia);
      mockRedis.set.mockResolvedValue('OK'); // SETNX success
      mockPrisma.videoSeparateTask.findFirst.mockResolvedValue(null); // no duplicate
      mockPrisma.videoSeparateTask.create.mockResolvedValue({
        id: 'task-1',
        userId: 'user-1',
        workflowId: 'wf-1',
        nodeId: 'node-1',
        sourceFileId: 'file-1',
        mode: 'split',
        status: 'queued',
      });
      mockQueue.add.mockResolvedValue({ id: 'task-1' });
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue('OK');

      const result = await service.submitSeparate(baseParams);

      expect(result.taskId).toBe('task-1');
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      expect(mockRedis.incr).toHaveBeenCalledWith('user:video-separate:user-1');
    });

    it('should throw ForbiddenException when file not owned by user', async () => {
      mockPrisma.media.findFirst.mockResolvedValue(null);

      await expect(service.submitSeparate(baseParams)).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when file too large', async () => {
      mockPrisma.media.findFirst.mockResolvedValue({
        ...mockMedia,
        size: 3 * 1024 * 1024 * 1024, // 3GB
      });

      await expect(service.submitSeparate(baseParams)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when mimeType not supported', async () => {
      mockPrisma.media.findFirst.mockResolvedValue({
        ...mockMedia,
        mimeType: 'image/png',
      });

      await expect(service.submitSeparate(baseParams)).rejects.toThrow(BadRequestException);
    });

    it('should return existing taskId on duplicate', async () => {
      mockPrisma.media.findFirst.mockResolvedValue(mockMedia);
      mockRedis.set.mockResolvedValue('OK');
      mockPrisma.videoSeparateTask.findFirst.mockResolvedValue({ id: 'existing-task' });

      const result = await service.submitSeparate(baseParams);

      expect(result.taskId).toBe('existing-task');
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should throw when Redis lock is not acquired', async () => {
      mockPrisma.media.findFirst.mockResolvedValue(mockMedia);
      mockRedis.set.mockResolvedValue(null); // SETNX failed

      await expect(service.submitSeparate(baseParams)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when user exceeds concurrent limit', async () => {
      mockPrisma.media.findFirst.mockResolvedValue(mockMedia);
      mockRedis.set.mockResolvedValue('OK');
      mockPrisma.videoSeparateTask.findFirst.mockResolvedValue(null);
      mockPrisma.videoSeparateTask.create.mockResolvedValue({ id: 'task-1' });
      mockQueue.add.mockResolvedValue({ id: 'task-1' });
      mockRedis.incr.mockResolvedValue(4); // > 3 limit
      mockRedis.expire.mockResolvedValue('OK');

      await expect(service.submitSeparate(baseParams)).rejects.toThrow(BadRequestException);
      expect(mockRedis.decr).toHaveBeenCalled(); // rollback counter
    });
  });

  describe('getTaskStatus', () => {
    it('should return status for own task', async () => {
      mockPrisma.videoSeparateTask.findUnique.mockResolvedValue({
        status: 'done',
        videoFileId: 'vid-1',
        audioFileId: 'aud-1',
        errorMsg: null,
        userId: 'user-1',
      });

      const result = await service.getTaskStatus('task-1', 'user-1');

      expect(result.status).toBe('done');
      expect(result.videoFileId).toBe('vid-1');
    });

    it('should throw ForbiddenException for cross-user access', async () => {
      mockPrisma.videoSeparateTask.findUnique.mockResolvedValue({
        status: 'processing',
        userId: 'user-2',
      });

      await expect(service.getTaskStatus('task-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException for unknown task (leak prevention)', async () => {
      mockPrisma.videoSeparateTask.findUnique.mockResolvedValue(null);

      await expect(service.getTaskStatus('unknown', 'user-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('handleTaskCompleted', () => {
    it('should update task and push Socket event', async () => {
      mockPrisma.videoSeparateTask.update.mockResolvedValue({
        workflowId: 'wf-1',
        nodeId: 'node-1',
      });

      await service.handleTaskCompleted('task-1', 'vid-1', 'aud-1');

      expect(mockPrisma.videoSeparateTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'done', videoFileId: 'vid-1', audioFileId: 'aud-1', finishedAt: expect.any(Date) },
      });
      expect(mockGateway.emitSeparateStatus).toHaveBeenCalledWith('wf-1', {
        nodeId: 'node-1',
        taskId: 'task-1',
        status: 'done',
        videoFileId: 'vid-1',
        audioFileId: 'aud-1',
      });
    });
  });

  describe('handleTaskFailed', () => {
    it('should update task with error and push Socket event', async () => {
      mockPrisma.videoSeparateTask.update.mockResolvedValue({
        workflowId: 'wf-1',
        nodeId: 'node-1',
      });

      await service.handleTaskFailed('task-1', 'something broke', 'FFMPEG_ERROR');

      expect(mockPrisma.videoSeparateTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: {
          status: 'error',
          errorMsg: 'something broke',
          errorType: 'FFMPEG_ERROR',
          finishedAt: expect.any(Date),
        },
      });
    });
  });

  describe('setTaskProcessing', () => {
    it('should update status to processing and push Socket event', async () => {
      mockPrisma.videoSeparateTask.update.mockResolvedValue({
        workflowId: 'wf-1',
        nodeId: 'node-1',
      });

      await service.setTaskProcessing('task-1');

      expect(mockPrisma.videoSeparateTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'processing' },
      });
      expect(mockGateway.emitSeparateStatus).toHaveBeenCalledWith('wf-1', {
        nodeId: 'node-1',
        taskId: 'task-1',
        status: 'processing',
      });
    });
  });
});
