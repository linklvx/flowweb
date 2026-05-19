import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  REDIS_URL: z.string().default('redis://localhost:6379/0'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  MINIO_ENDPOINT: z.string().url(),
  MINIO_ACCESS_KEY: z.string().min(3),
  MINIO_SECRET_KEY: z.string().min(8),
  MINIO_BUCKET: z.string().default('flowai'),
  MINIO_USE_SSL: z.coerce.boolean().default(false),
});

describe('env schema - MinIO', () => {
  it('should validate complete MinIO env vars', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost:5432/db',
      MINIO_ENDPOINT: 'http://127.0.0.1:9000',
      MINIO_ACCESS_KEY: 'minioadmin',
      MINIO_SECRET_KEY: 'minioadmin123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MINIO_BUCKET).toBe('flowai');
      expect(result.data.MINIO_USE_SSL).toBe(false);
    }
  });

  it('should reject invalid MINIO_ENDPOINT', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost:5432/db',
      MINIO_ENDPOINT: 'not-a-url',
      MINIO_ACCESS_KEY: 'minioadmin',
      MINIO_SECRET_KEY: 'minioadmin123',
    });
    expect(result.success).toBe(false);
  });

  it('should reject short MINIO_SECRET_KEY', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost:5432/db',
      MINIO_ENDPOINT: 'http://127.0.0.1:9000',
      MINIO_ACCESS_KEY: 'minioadmin',
      MINIO_SECRET_KEY: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('should apply defaults for MINIO_BUCKET and MINIO_USE_SSL', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost:5432/db',
      MINIO_ENDPOINT: 'http://127.0.0.1:9000',
      MINIO_ACCESS_KEY: 'minioadmin',
      MINIO_SECRET_KEY: 'minioadmin123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MINIO_BUCKET).toBe('flowai');
      expect(result.data.MINIO_USE_SSL).toBe(false);
    }
  });
});
