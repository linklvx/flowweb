import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AiDownloadProcessor } from './ai-download.processor';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { Job } from 'bullmq';

// Mock axios
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

import axios from 'axios';

describe('AiDownloadProcessor', () => {
  let processor: AiDownloadProcessor;
  let prisma: any;
  let minio: any;
  let gateway: any;

  beforeEach(async () => {
    prisma = {
      media: { create: vi.fn().mockResolvedValue({ id: 'media-new' }) },
    };
    minio = {
      upload: vi.fn().mockResolvedValue(undefined),
      buildKey: vi.fn().mockReturnValue('results/user1/proj1/node1/2026-05-20/uuid.png'),
    };
    gateway = {
      emitNodeStatus: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiDownloadProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        { provide: ExecutionGateway, useValue: gateway },
      ],
    }).compile();
    processor = module.get<AiDownloadProcessor>(AiDownloadProcessor);
  });

  it('should download AI result, upload to MinIO, and create Media', async () => {
    const mockBuffer = Buffer.from('fake-image-data');
    (axios.get as any).mockResolvedValue({
      data: mockBuffer,
      headers: { 'content-type': 'image/png', 'content-length': '12345' },
    });

    const job = {
      data: {
        userId: 'user1',
        projectId: 'proj1',
        nodeId: 'node1',
        taskId: 'task1',
        resultUrl: 'https://external.ai/result.png',
        mimeType: 'image/png',
      },
    } as any as Job;

    const result = await processor.process(job);
    expect(result.status).toBe('completed');
    expect(minio.upload).toHaveBeenCalledWith(
      expect.any(String),
      mockBuffer,
      'image/png',
    );
    expect(prisma.media.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'generated',
          status: 'completed',
          userId: 'user1',
          projectId: 'proj1',
          nodeId: 'node1',
        }),
      }),
    );
    expect(gateway.emitNodeStatus).toHaveBeenCalledWith(
      'proj1',
      expect.objectContaining({
        nodeId: 'node1',
        status: 'done',
        fileId: 'media-new',
      }),
    );
  });
});
