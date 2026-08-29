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
  let teamCredit: any;

  beforeEach(async () => {
    prisma = {
      canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't-team' }) },
      lightingTask: { update: vi.fn().mockResolvedValue({}) },
      media: { create: vi.fn().mockResolvedValue({ id: 'media-1' }) },
      team: { findFirst: vi.fn() },
    };
    const minio = {
      generatePresignedGetUrl: vi.fn().mockResolvedValue('https://minio.local/signed'),
      buildKey: vi.fn().mockReturnValue('generated/key'),
      upload: vi.fn().mockResolvedValue(undefined),
    };
    const gateway = { emitNodeStatus: vi.fn() };
    const apiCaller = { callRelighting: vi.fn().mockResolvedValue({ url: 'https://ai.result/r.png' }) };
    teamCredit = { consume: vi.fn().mockResolvedValue(undefined) };
    const collabDoc = { writeNodeData: vi.fn() };

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
        originalImageUrl: 'https://minio.local/media/src.jpg',
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

  it('project.teamId 缺失 → task failed 且不建 Media（不回落个人团队）', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue(null);
    mockAxiosResult();

    await expect(consumer.handleLightingJob(makeJob('proj-1'))).rejects.toThrow('PROJECT_TEAM_MISSING');

    expect(prisma.media.create).not.toHaveBeenCalled();
    expect(prisma.lightingTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
    expect(prisma.team.findFirst).not.toHaveBeenCalled();
  });
});
