import { Test, type TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LightingConsumer } from './lighting.consumer';
import { MinioService } from '../../minio/minio.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ExecutionGateway } from '../../gateway/execution.gateway';
import { ApiCallerService } from '../../execution/api-caller.service';
import { TeamCreditService } from '../../team/team-credit.service';
import { CollabDocumentService } from '../../collab/collab-document.service';
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
    teamCredit = { consume: vi.fn().mockResolvedValue({ success: true }) };
    collabDoc = { writeNodeData: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LightingConsumer,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        { provide: ExecutionGateway, useValue: gateway },
        { provide: ApiCallerService, useValue: apiCaller },
        { provide: TeamCreditService, useValue: teamCredit },
        { provide: CollabDocumentService, useValue: collabDoc },
      ],
    }).compile();
    consumer = module.get<LightingConsumer>(LightingConsumer);
  });

  const makeJob = (projectId?: string) =>
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
    await consumer.handleLightingJob(makeJob('proj-1'));

    expect(prisma.media.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ teamId: 't-team' }),
      }),
    );
    expect(prisma.team.findFirst).not.toHaveBeenCalled();
    expect(teamCredit.consume).toHaveBeenCalledWith('t-team', 'u1', 1, 'lighting:task-1');
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
    expect(teamCredit.consume).not.toHaveBeenCalled();
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

  describe('安全止血（spec 批0c-3：扣费守卫 + B1 越权读根修）', () => {
    it('consume 失败（余额不足）→ task failed + 产物零落库（media.create/minio.upload 零调用）+ 返回 failed', async () => {
      teamCredit.consume.mockResolvedValue({ success: false, reason: 'CREDIT_INSUFFICIENT' });
      mockAxiosResult();

      const result = await consumer.handleLightingJob(makeJob('proj-1'));

      expect(result.status).toBe('failed');
      // F4 不变量：看到产物 ⇒ 已扣费——扣费失败则任何产物（Media 行/MinIO 对象）不得落库
      expect(prisma.media.create).not.toHaveBeenCalled();
      expect(minio.upload).not.toHaveBeenCalled();
      expect(collabDoc.writeNodeData).not.toHaveBeenCalled();
      expect(prisma.lightingTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'failed' }),
        }),
      );
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
  });
});
