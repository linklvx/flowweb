import { Injectable, Inject, Logger, BadRequestException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import * as Sentry from '@sentry/node';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import {
  VIDEO_SEPARATE_QUEUE, MAX_FILE_SIZE, USER_CONCURRENT_LIMIT,
  IDEMPOTENCY_LOCK_TTL, COUNTER_TTL,
  SUPPORTED_VIDEO_MIME_TYPES,
} from './video-separate.constants';
import { VideoSeparateRequest, VideoSeparateJobData } from './video-separate.types';
import { getOwnerTeamId, assertTeamMember } from '../team/team.util';

@Injectable()
export class VideoSeparateService {
  private readonly logger = new Logger(VideoSeparateService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: any,
    @InjectQueue(VIDEO_SEPARATE_QUEUE) private readonly separateQueue: Queue,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject(ExecutionGateway) private readonly gateway: ExecutionGateway,
  ) {}

  async submitSeparate(params: VideoSeparateRequest): Promise<{ taskId: string }> {
    const { fileId, nodeId, userId, workflowId, mode } = params;

    // 1. File ownership validation（团队化：按 id 查，creator 之外须为 media.teamId 成员）
    const media = await this.prisma.media.findFirst({
      where: { id: fileId },
      select: { id: true, userId: true, teamId: true, size: true, mimeType: true, originalName: true, key: true, projectId: true },
    });
    if (!media) throw new ForbiddenException('file not found or access denied');
    if (media.userId !== userId) {
      await assertTeamMember(this.prisma, media.teamId, userId);
    }

    // 1.5 团队解析：project 上下文 → project.teamId（缺失即拒绝，不回落）；个人素材回落个人团队
    let teamId: string;
    if (media.projectId) {
      const projectTeamId = (await this.prisma.canvasProject.findUnique({
        where: { id: media.projectId },
        select: { teamId: true },
      }))?.teamId;
      if (!projectTeamId) throw new InternalServerErrorException('项目团队缺失');
      teamId = projectTeamId;
    } else {
      teamId = await getOwnerTeamId(this.prisma, userId);
    }

    // 2. Lightweight DB-field validation
    if (media.size > MAX_FILE_SIZE) {
      throw new BadRequestException('文件过大（>2GB），请拆分后处理');
    }
    if (!SUPPORTED_VIDEO_MIME_TYPES.includes(media.mimeType)) {
      throw new BadRequestException(`不支持的视频格式：${media.mimeType}`);
    }

    // 3. Redis distributed lock (SETNX with uuid owner)
    const lockKey = `lock:video-separate:${nodeId}`;
    const lockValue = crypto.randomUUID();
    const locked = await this.redis.set(lockKey, lockValue, 'EX', IDEMPOTENCY_LOCK_TTL, 'NX');
    if (!locked) {
      throw new BadRequestException('操作过于频繁，请稍后重试');
    }

    try {
      // 4. Idempotency check (inside lock，团队 + 节点 + 参数维度；并发计数器保留 userId 维度)
      const existing = await this.prisma.videoSeparateTask.findFirst({
        where: { teamId, nodeId, mode, status: { in: ['queued', 'processing'] } },
        select: { id: true },
      });
      if (existing) return { taskId: existing.id };

      // 5. Create task + enqueue
      const task = await this.prisma.videoSeparateTask.create({
        data: { userId, teamId, workflowId, nodeId, sourceFileId: fileId, mode, status: 'queued' },
      });

      const jobData: VideoSeparateJobData = {
        taskId: task.id,
        userId,
        sourceFileId: fileId,
        sourceKey: media.key,
        sourceOriginalName: media.originalName,
        sourceMimeType: media.mimeType,
        sourceSize: media.size,
        projectId: media.projectId ?? workflowId,
        nodeId,
      };

      await this.separateQueue.add('video-separate', jobData, { jobId: task.id });

      // 6. INCR concurrency counter AFTER successful enqueue
      const concurrencyKey = `user:video-separate:${userId}`;
      const currentCount = await this.redis.incr(concurrencyKey);
      await this.redis.expire(concurrencyKey, COUNTER_TTL);

      if (currentCount > USER_CONCURRENT_LIMIT) {
        await this.redis.decr(concurrencyKey);
        throw new BadRequestException('当前处理任务过多（上限 3 个），请等待完成后再试');
      }

      this.logger.log(`Separate task ${task.id} enqueued for node ${nodeId}`);
      return { taskId: task.id };
    } catch (error) {
      throw error;
    } finally {
      // 主动释放幂等锁，缩短锁持有时间（入队成功或校验失败后立即释放）
      await this.redis.del(lockKey).catch(() => {});
    }
  }

  async getTaskStatus(taskId: string, userId: string) {
    const task = await this.prisma.videoSeparateTask.findUnique({
      where: { id: taskId },
      select: { status: true, videoFileId: true, audioFileId: true, errorMsg: true, userId: true, teamId: true },
    });
    if (!task) {
      throw new ForbiddenException('task not found or access denied');
    }
    // 团队化：creator 之外须为 task.teamId 成员方可查询
    if (task.userId !== userId) {
      await assertTeamMember(this.prisma, task.teamId, userId);
    }
    return { status: task.status, videoFileId: task.videoFileId, audioFileId: task.audioFileId, error: task.errorMsg };
  }

  async setTaskProcessing(taskId: string): Promise<void> {
    const task = await this.prisma.videoSeparateTask.update({
      where: { id: taskId },
      data: { status: 'processing' },
    });
    this.gateway.emitSeparateStatus(task.workflowId, {
      nodeId: task.nodeId,
      taskId,
      status: 'processing',
    });
  }

  async handleTaskCompleted(taskId: string, videoFileId: string, audioFileId: string): Promise<void> {
    const task = await this.prisma.videoSeparateTask.update({
      where: { id: taskId },
      data: { status: 'done', videoFileId, audioFileId, finishedAt: new Date() },
    });
    this.gateway.emitSeparateStatus(task.workflowId, {
      nodeId: task.nodeId,
      taskId,
      status: 'done',
      videoFileId,
      audioFileId,
    });
  }

  async handleTaskFailed(taskId: string, errorMsg: string, errorType?: string): Promise<void> {
    const task = await this.prisma.videoSeparateTask.update({
      where: { id: taskId },
      data: { status: 'error', errorMsg, errorType: errorType || 'UNKNOWN', finishedAt: new Date() },
    });

    // Sentry 上报：按 errorType/taskId/userId 标签化，便于错误聚合与排查
    Sentry.captureException(new Error(errorMsg), {
      tags: {
        module: 'video-separate',
        errorType: errorType || 'UNKNOWN',
        taskId,
        userId: task.userId,
      },
      extra: {
        nodeId: task.nodeId,
        workflowId: task.workflowId,
      },
    });

    this.gateway.emitSeparateStatus(task.workflowId, {
      nodeId: task.nodeId,
      taskId,
      status: 'error',
      error: errorMsg,
    });
  }
}
