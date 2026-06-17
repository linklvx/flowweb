import { describe, it, expect } from 'vitest';
import { computeGridSizes, validateGridParams, scaleToMaxSize, isSubImageTooSmall } from './imageSplit';

describe('computeGridSizes', () => {
  it('returns equal sizes when total is divisible by count', () => {
    expect(computeGridSizes(1000, 2)).toEqual([500, 500]);
  });

  it('handles non-divisible: first N-1 floor, last absorbs remainder', () => {
    const result = computeGridSizes(100, 3);
    expect(result).toEqual([33, 33, 34]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('handles 10x10 image with 4x4 grid (edge case)', () => {
    const result = computeGridSizes(10, 4);
    expect(result.reduce((a, b) => a + b, 0)).toBe(10);
  });
});

describe('validateGridParams', () => {
  it('accepts valid grid params (2x2 to 5x5)', () => {
    expect(validateGridParams(2, 2)).toBe(true);
    expect(validateGridParams(3, 3)).toBe(true);
    expect(validateGridParams(5, 5)).toBe(true);
  });

  it('rejects rows < 2', () => {
    expect(validateGridParams(1, 3)).toBe(false);
    expect(validateGridParams(0, 3)).toBe(false);
  });

  it('rejects cols < 2', () => {
    expect(validateGridParams(3, 1)).toBe(false);
  });

  it('rejects rows > 5', () => {
    expect(validateGridParams(6, 3)).toBe(false);
  });

  it('rejects cols > 5', () => {
    expect(validateGridParams(3, 6)).toBe(false);
  });
});

describe('scaleToMaxSize', () => {
  it('scales down when long edge exceeds maxSize', () => {
    const result = scaleToMaxSize(8000, 4000, 4096);
    expect(result.width).toBe(4096);
    expect(result.height).toBe(2048);
  });

  it('preserves aspect ratio when scaling', () => {
    const result = scaleToMaxSize(6000, 3000, 4096);
    expect(result.width).toBe(4096);
    expect(result.height).toBe(2048);
  });

  it('returns original size when within limit', () => {
    const result = scaleToMaxSize(2000, 1000, 4096);
    expect(result.width).toBe(2000);
    expect(result.height).toBe(1000);
  });

  it('handles square image exactly at limit', () => {
    const result = scaleToMaxSize(4096, 4096, 4096);
    expect(result.width).toBe(4096);
    expect(result.height).toBe(4096);
  });

  it('handles portrait image exceeding limit', () => {
    const result = scaleToMaxSize(2000, 6000, 4096);
    expect(result.width).toBeLessThanOrEqual(4096);
    expect(result.height).toBeLessThanOrEqual(4096);
    expect(result.width / result.height).toBeCloseTo(2000 / 6000, 3);
  });
});

describe('isSubImageTooSmall', () => {
  it('returns false when sub-image long edge >= minSize', () => {
    expect(isSubImageTooSmall(100, 100, 2, 2, 10)).toBe(false);
  });

  it('returns true when sub-image long edge < minSize', () => {
    expect(isSubImageTooSmall(10, 10, 5, 5, 10)).toBe(true);
  });

  it('boundary: sub-image exactly 10px', () => {
    expect(isSubImageTooSmall(20, 20, 2, 2, 10)).toBe(false);
  });

  it('boundary: sub-image exactly 9px', () => {
    expect(isSubImageTooSmall(18, 18, 2, 2, 10)).toBe(true);
  });
});
