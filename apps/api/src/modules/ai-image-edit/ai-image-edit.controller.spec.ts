import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AiImageEditController } from './ai-image-edit.controller';
import { AiImageEditService } from './ai-image-edit.service';

describe('AiImageEditController', () => {
  let controller: AiImageEditController;
  let service: { enqueueOutpaint: ReturnType<typeof vi.fn>; enqueueErase: ReturnType<typeof vi.fn>; enqueueRedraw: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    service = {
      enqueueOutpaint: vi.fn().mockResolvedValue({ jobId: 'job-outpaint-1' }),
      enqueueErase: vi.fn().mockResolvedValue({ jobId: 'job-erase-1' }),
      enqueueRedraw: vi.fn().mockResolvedValue({ jobId: 'job-redraw-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiImageEditController],
      providers: [
        { provide: AiImageEditService, useValue: service },
      ],
    }).compile();
    controller = module.get<AiImageEditController>(AiImageEditController);
  });

  describe('POST /api/image-edit/outpaint', () => {
    it('should enqueue outpaint job and return jobId', async () => {
      const body = {
        projectId: 'proj1',
        nodeId: 'node1',
        fileId: 'file-1',
        direction: 'right',
        scale: 0.5,
      };
      const result = await controller.outpaint(body);
      expect(service.enqueueOutpaint).toHaveBeenCalledWith(
        'proj1', 'node1', 'file-1', 'right', 0.5, undefined,
      );
      expect(result).toEqual({ jobId: 'job-outpaint-1' });
    });
  });

  describe('POST /api/image-edit/erase', () => {
    it('should enqueue erase job and return jobId', async () => {
      const body = {
        projectId: 'proj1',
        nodeId: 'node1',
        fileId: 'file-1',
        maskFileId: 'mask-1',
      };
      const result = await controller.erase(body);
      expect(service.enqueueErase).toHaveBeenCalledWith(
        'proj1', 'node1', 'file-1', 'mask-1',
      );
      expect(result).toEqual({ jobId: 'job-erase-1' });
    });
  });

  describe('POST /api/image-edit/redraw', () => {
    it('should enqueue redraw job and return jobId', async () => {
      const body = {
        projectId: 'proj1',
        nodeId: 'node1',
        fileId: 'file-1',
        maskFileId: 'mask-1',
        prompt: 'a beautiful sunset',
        strength: 70,
      };
      const result = await controller.redraw(body);
      expect(service.enqueueRedraw).toHaveBeenCalledWith(
        'proj1', 'node1', 'file-1', 'mask-1', 'a beautiful sunset', 70,
      );
      expect(result).toEqual({ jobId: 'job-redraw-1' });
    });
  });
});
