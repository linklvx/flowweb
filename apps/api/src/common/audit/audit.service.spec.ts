import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      auditLog: {
        create: vi.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<AuditService>(AuditService);
  });

  describe('log', () => {
    it('should write audit log with all required fields', async () => {
      prisma.auditLog.create.mockResolvedValue({ id: 'log-1' });

      await service.log({
        operatorId: 'user-1',
        operatorName: 'Test User',
        targetType: 'subscription',
        targetId: 'sub-1',
        action: 'create',
        beforeValue: null,
        afterValue: { tier: 'pro' },
        remark: 'test remark',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      const call = prisma.auditLog.create.mock.calls[0][0];
      expect(call.data.operatorId).toBe('user-1');
      expect(call.data.operatorName).toBe('Test User');
      expect(call.data.targetType).toBe('subscription');
      expect(call.data.targetId).toBe('sub-1');
      expect(call.data.action).toBe('create');
      expect(call.data.beforeValue).toBeUndefined();
      expect(call.data.afterValue).toEqual({ tier: 'pro' });
      expect(call.data.remark).toBe('test remark');
    });

    it('should write audit log with minimal fields', async () => {
      prisma.auditLog.create.mockResolvedValue({ id: 'log-2' });

      await service.log({
        operatorId: 'admin-1',
        operatorName: 'Admin',
        targetType: 'point',
        targetId: 'bal-1',
        action: 'grant',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      const call = prisma.auditLog.create.mock.calls[0][0];
      expect(call.data.remark).toBeNull();
      expect(call.data.beforeValue).toBeUndefined();
      expect(call.data.afterValue).toBeUndefined();
    });

    it('should serialize complex before/after values as JSON', async () => {
      prisma.auditLog.create.mockResolvedValue({ id: 'log-3' });

      const beforeValue = { credits: 100, subscriptionCredits: 500 };
      const afterValue = { credits: 50, subscriptionCredits: 500 };

      await service.log({
        operatorId: 'u1',
        operatorName: 'User',
        targetType: 'point',
        targetId: 'bal-1',
        action: 'update',
        beforeValue,
        afterValue,
      });

      const call = prisma.auditLog.create.mock.calls[0][0];
      expect(call.data.beforeValue).toEqual(beforeValue);
      expect(call.data.afterValue).toEqual(afterValue);
    });

    it('log 带 teamId 写入', async () => {
      await service.log({
        operatorId: 'u1',
        operatorName: 'a',
        teamId: 't1',
        targetType: 'TEAM',
        targetId: 't1',
        action: 'create_team',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ teamId: 't1', action: 'create_team' }),
        }),
      );
    });

    it('log 不传 teamId 时写 null', async () => {
      await service.log({
        operatorId: 'u1',
        operatorName: 'a',
        targetType: 'TEAM',
        targetId: 't1',
        action: 'create_team',
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ teamId: null }),
        }),
      );
    });
  });

  describe('logTx', () => {
    it('logTx 在传入事务上写', async () => {
      const tx = { auditLog: { create: vi.fn() } };

      await service.logTx(tx as any, {
        operatorId: 'u1',
        operatorName: 'a',
        teamId: 't1',
        targetType: 'TEAM_MEMBER',
        targetId: 'u2',
        action: 'remove_member',
      });

      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ teamId: 't1', action: 'remove_member' }),
        }),
      );
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });
});
