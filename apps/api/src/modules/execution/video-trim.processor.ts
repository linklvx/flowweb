import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { rm } from 'fs/promises';
import { VideoTrimService } from './video-trim.service';
import { buildFfmpegArgs, FfmpegConfig } from './video-trim.utils';
import { VideoTrimJobData, VideoTrimJobResult } from './video-trim.types';
import { VIDEO_TRIM_QUEUE, TEMP_DIR } from './video-trim.constants';

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
  ) {
    super();
  }

  private runFfmpeg(jobData: VideoTrimJobData): Promise<void> {
    const args = buildFfmpegArgs(jobData, this.ffmpegConfig);
    this.logger.log(`FFmpeg args: ${args.join(' ')}`);

    return new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

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
    const { taskId, outputPath } = job.data;
    this.logger.log(`Processing trim task ${taskId}`);
    await job.updateProgress(10);

    try {
      await this.runFfmpeg(job.data);
      await job.updateProgress(100);

      await this.videoTrimService.handleTaskCompleted(taskId, outputPath);
      await this.cleanupTempDir(taskId);

      return { outputPath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Trim task ${taskId} failed: ${message}`);

      await this.cleanupTempDir(taskId);
      await this.videoTrimService.handleTaskFailed(taskId, message);

      throw error;
    }
  }
}
