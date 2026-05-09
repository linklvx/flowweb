import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateEnv } from './env';

describe('validateEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should validate correct environment variables', () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/db';
    process.env.PORT = '3000';
    const env = validateEnv();
    expect(env.DATABASE_URL).toBe('postgresql://localhost:5432/db');
    expect(env.PORT).toBe(3000);
  });

  it('should default PORT to 3000 when not set', () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/db';
    const env = validateEnv();
    expect(env.PORT).toBe(3000);
  });
});
