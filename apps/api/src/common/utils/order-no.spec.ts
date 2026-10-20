import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateOrderNo } from './order-no';

const PINNED_MS = 1_700_000_000_045;

describe('generateOrderNo', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should start with SUB prefix', () => {
    const orderNo = generateOrderNo();
    expect(orderNo.startsWith('SUB')).toBe(true);
  });

  it('should produce consistent format', () => {
    vi.spyOn(Date, 'now').mockReturnValue(PINNED_MS);
    const orderNo = generateOrderNo();
    // Format: SUB + UTC timestamp (13 digits) + 6 random digits
    // Total: SUB + 13 + 6 = 22 chars
    expect(orderNo.length).toBe(22);
    expect(orderNo).toMatch(/^SUB\d{19}$/);
    expect(orderNo.slice(3, 16)).toBe(String(PINNED_MS));
    expect(orderNo.slice(16)).toMatch(/^\d{6}$/);
  });

  it('should have incrementing timestamp portion', () => {
    const a = generateOrderNo();
    const b = generateOrderNo();
    const tsA = BigInt(a.slice(3, 16));
    const tsB = BigInt(b.slice(3, 16));
    expect(tsB).toBeGreaterThanOrEqual(tsA);
  });

  it('same ms + 100 distinct randoms yields 100 unique order numbers', () => {
    vi.spyOn(Date, 'now').mockReturnValue(PINNED_MS);
    let i = 0;
    // distinct floats ≥0.01 apart → 6-digit buckets ≥10^4 apart, no accidental floor collisions
    vi.spyOn(Math, 'random').mockImplementation(() => (i++) / 100);
    const results = new Set<string>();
    for (let n = 0; n < 100; n++) {
      results.add(generateOrderNo());
    }
    expect(results.size).toBe(100);
  });

  it('same ms + constant random collapses to 1 — uniqueness is NOT guaranteed here (SubscriptionOrder.orderNo @unique is the real guard)', () => {
    vi.spyOn(Date, 'now').mockReturnValue(PINNED_MS);
    vi.spyOn(Math, 'random').mockReturnValue(0.424242);
    const results = new Set<string>();
    for (let n = 0; n < 100; n++) {
      results.add(generateOrderNo());
    }
    expect(results.size).toBe(1);
  });

  it('same ms + narrowed random space (50 cycling values) yields exactly 50 — the collision shape the canary must catch', () => {
    vi.spyOn(Date, 'now').mockReturnValue(PINNED_MS);
    let i = 0;
    // 50 distinct floats (0.001 apart) cycling twice over 100 draws → every value hit exactly twice
    vi.spyOn(Math, 'random').mockImplementation(() => (i++ % 50) / 1000);
    const results = new Set<string>();
    for (let n = 0; n < 100; n++) {
      results.add(generateOrderNo());
    }
    expect(results.size).toBe(50);
  });

  it('should keep same-ms collisions within budget (birthday canary, P(≥3 pairs)≈2e-8)', () => {
    // Real Math.random, clock pinned to one millisecond: 100 draws in the 6-digit
    // (10^6) random space → expected colliding pairs ≈ 0.005; allow ≤2 (P(≥3)≈2e-8,
    // effectively never red). A constant random (size 1) or narrowed space
    // (e.g. 50 cycling values → size 50) still fails this bound — deterministic
    // coverage lives in the two tests above.
    vi.spyOn(Date, 'now').mockReturnValue(PINNED_MS);
    const results = new Set<string>();
    for (let n = 0; n < 100; n++) {
      results.add(generateOrderNo());
    }
    expect(results.size).toBeGreaterThanOrEqual(98);
  });
});
