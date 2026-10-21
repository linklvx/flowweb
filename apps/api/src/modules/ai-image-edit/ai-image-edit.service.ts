import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AI_IMAGE_EDIT_QUEUE_NAME } from './ai-image-edit.constants';
import { AiImageEditJobData } from './ai-image-edit.processor';
import type { ExecutionTicket } from '../execution/execution.types';

@Injectable()
export class AiImageEditService {
  constructor(
    @InjectQueue(AI_IMAGE_EDIT_QUEUE_NAME) private readonly queue: Queue<AiImageEditJobData>,
  ) {}

  /** 批0.5-8：意图锚随 job.data 下传 processor（consume guard/complete 门序/failed 钩子用）。
   *  Y1a T9：intentRowId/intentId 升格为完整 ExecutionTicket {intentRowId,execSeq,jobId}——
   *  ticket.jobId=controller 预生成 UUID（add({jobId}) 幂等锚+attachJob 同值——票完整先于入队）。 */
  private async addWithTicket(taskType: 'outpaint' | 'erase' | 'redraw', data: Omit<AiImageEditJobData, 'taskType' | 'ticket'>, ticket: ExecutionTicket): Promise<{ jobId: string }> {
    const job = await this.queue.add(taskType, {
      ...data,
      taskType,
      intentRowId: ticket.intentRowId,
      ticket,
    }, { jobId: ticket.jobId });
    return { jobId: job.id! };
  }

  async enqueueOutpaint(
    userId: string,
    projectId: string,
    nodeId: string,
    fileId: string,
    rect: { x: number; y: number; width: number; height: number },
    imageWidth: number,
    imageHeight: number,
    ticket: ExecutionTicket,
  ): Promise<{ jobId: string }> {
    return this.addWithTicket('outpaint', {
      userId, projectId, nodeId, fileId, rect, imageWidth, imageHeight,
    }, ticket);
  }

  async enqueueErase(
    userId: string,
    projectId: string,
    nodeId: string,
    fileId: string,
    maskFileId: string,
    ticket: ExecutionTicket,
  ): Promise<{ jobId: string }> {
    return this.addWithTicket('erase', {
      userId, projectId, nodeId, fileId, maskFileId,
    }, ticket);
  }

  async enqueueRedraw(
    userId: string,
    projectId: string,
    nodeId: string,
    fileId: string,
    maskFileId: string,
    prompt: string,
    strength: number,
    ticket: ExecutionTicket,
  ): Promise<{ jobId: string }> {
    return this.addWithTicket('redraw', {
      userId, projectId, nodeId, fileId, maskFileId, prompt, strength,
    }, ticket);
  }
}
