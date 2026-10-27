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
      // Y1c T23（迁移三）：ACTIVE 预留面——默认零预留（T23 用例内覆写）
      storageReservation: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { upperBoundBytes: 0 } }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(prisma)),   // passthrough（tx=同 mock）
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

  it('Y1c T23：ACTIVE 预留计入 presign 硬门（Q7 两并发 presign 同过 oversale 收口）——usage+ΣACTIVE+incoming', async () => {
    prisma.storageReservation.aggregate.mockResolvedValue({ _sum: { upperBoundBytes: 150 } });
    // usage(100)+ACTIVE(150)+incoming(400)=650 > 600 ⇒ 拒（旧式 usage+incoming=500 会放行=oversale）
    await expect(service.assertCanUpload('t1', 400)).rejects.toThrow(BadRequestException);
    expect(prisma.storageReservation.aggregate).toHaveBeenCalledWith({
      _sum: { upperBoundBytes: true },
      where: { teamId: 't1', state: 'ACTIVE' },
    });
    // 预留回落 50：100+50+400=550 ≤ 600 放行
    prisma.storageReservation.aggregate.mockResolvedValue({ _sum: { upperBoundBytes: 50 } });
    await expect(service.assertCanUpload('t1', 400)).resolves.toBeUndefined();
  });

  it('Y1c T23：confirm 终判排除自身预留（actualSize 入账不双计）+拒档释放同事务', async () => {
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', teamId: 't1', key: 'uploads/u1/a.png' });
    prisma.storageReservation.aggregate.mockResolvedValue({ _sum: { upperBoundBytes: 999 } });   // 全部为他者？——排除自身后查询谓词见下
    await expect(service.assertOnConfirm('m1', 400)).rejects.toThrow('存储空间不足');
    // 自身预留排除（mediaId not m1）——自身字节经 actualSize 入账
    expect(prisma.storageReservation.aggregate).toHaveBeenCalledWith({
      _sum: { upperBoundBytes: true },
      where: { teamId: 't1', state: 'ACTIVE', mediaId: { not: 'm1' } },
    });
    // 拒档=行删+预留 RELEASED 同事务
    expect(prisma.storageReservation.updateMany).toHaveBeenCalledWith({
      where: { mediaId: 'm1', state: 'ACTIVE' },
      data: { state: 'RELEASED' },
    });
  });

  it('③ confirm 二次校验（Q7）：超限删对象+删记录+抛错（事务断言顺序）', async () => {
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', teamId: 't1', key: 'uploads/u1/a.png' }); // fixture 必须含 key——删的是行内 key（D1）
    const order: string[] = [];
    minio.delete.mockImplementation(async () => { order.push('minio'); });
    prisma.media.delete.mockImplementation(async () => { order.push('media'); });

    await expect(service.assertOnConfirm('m1', 550)).rejects.toThrow('存储空间不足'); // D1：删 key/bucket 形参，两参

    expect(minio.delete).toHaveBeenCalledWith('uploads/u1/a.png'); // 行内 key，非请求体
    expect(prisma.media.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
    expect(order).toEqual(['minio', 'media']);
  });

  it('③ confirm：未超限不动', async () => {
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', teamId: 't1', key: 'uploads/u1/a.png' });
    await expect(service.assertOnConfirm('m1', 400)).resolves.toBeUndefined();
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
