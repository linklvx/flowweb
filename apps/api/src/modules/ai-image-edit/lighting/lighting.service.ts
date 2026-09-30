import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { TeamCreditService } from '../../team/team-credit.service';
import { getOwnerTeamId, assertTeamMember } from '../../team/team.util';
import { AI_IMAGE_EDIT_QUEUE_NAME, CREDIT_COST_PER_EDIT } from '../ai-image-edit.constants';
import type { CreateLightingTaskDto } from './dto/create-lighting-task.dto';

const LightingTaskStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  FAILED: 'failed',
} as const;

// 递归排序对象键后序列化（嵌套对象键序不同不击穿幂等比较）
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

@Injectable()
export class LightingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TeamCreditService) private readonly teamCredit: TeamCreditService,
    @InjectQueue(AI_IMAGE_EDIT_QUEUE_NAME) private readonly queue: Queue,
  ) {}

  /** 批0.5-8：intentRowId/intentId 随 job.data 下传 consumer；新入队返回 jobId 供 controller attachJob
   *  回写（60s 去重分支无新 job → jobId undefined，controller 侧按重放处理）。 */
  async createTask(
    dto: CreateLightingTaskDto,
    userId: string,
    intentRowId?: string,
    intentId?: string,
  ): Promise<{ taskId: string; status: string; jobId?: string }> {
    // Validate params
    const { params, originalImageId } = dto;
    if (params.brightness < 0 || params.brightness > 100) {
      throw new BadRequestException('亮度值必须在 0-100 之间');
    }
    if (params.colorTemperature < 2000 || params.colorTemperature > 10000) {
      throw new BadRequestException('色温值必须在 2000K-10000K 之间');
    }
    if (params.position.z < 2 || params.position.z > 10) {
      throw new BadRequestException('光源 Z 轴位置必须在 2-10 之间');
    }

    // 团队解析：project 上下文 → project.teamId（缺失即拒绝，不回落）；无 projectId 的个人任务回落个人团队
    let teamId: string;
    let project: { teamId: string } | null = null;
    if (dto.projectId) {
      project = await this.prisma.canvasProject.findUnique({
        where: { id: dto.projectId },
        select: { teamId: true },
      });
      if (!project) throw new NotFoundException('项目不存在');
      teamId = project.teamId;
    } else {
      teamId = await getOwnerTeamId(this.prisma, userId);
    }

    // Idempotency check: same team + nodeId + params（stableStringify 深排序键）within 60s
    const recentWindow = new Date(Date.now() - 60_000);
    const existing = await this.prisma.lightingTask.findFirst({
      where: {
        teamId,
        nodeId: dto.nodeId,
        createdAt: { gte: recentWindow },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing && stableStringify(existing.params) === stableStringify(params)) {
      return { taskId: existing.id, status: existing.status };
    }

    // Check credits (team pool pre-check)
    const estimatedCost = CREDIT_COST_PER_EDIT; // 与实扣同源（批0c：消预检/实扣口径分叉）
    if (project) {
      const balance = await this.teamCredit.getBalanceView(teamId, userId);
      if (balance.total < estimatedCost) {
        throw new BadRequestException('积分不足，无法提交任务');
      }
    }

    // Create task in DB（归属 = project.teamId / 个人团队；列名沿用 originalImageUrl，值 = mediaId 引用——批0c B1）
    const task = await this.prisma.lightingTask.create({
      data: {
        userId,
        teamId,
        nodeId: dto.nodeId,
        projectId: dto.projectId,
        originalImageUrl: originalImageId,
        params: params as any,
        status: LightingTaskStatus.PENDING,
        costCredits: estimatedCost,
      },
    });

    // Enqueue job
    const job = await this.queue.add('lighting', {
      taskType: 'lighting',
      userId,
      nodeId: dto.nodeId,
      projectId: dto.projectId,
      taskId: task.id,
      originalImageId,
      params,
      taskDbId: task.id,
      ...(intentRowId ? { intentRowId, intentId } : {}),
    });

    return { taskId: task.id, status: 'pending', jobId: job.id! };
  }

  async getTask(taskId: string, userId: string) {
    const task = await this.prisma.lightingTask.findUnique({ where: { id: taskId } });
    if (!task) return null;
    // 团队化：creator 之外须为 task.teamId 成员方可查询
    if (task.userId !== userId) {
      await assertTeamMember(this.prisma, task.teamId, userId);
    }
    return task;
  }
}
