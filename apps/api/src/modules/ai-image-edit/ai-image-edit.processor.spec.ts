import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AiImageEditProcessor } from './ai-image-edit.processor';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmitPort } from '../gateway/emit.port';
import { ApiCallerService } from '../execution/api-caller.service';
import { TeamCreditService } from '../team/team-credit.service';
import { CollabWritePort } from '../collab/collab-write.port';
import { LightingConsumer } from './lighting/lighting.consumer';
import { GenerationIntentService } from '../execution/generation-intent.service';
import { SafeRemoteFetchService } from '../media/safe-remote-fetch.service';
import { ArtifactCommitService } from '../artifact-core/artifact-commit.service';
import { Job } from 'bullmq';

describe('AiImageEditProcessor', () => {
  let processor: AiImageEditProcessor;
  let prisma: any;
  let minio: any;
  let gateway: any;
  let apiCaller: any;
  let teamCredit: any;
  let collabDoc: any;
  let intentService: any;
  let safeFetch: any;
  let artifactCommit: any;   // T10：产物落地/资金核销改道（stub——默认 committed）

  beforeEach(async () => {
    prisma = {
      canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 'team1' }) },
      media: {
        findUnique: vi.fn().mockResolvedValue({ id: 'file-1', key: 'results/u/p/n/date/uuid.png', userId: 'user1', projectId: 'proj1' }),
        create: vi.fn().mockResolvedValue({ id: 'media-new' }),
      },
      team: { findFirst: vi.fn().mockResolvedValue({ id: 'team1' }) },
      generationIntent: { findUnique: vi.fn().mockResolvedValue({ status: 'RUNNING', execSeq: 9n, attempts: 1, providerTaskId: null }) },
    };
    minio = {
      upload: vi.fn().mockResolvedValue(undefined),
      buildKey: vi.fn().mockReturnValue('results/user1/proj1/node1/2026-06-10/uuid.png'),
      generatePresignedGetUrl: vi.fn().mockResolvedValue('https://minio.local/bucket/key?token=abc'),
    };
    gateway = {
      emitNodeStatus: vi.fn(),
    };
    // T6：结果下载经 SafeRemoteFetch（SSRF 四门+限长）——axios 直连退役
    safeFetch = {
      fetchBuffer: vi.fn().mockResolvedValue({ buffer: Buffer.from('fake-image-data'), contentType: 'image/png' }),
    };
    apiCaller = {
      callOutpainting: vi.fn().mockResolvedValue({ url: 'https://dashscope.result/outpaint.png' }),
      callErase: vi.fn().mockResolvedValue({ url: 'https://dashscope.result/erase.png' }),
      callRedraw: vi.fn().mockResolvedValue({ url: 'https://dashscope.result/redraw.png' }),
    };
    teamCredit = {
      reserve: vi.fn().mockResolvedValue({ success: true, mayCall: true }),
      settle: vi.fn().mockResolvedValue({ success: true, settled: true }),
      void_: vi.fn().mockResolvedValue(undefined),
    };
    collabDoc = { // T13 typed outcome：business 档（transient/permanent=悬留档）——交付判据改判别式
      writeNodeData: vi.fn().mockResolvedValue({ kind: 'business', written: true }),
      writeExecStatus: vi.fn().mockResolvedValue(undefined),
    };
    // T10：commitImage=stage→下载→上传→finalize 单事务的 stub 面（默认 committed——mediaId 锚 media-new）
    artifactCommit = {
      commitImage: vi.fn().mockResolvedValue({ outcome: 'committed', mediaId: 'media-new', key: 'artifacts/t/r/9/0-abc' }),
    };
    intentService = {
      complete: vi.fn().mockResolvedValue(1),
      fail: vi.fn().mockResolvedValue(undefined),
      void_: vi.fn().mockResolvedValue(undefined),
      findByActiveNode: vi.fn().mockResolvedValue(null), // Y0b-1（N4）：failed 钩子反查
      reanchorDeadline: vi.fn().mockResolvedValue(1), // Y0b-2 T4：外呼前重锚（count 形态——T9 代际 CAS）
      touchHeartbeat: vi.fn().mockResolvedValue(undefined),
      ensureProviderRequestId: vi.fn().mockResolvedValue('rid-t9'), // T9 write-ahead
      recordProviderTaskId: vi.fn().mockResolvedValue(undefined),   // T9 taskId 落库
      tickFence: vi.fn().mockResolvedValue(undefined),              // T9 onTick 双职+代际
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiImageEditProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        { provide: EmitPort, useValue: gateway },
        { provide: ApiCallerService, useValue: apiCaller },
        { provide: TeamCreditService, useValue: teamCredit },
        { provide: CollabWritePort, useValue: collabDoc },
        { provide: LightingConsumer, useValue: { handleLightingJob: vi.fn() } },
        { provide: GenerationIntentService, useValue: intentService },
        { provide: SafeRemoteFetchService, useValue: safeFetch },
        { provide: ArtifactCommitService, useValue: artifactCommit },   // T10
      ],
    }).compile();
    processor = module.get<AiImageEditProcessor>(AiImageEditProcessor);
  });

  describe('success path', () => {
    it('should outpaint, reserve→settle, and emit edit-result', async () => {
      const mockBuffer = Buffer.from('fake-image-data');
      safeFetch.fetchBuffer.mockResolvedValue({ buffer: mockBuffer, contentType: 'image/png' });

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
          ticket: { intentRowId: 'row-9', execSeq: '9', jobId: 'job-9', expectedRev: 0 },
        },
      } as any as Job;

      const result = await processor.process(job);
      expect(result.status).toBe('completed');
      expect(apiCaller.callOutpainting).toHaveBeenCalledWith(
        'https://minio.local/bucket/key?token=abc',
        { x: -16, y: 0, width: 528, height: 512 },
        512,
        512,
        undefined,
        expect.objectContaining({ onTick: expect.any(Function) }), // Y0b-2 T4：onTick 双职（心跳+reaper 收敛 abort）
      );
      // T10：产物落地/资金核销改道 commitImage（下载/上传/media.create/settle/complete 均在其内——
      // processor 直用面退役；归属锚 teamId=project.teamId 透传）
      expect(artifactCommit.commitImage).toHaveBeenCalledWith(expect.objectContaining({
        projectId: 'proj1', nodeId: 'node1', teamId: 'team1', userId: 'user1',
        intentRowId: 'row-9', execSeq: 9n, expectedRev: 0, sourceUrl: 'https://dashscope.result/outpaint.png',
      }));
      expect(prisma.media.create).not.toHaveBeenCalled();   // 唯一 Media 写入点=MediaRegistration（commitImage 内）
      // 批0.5-9 两阶段：reserve 外呼之前（settle 归 finalize 单事务——processor 不再直调）
      expect(teamCredit.reserve).toHaveBeenCalledWith('user1', { intentRowId: 'row-9', execSeq: 9n });
      expect(teamCredit.settle).not.toHaveBeenCalled();
      expect(teamCredit.reserve.mock.invocationCallOrder[0]).toBeLessThan(apiCaller.callOutpainting.mock.invocationCallOrder[0]);
      expect(apiCaller.callOutpainting.mock.invocationCallOrder[0]).toBeLessThan(artifactCommit.commitImage.mock.invocationCallOrder[0]);
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
      safeFetch.fetchBuffer.mockResolvedValue({ buffer: mockBuffer, contentType: 'image/png' });

      const job = {
        data: {
          taskType: 'erase',
          userId: 'user1',
          projectId: 'proj1',
          nodeId: 'node1',
          fileId: 'file-1',
          maskFileId: 'mask-1',
          intentRowId: 'row-9',
          ticket: { intentRowId: 'row-9', execSeq: '9', jobId: 'job-9', expectedRev: 0 },
        },
      } as any as Job;

      const result = await processor.process(job);
      expect(result.status).toBe('completed');
      expect(apiCaller.callErase).toHaveBeenCalledWith(
        'https://minio.local/bucket/key?token=abc',
        'https://minio.local/bucket/key?token=abc',
        expect.objectContaining({ onTick: expect.any(Function) }), // Y0b-2 T4：onTick 双职
      );
      expect(teamCredit.reserve).toHaveBeenCalledWith('user1', { intentRowId: 'row-9', execSeq: 9n });
      expect(artifactCommit.commitImage).toHaveBeenCalledTimes(1);
      expect(gateway.emitNodeStatus).toHaveBeenCalledWith(
        'proj1',
        expect.objectContaining({ status: 'edit-result' }),
      );
    });

    it('生成物归属 = project.teamId（非 getOwnerTeamId 反推）', async () => {
      safeFetch.fetchBuffer.mockResolvedValue({ buffer: Buffer.from('fake-image-data'), contentType: 'image/png' });

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
          ticket: { intentRowId: 'row-9', execSeq: '9', jobId: 'job-9', expectedRev: 0 },
        },
      } as any as Job;

      await processor.process(job);
      expect(artifactCommit.commitImage).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'team1' }));   // 生成物归属=project.teamId
      // 不再调用 team.findFirst 反推
      expect(prisma.team.findFirst).not.toHaveBeenCalled();
    });

    it('project 缺失 → failed 且不建 Media 不外呼（团队解析前移至 reserve/外呼之前）', async () => {
      prisma.canvasProject.findUnique.mockResolvedValue(null);
      safeFetch.fetchBuffer.mockResolvedValue({ buffer: Buffer.from('fake-image-data'), contentType: 'image/png' });

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
          ticket: { intentRowId: 'row-9', execSeq: '9', jobId: 'job-9', expectedRev: 0 },
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
    it('T6/T10 SSRF 拒路径：commitImage 内下载拒（私网/allowlist 外/超限）→ void_ 解冻 + fail 置 FAILED + 零上传零 Media', async () => {
      artifactCommit.commitImage.mockRejectedValue(new Error('safe-fetch 私网/保留地址拒: dashscope.result → 10.0.0.1'));

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
          ticket: { intentRowId: 'row-9', execSeq: '9', jobId: 'job-9', expectedRev: 0 },
        },
      } as any as Job;

      await expect(processor.process(job)).rejects.toThrow(/safe-fetch/);
      expect(teamCredit.void_).toHaveBeenCalledWith({ intentRowId: 'row-9', execSeq: 9n });
      expect(prisma.media.create).not.toHaveBeenCalled();
    });

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
          ticket: { intentRowId: 'row-9', execSeq: '9', jobId: 'job-9', expectedRev: 0 },
        },
      } as any as Job;

      await expect(processor.process(job)).rejects.toThrow('API timeout');

      // 冻结在外呼前发生，失败即解冻（批0.5-9）
      expect(teamCredit.reserve).toHaveBeenCalledTimes(1);
      expect(teamCredit.void_).toHaveBeenCalledWith({ intentRowId: 'row-9', execSeq: 9n });
      expect(intentService.fail).toHaveBeenCalledWith('row-9', expect.stringContaining('API timeout'), undefined, 9n);

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
          ticket: { intentRowId: 'row-9', execSeq: '9', jobId: 'job-9', expectedRev: 0 },
        },
      }) as any as Job;

    it('reserve 失败（余额不足）→ 外呼零调用 + 意图 VOIDED + 产物零落库 + 返回 failed', async () => {
      teamCredit.reserve.mockResolvedValue({ success: false, reason: 'CREDIT_INSUFFICIENT' });
      safeFetch.fetchBuffer.mockResolvedValue({ buffer: Buffer.from('fake-image-data'), contentType: 'image/png' });

      const result = await processor.process(makeJob());
      expect(result.status).toBe('failed');
      // 批0.5-9：reserve 前置外呼——余额不足零外呼（不再白付第三方）
      expect(apiCaller.callOutpainting).not.toHaveBeenCalled();
      expect(intentService.void_).toHaveBeenCalledWith('row-9', expect.stringContaining('CREDIT_INSUFFICIENT'), 9n);
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
      safeFetch.fetchBuffer.mockResolvedValue({ buffer: Buffer.from('fake-image-data'), contentType: 'image/png' });

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
          ticket: { intentRowId: 'row-9', execSeq: '9', jobId: 'job-9', expectedRev: 0 },
        },
      }) as any as Job;

    const mockResult = () => {
      safeFetch.fetchBuffer.mockResolvedValue({ buffer: Buffer.from('fake-image-data'), contentType: 'image/png' });
    };

    it('reserve 带 intentGuard {intentRowId}（Y0b-1 Z10——金额单源 intent 行；约束① CAS 锚防 stalled 重排双冻结）', async () => {
      mockResult();
      await processor.process(makeIntentJob());
      expect(teamCredit.reserve).toHaveBeenCalledWith(
        'user1', { intentRowId: 'row-9', execSeq: 9n },
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

    it('T15 finalize committed：交付归投影 poller（worker 零 data 写——writeNodeData 零调用+O0b-2 信封面零触碰）+emit 照发（complete 门序归 finalize 内 intent CAS）', async () => {
      mockResult();
      const result = await processor.process(makeIntentJob());
      expect(artifactCommit.commitImage).toHaveBeenCalledWith(expect.objectContaining({ intentRowId: 'row-9', execSeq: 9n }));
      expect(intentService.complete).not.toHaveBeenCalled();   // intent CAS 归 finalize 单事务（processor 直调退役）
      expect(collabDoc.writeNodeData).not.toHaveBeenCalled();   // T15：fileId=投影 poller deliverArtifact 专写（pending 行随 finalize 落）
      expect(gateway.emitNodeStatus).toHaveBeenCalledWith('proj1', expect.objectContaining({ status: 'edit-result', fileId: 'media-new' }));
      expect(result.status).toBe('completed');
    });

    it('T10 finalize intent-stale（行终态/换代——旧 complete 门序闭面）：writeNodeData/emit 零调用（F13 看到产物⇒意图仍有效）', async () => {
      artifactCommit.commitImage.mockResolvedValueOnce({ outcome: 'intent-stale' });
      mockResult();
      const result = await processor.process(makeIntentJob());
      expect(collabDoc.writeNodeData).not.toHaveBeenCalled();
      expect(gateway.emitNodeStatus).not.toHaveBeenCalledWith(
        'proj1', expect.objectContaining({ status: 'edit-result' }),
      );
      expect(result.status).toBe('completed'); // job 本身成功——产物留作物证，仅不投递
    });

    it('T10 资金独立判：finalize superseded → 照常 completed+emit，doc 不覆盖用户值（writeNodeData 零调用）', async () => {
      artifactCommit.commitImage.mockResolvedValueOnce({ outcome: 'superseded', mediaId: 'media-x' });
      mockResult();
      const result = await processor.process(makeIntentJob());
      expect(collabDoc.writeNodeData).not.toHaveBeenCalled();   // 用户在飞替换值保留
      expect(gateway.emitNodeStatus).toHaveBeenCalledWith(
        'proj1', expect.objectContaining({ status: 'edit-result', fileId: 'media-x' }),
      );
      expect(result.status).toBe('completed');
    });

    it('catch 路径：void_ 解冻 + fail 置 FAILED + writeExecStatus error（意图终态必达）', async () => {
      apiCaller.callOutpainting.mockRejectedValue(new Error('AI timeout'));
      await expect(processor.process(makeIntentJob())).rejects.toThrow('AI timeout');
      expect(teamCredit.void_).toHaveBeenCalledWith({ intentRowId: 'row-9', execSeq: 9n });
      expect(intentService.fail).toHaveBeenCalledWith('row-9', expect.stringContaining('AI timeout'), undefined, 9n);
      expect(collabDoc.writeExecStatus).toHaveBeenCalledWith(
        'proj1', 'node1', expect.objectContaining({ status: 'error' }),
        { intentRowId: 'row-9', execSeq: '9' },
      );
    });

    it('failed 钩子（SIGKILL 兜底，Y0c T28/Z41 拆两半）：findByActiveNode(job.id) 反查 → fail(jobId 限定)——PG 半；writeExecStatus 零调用（投影半归 api 最终一致链）', async () => {
      intentService.findByActiveNode.mockResolvedValue({ id: 'row-9', execSeq: 9n }); // T9：钩子按票验代际——同代才 fail
      const job = { ...makeIntentJob(), id: 'job-9' };
      await processor.onFailed(job as any, new Error('worker killed'));
      expect(collabDoc.writeExecStatus).not.toHaveBeenCalled(); // Z41：投影不走 worker 失败钩子（重连 alignExecFromIntents+reconcile 收敛）
      expect(intentService.findByActiveNode).toHaveBeenCalledWith('proj1', 'node1', 'job-9'); // Z27：jobId 限定
      expect(intentService.fail).toHaveBeenCalledWith('row-9', 'worker killed', 'job-9', 9n);
    });

    it('failed 钩子：job 为 undefined（移除中）→ 零写零抛', async () => {
      await processor.onFailed(undefined as any, new Error('x'));
      expect(collabDoc.writeExecStatus).not.toHaveBeenCalled();
      expect(intentService.fail).not.toHaveBeenCalled();
    });
  });
});
