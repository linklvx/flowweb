import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AI_IMAGE_EDIT_QUEUE_NAME } from './ai-image-edit.constants';
import { AiImageEditJobData } from './ai-image-edit.processor';

@Injectable()
export class AiImageEditService {
  constructor(
    @InjectQueue(AI_IMAGE_EDIT_QUEUE_NAME) private readonly queue: Queue<AiImageEditJobData>,
  ) {}

  /** 批0.5-8：intentRowId/intentId 随 job.data 下传 processor（consume guard/complete 门序/failed 钩子用） */
  async enqueueOutpaint(
    userId: string,
    projectId: string,
    nodeId: string,
    fileId: string,
    rect: { x: number; y: number; width: number; height: number },
    imageWidth: number,
    imageHeight: number,
    intentRowId?: string,
    intentId?: string,
  ): Promise<{ jobId: string }> {
    const job = await this.queue.add('outpaint', {
      taskType: 'outpaint',
      userId,
      projectId,
      nodeId,
      fileId,
      rect,
      imageWidth,
      imageHeight,
      ...(intentRowId ? { intentRowId, intentId } : {}),
    });
    return { jobId: job.id! };
  }

  async enqueueErase(
    userId: string,
    projectId: string,
    nodeId: string,
    fileId: string,
    maskFileId: string,
    intentRowId?: string,
    intentId?: string,
  ): Promise<{ jobId: string }> {
    const job = await this.queue.add('erase', {
      taskType: 'erase',
      userId,
      projectId,
      nodeId,
      fileId,
      maskFileId,
      ...(intentRowId ? { intentRowId, intentId } : {}),
    });
    return { jobId: job.id! };
  }

  async enqueueRedraw(
    userId: string,
    projectId: string,
    nodeId: string,
    fileId: string,
    maskFileId: string,
    prompt: string,
    strength: number,
    intentRowId?: string,
    intentId?: string,
  ): Promise<{ jobId: string }> {
    const job = await this.queue.add('redraw', {
      taskType: 'redraw',
      userId,
      projectId,
      nodeId,
      fileId,
      maskFileId,
      prompt,
      strength,
      ...(intentRowId ? { intentRowId, intentId } : {}),
    });
    return { jobId: job.id! };
  }
}
