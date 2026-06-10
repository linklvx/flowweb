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

  private getUserId(): string {
    // TODO: replace with real authenticated user context
    return 'default-user';
  }

  async enqueueOutpaint(
    projectId: string,
    nodeId: string,
    fileId: string,
    direction: string,
    scale: number,
    prompt?: string,
  ): Promise<{ jobId: string }> {
    const job = await this.queue.add('outpaint', {
      taskType: 'outpaint',
      userId: this.getUserId(),
      projectId,
      nodeId,
      fileId,
      direction,
      scale,
      prompt,
    });
    return { jobId: job.id! };
  }

  async enqueueErase(
    projectId: string,
    nodeId: string,
    fileId: string,
    maskFileId: string,
  ): Promise<{ jobId: string }> {
    const job = await this.queue.add('erase', {
      taskType: 'erase',
      userId: this.getUserId(),
      projectId,
      nodeId,
      fileId,
      maskFileId,
    });
    return { jobId: job.id! };
  }

  async enqueueRedraw(
    projectId: string,
    nodeId: string,
    fileId: string,
    maskFileId: string,
    prompt: string,
    strength: number,
  ): Promise<{ jobId: string }> {
    const job = await this.queue.add('redraw', {
      taskType: 'redraw',
      userId: this.getUserId(),
      projectId,
      nodeId,
      fileId,
      maskFileId,
      prompt,
      strength,
    });
    return { jobId: job.id! };
  }
}
