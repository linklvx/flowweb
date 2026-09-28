import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { VALID_ASPECT_RATIOS, VALID_RESOLUTIONS, STORYBOARD_STITCH_QUEUE } from './storyboard.constants';
import { CreateStitchTaskDto } from './storyboard.dto';

@Injectable()
export class StoryboardService {
  constructor(
    @InjectQueue(STORYBOARD_STITCH_QUEUE) private readonly stitchQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async createStitchTask(projectId: string, dto: CreateStitchTaskDto, userId: string) {
    const project = await this.prisma.canvasProject.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');

    if (!Array.isArray(dto.fileIds) || dto.fileIds.length === 0) {
      throw new BadRequestException('fileIds 不能为空');
    }
    if (dto.gridRows < 1 || dto.gridRows > 10 || dto.gridCols < 1 || dto.gridCols > 10) {
      throw new BadRequestException('行列数为 1~10');
    }
    if (dto.fileIds.length > dto.gridRows * dto.gridCols) {
      throw new BadRequestException('图片数超过宫格容量');
    }
    if (!VALID_ASPECT_RATIOS.includes(dto.aspectRatio as any)) {
      throw new BadRequestException('非法比例');
    }
    if (!VALID_RESOLUTIONS.includes(dto.resolution as any)) {
      throw new BadRequestException('非法分辨率');
    }
    // P2-新3：fileIds 存在性 + 项目归属校验（防跨项目越权取图；重复提交时 fail-fast 而非让 consumer 全失败）
    const medias = await this.prisma.media.findMany({
      where: { id: { in: dto.fileIds }, projectId },
      select: { id: true },
    });
    const found = new Set(medias.map((m) => m.id));
    if (dto.fileIds.some((f) => !found.has(f))) {
      throw new BadRequestException('存在无效或不属于该项目的图片');
    }
    const job = await this.stitchQueue.add('stitch', { projectId, userId, ...dto });
    return { taskId: job.id!, status: 'PENDING' };
  }

  async getTaskStatus(_projectId: string, taskId: string) {
    const job = await this.stitchQueue.getJob(taskId);
    if (!job) throw new NotFoundException('任务不存在');
    const state = await job.getState();
    const status = state === 'completed' ? 'COMPLETED' : state === 'failed' ? 'FAILED' : 'PENDING';
    const rv = job.returnvalue as any;
    return {
      taskId,
      status,
      ...(status === 'COMPLETED' ? rv : {}),
      ...(status === 'FAILED' ? { error: job.failedReason } : {}),
    };
  }
}
