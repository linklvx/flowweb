import { Test, type TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LightingConsumer } from './lighting.consumer';
import { MinioService } from '../../minio/minio.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmitPort } from '../../gateway/emit.port';
import { ApiCallerService } from '../../execution/api-caller.service';
import { TeamCreditService } from '../../team/team-credit.service';
import { CollabWritePort } from '../../collab/collab-write.port';
import { GenerationIntentService } from '../../execution/generation-intent.service';
import { SafeRemoteFetchService } from '../../media/safe-remote-fetch.service';
import { ArtifactCommitService, FundsInvariantError } from '../../artifact-core/artifact-commit.service';
import { Job } from 'bullmq';

describe('LightingConsumer', () => {
  let consumer: LightingConsumer;
  let prisma: any;
  let minio: any;
  let teamCredit: any;
  let apiCaller: any;
  let emitMock: ReturnType<typeof vi.fn>;
  let collabDoc: any;
  let intentService: any;
  let safeFetch: any;
  let artifactCommit: any;   // T10：产物落地/资金核销改道（stub——默认 committed media-1）

  beforeEach(async () => {
    prisma = {
      canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't-team' }) },
      lightingTask: { update: vi.fn().mockResolvedValue({}) },
      media: {
        findUnique: vi.fn().mockResolvedValue({ id: 'media-src', key: 'media/source-key', userId: 'u1', projectId: 'proj-1' }),
        create: vi.fn().mockResolvedValue({ id: 'media-1' }),
      },
      team: { findFirst: vi.fn() },
      generationIntent: { findUnique: vi.fn().mockResolvedValue({ status: 'RUNNING', execSeq: 9n }) }, // T9 catch fence 读行
    };
    minio = {
      generatePresignedGetUrl: vi.fn().mockResolvedValue('https://minio.local/signed'),
      buildKey: vi.fn().mockReturnValue('generated/key'),
      upload: vi.fn().mockResolvedValue(undefined),
    };
    // T6：结果下载经 SafeRemoteFetch（SSRF 四门+限长）——axios 直连退役
    safeFetch = {
      fetchBuffer: vi.fn().mockResolvedValue({ buffer: Buffer.from('img'), contentType: 'image/png' }),
    };
    const gateway = { emitNodeStatus: vi.fn() };
    emitMock = gateway.emitNodeStatus;
    apiCaller = { callRelighting: vi.fn().mockResolvedValue({ url: 'https://ai.result/r.png' }) };
    teamCredit = {
      reserve: vi.fn().mockResolvedValue({ success: true, mayCall: true }),
      settle: vi.fn().mockResolvedValue({ success: true, settled: true }),
      void_: vi.fn().mockResolvedValue(undefined),
    };
    collabDoc = { // T13 typed outcome：business 档（transient/permanent=悬留档）——交付判据改判别式
      writeNodeData: vi.fn().mockResolvedValue({ kind: 'business', written: true }),
      writeExecStatus: vi.fn().mockResolvedValue(undefined),   // F1 资金硬门：FUNDS_INVARIANT_VIOLATION error 投影写面（worker 侧唯一持久用户面）
    };
    intentService = {
      complete: vi.fn().mockResolvedValue(1),
      fail: vi.fn().mockResolvedValue(undefined),
      void_: vi.fn().mockResolvedValue(undefined),
    };
    // T10：commitImage=stage→下载→上传→finalize 单事务 stub 面（默认 committed——mediaId 锚 media-1）
    artifactCommit = {
      commitImage: vi.fn().mockResolvedValue({ outcome: 'committed', mediaId: 'media-1', key: 'generated/key' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LightingConsumer,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        { provide: EmitPort, useValue: gateway },
        { provide: ApiCallerService, useValue: apiCaller },
        { provide: TeamCreditService, useValue: teamCredit },
        { provide: CollabWritePort, useValue: collabDoc },
        { provide: GenerationIntentService, useValue: intentService },
        { provide: SafeRemoteFetchService, useValue: safeFetch },
        { provide: ArtifactCommitService, useValue: artifactCommit },   // T10
      ],
    }).compile();
    consumer = module.get<LightingConsumer>(LightingConsumer);
  });

  const makeJob = (projectId?: string, intent?: { intentRowId?: string; ticket?: any }) =>
    ({
      data: {
        taskType: 'lighting',
        userId: 'u1',
        nodeId: 'n1',
        projectId,
        taskId: 'task-1',
        originalImageId: 'media-src',
        params: {
          position: { x: 0, y: 0, z: 6 },
          brightness: 50,
          colorTemperature: 5600,
          rimLight: false,
        },
        ...(intent ?? {}),
      },
    }) as any as Job;

  const mockDownloadResult = () => {
    safeFetch.fetchBuffer.mockResolvedValue({ buffer: Buffer.from('img'), contentType: 'image/png' });
  };

  it('有 project 上下文：Media 归属 = project.teamId，不反推', async () => {
    mockDownloadResult();
    await consumer.handleLightingJob(makeJob('proj-1', { intentRowId: 'row-9', ticket: { intentRowId: 'row-9', execSeq: '9', jobId: 'job-9', expectedRev: 0 } }), {});

    // T10：产物落地/资金核销改道 commitImage（下载/上传/media.create/settle/complete 均在其内）
    expect(artifactCommit.commitImage).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'proj-1', nodeId: 'n1', teamId: 't-team', userId: 'u1',
      intentRowId: 'row-9', execSeq: 9n, expectedRev: 0, sourceUrl: 'https://ai.result/r.png', taskId: 'task-1',
    }));
    expect(prisma.media.create).not.toHaveBeenCalled();   // 唯一 Media 写入点=MediaRegistration（commitImage 内）
    expect(prisma.team.findFirst).not.toHaveBeenCalled();
    // A-1 根修（Y0b-2 T5）：reserve 收敛 processor（队列入口）——consumer 零 reserve；settle 归 finalize 单事务
    expect(teamCredit.reserve).not.toHaveBeenCalled();
    expect(teamCredit.settle).not.toHaveBeenCalled();
  });

  it('T6 SSRF 拒路径：fetchBuffer 拒（私网/allowlist 外/超限）→ 抛错（BullMQ failed）+ void_ 解冻（对齐 ai-image-edit 同款——冻结不滞留）+零上传零 Media', async () => {
    artifactCommit.commitImage.mockRejectedValue(new Error('safe-fetch host 不在 allowlist: ai.result'));
    await expect(consumer.handleLightingJob(makeJob('proj-1', { intentRowId: 'row-9', ticket: { intentRowId: 'row-9', execSeq: '9', jobId: 'job-9', expectedRev: 0 } }), {}))
      .rejects.toThrow(/safe-fetch/);
    expect(teamCredit.void_).toHaveBeenCalledWith({ intentRowId: 'row-9', execSeq: 9n });
    expect(prisma.media.create).not.toHaveBeenCalled();
  });

  it('无 projectId（个人任务死径）：资金链恒有项目锚（LightingController assertEditorWithTeam(body.projectId) 必填门+controller claim）→ 直达形态缺票 fail-fast INTENT_GUARD_MISSING（不回落不落库）', async () => {
    prisma.team.findFirst.mockResolvedValue({ id: 't-personal' });
    mockDownloadResult();

    await expect(consumer.handleLightingJob(makeJob(undefined), {})).rejects.toThrow('INTENT_GUARD_MISSING');

    // 归属解析（step 1.5 个人回落）先于票守卫可达——守卫在 commit 点拦住即语义（零外呼后产物面）
    expect(artifactCommit.commitImage).not.toHaveBeenCalled();
    expect(prisma.media.create).not.toHaveBeenCalled();
    expect(teamCredit.reserve).not.toHaveBeenCalled();
    expect(teamCredit.settle).not.toHaveBeenCalled();
  });

  it('project.teamId 缺失 → task failed 且不建 Media（不回落个人团队）', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue(null);
    mockDownloadResult();

    await expect(consumer.handleLightingJob(makeJob('proj-1'), {})).rejects.toThrow('PROJECT_TEAM_MISSING');

    // team 解析先于付费 AI 调用：project 缺失属永久性错误，不应浪费一次 relighting 调用
    expect(apiCaller.callRelighting).not.toHaveBeenCalled();
    expect(prisma.media.create).not.toHaveBeenCalled();
    expect(prisma.lightingTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
    expect(prisma.team.findFirst).not.toHaveBeenCalled();
  });

  describe('安全止血（spec 批0c-3 + 批0.5-9 两阶段：扣费守卫 + B1 越权读根修）', () => {
    it('A-1 根修：consumer 不再 reserve（收敛 processor 队列入口）——guard 缺失仍接线断言（余额不足路径归 processor 收口）', async () => {
      mockDownloadResult();

      // guard 完整：正常链零 reserve 调用（A-1——二次 reserve 白扣费根修的守护锚）
      await consumer.handleLightingJob(makeJob('proj-1', { intentRowId: 'row-9', ticket: { intentRowId: 'row-9', execSeq: '9', jobId: 'job-9', expectedRev: 0 } }), {});
      expect(teamCredit.reserve).not.toHaveBeenCalled();
      expect(apiCaller.callRelighting).toHaveBeenCalledTimes(1); // 正常链外呼恰一次

      // guard 缺失=接线断裂——拒绝（processor 侧同款守卫的前线兜底）——外呼计数不增
      await expect(consumer.handleLightingJob(makeJob('proj-1'), {})).rejects.toThrow('INTENT_GUARD_MISSING');
      expect(apiCaller.callRelighting).toHaveBeenCalledTimes(1); // 零外呼
      expect(artifactCommit.commitImage).toHaveBeenCalledTimes(1); // 仅首段正常链落库（F4：违约段产物零落库）
    });

    it('外呼抛错（已冻结）→ catch 路径 void_ 解冻（约束②）', async () => {
      apiCaller.callRelighting.mockRejectedValue(new Error('relight boom'));
      mockDownloadResult();

      await expect(consumer.handleLightingJob(makeJob('proj-1', { intentRowId: 'row-9', ticket: { intentRowId: 'row-9', execSeq: '9', jobId: 'job-9', expectedRev: 0 } }), {}))
        .rejects.toThrow('relight boom');

      expect(teamCredit.void_).toHaveBeenCalledWith({ intentRowId: 'row-9', execSeq: 9n });
    });

    it('originalImageId 归属：属他人且非本项目 → 拒绝（不泄露存在性）', async () => {
      prisma.media.findUnique.mockResolvedValue({
        id: 'media-src',
        key: 'media/source-key',
        userId: 'someone-else',
        projectId: 'other-proj',
      });
      mockDownloadResult();

      await expect(consumer.handleLightingJob(makeJob('proj-1'), {})).rejects.toThrow('Media not found: media-src');
      // 归属校验先于付费 AI 调用：越权读不应触发 relighting
      expect(apiCaller.callRelighting).not.toHaveBeenCalled();
    });

    it('step9 已置 SUCCESS 后残余段抛错（T15：emit 注入——doc 交付写已移除）→ FAILED 覆写须清产物字段（不留 SUCCESS 残留 URL）', async () => {
      emitMock.mockImplementation((() => { throw new Error('emit boom'); }) as any);
      mockDownloadResult();

      await expect(consumer.handleLightingJob(makeJob('proj-1', { intentRowId: 'row-9', ticket: { intentRowId: 'row-9', execSeq: '9', jobId: 'job-9', expectedRev: 0 } }), {})).rejects.toThrow('emit boom');

      // SUCCESS 已落库（resultImageUrl/resultMediaId 已写）→ catch 覆写 FAILED 时必须同笔清空，
      // 否则 FAILED 行残留产物 URL（getTask 可取）——状态与产物矛盾
      expect(prisma.lightingTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'failed',
            resultImageUrl: null,
            resultMediaId: null,
          }),
        }),
      );
    });
  });

  describe('批0.5-8/0.5-9 意图表扩面（reserve guard + settle 核销 + complete 门序）', () => {
    const intent = { intentRowId: 'row-9', ticket: { intentRowId: 'row-9', execSeq: '9', jobId: 'job-9', expectedRev: 0 } };

    it('A-1：consumer 零 reserve（金额单源 intent 行+冻结收敛 processor 队列入口——双 reserve 白扣费根修守护）', async () => {
      mockDownloadResult();
      await consumer.handleLightingJob(makeJob('proj-1', intent), {});
      expect(teamCredit.reserve).not.toHaveBeenCalled();
      expect(artifactCommit.commitImage).toHaveBeenCalledTimes(1);   // 核销归 finalize 单事务（冻结在手凭据）
      expect(teamCredit.settle).not.toHaveBeenCalled();             // settle 直调退役
    });

    it('T15 finalize committed：交付归投影 poller（worker 零 data 写——writeNodeData 零调用）+SUCCESS 回填+emit 照发（complete 门序归 finalize 内 intent CAS）', async () => {
      mockDownloadResult();
      const r = await consumer.handleLightingJob(makeJob('proj-1', intent), {});
      expect(intentService.complete).not.toHaveBeenCalled();
      expect(collabDoc.writeNodeData).not.toHaveBeenCalled();   // T15：fileId=投影 poller deliverArtifact 专写（pending 行随 finalize 落）
      expect(prisma.lightingTask.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'success', resultMediaId: 'media-1' }) }));
      expect(r.status).toBe('completed');
    });

    it('T10 finalize intent-stale（行终态/换代——旧 complete 门序闭面）：writeNodeData/SUCCESS 回填/emit 零调用（F13 看到产物⇒意图仍有效）', async () => {
      artifactCommit.commitImage.mockResolvedValueOnce({ outcome: 'intent-stale' });
      mockDownloadResult();
      const result = await consumer.handleLightingJob(makeJob('proj-1', intent), {});
      expect(collabDoc.writeNodeData).not.toHaveBeenCalled();
      expect(prisma.lightingTask.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'success' }) }),
      );
      expect(result.status).toBe('completed'); // job 本身成功——产物留作物证，仅不投递
    });
  });

  // ── F1 资金硬门执行面（spec 评审 P1）：FundsInvariantError 传播到 catch ⇒ 禁 void_/不置 LightingTask
  //    FAILED/不 rethrow——意图行留 RUNNING+冻结原样交对账第四分支裁决（任务状态收敛归裁决面）；
  //    用户面=writeExecStatus FUNDS_INVARIANT_VIOLATION error 投影（worker emit 降级 no-op——doc 投影
  //    为唯一持久面）+lighting-failed emit+logger.error 打点。 ──
  describe('F1 资金硬门：FundsInvariantError catch 分支（不 void_/不置任务 FAILED/不 rethrow——行留 RUNNING 交对账）', () => {
    const intent = { intentRowId: 'row-9', ticket: { intentRowId: 'row-9', execSeq: '9', jobId: 'job-9', expectedRev: 0 } };

    it('不 void_、不置 LightingTask FAILED、不 rethrow（failed 返回非 throw）+FUNDS_INVARIANT_VIOLATION 投影+lighting-failed emit+logger.error', async () => {
      artifactCommit.commitImage.mockRejectedValueOnce(new FundsInvariantError({
        intentRowId: 'row-9', execSeq: 9n, creditCost: 5, reservedCredits: 0, creditsConsumed: 0, reservedExecSeq: null,
      }));
      const loggerSpy = vi.spyOn((consumer as any).logger, 'error');

      const result = await consumer.handleLightingJob(makeJob('proj-1', intent), {});

      expect(result).toMatchObject({ status: 'failed', reason: 'FUNDS_INVARIANT_VIOLATION' });   // 正常返回=rethrow 面 regressed 即红
      // 资金禁自动动作：不 void_（解冻退款）——行留 RUNNING+冻结原样
      expect(teamCredit.void_).not.toHaveBeenCalled();
      // 不置 LightingTask FAILED（歧义态禁终态化——任务状态收敛归对账裁决面）
      const failedUpdates = prisma.lightingTask.update.mock.calls.filter((c: any[]) => (c[0] as any)?.data?.status === 'failed');
      expect(failedUpdates).toHaveLength(0);
      // error 级打点（携带意图行 id——资金不变量破缺=对账介入信号）
      expect(loggerSpy).toHaveBeenCalled();
      expect(String(loggerSpy.mock.calls.at(-1)![0])).toContain('row-9');
      // 用户面持久投影（worker emit 降级 no-op——doc 投影为唯一可达面）
      expect(collabDoc.writeExecStatus).toHaveBeenCalledWith('proj-1', 'n1', expect.objectContaining({
        status: 'error', errorCode: 'FUNDS_INVARIANT_VIOLATION', error: expect.stringContaining('资金核销异常'),
      }), { intentRowId: 'row-9', execSeq: '9' });
      // 即时 UX 面（api 形态有效）
      expect(emitMock).toHaveBeenCalledWith('proj-1', expect.objectContaining({
        nodeId: 'n1', status: 'lighting-failed',
      }));
    });
  });
});
