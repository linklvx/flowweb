import { Test, TestingModule } from '@nestjs/testing';
import { VideoSeparateProcessor } from './video-separate.processor';
import { VideoSeparateService } from './video-separate.service';
import { MediaProcessService } from '../media-process/media-process.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { NonRetryableError, VideoSeparateJobData } from './video-separate.types';
import { Job } from 'bullmq';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

describe('VideoSeparateProcessor', () => {
  let processor: VideoSeparateProcessor;
  let mockSeparateService: any;
  let mockMediaProcess: any;
  let mockPrisma: any;
  let mockMinio: any;
  let mockRedis: any;

  const baseJobData: VideoSeparateJobData = {
    taskId: 'task-1',
    userId: 'user-1',
    sourceFileId: 'file-1',
    sourceKey: 'uploads/test.mp4',
    sourceOriginalName: 'test.mp4',
    sourceMimeType: 'video/mp4',
    sourceSize: 10485760,
    projectId: 'proj-1',
    nodeId: 'node-1',
  };

  function mockJob(data: VideoSeparateJobData) {
    return {
      data,
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job<VideoSeparateJobData>;
  }

  beforeEach(async () => {
    mockRedis = { decr: vi.fn().mockResolvedValue(1) };
    mockSeparateService = {
      setTaskProcessing: vi.fn().mockResolvedValue(undefined),
      handleTaskCompleted: vi.fn().mockResolvedValue(undefined),
      handleTaskFailed: vi.fn().mockResolvedValue(undefined),
    };
    mockMediaProcess = {
      detectAudio: vi.fn().mockResolvedValue(true),
      detectAudioCodec: vi.fn().mockResolvedValue('aac'),
      detectDuration: vi.fn().mockResolvedValue(60),
      detectMetadata: vi.fn().mockResolvedValue({ duration: 60, width: 1920, height: 1080 }),
      runFfmpeg: vi.fn().mockResolvedValue(undefined),
      uploadAndCreateMedia: vi.fn().mockResolvedValue({ id: 'media-1' }),
      cleanupTempDir: vi.fn().mockResolvedValue(undefined),
      cleanupStaleDirs: vi.fn().mockResolvedValue(undefined),
      downloadWithRetry: vi.fn().mockImplementation((_url, _dest, _opts) => Promise.resolve()),
    };
    mockPrisma = { media: {}, videoSeparateTask: {} };
    mockMinio = { generatePresignedGetUrl: vi.fn().mockResolvedValue('https://signed.url') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VideoSeparateProcessor,
        { provide: VideoSeparateService, useValue: mockSeparateService },
        { provide: MediaProcessService, useValue: mockMediaProcess },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MinioService, useValue: mockMinio },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    processor = module.get<VideoSeparateProcessor>(VideoSeparateProcessor);
  });

  it('should process successful separation with AAC codec (stream copy)', async () => {
    const job = mockJob(baseJobData);

    const result = await processor.process(job);

    expect(mockSeparateService.setTaskProcessing).toHaveBeenCalledWith('task-1');
    expect(mockMediaProcess.detectAudio).toHaveBeenCalled();
    expect(mockMediaProcess.runFfmpeg).toHaveBeenCalledTimes(2);
    expect(mockSeparateService.handleTaskCompleted).toHaveBeenCalledWith('task-1', 'media-1', 'media-1');
    expect(mockRedis.decr).toHaveBeenCalledWith('user:video-separate:user-1');
    expect(mockMediaProcess.cleanupTempDir).toHaveBeenCalled();
  });

  it('should transcode Opus audio to AAC', async () => {
    mockMediaProcess.detectAudioCodec.mockResolvedValue('opus');
    const job = mockJob(baseJobData);

    await processor.process(job);

    // Verify audio args include AAC transcode
    const audioCall = mockMediaProcess.runFfmpeg.mock.calls[1][0];
    expect(audioCall).toContain('aac');
  });

  it('should handle no audio track by throwing NonRetryableError (retryStrategy returns -1)', async () => {
    mockMediaProcess.detectAudio.mockResolvedValue(false);
    const job = mockJob(baseJobData);

    await expect(processor.process(job)).rejects.toThrow(NonRetryableError);
    expect(mockSeparateService.handleTaskFailed).toHaveBeenCalledWith('task-1', '视频不包含音频轨道', 'NO_AUDIO_TRACK');
    expect(mockRedis.decr).toHaveBeenCalled();
  });

  it('PROJECT_TEAM_MISSING（project 缺失，永久性错误）→ 包装为 NonRetryableError 终态，不触发重试放大', async () => {
    mockMediaProcess.uploadAndCreateMedia.mockRejectedValue(new Error('PROJECT_TEAM_MISSING'));
    const job = mockJob(baseJobData);

    await expect(processor.process(job)).rejects.toThrow(NonRetryableError);
    expect(mockSeparateService.handleTaskFailed).toHaveBeenCalledWith('task-1', 'PROJECT_TEAM_MISSING', 'PROJECT_TEAM_MISSING');
    // 媒体处理在首次尝试内只走到第一次 uploadAndCreateMedia（video 抛错后 audio 不再执行）
    expect(mockMediaProcess.uploadAndCreateMedia).toHaveBeenCalledTimes(1);
  });

  it('should handle download failure with retry via throw', async () => {
    mockMediaProcess.downloadWithRetry.mockRejectedValue(new Error('ECONNRESET'));
    const job = mockJob(baseJobData);

    await expect(processor.process(job)).rejects.toThrow('ECONNRESET');
    expect(mockSeparateService.handleTaskFailed).toHaveBeenCalledWith('task-1', 'ECONNRESET', 'MINIO_UPLOAD_FAILED');
  });

  it('should clean up temp dir in finally block after error', async () => {
    mockMediaProcess.detectAudio.mockRejectedValue(new Error('unexpected'));
    const job = mockJob(baseJobData);

    await expect(processor.process(job)).rejects.toThrow('unexpected');
    expect(mockMediaProcess.cleanupTempDir).toHaveBeenCalled();
  });
});
