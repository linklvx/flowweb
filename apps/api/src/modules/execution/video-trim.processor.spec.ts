import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { VideoTrimProcessor } from './video-trim.processor';
import { VideoTrimService } from './video-trim.service';
import * as constants from './video-trim.constants';

vi.mock('child_process', () => ({ spawn: vi.fn() }));
vi.mock('fs/promises', () => ({ rm: vi.fn().mockResolvedValue(undefined) }));

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

describe('VideoTrimProcessor', () => {
  let processor: VideoTrimProcessor;
  let mockService: { handleTaskCompleted: ReturnType<typeof vi.fn>; handleTaskFailed: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockService = {
      handleTaskCompleted: vi.fn(),
      handleTaskFailed: vi.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        VideoTrimProcessor,
        { provide: VideoTrimService, useValue: mockService },
      ],
    }).compile();

    processor = module.get(VideoTrimProcessor);
  });

  describe('process', () => {
    it('should call handleTaskCompleted on success', async () => {
      vi.spyOn(processor as any, 'runFfmpeg').mockResolvedValue(undefined);

      await processor.process(makeJob());

      expect(mockService.handleTaskCompleted).toHaveBeenCalledWith('task-1', expect.any(String));
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
        data: {
          ...makeJob().data,
          outputPath: `${constants.TEMP_DIR}task-3/output.mp4`,
          taskId: 'task-3',
        },
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
        data: {
          ...makeJob().data,
          outputPath: `${constants.TEMP_DIR}task-4/output.mp4`,
          taskId: 'task-4',
        },
      }))).rejects.toThrow('crash');

      expect(fsPromises.rm).toHaveBeenCalledWith(
        `${constants.TEMP_DIR}task-4`,
        expect.objectContaining({ recursive: true, force: true }),
      );
    });
  });
});
