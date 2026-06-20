import { describe, it, expect } from 'vitest';
import { kelvinToRgb } from './kelvinToRgb';

describe('kelvinToRgb', () => {
  it('2000K should produce warm orange/red color (R dominant)', () => {
    const result = kelvinToRgb(2000);
    expect(result.r).toBeGreaterThan(result.b);
    expect(result.g).toBeGreaterThan(0);
    // Values should be in 0-1 range
    expect(result.r).toBeLessThanOrEqual(1);
    expect(result.g).toBeLessThanOrEqual(1);
    expect(result.b).toBeLessThanOrEqual(1);
    expect(result.r).toBeGreaterThanOrEqual(0);
    expect(result.g).toBeGreaterThanOrEqual(0);
    expect(result.b).toBeGreaterThanOrEqual(0);
  });

  it('5600K should produce near-white daylight (RGB balanced)', () => {
    const result = kelvinToRgb(5600);
    // At daylight temperature, R, G, B should be relatively balanced (all near 1)
    expect(result.r).toBeCloseTo(1, 0);
    expect(result.g).toBeCloseTo(1, 0);
    expect(result.b).toBeCloseTo(1, 0);
  });

  it('10000K should produce blue-white (B dominant)', () => {
    const result = kelvinToRgb(10000);
    // At high temperature, blue should be at or near max, and more than red
    expect(result.b).toBeGreaterThanOrEqual(result.r);
    expect(result.b).toBeCloseTo(1, 0);
  });

  it('values below 2000K should clamp to 2000K', () => {
    const result = kelvinToRgb(1500);
    const clamped = kelvinToRgb(2000);
    expect(result).toEqual(clamped);
  });

  it('values above 10000K should clamp to 10000K', () => {
    const result = kelvinToRgb(15000);
    const clamped = kelvinToRgb(10000);
    expect(result).toEqual(clamped);
  });

  it('output should be compatible with Three.js Color (RGB 0-1 range)', () => {
    for (const k of [2000, 3000, 4000, 5600, 6500, 8000, 10000]) {
      const result = kelvinToRgb(k);
      expect(result.r).toBeGreaterThanOrEqual(0);
      expect(result.r).toBeLessThanOrEqual(1);
      expect(result.g).toBeGreaterThanOrEqual(0);
      expect(result.g).toBeLessThanOrEqual(1);
      expect(result.b).toBeGreaterThanOrEqual(0);
      expect(result.b).toBeLessThanOrEqual(1);
    }
  });
});
