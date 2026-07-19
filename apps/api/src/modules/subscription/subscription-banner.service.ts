import { Injectable, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { QUEUE_NAMES } from '../../config/queue.constants';
import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import * as crypto from 'crypto';

const CACHE_KEY = 'flowweb:subscription:banner:public';
const LOCK_KEY = 'flowweb:subscription:banner:auto-extend:lock';
const BANNER_ID = 'subscription-banner-singleton';

export interface UpdateBannerDto {
  title?: string;
  subtitle?: string;
  backgroundImageUrl?: string | null;
  backgroundImageKey?: string | null;
  countdownEndAt?: string | null;
  autoExtend?: boolean;
  isActive?: boolean;
}

export interface PublicBanner {
  title: string;
  subtitle: string;
  backgroundImageUrl: string | null;
  backgroundImageKey: string | null;
  countdownEndAt: string | null;
}

@Injectable()
export class SubscriptionBannerService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    @InjectQueue(QUEUE_NAMES.BANNER_CLEANUP) private readonly cleanupQueue: Queue,
    @Inject(AuditService) private readonly auditLog: AuditService,
  ) {}

  // ============================================================
  // getPublicBanner
  // ============================================================
  async getPublicBanner(): Promise<PublicBanner | null> {
    // Check cache
    const cached = await this.redis.get(CACHE_KEY);
    if (cached === 'null') return null;
    if (cached) return JSON.parse(cached) as PublicBanner;

    // Cache miss — query DB
    const record = await this.prisma.subscriptionBanner.findFirst();
    if (!record || !record.isActive) {
      await this.redis.set(CACHE_KEY, 'null', 'EX', 60);
      return null;
    }

    // Auto-extend if needed
    if (record.autoExtend && record.countdownEndAt && record.countdownEndAt < new Date()) {
      const newEndAt = await this.tryAutoExtend({ id: record.id, countdownEndAt: record.countdownEndAt });
      if (newEndAt) record.countdownEndAt = newEndAt;
    }

    const result: PublicBanner = {
      title: record.title,
      subtitle: record.subtitle,
      backgroundImageUrl: record.backgroundImageUrl ?? null,
      backgroundImageKey: record.backgroundImageKey ?? null,
      countdownEndAt: record.countdownEndAt?.toISOString() ?? null,
    };

    await this.redis.set(CACHE_KEY, JSON.stringify(result), 'EX', 60);
    return result;
  }

  // ============================================================
  // getAdminBanner
  // ============================================================
  async getAdminBanner() {
    return this.prisma.subscriptionBanner.findFirst();
  }

  // ============================================================
  // updateBanner
  // ============================================================
  async updateBanner(dto: UpdateBannerDto, operatorId?: string) {
    // Read existing record
    const existing = await this.prisma.subscriptionBanner.findFirst();

    // Merge for validation
    const merged = { ...(existing ?? {}), ...this.normalizeDto(dto) };
    if (merged.autoExtend === true && !merged.countdownEndAt) {
      throw new Error(
        'autoExtend cannot be enabled without countdownEndAt',
      );
    }

    // Upsert
    const updated = await this.prisma.subscriptionBanner.upsert({
      where: { id: BANNER_ID },
      create: {
        id: BANNER_ID,
        title: '',
        subtitle: '',
        ...this.normalizeDto(dto),
      },
      update: this.normalizeDto(dto),
    });

    // Delete cache
    await this.redis.del(CACHE_KEY);

    // Audit log (try/catch — must not block)
    try {
      await this.auditLog.log({
        operatorId: operatorId ?? 'anonymous',
        operatorName: operatorId ?? 'Anonymous',
        targetType: 'subscription_banner',
        targetId: BANNER_ID,
        action: existing ? 'update' : 'create',
        beforeValue: existing ? this.stripInternal(existing) as any : null,
        afterValue: this.stripInternal(updated) as any,
      });
    } catch {
      // ignore audit failure
    }

    // Enqueue old backgroundImageKey for cleanup if changed
    const oldKey = existing?.backgroundImageKey;
    const newKey = updated.backgroundImageKey;
    if (oldKey && oldKey !== newKey) {
      await this.cleanupQueue.add('cleanup-banner-image', { key: oldKey });
    }

    return updated;
  }

  // ============================================================
  // Private: auto-extend
  // ============================================================
  private async tryAutoExtend(record: {
    id: string;
    countdownEndAt: Date;
  }): Promise<Date | null> {
    const lockValue = crypto.randomUUID();
    const locked = await this.redis.set(LOCK_KEY, lockValue, 'PX', 1000, 'NX');

    if (locked !== 'OK') return null; // another process holds the lock

    try {
      const newEndAt = new Date(record.countdownEndAt.getTime() + 3 * 86400000);

      await this.prisma.subscriptionBanner.update({
        where: { id: record.id },
        data: { countdownEndAt: newEndAt },
      });

      // Audit log (try/catch — must not block)
      try {
        await this.auditLog.log({
          operatorId: 'system',
          operatorName: 'System',
          targetType: 'subscription_banner',
          targetId: record.id,
          action: 'auto_extend',
          beforeValue: { countdownEndAt: record.countdownEndAt.toISOString() },
          afterValue: { countdownEndAt: newEndAt.toISOString() },
        });
      } catch {
        // ignore audit failure
      }

      return newEndAt;
    } finally {
      // Release lock via Lua (only if we still hold it)
      await this.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        LOCK_KEY,
        lockValue,
      );
      // Delete cache to force refresh
      await this.redis.del(CACHE_KEY);
    }
  }

  // ============================================================
  // Private: helpers
  // ============================================================
  private normalizeDto(dto: UpdateBannerDto): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value === undefined) continue;
      if (key === 'countdownEndAt' && value !== null && typeof value === 'string') {
        result[key] = new Date(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private stripInternal(record: Record<string, unknown>): Record<string, unknown> {
    const { createdAt, updatedAt, ...rest } = record;
    return rest;
  }
}
