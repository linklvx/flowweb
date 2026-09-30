import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import * as path from 'path';
import { mkdir, statfs } from 'fs/promises';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { MediaProcessService } from '../media-process/media-process.service';
import { VideoSeparateService } from './video-separate.service';
import {
  VIDEO_SEPARATE_QUEUE, TEMP_SEPARATE_DIR,
  PRESIGNED_URL_EXPIRY, DOWNLOAD_TIMEOUT_MS, DOWNLOAD_RETRIES,
  ALLOWED_EXTENSIONS, AUDIO_OUTPUT_EXT, AUDIO_OUTPUT_MIME,
} from './video-separate.constants';
import { QUEUE_CONCURRENCY } from '../../config/queue.constants';
import { NonRetryableError, VideoSeparateJobData, VideoSeparateJobResult } from './video-separate.types';
import { defaultMediaRetryStrategy } from './video-separate.retry';

@Processor(VIDEO_SEPARATE_QUEUE, {
  concurrency: QUEUE_CONCURRENCY.VIDEO_SEPARATE,
  settings: { retryStrategy: defaultMediaRetryStrategy },
} as any) // BullMQ SettingsOpts 类型定义未暴露 retryStrategy，但运行时正确支持
export class VideoSeparateProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoSeparateProcessor.name);

  constructor(
    @Inject(VideoSeparateService) private readonly separateService: VideoSeparateService,
    @Inject(MediaProcessService) private readonly mediaProcess: MediaProcessService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject('REDIS_CLIENT') private readonly redis: any,
  ) {
    super();
    this.cleanupStaleOnStart();
  }

  private async cleanupStaleOnStart(): Promise<void> {
    try {
      await mkdir(TEMP_SEPARATE_DIR, { recursive: true });
      await this.mediaProcess.cleanupStaleDirs(TEMP_SEPARATE_DIR, 24 * 3600_000);

      // 启动时扫描活跃任务，校准 Redis 计数 → 降低进程崩溃导致的计数泄漏
      const activeTasks = await this.prisma.videoSeparateTask.findMany({
        where: { status: { in: ['queued', 'processing'] } },
        select: { userId: true },
      });
      const userCounts = new Map<string, number>();
      for (const t of activeTasks) {
        userCounts.set(t.userId, (userCounts.get(t.userId) || 0) + 1);
      }
      for (const [userId, count] of userCounts) {
        const key = `user:video-separate:${userId}`;
        await this.redis.set(key, String(count), 'EX', 86400);
        this.logger.log(`Startup reconciliation: set ${key} = ${count}`);
      }
    } catch (err) {
      this.logger.warn(`Startup stale cleanup failed: ${(err as Error).message}`);
    }
  }

  private safePath(input: string): { ext: string; safeBaseName: string } {
    const rawExt = path.extname(input).toLowerCase().replace('.', '');
    const ext = ALLOWED_EXTENSIONS.includes(rawExt) ? rawExt : 'mp4';
    const safeBaseName = path.basename(input, path.extname(input))
      .replace(/[^a-zA-Z0-9_\-一-鿿]/g, '_');
    return { ext, safeBaseName };
  }

  private classifyError(error: Error): string {
    const msg = error.message;
    if (msg.includes('No such file') || msg.includes('Invalid data')) return 'FILE_CORRUPTED';
    if (msg.includes('Connection refused') || msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET')) return 'MINIO_UPLOAD_FAILED';
    if (msg.includes('SIGKILL') || msg.includes('timeout') || msg.includes('Timeout')) return 'FFMPEG_TIMEOUT';
    if (msg.includes('Unsupported codec')) return 'CODEC_UNSUPPORTED';
    if (msg.includes('Insufficient disk space')) return 'DISK_SPACE_INSUFFICIENT';
    return 'UNKNOWN';
  }

  private async ensureDiskSpace(outputDir: string, sourceSize: number): Promise<void> {
    const requiredSpace = sourceSize * 3.5; // input + 2 outputs + buffer
    try {
      const stats = await statfs(outputDir);
      const available = stats.bavail * stats.bsize;
      if (available < requiredSpace) {
        const availableMB = (available / 1024 / 1024).toFixed(1);
        const requiredMB = (requiredSpace / 1024 / 1024).toFixed(1);
        throw new NonRetryableError(
          'DISK_SPACE_INSUFFICIENT',
          `磁盘空间不足：可用 ${availableMB}MB，需要 ${requiredMB}MB`,
        );
      }
      this.logger.log(
        `Disk space OK: available=${(available / 1024 / 1024).toFixed(1)}MB, required=${(requiredSpace / 1024 / 1024).toFixed(1)}MB`,
      );
    } catch (err) {
      if (err instanceof NonRetryableError) throw err;
      // 降级处理：statfs 在 Node < 18.15.0 不存在 / 权限不足等场景
      // 记录警告并继续执行，不做硬阻断
      this.logger.warn(
        `Disk space check unavailable (Node >= 18.15.0 required), proceeding without check: ${(err as Error).message}`,
      );
    }
  }

  async process(job: Job<VideoSeparateJobData>): Promise<VideoSeparateJobResult> {
    const { taskId, userId, sourceFileId, sourceKey, sourceOriginalName, sourceMimeType, projectId, nodeId } = job.data;

    const { ext, safeBaseName } = this.safePath(sourceOriginalName);
    const outputDir = path.join(TEMP_SEPARATE_DIR, taskId);

    try {
      // Entry: mark processing + push Socket
      await this.separateService.setTaskProcessing(taskId);
      await job.updateProgress(5);

      await mkdir(outputDir, { recursive: true });

      // Disk space pre-check (source × 3.5 buffer for input + 2 outputs)
      await this.ensureDiskSpace(outputDir, job.data.sourceSize);

      // Generate fresh presigned URL
      const presignedUrl = await this.minio.generatePresignedGetUrl(sourceKey, PRESIGNED_URL_EXPIRY);

      // Download with independent timeout + retry
      const inputPath = path.join(outputDir, `input.${ext}`);
      await this.mediaProcess.downloadWithRetry(presignedUrl, inputPath, {
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        retries: DOWNLOAD_RETRIES,
      });
      await job.updateProgress(20);

      // ffprobe metadata
      const metadata = await this.mediaProcess.detectMetadata(inputPath);

      // Audio track check
      const hasAudio = await this.mediaProcess.detectAudio(inputPath);
      if (!hasAudio) {
        throw new NonRetryableError('NO_AUDIO_TRACK', '视频不包含音频轨道');
      }

      const audioCodec = await this.mediaProcess.detectAudioCodec(inputPath);
      await job.updateProgress(30);

      // Extract video-only (-an -c:v copy)
      const videoOutput = path.join(outputDir, `output_video.${ext}`);
      await this.mediaProcess.runFfmpeg(['-i', inputPath, '-an', '-c:v', 'copy', '-y', videoOutput]);
      await job.updateProgress(60);

      // Extract audio-only (-vn, copy or transcode AAC)
      const audioOutput = path.join(outputDir, `output_audio.${AUDIO_OUTPUT_EXT}`);
      const audioArgs = (audioCodec === 'aac' || audioCodec === 'mp3')
        ? ['-i', inputPath, '-vn', '-c:a', 'copy', '-y', audioOutput]
        : ['-i', inputPath, '-vn', '-c:a', 'aac', '-b:a', '192k', '-y', audioOutput];
      await this.mediaProcess.runFfmpeg(audioArgs);
      await job.updateProgress(85);

      // Upload + create Media records
      const videoMedia = await this.mediaProcess.uploadAndCreateMedia({
        filePath: videoOutput, userId, projectId, nodeId,
        originalName: `${safeBaseName}_无音频.${ext}`,
        mimeType: sourceMimeType, sourceFileId, bizType: 'video_separate',
        metadata: {
          duration: metadata.duration,
          width: metadata.width,
          height: metadata.height,
          videoCodec: metadata.videoCodec,
          bitrate: metadata.bitrate,
        },
      });

      const audioMedia = await this.mediaProcess.uploadAndCreateMedia({
        filePath: audioOutput, userId, projectId, nodeId,
        originalName: `${safeBaseName}_分离音频.${AUDIO_OUTPUT_EXT}`,
        mimeType: AUDIO_OUTPUT_MIME, sourceFileId, bizType: 'video_separate',
        metadata: {
          duration: metadata.duration,
          audioCodec: audioCodec || metadata.audioCodec,
          bitrate: metadata.audioBitrate,
        },
      });

      await job.updateProgress(100);

      await this.separateService.handleTaskCompleted(taskId, videoMedia.id, audioMedia.id);
      await this.redis.decr(`user:video-separate:${userId}`);

      return { videoFileId: videoMedia.id, audioFileId: audioMedia.id };

    } catch (error) {
      await this.redis.decr(`user:video-separate:${userId}`);

      // PROJECT_TEAM_MISSING 属永久性错误（project 缺失/已删，重试不会好转）：
      // 包装为不可重试，避免 BullMQ 指数退避放大为 3× 下载/ffmpeg/上传 + 孤儿对象
      const failure =
        (error as Error).message === 'PROJECT_TEAM_MISSING'
          ? new NonRetryableError('PROJECT_TEAM_MISSING', (error as Error).message)
          : error;

      if (failure instanceof NonRetryableError) {
        // 业务错误：更新 DB → throw → retryStrategy 返回 -1 → BullMQ 直接标记 failed
        await this.separateService.handleTaskFailed(taskId, failure.message, failure.errorType);
        throw failure;
      }

      // 基础设施错误：更新 DB → throw → retryStrategy 指数退避 → BullMQ 自动重试
      const errorType = this.classifyError(failure as Error);
      await this.separateService.handleTaskFailed(taskId, (failure as Error).message, errorType);
      throw failure;
    } finally {
      await this.mediaProcess.cleanupTempDir(taskId, TEMP_SEPARATE_DIR);
    }
  }
}
