import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { VideoTrimProcessor } from './video-trim.processor';
import { VideoTrimService } from './video-trim.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import * as constants from './video-trim.constants';

vi.mock('child_process', () => ({ spawn: vi.fn() }));
vi.mock('fs/promises', () => ({
  rm: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from('fake-video-data')),
}));

function makeJob(overrides?: Record<string, unknown>) {
  const defaults = {
    id: 'task-1',
    data: {
      taskId: 'task-1',
      userId: 'user-1',
      inputPath: '/tmp/in.mp4',
      outputPath: '/tmp/out.mp4',
      startTime: 5,
      endTime: 10,
      hasAudio: true,
    },
    updateProgress: vi.fn().mockResolvedValue(undefined),
  };
  return { ...defaults, ...overrides } as any;
}

function mockPrisma() {
  return {
    videoTrimTask: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'task-1',
        sourceFileId: 'file-1',
        nodeId: 'node-1',
        workflowId: 'wf-1',
      }),
    },
    media: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'file-1',
        originalName: 'test-video.mp4',
        mimeType: 'video/mp4',
      }),
      create: vi.fn().mockResolvedValue({
        id: 'media-001',
        userId: 'user-1',
        key: 'results/user-1/wf-1/node-1/2026-07-01/uuid.mp4',
        originalName: 'trimmed-task-1.mp4',
        mimeType: 'video/mp4',
        size: 12345,
        status: 'completed',
      }),
    },
  };
}

function mockMinio() {
  return {
    buildKey: vi.fn().mockReturnValue('results/user-1/wf-1/node-1/2026-07-01/uuid.mp4'),
    upload: vi.fn().mockResolvedValue(undefined),
  };
}

describe('VideoTrimProcessor', () => {
  let processor: VideoTrimProcessor;
  let mockService: { handleTaskCompleted: ReturnType<typeof vi.fn>; handleTaskFailed: ReturnType<typeof vi.fn> };
  let prisma: ReturnType<typeof mockPrisma>;
  let minio: ReturnType<typeof mockMinio>;

  beforeEach(async () => {
    mockService = {
      handleTaskCompleted: vi.fn(),
      handleTaskFailed: vi.fn(),
    };
    prisma = mockPrisma();
    minio = mockMinio();

    const module = await Test.createTestingModule({
      providers: [
        VideoTrimProcessor,
        { provide: VideoTrimService, useValue: mockService },
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
      ],
    }).compile();

    processor = module.get(VideoTrimProcessor);
  });

  describe('process', () => {
    it('should upload result to MinIO and call handleTaskCompleted with media ID', async () => {
      vi.spyOn(processor as any, 'runFfmpeg').mockResolvedValue(undefined);

      await processor.process(makeJob());

      expect(minio.upload).toHaveBeenCalled();
      expect(minio.buildKey).toHaveBeenCalledWith('generated', 'user-1', expect.any(Object));
      expect(prisma.media.create).toHaveBeenCalled();
      expect(mockService.handleTaskCompleted).toHaveBeenCalledWith('task-1', 'media-001');
    });

    it('should call handleTaskFailed on error', async () => {
      vi.spyOn(processor as any, 'runFfmpeg').mockRejectedValue(new Error('FFmpeg crash'));

      await expect(processor.process(makeJob({ id: 'task-2' }))).rejects.toThrow('FFmpeg crash');
      expect(mockService.handleTaskFailed).toHaveBeenCalledWith('task-1', 'FFmpeg crash');
    });

    it('should clean up temp directory on completed', async () => {
      vi.spyOn(processor as any, 'runFfmpeg').mockResolvedValue(undefined);
      const fsPromises = await import('fs/promises');

      await processor.process(makeJob({
        data: { ...makeJob().data, outputPath: `${constants.TEMP_DIR}task-3/output.mp4`, taskId: 'task-3' },
      }));

      expect(fsPromises.rm).toHaveBeenCalledWith(
        `${constants.TEMP_DIR}task-3`,
        expect.objectContaining({ recursive: true, force: true }),
      );
    });

    it('should clean up temp directory on failed', async () => {
      vi.spyOn(processor as any, 'runFfmpeg').mockRejectedValue(new Error('crash'));
      const fsPromises = await import('fs/promises');

      await expect(processor.process(makeJob({
        data: { ...makeJob().data, outputPath: `${constants.TEMP_DIR}task-4/output.mp4`, taskId: 'task-4' },
      }))).rejects.toThrow('crash');

      expect(fsPromises.rm).toHaveBeenCalledWith(
        `${constants.TEMP_DIR}task-4`,
        expect.objectContaining({ recursive: true, force: true }),
      );
    });
  });
});
