import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AiImageEditProcessor } from './ai-image-edit.processor';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { ApiCallerService } from '../execution/api-caller.service';
import { CreditService } from '../credit/credit.service';
import { Job } from 'bullmq';

// Mock axios
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

import axios from 'axios';

describe('AiImageEditProcessor', () => {
  let processor: AiImageEditProcessor;
  let prisma: any;
  let minio: any;
  let gateway: any;
  let apiCaller: any;
  let credit: any;

  beforeEach(async () => {
    prisma = {
      media: {
        findUnique: vi.fn().mockResolvedValue({ id: 'file-1', key: 'results/u/p/n/date/uuid.png' }),
        create: vi.fn().mockResolvedValue({ id: 'media-new' }),
      },
    };
    minio = {
      upload: vi.fn().mockResolvedValue(undefined),
      buildKey: vi.fn().mockReturnValue('results/user1/proj1/node1/2026-06-10/uuid.png'),
      generatePresignedGetUrl: vi.fn().mockResolvedValue('https://minio.local/bucket/key?token=abc'),
    };
    gateway = {
      emitNodeStatus: vi.fn(),
    };
    apiCaller = {
      callOutpainting: vi.fn().mockResolvedValue({ url: 'https://dashscope.result/outpaint.png' }),
      callErase: vi.fn().mockResolvedValue({ url: 'https://dashscope.result/erase.png' }),
      callRedraw: vi.fn().mockResolvedValue({ url: 'https://dashscope.result/redraw.png' }),
    };
    credit = {
      deduct: vi.fn().mockResolvedValue({ success: true, newBalance: 99 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiImageEditProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        { provide: ExecutionGateway, useValue: gateway },
        { provide: ApiCallerService, useValue: apiCaller },
        { provide: CreditService, useValue: credit },
      ],
    }).compile();
    processor = module.get<AiImageEditProcessor>(AiImageEditProcessor);
  });

  describe('success path', () => {
    it('should outpaint, deduct credit, and emit edit-result', async () => {
      const mockBuffer = Buffer.from('fake-image-data');
      (axios.get as any).mockResolvedValue({
        data: mockBuffer,
        headers: { 'content-type': 'image/png' },
      });

      const job = {
        data: {
          taskType: 'outpaint',
          userId: 'user1',
          projectId: 'proj1',
          nodeId: 'node1',
          fileId: 'file-1',
          direction: 'right',
          scale: 0.5,
        },
      } as any as Job;

      const result = await processor.process(job);
      expect(result.status).toBe('completed');
      expect(apiCaller.callOutpainting).toHaveBeenCalledWith(
        'https://minio.local/bucket/key?token=abc',
        'right',
        0.5,
        undefined,
      );
      expect(minio.upload).toHaveBeenCalled();
      expect(prisma.media.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'generated',
            status: 'completed',
            userId: 'user1',
          }),
        }),
      );
      expect(credit.deduct).toHaveBeenCalledWith('user1', 1);
      expect(gateway.emitNodeStatus).toHaveBeenCalledWith(
        'proj1',
        expect.objectContaining({
          nodeId: 'node1',
          status: 'edit-result',
          fileId: 'media-new',
        }),
      );
    });

    it('should erase with mask, deduct credit, and emit edit-result', async () => {
      const mockBuffer = Buffer.from('fake-erase-data');
      (axios.get as any).mockResolvedValue({
        data: mockBuffer,
        headers: { 'content-type': 'image/png' },
      });

      const job = {
        data: {
          taskType: 'erase',
          userId: 'user1',
          projectId: 'proj1',
          nodeId: 'node1',
          fileId: 'file-1',
          maskFileId: 'mask-1',
        },
      } as any as Job;

      const result = await processor.process(job);
      expect(result.status).toBe('completed');
      expect(apiCaller.callErase).toHaveBeenCalledWith(
        'https://minio.local/bucket/key?token=abc',
        'https://minio.local/bucket/key?token=abc',
      );
      expect(credit.deduct).toHaveBeenCalledWith('user1', 1);
      expect(gateway.emitNodeStatus).toHaveBeenCalledWith(
        'proj1',
        expect.objectContaining({ status: 'edit-result' }),
      );
    });
  });

  describe('failure path', () => {
    it('should NOT deduct credit and emit edit-failed on API error', async () => {
      apiCaller.callOutpainting.mockRejectedValue(new Error('API timeout'));

      const job = {
        data: {
          taskType: 'outpaint',
          userId: 'user1',
          projectId: 'proj1',
          nodeId: 'node1',
          fileId: 'file-1',
          direction: 'right',
          scale: 0.5,
        },
      } as any as Job;

      await expect(processor.process(job)).rejects.toThrow('API timeout');

      // Must NOT deduct credit on failure
      expect(credit.deduct).not.toHaveBeenCalled();

      // Must emit failure status
      expect(gateway.emitNodeStatus).toHaveBeenCalledWith(
        'proj1',
        expect.objectContaining({
          nodeId: 'node1',
          status: 'edit-failed',
          error: 'API timeout',
        }),
      );
    });
  });
});
