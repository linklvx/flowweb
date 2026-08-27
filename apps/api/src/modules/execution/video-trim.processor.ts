import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { rm, mkdir, readFile } from 'fs/promises';
import { PrismaService } from '../../prisma/prisma.service';
import { getOwnerTeamId } from '../team/team.util';
import { MinioService } from '../minio/minio.service';
import { VideoTrimService } from './video-trim.service';
import { buildFfmpegArgs, FfmpegConfig } from './video-trim.utils';
import { VideoTrimJobData, VideoTrimJobResult } from './video-trim.types';
import { VIDEO_TRIM_QUEUE, TEMP_DIR, FFMPEG_PATH } from './video-trim.constants';

@Processor(VIDEO_TRIM_QUEUE)
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
    const args = buildFfmpegArgs(jobData, this.ffmpegConfig);
    this.logger.log(`FFmpeg args: ${args.join(' ')}`);

    return new Promise((resolve, reject) => {
      const proc = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      let stderr = '';
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-200)}`));
        }
      });

      proc.on('error', (err) => {
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
        select: { sourceFileId: true, nodeId: true, workflowId: true },
      });

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
          teamId: await getOwnerTeamId(this.prisma, userId),
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
