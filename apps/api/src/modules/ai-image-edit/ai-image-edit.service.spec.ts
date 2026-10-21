import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AiImageEditService } from './ai-image-edit.service';
import { AI_IMAGE_EDIT_QUEUE_NAME } from './ai-image-edit.constants';

describe('AiImageEditService', () => {
  let service: AiImageEditService;
  let queue: { add: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    queue = { add: vi.fn().mockResolvedValue({ id: 'job-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiImageEditService,
        { provide: getQueueToken(AI_IMAGE_EDIT_QUEUE_NAME), useValue: queue },
      ],
    }).compile();
    service = module.get<AiImageEditService>(AiImageEditService);
  });

  // Y1a T9：enqueue 携 ExecutionTicket；jobId=票内预生成 UUID（add 第三参幂等锚）
  const TICKET = { intentRowId: 'row-1', execSeq: '7', jobId: 'ticket-job-1' };

  it('enqueueOutpaint 将入参 userId+ticket 写入 job data（T9）', async () => {
    const result = await service.enqueueOutpaint(
      'u1', 'proj1', 'node1', 'file-1',
      { x: -16, y: 0, width: 528, height: 512 }, 512, 512,
      TICKET,
    );
    expect(queue.add).toHaveBeenCalledWith('outpaint', expect.objectContaining({
      taskType: 'outpaint',
      userId: 'u1',
      projectId: 'proj1',
      nodeId: 'node1',
      fileId: 'file-1',
      intentRowId: 'row-1',
      ticket: TICKET,
    }), { jobId: 'ticket-job-1' });
    expect(result).toEqual({ jobId: 'job-1' });
  });

  it('enqueueErase 将入参 userId 写入 job data', async () => {
    const result = await service.enqueueErase('u1', 'proj1', 'node1', 'file-1', 'mask-1', TICKET);
    expect(queue.add).toHaveBeenCalledWith('erase', expect.objectContaining({
      taskType: 'erase',
      userId: 'u1',
      projectId: 'proj1',
      nodeId: 'node1',
      fileId: 'file-1',
      maskFileId: 'mask-1',
    }), { jobId: 'ticket-job-1' });
    expect(result).toEqual({ jobId: 'job-1' });
  });

  it('enqueueRedraw 将入参 userId 写入 job data', async () => {
    const result = await service.enqueueRedraw('u1', 'proj1', 'node1', 'file-1', 'mask-1', 'a sunset', 70, TICKET);
    expect(queue.add).toHaveBeenCalledWith('redraw', expect.objectContaining({
      taskType: 'redraw',
      userId: 'u1',
      projectId: 'proj1',
      nodeId: 'node1',
      fileId: 'file-1',
      maskFileId: 'mask-1',
      prompt: 'a sunset',
      strength: 70,
    }), { jobId: 'ticket-job-1' });
    expect(result).toEqual({ jobId: 'job-1' });
  });
});
