import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionBannerService } from './subscription-banner.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { getQueueToken } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../../config/queue.constants';
import { describe, it, expect, beforeEach, vi } from 'vitest';

function mockPrisma() {
  return {
    subscriptionBanner: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  };
}

function mockRedis() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    eval: vi.fn(),
  };
}

function mockAuditLog() {
  return { log: vi.fn() };
}

function mockCleanupQueue() {
  return { add: vi.fn() };
}

describe('SubscriptionBannerService', () => {
  let service: SubscriptionBannerService;
  let prisma: ReturnType<typeof mockPrisma>;
  let redis: ReturnType<typeof mockRedis>;
  let auditLog: ReturnType<typeof mockAuditLog>;
  let cleanupQueue: ReturnType<typeof mockCleanupQueue>;

  beforeEach(async () => {
    prisma = mockPrisma();
    redis = mockRedis();
    auditLog = mockAuditLog();
    cleanupQueue = mockCleanupQueue();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionBannerService,
        { provide: PrismaService, useValue: prisma },
        { provide: 'REDIS_CLIENT', useValue: redis },
        { provide: getQueueToken(QUEUE_NAMES.BANNER_CLEANUP), useValue: cleanupQueue },
        { provide: AuditService, useValue: auditLog },
      ],
    }).compile();

    service = module.get<SubscriptionBannerService>(SubscriptionBannerService);
  });

  // ============================================================
  // getPublicBanner
  // ============================================================
  describe('getPublicBanner', () => {
    it('should return null when no banner exists', async () => {
      redis.get.mockResolvedValue(null);
      prisma.subscriptionBanner.findFirst.mockResolvedValue(null);

      const result = await service.getPublicBanner();

      expect(redis.get).toHaveBeenCalledWith('flowweb:subscription:banner:public');
      expect(prisma.subscriptionBanner.findFirst).toHaveBeenCalled();
      expect(redis.set).toHaveBeenCalledWith(
        'flowweb:subscription:banner:public',
        'null',
        'EX',
        60,
      );
      expect(result).toBeNull();
    });

    it('should return null when banner is inactive', async () => {
      redis.get.mockResolvedValue(null);
      prisma.subscriptionBanner.findFirst.mockResolvedValue({
        id: 'subscription-banner-singleton',
        title: 'Test',
        subtitle: 'Test Sub',
        backgroundImageUrl: null,
        backgroundImageKey: null,
        countdownEndAt: null,
        autoExtend: false,
        isActive: false,
      });

      const result = await service.getPublicBanner();

      expect(redis.set).toHaveBeenCalledWith(
        'flowweb:subscription:banner:public',
        'null',
        'EX',
        60,
      );
      expect(result).toBeNull();
    });

    it('should return public fields only when active', async () => {
      const countdown = new Date('2026-12-31T23:59:59Z');
      redis.get.mockResolvedValue(null);
      prisma.subscriptionBanner.findFirst.mockResolvedValue({
        id: 'subscription-banner-singleton',
        title: 'VIP Sale',
        subtitle: 'Limited time offer',
        backgroundImageUrl: 'https://example.com/bg.jpg',
        backgroundImageKey: 'uploads/banner-bg.png',
        countdownEndAt: countdown,
        autoExtend: true,
        isActive: true,
      });

      const result = await service.getPublicBanner();

      // Should NOT leak internal fields
      expect(result).not.toBeNull();
      expect(result).toMatchObject({
        title: 'VIP Sale',
        subtitle: 'Limited time offer',
        backgroundImageUrl: 'https://example.com/bg.jpg',
        backgroundImageKey: 'uploads/banner-bg.png',
        countdownEndAt: countdown.toISOString(),
      });
      expect((result as any).autoExtend).toBeUndefined();
      expect((result as any).isActive).toBeUndefined();
      expect((result as any).id).toBeUndefined();

      expect(redis.set).toHaveBeenCalledWith(
        'flowweb:subscription:banner:public',
        JSON.stringify(result),
        'EX',
        60,
      );
    });

    it('should return cached data without hitting DB', async () => {
      const cached = {
        title: 'Cached Banner',
        subtitle: 'From cache',
        backgroundImageUrl: null,
        backgroundImageKey: null,
        countdownEndAt: '2026-12-31T23:59:59.000Z',
      };
      redis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.getPublicBanner();

      expect(prisma.subscriptionBanner.findFirst).not.toHaveBeenCalled();
      expect(result).toEqual(cached);
    });

    it('should return null when cache has null sentinel', async () => {
      redis.get.mockResolvedValue('null');

      const result = await service.getPublicBanner();

      expect(prisma.subscriptionBanner.findFirst).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  // ============================================================
  // autoExtend (triggered within getPublicBanner)
  // ============================================================
  describe('autoExtend', () => {
    it('should extend countdownEndAt by 3 days based on original time', async () => {
      const pastDate = new Date('2026-07-18T00:00:00Z');
      redis.get.mockResolvedValue(null);
      prisma.subscriptionBanner.findFirst.mockResolvedValue({
        id: 'subscription-banner-singleton',
        title: 'Flash Sale',
        subtitle: 'Ending soon',
        backgroundImageUrl: null,
        backgroundImageKey: null,
        countdownEndAt: pastDate,
        autoExtend: true,
        isActive: true,
      });
      // Lock acquired
      redis.set.mockResolvedValueOnce('OK');   // lock NX
      redis.del.mockResolvedValue(1);
      redis.eval.mockResolvedValue(1);
      prisma.subscriptionBanner.update.mockResolvedValue({});

      const result = await service.getPublicBanner();

      // Lock attempt
      expect(redis.set).toHaveBeenNthCalledWith(
        1,
        'flowweb:subscription:banner:auto-extend:lock',
        expect.any(String),
        'PX',
        1000,
        'NX',
      );
      // DB update: extend by 3 days from original
      expect(prisma.subscriptionBanner.update).toHaveBeenCalledWith({
        where: { id: 'subscription-banner-singleton' },
        data: {
          countdownEndAt: new Date(pastDate.getTime() + 3 * 86400000),
        },
      });
      // Lock released via Lua
      expect(redis.eval).toHaveBeenCalled();
      // Cache deleted
      expect(redis.del).toHaveBeenCalledWith('flowweb:subscription:banner:public');
    });

    it('should not extend when lock is held by another request', async () => {
      const pastDate = new Date('2026-07-18T00:00:00Z');
      redis.get.mockResolvedValue(null);
      prisma.subscriptionBanner.findFirst.mockResolvedValue({
        id: 'subscription-banner-singleton',
        title: 'Flash Sale',
        subtitle: 'Ending soon',
        backgroundImageUrl: null,
        backgroundImageKey: null,
        countdownEndAt: pastDate,
        autoExtend: true,
        isActive: true,
      });
      // Lock NOT acquired
      redis.set.mockResolvedValueOnce(null);  // cache get
      redis.set.mockResolvedValueOnce(null);  // lock NX (failed)

      const result = await service.getPublicBanner();

      expect(result).not.toBeNull();
      expect(prisma.subscriptionBanner.update).not.toHaveBeenCalled();
      expect(redis.eval).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // getAdminBanner
  // ============================================================
  describe('getAdminBanner', () => {
    it('should return full banner with internal fields', async () => {
      const record = {
        id: 'subscription-banner-singleton',
        title: 'Admin Banner',
        subtitle: 'All fields',
        backgroundImageUrl: 'https://example.com/bg.jpg',
        backgroundImageKey: 'uploads/bg.png',
        countdownEndAt: new Date('2026-12-31T23:59:59Z'),
        autoExtend: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.subscriptionBanner.findFirst.mockResolvedValue(record);

      const result = await service.getAdminBanner();

      expect(prisma.subscriptionBanner.findFirst).toHaveBeenCalled();
      expect(result).toEqual(record);
    });
  });

  // ============================================================
  // updateBanner
  // ============================================================
  describe('updateBanner', () => {
    it('should upsert and delete cache', async () => {
      const existing = {
        id: 'subscription-banner-singleton',
        title: 'Old',
        subtitle: 'Old Sub',
        backgroundImageKey: 'old-key',
        autoExtend: false,
        countdownEndAt: null,
        isActive: true,
      };
      prisma.subscriptionBanner.findFirst.mockResolvedValue(existing);
      prisma.subscriptionBanner.upsert.mockResolvedValue({
        ...existing,
        title: 'New',
        subtitle: 'New Sub',
      });

      const dto = { title: 'New', subtitle: 'New Sub' };
      const result = await service.updateBanner(dto, 'admin-1');

      expect(redis.del).toHaveBeenCalledWith('flowweb:subscription:banner:public');
      expect(prisma.subscriptionBanner.upsert).toHaveBeenCalledWith({
        where: { id: 'subscription-banner-singleton' },
        create: expect.objectContaining({ id: 'subscription-banner-singleton', title: 'New' }),
        update: { title: 'New', subtitle: 'New Sub' },
      });
      expect(auditLog.log).toHaveBeenCalled();
    });

    it('should throw if final state has autoExtend=true but no countdownEndAt', async () => {
      const existing = {
        id: 'subscription-banner-singleton',
        title: 'Old',
        subtitle: 'Old Sub',
        backgroundImageKey: null,
        autoExtend: false,
        countdownEndAt: null,
        isActive: true,
      };
      prisma.subscriptionBanner.findFirst.mockResolvedValue(existing);

      await expect(
        service.updateBanner({ autoExtend: true }),
      ).rejects.toThrow('autoExtend');
      expect(prisma.subscriptionBanner.upsert).not.toHaveBeenCalled();
    });

    it('should allow updating when final state is valid', async () => {
      const countdown = new Date('2026-12-31T23:59:59Z');
      const existing = {
        id: 'subscription-banner-singleton',
        title: 'Old',
        subtitle: 'Old Sub',
        backgroundImageKey: null,
        autoExtend: false,
        countdownEndAt: null,
        isActive: true,
      };
      prisma.subscriptionBanner.findFirst.mockResolvedValue(existing);
      prisma.subscriptionBanner.upsert.mockResolvedValue({
        ...existing,
        autoExtend: true,
        countdownEndAt: countdown,
      });

      await expect(
        service.updateBanner({ autoExtend: true, countdownEndAt: countdown.toISOString() }),
      ).resolves.toBeDefined();
      expect(prisma.subscriptionBanner.upsert).toHaveBeenCalled();
    });

    it('should enqueue old backgroundImageKey for cleanup when changed', async () => {
      const existing = {
        id: 'subscription-banner-singleton',
        title: 'Old',
        subtitle: 'Old Sub',
        backgroundImageKey: 'uploads/old-bg.png',
        autoExtend: false,
        countdownEndAt: null,
        isActive: true,
      };
      prisma.subscriptionBanner.findFirst.mockResolvedValue(existing);
      prisma.subscriptionBanner.upsert.mockResolvedValue({
        ...existing,
        backgroundImageKey: 'uploads/new-bg.png',
      });
      cleanupQueue.add.mockResolvedValue({ id: 'job-1' });

      await service.updateBanner({ backgroundImageKey: 'uploads/new-bg.png' }, 'admin-1');

      expect(cleanupQueue.add).toHaveBeenCalledWith(
        'cleanup-banner-image',
        { key: 'uploads/old-bg.png' },
      );
    });

    it('should not enqueue cleanup when backgroundImageKey unchanged', async () => {
      const existing = {
        id: 'subscription-banner-singleton',
        title: 'Old',
        subtitle: 'Old Sub',
        backgroundImageKey: 'uploads/bg.png',
        autoExtend: false,
        countdownEndAt: null,
        isActive: true,
      };
      prisma.subscriptionBanner.findFirst.mockResolvedValue(existing);
      prisma.subscriptionBanner.upsert.mockResolvedValue({ ...existing });

      await service.updateBanner({ title: 'New' }, 'admin-1');

      expect(cleanupQueue.add).not.toHaveBeenCalled();
    });
  });
});
