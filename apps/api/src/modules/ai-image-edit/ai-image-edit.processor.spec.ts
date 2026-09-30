import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AiImageEditProcessor } from './ai-image-edit.processor';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { ApiCallerService } from '../execution/api-caller.service';
import { TeamCreditService } from '../team/team-credit.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { LightingConsumer } from './lighting/lighting.consumer';
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
  let teamCredit: any;
  let collabDoc: any;

  beforeEach(async () => {
    prisma = {
      canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 'team1' }) },
      media: {
        findUnique: vi.fn().mockResolvedValue({ id: 'file-1', key: 'results/u/p/n/date/uuid.png', userId: 'user1', projectId: 'proj1' }),
        create: vi.fn().mockResolvedValue({ id: 'media-new' }),
      },
      team: { findFirst: vi.fn().mockResolvedValue({ id: 'team1' }) },
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
    teamCredit = {
      consume: vi.fn().mockResolvedValue({ success: true }),
    };
    collabDoc = { writeNodeData: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiImageEditProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        { provide: ExecutionGateway, useValue: gateway },
        { provide: ApiCallerService, useValue: apiCaller },
        { provide: TeamCreditService, useValue: teamCredit },
        { provide: CollabDocumentService, useValue: collabDoc },
        { provide: LightingConsumer, useValue: { handleLightingJob: vi.fn() } },
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
          rect: { x: -16, y: 0, width: 528, height: 512 },
          imageWidth: 512,
          imageHeight: 512,
        },
      } as any as Job;

      const result = await processor.process(job);
      expect(result.status).toBe('completed');
      expect(apiCaller.callOutpainting).toHaveBeenCalledWith(
        'https://minio.local/bucket/key?token=abc',
        { x: -16, y: 0, width: 528, height: 512 },
        512,
        512,
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
      expect(teamCredit.consume).toHaveBeenCalledWith('team1', 'user1', 1, 'edit:node1');
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
      expect(teamCredit.consume).toHaveBeenCalledWith('team1', 'user1', 1, 'edit:node1');
      expect(gateway.emitNodeStatus).toHaveBeenCalledWith(
        'proj1',
        expect.objectContaining({ status: 'edit-result' }),
      );
    });

    it('生成物归属 = project.teamId（非 getOwnerTeamId 反推）', async () => {
      (axios.get as any).mockResolvedValue({
        data: Buffer.from('fake-image-data'),
        headers: { 'content-type': 'image/png' },
      });

      const job = {
        data: {
          taskType: 'outpaint',
          userId: 'user1',
          projectId: 'proj1',
          nodeId: 'node1',
          fileId: 'file-1',
          rect: { x: 0, y: 0, width: 512, height: 512 },
          imageWidth: 512,
          imageHeight: 512,
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
      (axios.get as any).mockResolvedValue({
        data: Buffer.from('fake-image-data'),
        headers: { 'content-type': 'image/png' },
      });

      const job = {
        data: {
          taskType: 'outpaint',
          userId: 'user1',
          projectId: 'proj-missing',
          nodeId: 'node1',
          fileId: 'file-1',
          rect: { x: 0, y: 0, width: 512, height: 512 },
          imageWidth: 512,
          imageHeight: 512,
        },
      } as any as Job;

      const result = await processor.process(job);
      expect(result.status).toBe('failed');
      expect(prisma.media.create).not.toHaveBeenCalled();
      expect(prisma.team.findFirst).not.toHaveBeenCalled();
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
          rect: { x: 0, y: 0, width: 512, height: 512 },
          imageWidth: 512,
          imageHeight: 512,
        },
      } as any as Job;

      await expect(processor.process(job)).rejects.toThrow('API timeout');

      // Must NOT deduct credit on failure
      expect(teamCredit.consume).not.toHaveBeenCalled();

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

  describe('安全止血（spec 批0c-2：免费算力/越权产物）', () => {
    const makeJob = () =>
      ({
        data: {
          taskType: 'outpaint',
          userId: 'user1',
          projectId: 'proj1',
          nodeId: 'node1',
          fileId: 'file-1',
          rect: { x: 0, y: 0, width: 512, height: 512 },
          imageWidth: 512,
          imageHeight: 512,
        },
      }) as any as Job;

    it('consume 失败（余额不足）→ 产物零落库（media.create/minio.upload 零调用）+ writeNodeData 零调用 + 返回 failed', async () => {
      teamCredit.consume.mockResolvedValue({ success: false, reason: 'CREDIT_INSUFFICIENT' });
      (axios.get as any).mockResolvedValue({
        data: Buffer.from('fake-image-data'),
        headers: { 'content-type': 'image/png' },
      });

      const result = await processor.process(makeJob());
      expect(result.status).toBe('failed');
      // F4 不变量：看到产物 ⇒ 已扣费——扣费失败则任何产物（Media 行/MinIO 对象）不得落库
      expect(prisma.media.create).not.toHaveBeenCalled();
      expect(minio.upload).not.toHaveBeenCalled();
      expect(collabDoc.writeNodeData).not.toHaveBeenCalled();
    });

    it('getMediaKey 归属：fileId 属他人且非本项目 → 404 语义拒绝（不泄露存在性）', async () => {
      prisma.media.findUnique.mockResolvedValue({
        id: 'file-1',
        key: 'results/u/p/n/date/uuid.png',
        userId: 'someone-else',
        projectId: 'other-proj',
      });
      (axios.get as any).mockResolvedValue({
        data: Buffer.from('fake-image-data'),
        headers: { 'content-type': 'image/png' },
      });

      await expect(processor.process(makeJob())).rejects.toThrow('Media not found: file-1');
    });
  });
});
