import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { spawn } from 'child_process';
import { rm, mkdir, readFile } from 'fs/promises';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { VideoTrimService } from './video-trim.service';
import { buildFfmpegArgs, FfmpegConfig } from './video-trim.utils';
import { VideoTrimJobData, VideoTrimJobResult } from './video-trim.types';
import { VIDEO_TRIM_QUEUE, TEMP_DIR, ffmpegPath } from './video-trim.constants';
import { QUEUE_CONCURRENCY } from '../../config/queue.constants';
import { FFMPEG_PROTOCOL_WHITELIST } from '../media-process/media-process.service';

/** T7：trim ffmpeg 超时（media-process MAX_TASK_DURATION_MS 同款 5min） */
const TRIM_FFMPEG_TIMEOUT_MS = 5 * 60 * 1000;

// Y0c T30（Z146）：并发上界补参——QUEUE_CONCURRENCY.VIDEO_TRIM（=max(1,floor(核数×0.7))）
// 此前定义未消费，实现落 BullMQ 默认 1 与意图不符
@Processor(VIDEO_TRIM_QUEUE, { concurrency: QUEUE_CONCURRENCY.VIDEO_TRIM })
export class VideoTrimProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoTrimProcessor.name);

  private readonly ffmpegConfig: FfmpegConfig = {
    encoder: process.env.VIDEO_TRIM_ENCODER || 'libx264',
    preset: process.env.VIDEO_TRIM_PRESET || 'fast',
    crf: Number(process.env.VIDEO_TRIM_CRF) || 23,
  };

  constructor(
    @Inject(VideoTrimService) private readonly videoTrimService: VideoTrimService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {
    super();
  }

  private runFfmpeg(jobData: VideoTrimJobData): Promise<void> {
    // Y1a+Y1b T7（spec Z7''）：spawn 沙箱——白名单前置（全局 option 须在首个 -i 前）+超时 SIGKILL
    //（media-process runFfmpeg 同款；既有 trim spawn 无超时=挂死占并发槽根修）
    const args = ['-protocol_whitelist', FFMPEG_PROTOCOL_WHITELIST, ...buildFfmpegArgs(jobData, this.ffmpegConfig)];
    this.logger.log(`FFmpeg args: ${args.join(' ')}`);

    return new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });   // T34：惰性读（constants const 冻结形态退役）

      let stderr = '';
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error(`FFmpeg execution timeout (${TRIM_FFMPEG_TIMEOUT_MS}ms)`));
      }, TRIM_FFMPEG_TIMEOUT_MS);

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-200)}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private async cleanupTempDir(taskId: string): Promise<void> {
    try {
      await rm(`${TEMP_DIR}${taskId}`, { recursive: true, force: true });
      this.logger.log(`Cleaned up temp dir: ${TEMP_DIR}${taskId}`);
    } catch (err) {
      this.logger.warn(`Failed to clean up temp dir: ${(err as Error).message}`);
    }
  }

  async process(job: Job<VideoTrimJobData, VideoTrimJobResult>): Promise<VideoTrimJobResult> {
    const { taskId, userId, outputPath } = job.data;
    this.logger.log(`Processing trim task ${taskId}`);
    await job.updateProgress(10);

    try {
      // Ensure output directory exists
      await mkdir(`${TEMP_DIR}${taskId}`, { recursive: true });
      await this.runFfmpeg(job.data);
      await job.updateProgress(80);

      // Upload trimmed result to MinIO and create Media record
      const buffer = await readFile(outputPath);
      const task = await this.prisma.videoTrimTask.findUnique({
        where: { id: taskId },
        select: { sourceFileId: true, nodeId: true, workflowId: true, teamId: true },
      });

      if (!task?.teamId) {
        // task 缺失或团队缺失：job 已无意义，failed 不再 create Media（不回落个人团队）
        Sentry.captureException(new Error(`video-trim: task team missing for task ${taskId}`));
        await this.cleanupTempDir(taskId);
        await this.videoTrimService.handleTaskFailed(taskId, 'PROJECT_TEAM_MISSING');
        return { outputPath: '' };
      }

      const sourceMedia = task
        ? await this.prisma.media.findUnique({ where: { id: task.sourceFileId } })
        : null;

      const ext = sourceMedia?.originalName?.split('.').pop() || 'mp4';
      const key = this.minio.buildKey('generated', userId, {
        projectId: task?.workflowId,
        nodeId: task?.nodeId,
        ext,
      });
      const contentType = sourceMedia?.mimeType || 'video/mp4';

      await this.minio.upload(key, buffer, contentType);

      const media = await this.prisma.media.create({
        data: {
          userId,
          teamId: task.teamId,
          key,
          originalName: `trimmed-${taskId}.${ext}`,
          mimeType: contentType,
          size: buffer.length,
          projectId: task?.workflowId,
          nodeId: task?.nodeId,
          type: 'generated',
          status: 'completed',
        },
      });

      await job.updateProgress(100);
      await this.videoTrimService.handleTaskCompleted(taskId, media.id);
      await this.cleanupTempDir(taskId);

      return { outputPath: media.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Trim task ${taskId} failed: ${message}`);

      await this.cleanupTempDir(taskId);
      await this.videoTrimService.handleTaskFailed(taskId, message);

      throw error;
    }
  }
}
