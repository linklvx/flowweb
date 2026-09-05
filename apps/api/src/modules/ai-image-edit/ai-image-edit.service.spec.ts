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

  it('enqueueOutpaint 将入参 userId 写入 job data', async () => {
    const result = await service.enqueueOutpaint(
      'u1', 'proj1', 'node1', 'file-1',
      { x: -16, y: 0, width: 528, height: 512 }, 512, 512,
    );
    expect(queue.add).toHaveBeenCalledWith('outpaint', expect.objectContaining({
      taskType: 'outpaint',
      userId: 'u1',
      projectId: 'proj1',
      nodeId: 'node1',
      fileId: 'file-1',
    }));
    expect(result).toEqual({ jobId: 'job-1' });
  });

  it('enqueueErase 将入参 userId 写入 job data', async () => {
    const result = await service.enqueueErase('u1', 'proj1', 'node1', 'file-1', 'mask-1');
    expect(queue.add).toHaveBeenCalledWith('erase', expect.objectContaining({
      taskType: 'erase',
      userId: 'u1',
      projectId: 'proj1',
      nodeId: 'node1',
      fileId: 'file-1',
      maskFileId: 'mask-1',
    }));
    expect(result).toEqual({ jobId: 'job-1' });
  });

  it('enqueueRedraw 将入参 userId 写入 job data', async () => {
    const result = await service.enqueueRedraw('u1', 'proj1', 'node1', 'file-1', 'mask-1', 'a sunset', 70);
    expect(queue.add).toHaveBeenCalledWith('redraw', expect.objectContaining({
      taskType: 'redraw',
      userId: 'u1',
      projectId: 'proj1',
      nodeId: 'node1',
      fileId: 'file-1',
      maskFileId: 'mask-1',
      prompt: 'a sunset',
      strength: 70,
    }));
    expect(result).toEqual({ jobId: 'job-1' });
  });
});
