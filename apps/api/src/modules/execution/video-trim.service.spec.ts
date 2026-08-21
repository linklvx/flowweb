import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { VideoTrimService } from './video-trim.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import * as constants from './video-trim.constants';

const { mockExec } = vi.hoisted(() => {
  return {
    mockExec: vi.fn((cmd: string, cb?: any) => {
      if (cb) {
        cb(null, '30.0', '');
      }
      return {} as any;
    }),
  };
});

vi.mock('child_process', () => ({
  exec: mockExec,
}));

function mockPrismaService(overrides: Record<string, any> = {}) {
  return {
    videoTrimTask: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'task-001',
        userId: 'user-1',
        workflowId: 'wf-1',
        nodeId: 'node-1',
        sourceFileId: 'file-1',
        startTime: 5,
        endTime: 10,
        status: 'queued',
        outputFileId: null,
        errorMsg: null,
      }),
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    media: {
      findFirst: vi.fn().mockResolvedValue({ id: 'file-1' }),
      findUnique: vi.fn().mockResolvedValue({ id: 'file-1', key: 'uploads/test.mp4', projectId: 'wf-1' }),
    },
    ...overrides,
  };
}

function mockBullQueue() {
  return { add: vi.fn().mockResolvedValue({ id: 'job-001' }) };
}

function mockMinioService() {
  return { generatePresignedGetUrl: vi.fn().mockResolvedValue('https://minio.local/bucket/uploads/test.mp4?sign=abc') };
}

describe('VideoTrimService', () => {
  let service: VideoTrimService;
  let prisma: ReturnType<typeof mockPrismaService>;
  let queue: ReturnType<typeof mockBullQueue>;
  let gateway: { emitTrimStatus: ReturnType<typeof vi.fn> };
  let minio: ReturnType<typeof mockMinioService>;

  beforeEach(async () => {
    // Reset mockExec to default (ffprobe returns duration=30.0, no audio)
    mockExec.mockImplementation((_cmd: string, cb?: any) => {
      if (cb) cb(null, '30.0', '');
      return {} as any;
    });

    prisma = mockPrismaService();
    queue = mockBullQueue();
    gateway = { emitTrimStatus: vi.fn() };
    minio = mockMinioService();

    const module = await Test.createTestingModule({
      providers: [
        VideoTrimService,
        { provide: PrismaService, useValue: prisma },
        { provide: `BullQueue_${constants.VIDEO_TRIM_QUEUE}`, useValue: queue },
        { provide: ExecutionGateway, useValue: gateway },
        { provide: MinioService, useValue: minio },
      ],
    }).compile();

    service = module.get(VideoTrimService);
  });

  // ── Parameter validation ──

  describe('validateParams', () => {
    it('should throw BadRequestException if startTime < 0', () => {
      expect(() =>
        (service as any).validateParams(-1, 10, 30),
      ).toThrow(BadRequestException);
    });

    it('should throw BadRequestException if endTime > actual duration', () => {
      expect(() =>
        (service as any).validateParams(5, 35, 30),
      ).toThrow(BadRequestException);
    });

    it('should throw BadRequestException if trim duration < 0.5s', () => {
      expect(() =>
        (service as any).validateParams(5, 5.3, 30),
      ).toThrow(BadRequestException);
    });

    it('should throw BadRequestException if source video < 0.5s', () => {
      expect(() =>
        (service as any).validateParams(0, 0.3, 0.3),
      ).toThrow(BadRequestException);
    });

    it('should pass for valid params', () => {
      expect(() =>
        (service as any).validateParams(5, 10, 30),
      ).not.toThrow();
    });
  });

  // ── File ownership ──

  describe('validateFileOwnership', () => {
    it('should throw ForbiddenException if file does not belong to user', async () => {
      prisma.media = { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn() };

      await expect(
        (service as any).validateFileOwnership('file-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should pass if file belongs to user', async () => {
      prisma.media = { findFirst: vi.fn().mockResolvedValue({ id: 'file-1' }), findUnique: vi.fn() };

      await expect(
        (service as any).validateFileOwnership('file-1', 'user-1'),
      ).resolves.toBeUndefined();
    });
  });

  // ── Duplicate check ──

  describe('checkDuplicate', () => {
    it('should return existing taskId if duplicate submission', async () => {
      prisma.videoTrimTask.findFirst.mockResolvedValueOnce({
        id: 'existing-task',
        status: 'queued',
      });

      const result = await (service as any).checkDuplicate('node-1');
      expect(result).toBe('existing-task');
    });

    it('should return null if no duplicate', async () => {
      prisma.videoTrimTask.findFirst.mockResolvedValueOnce(null);

      const result = await (service as any).checkDuplicate('node-1');
      expect(result).toBeNull();
    });
  });

  // ── Audio detection ──

  describe('detectAudio', () => {
    it('should detect no audio track and set hasAudio=false', async () => {
      mockExec.mockImplementation((_cmd: string, cb?: any) => {
        if (cb) cb(null, '', '');
        return {} as any;
      });

      const result = await (service as any).detectAudio('/path/to/video.mp4');
      expect(result).toBe(false);
    });

    it('should detect audio track and set hasAudio=true', async () => {
      mockExec.mockImplementation((_cmd: string, cb?: any) => {
        if (cb) cb(null, 'audio', '');
        return {} as any;
      });

      const result = await (service as any).detectAudio('/path/to/video.mp4');
      expect(result).toBe(true);
    });

    it('should return false when ffprobe fails', async () => {
      mockExec.mockImplementation((_cmd: string, cb?: any) => {
        if (cb) cb(new Error('ffprobe not found'), '', '');
        return {} as any;
      });

      const result = await (service as any).detectAudio('/path/to/video.mp4');
      expect(result).toBe(false);
    });
  });

  // ── submitTrim ──

  describe('submitTrim', () => {
    it('should create task and enqueue job with presigned URL', async () => {
      const presignedUrl = 'https://minio.local/bucket/uploads/test.mp4?sign=abc';
      minio.generatePresignedGetUrl.mockResolvedValueOnce(presignedUrl);

      prisma.videoTrimTask.create.mockResolvedValueOnce({
        id: 'task-002',
        userId: 'user-1',
        workflowId: 'wf-1',
        nodeId: 'node-1',
        sourceFileId: 'file-1',
        startTime: 5,
        endTime: 10,
        status: 'queued',
      });

      const result = await service.submitTrim({
        fileId: 'file-1',
        startTime: 5,
        endTime: 10,
        nodeId: 'node-1',
        userId: 'user-1',
        workflowId: 'wf-1',
      });

      expect(result.taskId).toBe('task-002');
      expect(minio.generatePresignedGetUrl).toHaveBeenCalledWith('uploads/test.mp4', 3600);
      expect(queue.add).toHaveBeenCalledWith(
        'video-trim',
        expect.objectContaining({ inputPath: presignedUrl }),
        expect.anything(),
      );
    });
  });

  // ── getTaskStatus ──

  describe('getTaskStatus', () => {
    it('should return task status', async () => {
      prisma.videoTrimTask.findUnique.mockResolvedValueOnce({
        id: 'task-1',
        status: 'done',
        outputFileId: 'out-1',
        errorMsg: null,
      });

      const result = await service.getTaskStatus('task-1');
      expect(result?.status).toBe('done');
      expect(result?.outputFileId).toBe('out-1');
    });

    it('should return null for unknown task', async () => {
      prisma.videoTrimTask.findUnique.mockResolvedValueOnce(null);

      const result = await service.getTaskStatus('unknown');
      expect(result).toBeNull();
    });
  });
});
