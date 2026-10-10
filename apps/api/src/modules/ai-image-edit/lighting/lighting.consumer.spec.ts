import { Test, type TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LightingConsumer } from './lighting.consumer';
import { MinioService } from '../../minio/minio.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ExecutionGateway } from '../../gateway/execution.gateway';
import { ApiCallerService } from '../../execution/api-caller.service';
import { TeamCreditService } from '../../team/team-credit.service';
import { CollabDocumentService } from '../../collab/collab-document.service';
import { GenerationIntentService } from '../../execution/generation-intent.service';
import { Job } from 'bullmq';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

import axios from 'axios';

describe('LightingConsumer', () => {
  let consumer: LightingConsumer;
  let prisma: any;
  let minio: any;
  let teamCredit: any;
  let apiCaller: any;
  let collabDoc: any;
  let intentService: any;

  beforeEach(async () => {
    prisma = {
      canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't-team' }) },
      lightingTask: { update: vi.fn().mockResolvedValue({}) },
      media: {
        findUnique: vi.fn().mockResolvedValue({ id: 'media-src', key: 'media/source-key', userId: 'u1', projectId: 'proj-1' }),
        create: vi.fn().mockResolvedValue({ id: 'media-1' }),
      },
      team: { findFirst: vi.fn() },
    };
    minio = {
      generatePresignedGetUrl: vi.fn().mockResolvedValue('https://minio.local/signed'),
      buildKey: vi.fn().mockReturnValue('generated/key'),
      upload: vi.fn().mockResolvedValue(undefined),
    };
    const gateway = { emitNodeStatus: vi.fn() };
    apiCaller = { callRelighting: vi.fn().mockResolvedValue({ url: 'https://ai.result/r.png' }) };
    teamCredit = {
      reserve: vi.fn().mockResolvedValue({ success: true, mayCall: true }),
      settle: vi.fn().mockResolvedValue({ success: true, settled: true }),
      void_: vi.fn().mockResolvedValue(undefined),
    };
    collabDoc = { writeNodeData: vi.fn().mockResolvedValue({ written: true }) }; // Y0b-2 T5：交付判据类型化 {written,reason}
    intentService = {
      complete: vi.fn().mockResolvedValue(1),
      fail: vi.fn().mockResolvedValue(undefined),
      void_: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LightingConsumer,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        { provide: ExecutionGateway, useValue: gateway },
        { provide: ApiCallerService, useValue: apiCaller },
        { provide: TeamCreditService, useValue: teamCredit },
        { provide: CollabDocumentService, useValue: collabDoc },
        { provide: GenerationIntentService, useValue: intentService },
      ],
    }).compile();
    consumer = module.get<LightingConsumer>(LightingConsumer);
  });

  const makeJob = (projectId?: string, intent?: { intentRowId: string; intentId: string }) =>
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

  const mockAxiosResult = () => {
    (axios.get as any).mockResolvedValue({
      data: Buffer.from('img'),
      headers: { 'content-type': 'image/png' },
    });
  };

  it('有 project 上下文：Media 归属 = project.teamId，不反推', async () => {
    mockAxiosResult();
    await consumer.handleLightingJob(makeJob('proj-1', { intentRowId: 'row-9', intentId: 'i-9' }));

    expect(prisma.media.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ teamId: 't-team' }),
      }),
    );
    expect(prisma.team.findFirst).not.toHaveBeenCalled();
    // A-1 根修（Y0b-2 T5）：reserve 收敛 processor（队列入口）——consumer 零 reserve；settle 核销照走
    expect(teamCredit.reserve).not.toHaveBeenCalled();
    expect(teamCredit.settle).toHaveBeenCalledWith({ intentRowId: 'row-9' });
  });

  it('无 projectId（个人任务）→ Media 回落个人团队，不扣团队积分', async () => {
    prisma.team.findFirst.mockResolvedValue({ id: 't-personal' });
    mockAxiosResult();

    await consumer.handleLightingJob(makeJob(undefined));

    expect(prisma.team.findFirst).toHaveBeenCalledWith({
      where: { ownerId: 'u1', isDefault: true },
      select: { id: true },
    });
    expect(prisma.media.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ teamId: 't-personal' }),
      }),
    );
    expect(teamCredit.reserve).not.toHaveBeenCalled();
    expect(teamCredit.settle).not.toHaveBeenCalled();
  });

  it('project.teamId 缺失 → task failed 且不建 Media（不回落个人团队）', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue(null);
    mockAxiosResult();

    await expect(consumer.handleLightingJob(makeJob('proj-1'))).rejects.toThrow('PROJECT_TEAM_MISSING');

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
      mockAxiosResult();

      // guard 完整：正常链零 reserve 调用（A-1——二次 reserve 白扣费根修的守护锚）
      await consumer.handleLightingJob(makeJob('proj-1', { intentRowId: 'row-9', intentId: 'i-9' }));
      expect(teamCredit.reserve).not.toHaveBeenCalled();
      expect(apiCaller.callRelighting).toHaveBeenCalledTimes(1); // 正常链外呼恰一次

      // guard 缺失=接线断裂——拒绝（processor 侧同款守卫的前线兜底）——外呼计数不增
      await expect(consumer.handleLightingJob(makeJob('proj-1'))).rejects.toThrow('INTENT_GUARD_MISSING');
      expect(apiCaller.callRelighting).toHaveBeenCalledTimes(1); // 零外呼
      expect(prisma.media.create).toHaveBeenCalledTimes(1); // 仅首段正常链落库（F4：违约段产物零落库）
    });

    it('外呼抛错（已冻结）→ catch 路径 void_ 解冻（约束②）', async () => {
      apiCaller.callRelighting.mockRejectedValue(new Error('relight boom'));
      mockAxiosResult();

      await expect(consumer.handleLightingJob(makeJob('proj-1', { intentRowId: 'row-9', intentId: 'i-9' })))
        .rejects.toThrow('relight boom');

      expect(teamCredit.void_).toHaveBeenCalledWith({ intentRowId: 'row-9' });
    });

    it('originalImageId 归属：属他人且非本项目 → 拒绝（不泄露存在性）', async () => {
      prisma.media.findUnique.mockResolvedValue({
        id: 'media-src',
        key: 'media/source-key',
        userId: 'someone-else',
        projectId: 'other-proj',
      });
      mockAxiosResult();

      await expect(consumer.handleLightingJob(makeJob('proj-1'))).rejects.toThrow('Media not found: media-src');
      // 归属校验先于付费 AI 调用：越权读不应触发 relighting
      expect(apiCaller.callRelighting).not.toHaveBeenCalled();
    });

    it('step9 已置 SUCCESS 后 step10 writeNodeData 抛错 → FAILED 覆写须清产物字段（不留 SUCCESS 残留 URL）', async () => {
      collabDoc.writeNodeData.mockRejectedValue(new Error('doc write boom'));
      mockAxiosResult();

      await expect(consumer.handleLightingJob(makeJob('proj-1', { intentRowId: 'row-9', intentId: 'i-9' }))).rejects.toThrow('doc write boom');

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
    const intent = { intentRowId: 'row-9', intentId: 'i-9' };

    it('A-1：consumer 零 reserve（金额单源 intent 行+冻结收敛 processor 队列入口——双 reserve 白扣费根修守护）', async () => {
      mockAxiosResult();
      await consumer.handleLightingJob(makeJob('proj-1', intent));
      expect(teamCredit.reserve).not.toHaveBeenCalled();
      expect(teamCredit.settle).toHaveBeenCalledWith({ intentRowId: 'row-9' }); // 核销照走（冻结在手凭据）
    });

    it('complete 门序开（count===1）：resultRef=media.id + writeNodeData 正常', async () => {
      mockAxiosResult();
      await consumer.handleLightingJob(makeJob('proj-1', intent));
      expect(intentService.complete).toHaveBeenCalledWith('row-9', 'media-1');
      expect(collabDoc.writeNodeData).toHaveBeenCalledWith('proj-1', 'n1', { fileId: 'media-1' });
    });

    it('complete 门序闭（count===0，reconcile 已 VOIDED）：writeNodeData/SUCCESS 回填/emit 零调用（F13 看到产物⇒意图仍有效）', async () => {
      intentService.complete.mockResolvedValue(0);
      mockAxiosResult();
      const result = await consumer.handleLightingJob(makeJob('proj-1', intent));
      expect(collabDoc.writeNodeData).not.toHaveBeenCalled();
      expect(prisma.lightingTask.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'success' }) }),
      );
      expect(result.status).toBe('completed'); // job 本身成功——产物留作证，仅不投递
    });
  });
});
