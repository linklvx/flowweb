import { Test, type TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { LightingService } from './lighting.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { TeamCreditService } from '../../team/team-credit.service';
import { getQueueToken } from '@nestjs/bullmq';
import { AI_IMAGE_EDIT_QUEUE_NAME } from '../ai-image-edit.constants';

const LightingTaskStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  FAILED: 'failed',
} as const;

describe('LightingService', () => {
  let service: LightingService;
  let prisma: any;
  let credit: any;
  let queue: any;

  const validDto = {
    nodeId: 'node-1',
    projectId: 'proj-1',
    originalImageUrl: 'https://minio.example.com/buckets/media/bucket/key.jpg',
    params: {
      position: { x: 0, y: 0, z: 6 },
      brightness: 50,
      colorTemperature: 5600,
      rimLight: false,
    },
  };

  beforeEach(async () => {
    prisma = {
      canvasProject: {
        findUnique: vi.fn().mockResolvedValue({ teamId: 'team1' }),
      },
      team: { findFirst: vi.fn().mockResolvedValue({ id: 'team1' }) },
      teamMember: { findFirst: vi.fn().mockResolvedValue(null) },
      lightingTask: {
        create: vi.fn().mockResolvedValue({ id: 'task-1', status: 'pending' }),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    credit = {
      getBalanceView: vi.fn().mockResolvedValue({ credits: 100, subscriptionCredits: 0, total: 100, quota: 0, used: 0 }),
      freeze: vi.fn().mockResolvedValue(undefined),
      deduct: vi.fn().mockResolvedValue(undefined),
      unfreeze: vi.fn().mockResolvedValue(undefined),
    };
    queue = {
      add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LightingService,
        { provide: PrismaService, useValue: prisma },
        { provide: TeamCreditService, useValue: credit },
        { provide: getQueueToken(AI_IMAGE_EDIT_QUEUE_NAME), useValue: queue },
      ],
    }).compile();

    service = module.get<LightingService>(LightingService);
  });

  describe('createTask', () => {
    it('should create a task and enqueue a job with taskType lighting', async () => {
      const result = await service.createTask(validDto, 'user-1');

      expect(result.taskId).toBe('task-1');
      expect(result.status).toBe('pending');
      expect(prisma.lightingTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          nodeId: 'node-1',
          projectId: 'proj-1',
          status: 'pending',
          params: validDto.params,
        }),
      });
      expect(queue.add).toHaveBeenCalledWith('lighting', expect.objectContaining({
        taskType: 'lighting',
        userId: 'user-1',
        nodeId: 'node-1',
        taskId: 'task-1',
      }));
    });

    it('should reject brightness out of range', async () => {
      const dto = { ...validDto, params: { ...validDto.params, brightness: 150 } };
      await expect(service.createTask(dto, 'user-1')).rejects.toThrow();
    });

    it('should reject colorTemperature out of range', async () => {
      const dto = { ...validDto, params: { ...validDto.params, colorTemperature: 500 } };
      await expect(service.createTask(dto, 'user-1')).rejects.toThrow();
    });

    it('should reject invalid position z (must be >= 2)', async () => {
      const dto = { ...validDto, params: { ...validDto.params, position: { x: 0, y: 0, z: 0 } } };
      await expect(service.createTask(dto, 'user-1')).rejects.toThrow();
    });

    it('should reject internal URLs (SSRF protection)', async () => {
      const dto = { ...validDto, originalImageUrl: 'http://127.0.0.1/admin' };
      await expect(service.createTask(dto, 'user-1')).rejects.toThrow();
    });

    it('should reject localhost URLs (SSRF protection)', async () => {
      const dto = { ...validDto, originalImageUrl: 'https://localhost:3000/file.jpg' };
      await expect(service.createTask(dto, 'user-1')).rejects.toThrow();
    });

    it('should return existing task for duplicate submission within 60s', async () => {
      prisma.lightingTask.findFirst = vi.fn().mockResolvedValue({
        id: 'existing-task',
        status: 'pending',
        params: validDto.params,
      });

      const result = await service.createTask(validDto, 'user-1');

      expect(result.taskId).toBe('existing-task');
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('幂等键深排序：params 嵌套键序不同仍命中幂等（stableStringify）', async () => {
      prisma.lightingTask.findFirst.mockResolvedValue({
        id: 'existing-task',
        status: 'pending',
        params: {
          colorTemperature: 5600,
          rimLight: false,
          brightness: 50,
          position: { z: 6, y: 0, x: 0 },
        },
      });

      const result = await service.createTask(validDto, 'user-1');

      expect(result.taskId).toBe('existing-task');
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('团队项目归属：task.teamId = project.teamId（非 getOwnerTeamId 反推）', async () => {
      prisma.canvasProject.findUnique.mockResolvedValue({ teamId: 't-team' });

      await service.createTask(validDto, 'user-1');

      expect(prisma.lightingTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ teamId: 't-team' }),
      });
      expect(prisma.team.findFirst).not.toHaveBeenCalled();
    });

    it('无 projectId（个人任务）→ 回落个人团队（getOwnerTeamId）', async () => {
      const dto = { ...validDto, projectId: undefined };

      await service.createTask(dto, 'user-1');

      expect(prisma.canvasProject.findUnique).not.toHaveBeenCalled();
      expect(prisma.team.findFirst).toHaveBeenCalledWith({
        where: { ownerId: 'user-1', isDefault: true },
        select: { id: true },
      });
      expect(prisma.lightingTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ teamId: 'team1' }),
      });
    });

    it('幂等查重按团队维度（teamId + nodeId）', async () => {
      prisma.canvasProject.findUnique.mockResolvedValue({ teamId: 't-team' });

      await service.createTask(validDto, 'user-1');

      expect(prisma.lightingTask.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ teamId: 't-team', nodeId: 'node-1' }),
        }),
      );
    });
  });

  describe('getTask', () => {
    it('should return task by id', async () => {
      prisma.lightingTask.findUnique = vi.fn().mockResolvedValue({
        id: 'task-1',
        userId: 'user-1',
        status: LightingTaskStatus.PENDING,
      });

      const result = await service.getTask('task-1', 'user-1');
      expect(result?.id).toBe('task-1');
    });

    it('should return null for non-existent task', async () => {
      prisma.lightingTask.findUnique = vi.fn().mockResolvedValue(null);
      const result = await service.getTask('nonexistent', 'user-1');
      expect(result).toBeNull();
    });

    it('团队成员可查他人任务（按 task.teamId 校验）', async () => {
      prisma.lightingTask.findUnique = vi.fn().mockResolvedValue({
        id: 'task-1',
        userId: 'owner-1',
        teamId: 't-team',
        status: LightingTaskStatus.PENDING,
      });
      prisma.teamMember.findFirst.mockResolvedValue({ role: 'MEMBER' });

      const result = await service.getTask('task-1', 'user-1');
      expect(result?.id).toBe('task-1');
      expect(prisma.teamMember.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ teamId: 't-team', userId: 'user-1' }),
        }),
      );
    });

    it('非团队成员 → 403', async () => {
      prisma.lightingTask.findUnique = vi.fn().mockResolvedValue({
        id: 'task-1',
        userId: 'owner-1',
        teamId: 't-team',
        status: LightingTaskStatus.PENDING,
      });
      prisma.teamMember.findFirst.mockResolvedValue(null);

      await expect(service.getTask('task-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });
  });
});
