import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { TeamCreditService } from '../../team/team-credit.service';
import { getOwnerTeamId } from '../../team/team.util';
import { AI_IMAGE_EDIT_QUEUE_NAME } from '../ai-image-edit.constants';
import type { CreateLightingTaskDto } from './dto/create-lighting-task.dto';
import * as crypto from 'node:crypto';

const LightingTaskStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  FAILED: 'failed',
} as const;

const PRIVATE_IP_PATTERNS = [
  /^https?:\/\/127\./,
  /^https?:\/\/localhost/,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/0\.0\.0\.0/,
];

function isPrivateUrl(url: string): boolean {
  return PRIVATE_IP_PATTERNS.some((p) => p.test(url));
}

function hashParams(nodeId: string, userId: string, params: unknown): string {
  const normalized = JSON.stringify({ nodeId, userId, params }, Object.keys({ nodeId: '', userId: '', params: {} }).sort());
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

@Injectable()
export class LightingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TeamCreditService) private readonly teamCredit: TeamCreditService,
    @InjectQueue(AI_IMAGE_EDIT_QUEUE_NAME) private readonly queue: Queue,
  ) {}

  async createTask(
    dto: CreateLightingTaskDto,
    userId: string,
  ): Promise<{ taskId: string; status: string }> {
    // Validate params
    const { params, originalImageUrl } = dto;
    if (params.brightness < 0 || params.brightness > 100) {
      throw new BadRequestException('亮度值必须在 0-100 之间');
    }
    if (params.colorTemperature < 2000 || params.colorTemperature > 10000) {
      throw new BadRequestException('色温值必须在 2000K-10000K 之间');
    }
    if (params.position.z < 2 || params.position.z > 10) {
      throw new BadRequestException('光源 Z 轴位置必须在 2-10 之间');
    }

    // SSRF protection
    if (isPrivateUrl(originalImageUrl)) {
      throw new BadRequestException('不支持内网图片地址');
    }

    // Idempotency check: same userId + nodeId + params within 60s
    const recentWindow = new Date(Date.now() - 60_000);
    const existing = await this.prisma.lightingTask.findFirst({
      where: {
        userId,
        nodeId: dto.nodeId,
        createdAt: { gte: recentWindow },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      // Check if params match using JSON comparison
      const existingParams = existing.params as Record<string, unknown>;
      const newParams = params as unknown as Record<string, unknown>;
      if (
        existingParams.position &&
        newParams.position &&
        JSON.stringify(existingParams) === JSON.stringify(newParams)
      ) {
        return { taskId: existing.id, status: existing.status };
      }
    }

    // Check credits (team pool pre-check)
    const estimatedCost = 15; // TODO: fetch from pricing config
    if (dto.projectId) {
      const project = await this.prisma.canvasProject.findUnique({
        where: { id: dto.projectId },
        select: { teamId: true },
      });
      if (project) {
        const balance = await this.teamCredit.getBalanceView(project.teamId, userId);
        if (balance.total < estimatedCost) {
          throw new BadRequestException('积分不足，无法提交任务');
        }
      }
    }

    // Create task in DB
    // 临时接线：Task 8 将切换 project.teamId 归属
    const teamId = await getOwnerTeamId(this.prisma, userId);
    const task = await this.prisma.lightingTask.create({
      data: {
        userId,
        teamId,
        nodeId: dto.nodeId,
        projectId: dto.projectId,
        originalImageUrl,
        params: params as any,
        status: LightingTaskStatus.PENDING,
        costCredits: estimatedCost,
      },
    });

    // Enqueue job
    await this.queue.add('lighting', {
      taskType: 'lighting',
      userId,
      nodeId: dto.nodeId,
      projectId: dto.projectId,
      taskId: task.id,
      originalImageUrl,
      params,
      taskDbId: task.id,
    });

    return { taskId: task.id, status: 'pending' };
  }

  async getTask(taskId: string, userId: string) {
    return this.prisma.lightingTask.findFirst({
      where: { id: taskId, userId },
    });
  }
}
