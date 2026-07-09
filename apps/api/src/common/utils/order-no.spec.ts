import { describe, it, expect } from 'vitest';
import { generateOrderNo } from './order-no';

describe('generateOrderNo', () => {
  it('should start with SUB prefix', () => {
    const orderNo = generateOrderNo();
    expect(orderNo.startsWith('SUB')).toBe(true);
  });

  it('should be unique across rapid calls', () => {
    const results = new Set<string>();
    for (let i = 0; i < 100; i++) {
      results.add(generateOrderNo());
    }
    expect(results.size).toBe(100);
  });

  it('should produce consistent format', () => {
    const orderNo = generateOrderNo();
    // Format: SUB + UTC timestamp (13 digits) + 6 random digits
    // Total: SUB + 13 + 6 = 22 chars
    expect(orderNo.length).toBe(22);
    expect(orderNo.slice(3)).toMatch(/^\d{19}$/);
  });

  it('should have incrementing timestamp portion', () => {
    const a = generateOrderNo();
    const b = generateOrderNo();
    const tsA = BigInt(a.slice(3, 16));
    const tsB = BigInt(b.slice(3, 16));
    expect(tsB).toBeGreaterThanOrEqual(tsA);
  });
});
