import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { StorageQuotaService } from './storage-quota.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { TeamSubscriptionService } from './team-subscription.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('StorageQuotaService', () => {
  let service: StorageQuotaService;
  let prisma: any;
  let minio: any;

  beforeEach(async () => {
    prisma = {
      media: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { size: 100 } }),
        findUnique: vi.fn(),
        delete: vi.fn(),
      },
      teamMember: { findFirst: vi.fn() },
    };
    minio = { delete: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageQuotaService,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        { provide: TeamSubscriptionService, useValue: { getLimits: vi.fn().mockResolvedValue({ seatLimit: 20, storageLimitBytes: 600 }) } },
      ],
    }).compile();

    service = module.get<StorageQuotaService>(StorageQuotaService);
  });

  it('① getUsage：sum(completed 未软删)', async () => {
    expect(await service.getUsage('t1')).toBe(100);
    expect(prisma.media.aggregate).toHaveBeenCalledWith({
      _sum: { size: true },
      where: { teamId: 't1', status: 'completed', deletedAt: null },
    });
  });

  it('② presign：超限拒', async () => {
    await expect(service.assertCanUpload('t1', 550)).rejects.toThrow(BadRequestException);
  });

  it('② presign：未超限放行', async () => {
    await expect(service.assertCanUpload('t1', 400)).resolves.toBeUndefined();
  });

  it('③ confirm 二次校验（Q7）：超限删对象+删记录+抛错（事务断言顺序）', async () => {
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', teamId: 't1' });
    const order: string[] = [];
    minio.delete.mockImplementation(async () => { order.push('minio'); });
    prisma.media.delete.mockImplementation(async () => { order.push('media'); });

    await expect(service.assertOnConfirm('m1', 550, 'k1', 'flowai')).rejects.toThrow('存储空间不足');

    expect(minio.delete).toHaveBeenCalledWith('k1');
    expect(prisma.media.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
    expect(order).toEqual(['minio', 'media']);
  });

  it('③ confirm：未超限不动', async () => {
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', teamId: 't1' });
    await expect(service.assertOnConfirm('m1', 400, 'k1', 'flowai')).resolves.toBeUndefined();
    expect(minio.delete).not.toHaveBeenCalled();
  });

  it('④ 成员放行', async () => {
    prisma.teamMember.findFirst.mockResolvedValue({ role: 'MEMBER' });
    await expect(service.assertMember('t1', 'u1')).resolves.toBeUndefined();
    expect(prisma.teamMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ teamId: 't1', userId: 'u1' }) }),
    );
  });

  it('④ 非成员 403', async () => {
    prisma.teamMember.findFirst.mockResolvedValue(null);
    await expect(service.assertMember('t1', 'u1')).rejects.toThrow(ForbiddenException);
  });
});
