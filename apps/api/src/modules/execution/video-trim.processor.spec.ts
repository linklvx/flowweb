import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { VideoTrimProcessor } from './video-trim.processor';
import { QUEUE_CONCURRENCY } from '../../config/queue.constants';
import { VideoTrimService } from './video-trim.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import * as constants from './video-trim.constants';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

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
    team: { findFirst: vi.fn().mockResolvedValue({ id: 'team1' }) },
    videoTrimTask: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'task-1',
        sourceFileId: 'file-1',
        nodeId: 'node-1',
        workflowId: 'wf-1',
        teamId: 'team1',
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

    it('生成物归属 = task.teamId（非 getOwnerTeamId 反推）', async () => {
      vi.spyOn(processor as any, 'runFfmpeg').mockResolvedValue(undefined);

      await processor.process(makeJob());

      expect(prisma.media.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ teamId: 'team1' }),
        }),
      );
      expect(prisma.team.findFirst).not.toHaveBeenCalled();
    });

    it('task/teamId 缺失 → failed 分支（handleTaskFailed，不建 Media 不回落）', async () => {
      vi.spyOn(processor as any, 'runFfmpeg').mockResolvedValue(undefined);
      prisma.videoTrimTask.findUnique.mockResolvedValue(null);

      await processor.process(makeJob());

      expect(mockService.handleTaskFailed).toHaveBeenCalledWith('task-1', 'PROJECT_TEAM_MISSING');
      expect(prisma.media.create).not.toHaveBeenCalled();
      expect(prisma.team.findFirst).not.toHaveBeenCalled();
    });
  });

  // Y1a+Y1b T7（spec Z7''）：ffmpeg spawn 沙箱化——protocol_whitelist 前置+timeout SIGKILL
  // （trim 与 media-process/thumbnail 同批改——grep 全部 spawn 面清单之一）。
  describe('Y1a+Y1b T7：runFfmpeg spawn 沙箱（spawn 数组+timeout+protocol_whitelist）', () => {
    // 顶部 vi.mock('child_process') 工厂拦截——直接 import 取同 mock 引用（events 真身）
    const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>;

    function makeProc(hang: boolean) {
      const proc = new EventEmitter() as any;
      proc.stdout = { on: vi.fn() };
      proc.stderr = { on: vi.fn() };
      proc.kill = vi.fn();
      if (!hang) process.nextTick(() => proc.emit('close', 0));
      return proc;
    }

    it('spawn 实参前置 -protocol_whitelist file,http,https,tcp,tls（红：现状无白名单）', async () => {
      mockSpawn.mockReturnValue(makeProc(false));
      await (processor as any).runFfmpeg(makeJob().data);
      const args = mockSpawn.mock.calls[mockSpawn.mock.calls.length - 1][1] as string[];
      expect(args[0]).toBe('-protocol_whitelist');
      expect(args[1]).toBe('file,http,https,tcp,tls');
      expect(args[2]).toBe('-ss');   // buildFfmpegArgs 首项原样后移
    });

    it('timeout SIGKILL：进程挂死 → 超时 kill+reject（红：现状 trim spawn 无超时——挂死占并发槽）', async () => {
      vi.useFakeTimers();
      try {
        mockSpawn.mockReturnValue(makeProc(true));
        const ret = (processor as any).runFfmpeg(makeJob().data).then(
          () => 'resolved',
          (e: Error) => e.message.includes('timeout') ? 'rejected:timeout' : `rejected:${e.message}`,
        );
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
        const proc = mockSpawn.mock.results[mockSpawn.mock.results.length - 1].value;
        expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
        expect(await ret).toBe('rejected:timeout');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

// Y0c T30（Z146 事实更正）：并发上界显式登记——QUEUE_CONCURRENCY.VIDEO_TRIM（queue.constants.ts
// 定义 =max(1,floor(核数×0.7))）此前未被消费，实现落 BullMQ 默认并发 1 与意图不符。断言形态=
// @Processor 第二参 WORKER_METADATA 元数据直读（'bullmq:worker_metadata'——bull-metadata.
// accessor.js:28 消费；module-split.spec 同款静态断言，不 compile 不连线）。
describe('Y0c T30 并发上界（Z146）', () => {
  it('@Processor worker options 含 concurrency=QUEUE_CONCURRENCY.VIDEO_TRIM（0.7×核数意图落实现）', () => {
    expect(Reflect.getMetadata('bullmq:worker_metadata', VideoTrimProcessor))
      .toMatchObject({ concurrency: QUEUE_CONCURRENCY.VIDEO_TRIM });
  });
});
