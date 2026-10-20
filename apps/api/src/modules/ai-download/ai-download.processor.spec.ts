import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AiDownloadProcessor } from './ai-download.processor';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabWritePort } from '../collab/collab-write.port';
import { StorageQuotaService } from '../team/storage-quota.service';
import { EmitPort } from '../gateway/emit.port';
import { SafeRemoteFetchService } from '../media/safe-remote-fetch.service';
import { Job } from 'bullmq';

// Mock Sentry（failed 分支须上报 captureException）
vi.mock('@sentry/nestjs', () => ({
  captureException: vi.fn(),
}));

import * as Sentry from '@sentry/nestjs';

describe('AiDownloadProcessor', () => {
  let processor: AiDownloadProcessor;
  let prisma: any;
  let minio: any;
  let gateway: any;
  let collabDoc: any;
  let quota: any;
  let safeFetch: any;

  beforeEach(async () => {
    prisma = {
      canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 'team1' }) },
      media: { create: vi.fn().mockResolvedValue({ id: 'media-new' }) },
      team: { findFirst: vi.fn().mockResolvedValue({ id: 'team1' }) },
    };
    collabDoc = { writeNodeData: vi.fn().mockResolvedValue({ written: true }) }; // Y0b-2 T5：交付判据类型化 {written,reason}
    quota = { assertCanUpload: vi.fn().mockResolvedValue(undefined) };
    minio = {
      upload: vi.fn().mockResolvedValue(undefined),
      buildKey: vi.fn().mockReturnValue('results/user1/proj1/node1/2026-05-20/uuid.png'),
    };
    gateway = {
      emitNodeStatus: vi.fn(),
    };
    // T6：下载通道=SafeRemoteFetch（SSRF 四门+限长）——axios 直连退役
    safeFetch = {
      fetchBuffer: vi.fn().mockResolvedValue({ buffer: Buffer.from('fake-image-data'), contentType: 'image/png' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiDownloadProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        { provide: EmitPort, useValue: gateway },
        { provide: CollabWritePort, useValue: collabDoc },
        { provide: StorageQuotaService, useValue: quota },
        { provide: SafeRemoteFetchService, useValue: safeFetch },
      ],
    }).compile();
    processor = module.get<AiDownloadProcessor>(AiDownloadProcessor);
  });

  it('should download AI result, upload to MinIO, and create Media', async () => {
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
    // T6：下载经 SafeRemoteFetch.fetchBuffer（SSRF 四门+限长）——不再 axios 直连
    expect(safeFetch.fetchBuffer).toHaveBeenCalledWith('https://external.ai/result.png');
    expect(minio.upload).toHaveBeenCalledWith(
      expect.any(String),
      Buffer.from('fake-image-data'),
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

  it('T6 SSRF 拒路径：fetchBuffer 拒（私网/allowlist 外/超限）→ process 抛错（BullMQ failed）+零上传零 Media', async () => {
    safeFetch.fetchBuffer.mockRejectedValue(new Error('safe-fetch host 不在 allowlist: evil.internal'));
    const job = {
      data: {
        userId: 'user1', projectId: 'proj1', nodeId: 'node1', taskId: 'task1',
        resultUrl: 'https://evil.internal/result.png', mimeType: 'image/png',
      },
    } as any as Job;

    await expect(processor.process(job)).rejects.toThrow(/safe-fetch/);
    expect(minio.upload).not.toHaveBeenCalled();
    expect(prisma.media.create).not.toHaveBeenCalled();
  });

  it('生成物归属 = project.teamId（非 getOwnerTeamId 反推）', async () => {
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

    await processor.process(job);
    expect(prisma.media.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ teamId: 'team1' }),
      }),
    );
    // 不再调用 team.findFirst 反推
    expect(prisma.team.findFirst).not.toHaveBeenCalled();
  });

  it('project 缺失 → failed 且不建 Media（不回落个人团队）', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue(null);

    const job = {
      data: {
        userId: 'user1',
        projectId: 'proj-missing',
        nodeId: 'node1',
        taskId: 'task1',
        resultUrl: 'https://external.ai/result.png',
        mimeType: 'image/png',
      },
    } as any as Job;

    const result = await processor.process(job);
    expect(result.status).toBe('failed');
    expect(prisma.media.create).not.toHaveBeenCalled();
    expect(prisma.team.findFirst).not.toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
