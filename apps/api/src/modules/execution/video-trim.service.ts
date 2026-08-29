import { Injectable, Inject, Logger, BadRequestException, ForbiddenException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { exec } from 'child_process';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { VIDEO_TRIM_QUEUE, MIN_TRIM_DURATION, TEMP_DIR, FFPROBE_PATH } from './video-trim.constants';
import { VideoTrimRequest, VideoTrimJobData } from './video-trim.types';
import { getOwnerTeamId } from '../team/team.util';

@Injectable()
export class VideoTrimService {
  private readonly logger = new Logger(VideoTrimService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @InjectQueue(VIDEO_TRIM_QUEUE) private readonly trimQueue: Queue,
    private readonly gateway: ExecutionGateway,
  ) {}

  private validateParams(startTime: number, endTime: number, actualDuration: number): void {
    if (actualDuration < MIN_TRIM_DURATION) {
      throw new BadRequestException('video is too short to trim');
    }
    if (startTime < 0) {
      throw new BadRequestException('startTime must be >= 0');
    }
    if (endTime > actualDuration) {
      throw new BadRequestException('endTime must be <= video duration');
    }
    if (endTime - startTime < MIN_TRIM_DURATION) {
      throw new BadRequestException('minimum trim duration is 0.5s');
    }
  }

  private async validateFileOwnership(
    fileId: string,
    userId: string,
  ): Promise<void> {
    const file = await this.prisma.media.findFirst({
      where: { id: fileId, userId },
    });
    if (!file) {
      throw new ForbiddenException('file not found or access denied');
    }
  }

  private async checkDuplicate(nodeId: string): Promise<string | null> {
    const existing = await this.prisma.videoTrimTask.findFirst({
      where: { nodeId, status: { in: ['queued', 'processing'] } },
      select: { id: true },
    });
    return existing?.id ?? null;
  }

  private detectAudio(inputPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      exec(
        `${FFPROBE_PATH} -v error -select_streams a:0 -show_entries stream=codec_type -of csv=p=0 "${inputPath}"`,
        (error, stdout) => {
          if (error) {
            this.logger.warn(`ffprobe audio detection failed: ${error.message}`);
            resolve(false);
            return;
          }
          resolve(stdout.trim() === 'audio');
        },
      );
    });
  }

  async submitTrim(params: VideoTrimRequest): Promise<{ taskId: string }> {
    const { fileId, startTime, endTime, nodeId, userId, workflowId } = params;

    // 1. Validate file ownership
    await this.validateFileOwnership(fileId, userId);

    // 2. Get media record for input path and workflow
    const media = await this.prisma.media.findUnique({ where: { id: fileId } });
    if (!media) {
      throw new NotFoundException('file not found');
    }
    const derivedWorkflowId = media.projectId ?? workflowId;

    // 3. Generate presigned URL for MinIO object access
    const inputUrl = await this.minio.generatePresignedGetUrl(media.key, 3600);

    // 4. Get actual video duration via ffprobe
    let actualDuration: number;
    try {
      actualDuration = await new Promise<number>((resolve, reject) => {
        exec(
          `${FFPROBE_PATH} -v error -show_entries format=duration -of csv=p=0 "${inputUrl}"`,
          (error, stdout) => {
            if (error) {
              reject(error);
              return;
            }
            resolve(parseFloat(stdout.trim()));
          },
        );
      });
    } catch (err) {
      this.logger.error(`ffprobe failed to read file: ${(err as Error).message}`);
      throw new InternalServerErrorException('failed to read video file');
    }

    // 5. Server-side parameter validation
    this.validateParams(startTime, endTime, actualDuration);

    // 6. Idempotency check
    const duplicateId = await this.checkDuplicate(nodeId);
    if (duplicateId) {
      return { taskId: duplicateId };
    }

    // 7. Detect audio
    const hasAudio = await this.detectAudio(inputUrl);

    // 8. Create task record
    // 临时接线：Task 8 将切换 project.teamId 归属
    const teamId = await getOwnerTeamId(this.prisma, userId);
    const task = await this.prisma.videoTrimTask.create({
      data: {
        userId,
        teamId,
        workflowId: derivedWorkflowId,
        nodeId,
        sourceFileId: fileId,
        startTime,
        endTime,
        status: 'queued',
      },
    });

    // 9. Enqueue BullMQ job
    const jobData: VideoTrimJobData = {
      taskId: task.id,
      userId,
      inputPath: inputUrl,
      outputPath: `${TEMP_DIR}${task.id}/output.mp4`,
      startTime,
      endTime,
      hasAudio,
    };

    await this.trimQueue.add('video-trim', jobData, { jobId: task.id });

    this.logger.log(`Trim task ${task.id} enqueued for node ${nodeId}`);
    return { taskId: task.id };
  }

  async getTaskStatus(taskId: string): Promise<{
    status: string;
    outputFileId?: string | null;
    error?: string | null;
  } | null> {
    const task = await this.prisma.videoTrimTask.findUnique({
      where: { id: taskId },
      select: { status: true, outputFileId: true, errorMsg: true },
    });
    if (!task) return null;
    return { status: task.status, outputFileId: task.outputFileId, error: task.errorMsg };
  }

  async handleTaskCompleted(taskId: string, outputFileId: string): Promise<void> {
    const task = await this.prisma.videoTrimTask.update({
      where: { id: taskId },
      data: { status: 'done', outputFileId, finishedAt: new Date() },
    });

    this.gateway.emitTrimStatus(task.workflowId, {
      nodeId: task.nodeId,
      taskId,
      status: 'done',
      outputFileId,
    });
  }

  async handleTaskFailed(taskId: string, errorMsg: string): Promise<void> {
    const task = await this.prisma.videoTrimTask.update({
      where: { id: taskId },
      data: { status: 'error', errorMsg, finishedAt: new Date() },
    });

    this.gateway.emitTrimStatus(task.workflowId, {
      nodeId: task.nodeId,
      taskId,
      status: 'error',
      error: errorMsg,
    });
  }
}
