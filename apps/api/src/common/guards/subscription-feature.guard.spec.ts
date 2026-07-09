import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubscriptionFeatureGuard } from './subscription-feature.guard';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, HttpException } from '@nestjs/common';

describe('SubscriptionFeatureGuard', () => {
  let guard: SubscriptionFeatureGuard;
  let reflector: Reflector;

  const mockContext = (metadata: Record<string, unknown>) => {
    reflector.get = vi.fn((key: string) => metadata[key]);
    guard = new SubscriptionFeatureGuard(reflector);
    return {
      switchToHttp: () => ({
        getRequest: () => ({}),
      }),
      getHandler: () => ({}),
    } as ExecutionContext;
  };

  beforeEach(() => {
    reflector = { get: vi.fn() } as any;
  });

  describe('SUBSCRIPTION_ENABLED', () => {
    it('should allow when subscription is enabled', () => {
      process.env.SUBSCRIPTION_ENABLED = 'true';
      const ctx = mockContext({ feature: 'SUBSCRIPTION_ENABLED' });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('should return 403 when subscription is disabled', () => {
      process.env.SUBSCRIPTION_ENABLED = 'false';
      const ctx = mockContext({ feature: 'SUBSCRIPTION_ENABLED' });
      expect(() => guard.canActivate(ctx)).toThrow(HttpException);
      try { guard.canActivate(ctx); } catch (e: any) {
        expect(e.getStatus()).toBe(403);
        expect(e.message).toContain('订阅功能未开放');
      }
    });

    it('should allow by default when env var is not set', () => {
      delete process.env.SUBSCRIPTION_ENABLED;
      const ctx = mockContext({ feature: 'SUBSCRIPTION_ENABLED' });
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('SUBSCRIPTION_UPGRADE_ENABLED', () => {
    it('should return 403 when upgrade is disabled', () => {
      process.env.SUBSCRIPTION_UPGRADE_ENABLED = 'false';
      const ctx = mockContext({ feature: 'SUBSCRIPTION_UPGRADE_ENABLED' });
      expect(() => guard.canActivate(ctx)).toThrow(HttpException);
      try { guard.canActivate(ctx); } catch (e: any) {
        expect(e.getStatus()).toBe(403);
        expect(e.message).toContain('升级功能未开放');
      }
    });
  });

  describe('SUBSCRIPTION_ADMIN_GRANT_ENABLED', () => {
    it('should return 403 when admin grant is disabled', () => {
      process.env.SUBSCRIPTION_ADMIN_GRANT_ENABLED = 'false';
      const ctx = mockContext({ feature: 'SUBSCRIPTION_ADMIN_GRANT_ENABLED' });
      expect(() => guard.canActivate(ctx)).toThrow(HttpException);
      try { guard.canActivate(ctx); } catch (e: any) {
        expect(e.getStatus()).toBe(403);
        expect(e.message).toContain('积分发放功能未开放');
      }
    });
  });
});
