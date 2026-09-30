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
import { GenerationIntentService } from '../execution/generation-intent.service';
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
  let intentService: any;

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
      reserve: vi.fn().mockResolvedValue({ success: true }),
      settle: vi.fn().mockResolvedValue({ success: true, settled: true }),
      void_: vi.fn().mockResolvedValue(undefined),
    };
    collabDoc = { writeNodeData: vi.fn(), writeExecStatus: vi.fn().mockResolvedValue(undefined) };
    intentService = {
      complete: vi.fn().mockResolvedValue(1),
      fail: vi.fn().mockResolvedValue(undefined),
      void_: vi.fn().mockResolvedValue(undefined),
    };

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
        { provide: GenerationIntentService, useValue: intentService },
      ],
    }).compile();
    processor = module.get<AiImageEditProcessor>(AiImageEditProcessor);
  });

  describe('success path', () => {
    it('should outpaint, reserve→settle, and emit edit-result', async () => {
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
          intentRowId: 'row-9',
          intentId: 'i-9',
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
      // 批0.5-9 两阶段：reserve 外呼之前 + settle 外呼成功后
      expect(teamCredit.reserve).toHaveBeenCalledWith('team1', 'user1', 1, { intentRowId: 'row-9', intentId: 'i-9' });
      expect(teamCredit.settle).toHaveBeenCalledWith({ intentRowId: 'row-9', intentId: 'i-9' });
      expect(teamCredit.reserve.mock.invocationCallOrder[0]).toBeLessThan(apiCaller.callOutpainting.mock.invocationCallOrder[0]);
      expect(gateway.emitNodeStatus).toHaveBeenCalledWith(
        'proj1',
        expect.objectContaining({
          nodeId: 'node1',
          status: 'edit-result',
          fileId: 'media-new',
        }),
      );
    });

    it('should erase with mask, reserve→settle, and emit edit-result', async () => {
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
          intentRowId: 'row-9',
          intentId: 'i-9',
        },
      } as any as Job;

      const result = await processor.process(job);
      expect(result.status).toBe('completed');
      expect(apiCaller.callErase).toHaveBeenCalledWith(
        'https://minio.local/bucket/key?token=abc',
        'https://minio.local/bucket/key?token=abc',
      );
      expect(teamCredit.reserve).toHaveBeenCalledWith('team1', 'user1', 1, { intentRowId: 'row-9', intentId: 'i-9' });
      expect(teamCredit.settle).toHaveBeenCalledTimes(1);
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
          intentRowId: 'row-9',
          intentId: 'i-9',
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

    it('project 缺失 → failed 且不建 Media 不外呼（团队解析前移至 reserve/外呼之前）', async () => {
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
          intentRowId: 'row-9',
          intentId: 'i-9',
        },
      } as any as Job;

      const result = await processor.process(job);
      expect(result.status).toBe('failed');
      expect(apiCaller.callOutpainting).not.toHaveBeenCalled(); // 零外呼
      expect(teamCredit.reserve).not.toHaveBeenCalled();
      expect(prisma.media.create).not.toHaveBeenCalled();
      expect(prisma.team.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('failure path', () => {
    it('API error → void_ 解冻 + fail 置 FAILED（冻结不滞留）+ emit edit-failed', async () => {
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
          intentRowId: 'row-9',
          intentId: 'i-9',
        },
      } as any as Job;

      await expect(processor.process(job)).rejects.toThrow('API timeout');

      // 冻结在外呼前发生，失败即解冻（批0.5-9）
      expect(teamCredit.reserve).toHaveBeenCalledTimes(1);
      expect(teamCredit.void_).toHaveBeenCalledWith({ intentRowId: 'row-9', intentId: 'i-9' });
      expect(intentService.fail).toHaveBeenCalledWith('row-9', expect.stringContaining('API timeout'));

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
          intentRowId: 'row-9',
          intentId: 'i-9',
        },
      }) as any as Job;

    it('reserve 失败（余额不足）→ 外呼零调用 + 意图 VOIDED + 产物零落库 + 返回 failed', async () => {
      teamCredit.reserve.mockResolvedValue({ success: false, reason: 'CREDIT_INSUFFICIENT' });
      (axios.get as any).mockResolvedValue({
        data: Buffer.from('fake-image-data'),
        headers: { 'content-type': 'image/png' },
      });

      const result = await processor.process(makeJob());
      expect(result.status).toBe('failed');
      // 批0.5-9：reserve 前置外呼——余额不足零外呼（不再白付第三方）
      expect(apiCaller.callOutpainting).not.toHaveBeenCalled();
      expect(intentService.void_).toHaveBeenCalledWith('row-9', expect.stringContaining('CREDIT_INSUFFICIENT'));
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

  describe('批0.5-8/0.5-9 意图表扩面（reserve guard + settle 核销 + complete 门序 + 终态兜底）', () => {
    const makeIntentJob = () =>
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
          intentRowId: 'row-9',
          intentId: 'i-9',
        },
      }) as any as Job;

    const mockResult = () => {
      (axios.get as any).mockResolvedValue({
        data: Buffer.from('fake-image-data'),
        headers: { 'content-type': 'image/png' },
      });
    };

    it('reserve 带 intentGuard {intentRowId, intentId}（约束① CAS 锚防 stalled 重排双冻结）', async () => {
      mockResult();
      await processor.process(makeIntentJob());
      expect(teamCredit.reserve).toHaveBeenCalledWith(
        'team1', 'user1', 1, { intentRowId: 'row-9', intentId: 'i-9' },
      );
    });

    it('intent guard 缺失（0.5-8 接线断裂防御）→ 拒绝付费外呼：零外呼零扣费返回 failed', async () => {
      mockResult();
      const job = makeIntentJob();
      delete (job.data as any).intentRowId;
      const result = await processor.process(job);
      expect(result.status).toBe('failed');
      expect(result.reason).toBe('INTENT_GUARD_MISSING');
      expect(apiCaller.callOutpainting).not.toHaveBeenCalled();
      expect(teamCredit.reserve).not.toHaveBeenCalled();
    });

    it('complete 门序开（count===1）：resultRef=media.id + writeNodeData 正常', async () => {
      mockResult();
      await processor.process(makeIntentJob());
      expect(intentService.complete).toHaveBeenCalledWith('row-9', 'media-new');
      expect(collabDoc.writeNodeData).toHaveBeenCalledWith(
        'proj1', 'node1', expect.objectContaining({ fileId: 'media-new' }),
      );
    });

    it('complete 门序闭（count===0，reconcile 已 VOIDED）：writeNodeData/emit 零调用（F13 看到产物⇒意图仍有效）', async () => {
      intentService.complete.mockResolvedValue(0);
      mockResult();
      const result = await processor.process(makeIntentJob());
      expect(collabDoc.writeNodeData).not.toHaveBeenCalled();
      expect(gateway.emitNodeStatus).not.toHaveBeenCalledWith(
        'proj1', expect.objectContaining({ status: 'edit-result' }),
      );
      expect(result.status).toBe('completed'); // job 本身成功——产物留作证，仅不投递
    });

    it('catch 路径：void_ 解冻 + fail 置 FAILED + writeExecStatus error（意图终态必达）', async () => {
      apiCaller.callOutpainting.mockRejectedValue(new Error('AI timeout'));
      await expect(processor.process(makeIntentJob())).rejects.toThrow('AI timeout');
      expect(teamCredit.void_).toHaveBeenCalledWith({ intentRowId: 'row-9', intentId: 'i-9' });
      expect(intentService.fail).toHaveBeenCalledWith('row-9', expect.stringContaining('AI timeout'));
      expect(collabDoc.writeExecStatus).toHaveBeenCalledWith(
        'proj1', 'node1', expect.objectContaining({ status: 'error', intentId: 'i-9' }),
      );
    });

    it('failed 钩子（SIGKILL 兜底）：job.data 带 intentRowId → writeExecStatus + fail 双写', async () => {
      await processor.onFailed(makeIntentJob(), new Error('worker killed'));
      expect(collabDoc.writeExecStatus).toHaveBeenCalledWith(
        'proj1', 'node1', expect.objectContaining({ status: 'error', intentId: 'i-9' }),
      );
      expect(intentService.fail).toHaveBeenCalledWith('row-9', 'worker killed');
    });

    it('failed 钩子：job 为 undefined（移除中）→ 零写零抛', async () => {
      await processor.onFailed(undefined as any, new Error('x'));
      expect(collabDoc.writeExecStatus).not.toHaveBeenCalled();
      expect(intentService.fail).not.toHaveBeenCalled();
    });
  });
});
