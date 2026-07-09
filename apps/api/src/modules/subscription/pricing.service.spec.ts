import { Test, TestingModule } from '@nestjs/testing';
import { PricingService } from './pricing.service';
import { describe, it, expect, beforeEach } from 'vitest';

describe('PricingService', () => {
  let service: PricingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PricingService],
    }).compile();
    service = module.get<PricingService>(PricingService);
  });

  const makeSub = (overrides: Record<string, unknown>) => ({
    id: 'sub-1', userId: 'u1', planId: 'p1', tier: 'pro', period: 'quarterly',
    status: 'active', paidAmount: 560, totalCredits: 59400, totalDays: 90,
    consumedCredits: 0, currentPeriodStart: new Date('2026-01-01'), currentPeriodEnd: new Date('2026-03-31'),
    ...overrides,
  });

  describe('calculate', () => {
    it('scenario 1: Pro quarterly → Max quarterly, 60d remaining, 70% credits remaining', () => {
      const now = new Date('2026-01-30');
      const sub = makeSub({ consumedCredits: 17820 }); // 70% remaining

      const result = service.calculate(sub as any, 'max', 'quarterly', 900, now);

      // 60d remaining (Jan 30 → Mar 31) / 90d total = 0.6667, credits 70%
      // finalRatio = min(0.6667, 0.70) = 0.6667
      expect(result.finalRatio).toBeCloseTo(0.6667, 3);
      expect(result.deductibleAmount).toBe(373); // floor(560 * 0.6667) = 373
      expect(result.payableAmount).toBe(527); // max(0, 900 - 373) = 527
    });

    it('scenario 2: credits exhausted, full price required', () => {
      const now = new Date('2026-03-28');
      const sub = makeSub({ consumedCredits: 59400, currentPeriodEnd: new Date('2026-03-31') });
      // 3 days remaining ≈ 3.3%, credits 0%

      const result = service.calculate(sub as any, 'max', 'quarterly', 900, now);

      expect(result.finalRatio).toBe(0);
      expect(result.deductibleAmount).toBe(0);
      expect(result.payableAmount).toBe(900);
    });

    it('scenario 3: deductible >= target price → free upgrade', () => {
      const now = new Date('2026-01-30');
      const sub = makeSub({ paidAmount: 1000 });

      const result = service.calculate(sub as any, 'max', 'monthly', 300, now);

      expect(result.deductibleAmount).toBeGreaterThanOrEqual(300);
      expect(result.payableAmount).toBe(0);
    });

    it('should reject downgrade (lower tier)', () => {
      const sub = makeSub({ tier: 'max' });

      expect(() => service.calculate(sub as any, 'pro', 'monthly', 200, new Date())).toThrow();
    });

    it('should reject same-tier period change', () => {
      const sub = makeSub({ tier: 'pro' });

      expect(() => service.calculate(sub as any, 'pro', 'annually', 2000, new Date())).toThrow();
    });

    it('should reject non-active subscription', () => {
      const sub = makeSub({ status: 'expired' });

      expect(() => service.calculate(sub as any, 'max', 'monthly', 300, new Date())).toThrow();
    });
  });
});
