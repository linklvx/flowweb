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

  async enqueueOutpaint(
    userId: string,
    projectId: string,
    nodeId: string,
    fileId: string,
    rect: { x: number; y: number; width: number; height: number },
    imageWidth: number,
    imageHeight: number,
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
    });
    return { jobId: job.id! };
  }

  async enqueueErase(
    userId: string,
    projectId: string,
    nodeId: string,
    fileId: string,
    maskFileId: string,
  ): Promise<{ jobId: string }> {
    const job = await this.queue.add('erase', {
      taskType: 'erase',
      userId,
      projectId,
      nodeId,
      fileId,
      maskFileId,
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
    });
    return { jobId: job.id! };
  }
}
