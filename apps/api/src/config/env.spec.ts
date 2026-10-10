import { describe, it, expect } from 'vitest';
import { envSchema, envSchemaValidated } from './env';

describe('env schema - SENTRY_DSN and PROMETHEUS_TOKEN', () => {
  it('should pass validation without SENTRY_DSN (optional)', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost:5432/db',
      MINIO_ENDPOINT: 'http://127.0.0.1:9000',
      MINIO_ACCESS_KEY: 'minioadmin',
      MINIO_SECRET_KEY: 'minioadmin123',
    });
    expect(result.success).toBe(true);
  });

  it('should accept valid SENTRY_DSN', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost:5432/db',
      MINIO_ENDPOINT: 'http://127.0.0.1:9000',
      MINIO_ACCESS_KEY: 'minioadmin',
      MINIO_SECRET_KEY: 'minioadmin123',
      SENTRY_DSN: 'https://abc123@ingest.sentry.io/456',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.SENTRY_DSN).toBe('https://abc123@ingest.sentry.io/456');
    }
  });

  it('should pass validation without PROMETHEUS_TOKEN (optional for local dev)', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost:5432/db',
      MINIO_ENDPOINT: 'http://127.0.0.1:9000',
      MINIO_ACCESS_KEY: 'minioadmin',
      MINIO_SECRET_KEY: 'minioadmin123',
    });
    expect(result.success).toBe(true);
  });

  it('should accept PROMETHEUS_TOKEN when configured', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost:5432/db',
      MINIO_ENDPOINT: 'http://127.0.0.1:9000',
      MINIO_ACCESS_KEY: 'minioadmin',
      MINIO_SECRET_KEY: 'minioadmin123',
      PROMETHEUS_TOKEN: 'secret-token-123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PROMETHEUS_TOKEN).toBe('secret-token-123');
    }
  });
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

// 本地 .env 27 键实证：MINIO_ENDPOINT/ACCESS_KEY/SECRET_KEY 必填（env.ts:8-10）——good 基线必含；
// ACCESS_KEY min(3)/SECRET_KEY min(8)（实测约束）——'k'/'s' 会令合法用例恒红=红相零鉴别力
const good = {
  DATABASE_URL: 'postgresql://x', REDIS_URL: 'redis://x',
  MINIO_ENDPOINT: 'http://localhost:9000', MINIO_ACCESS_KEY: 'minio-key', MINIO_SECRET_KEY: 'minio-secret-key',
};

describe('Y0a-4 env zod 收口：COLLAB_* 全族（P3 校验层不写默认+B13 空串=未设）', () => {
  it.each(['COLLAB_PORT','COLLAB_DEBOUNCE','COLLAB_TIMEOUT','COMPACT_INTERVAL_MS','COLLAB_LEASE_TTL_MS','COLLAB_LEASE_HEARTBEAT_MS','COLLAB_SPOOL_CAPACITY_BYTES'])('数值键 %s：正整数过/非数拒/负拒/空串=未设过', (k) => {
    expect(envSchema.safeParse({ ...good, [k]: '3001' }).success).toBe(true);
    expect(envSchema.safeParse({ ...good, [k]: 'abc' }).success).toBe(false);
    expect(envSchema.safeParse({ ...good, [k]: '-1' }).success).toBe(false);
    expect(envSchema.safeParse({ ...good, [k]: '' }).success).toBe(true);   // B13：空串档
  });

  it('COLLAB_MAX_LOADED_DOCS：≥0（0=预留默认档，非 positive）', () => {
    expect(envSchema.safeParse({ ...good, COLLAB_MAX_LOADED_DOCS: '0' }).success).toBe(true);
    expect(envSchema.safeParse({ ...good, COLLAB_MAX_LOADED_DOCS: '-1' }).success).toBe(false);
  });

  it('COLLAB_SPOOL_DIR/COLLAB_ADMIN_TOKEN：非空串过、空串=未设（BIND_ADDR 移 T4 不在此测）', () => {
    for (const k of ['COLLAB_SPOOL_DIR', 'COLLAB_ADMIN_TOKEN']) {
      expect(envSchema.safeParse({ ...good, [k]: '/var/x' }).success).toBe(true);
      expect(envSchema.safeParse({ ...good, [k]: '' }).success).toBe(true);
    }
  });

  it('MINIO_USE_SSL normalize 化：消灭反相且不新增启动失败面——任意串不过验、语义按 lowercase===true', () => {
    // normalize：消灭 Boolean('false')=true 反相（现状红相）且任何值形态不阻断启动（该键行为惰性）
    for (const v of ['false', 'False', 'TRUE', '1', 'yes', 'garbage']) {
      const r = envSchema.safeParse({ ...good, MINIO_USE_SSL: v });
      expect(r.success, v).toBe(true);   // normalize 不 reject——全部过验
      if (r.success) expect(r.data.MINIO_USE_SSL, v).toBe(v.trim().toLowerCase() === 'true');
    }
    expect(envSchema.safeParse({ ...good, MINIO_USE_SSL: 'true' }).data?.MINIO_USE_SSL).toBe(true);
  });

  it('COLLAB_SWEEP_ENABLED：仅 true|false；空串=未设', () => {
    expect(envSchema.safeParse({ ...good, COLLAB_SWEEP_ENABLED: 'true' }).success).toBe(true);
    expect(envSchema.safeParse({ ...good, COLLAB_SWEEP_ENABLED: 'flase' }).success).toBe(false);
    expect(envSchema.safeParse({ ...good, COLLAB_SWEEP_ENABLED: '' }).success).toBe(true);
  });
});

// Y0b-3 T1（§0.3 表十键）：zod 只验形态不写 default（默认值落使用点——防双源 P3 同款）；
// 消费 Task：T2 白名单/限速、T3 鉴权限流、T4 RSS 闸、T6 连接寿命。
describe('Y0b-3 T1：COLLAB 族新十键（形态校验——默认值落使用点不在此）', () => {
  it.each([
    'COLLAB_UPGRADE_RATE_PER_MIN', 'COLLAB_AUTH_ATTEMPTS_PER_MIN', 'COLLAB_AUTH_INFLIGHT_MAX',
    'COLLAB_REFUSAL_CACHE_TTL_MS', 'COLLAB_RSS_TRIP_BYTES', 'COLLAB_RSS_RELEASE_BYTES',
    'COLLAB_CONN_MAX_LIFETIME_MS',
  ])('int.positive 键 %s：正整数过/非数拒/0 拒/负拒/空串=未设过', (k) => {
    expect(envSchema.safeParse({ ...good, [k]: '60' }).success).toBe(true);
    expect(envSchema.safeParse({ ...good, [k]: 'abc' }).success).toBe(false);
    expect(envSchema.safeParse({ ...good, [k]: '0' }).success).toBe(false);
    expect(envSchema.safeParse({ ...good, [k]: '-1' }).success).toBe(false);
    expect(envSchema.safeParse({ ...good, [k]: '' }).success).toBe(true);   // B13：空串档
  });

  it('COLLAB_HEAP_PRESSURE_RATIO：0.5~0.95 过/0.3 拒/0.96 拒/非数拒/空串=未设过', () => {
    expect(envSchema.safeParse({ ...good, COLLAB_HEAP_PRESSURE_RATIO: '0.85' }).success).toBe(true);
    expect(envSchema.safeParse({ ...good, COLLAB_HEAP_PRESSURE_RATIO: '0.3' }).success).toBe(false);
    expect(envSchema.safeParse({ ...good, COLLAB_HEAP_PRESSURE_RATIO: '0.96' }).success).toBe(false);
    expect(envSchema.safeParse({ ...good, COLLAB_HEAP_PRESSURE_RATIO: 'abc' }).success).toBe(false);
    expect(envSchema.safeParse({ ...good, COLLAB_HEAP_PRESSURE_RATIO: '' }).success).toBe(true);
  });

  it('COLLAB_ALLOWED_ORIGINS：非空串过/空串=未设过', () => {
    expect(envSchema.safeParse({ ...good, COLLAB_ALLOWED_ORIGINS: 'https://a.example.com,https://b.example.com' }).success).toBe(true);
    expect(envSchema.safeParse({ ...good, COLLAB_ALLOWED_ORIGINS: '' }).success).toBe(true);
  });

  it("COLLAB_TRUSTED_PROXY：仅 '1' 过/'true' 拒/空串=未设过", () => {
    expect(envSchema.safeParse({ ...good, COLLAB_TRUSTED_PROXY: '1' }).success).toBe(true);
    expect(envSchema.safeParse({ ...good, COLLAB_TRUSTED_PROXY: 'true' }).success).toBe(false);
    expect(envSchema.safeParse({ ...good, COLLAB_TRUSTED_PROXY: '' }).success).toBe(true);
  });
});

// Y0b-3 T1（P-R）：生产 Origin 双缺 fail-fast——白名单推导源缺失=部署配置错误启动即拒。
describe('Y0b-3 T1（P-R）：生产 Origin 双缺 fail-fast（envSchemaValidated）', () => {
  it('production+BETTER_AUTH_URL 与 COLLAB_ALLOWED_ORIGINS 双缺 → 拒', () => {
    expect(envSchemaValidated.safeParse({ ...good, NODE_ENV: 'production' }).success).toBe(false);
  });
  it('production+任一在 → 过（BETTER_AUTH_URL 在/COLLAB_ALLOWED_ORIGINS 在）', () => {
    expect(envSchemaValidated.safeParse({ ...good, NODE_ENV: 'production', BETTER_AUTH_URL: 'https://x.example.com' }).success).toBe(true);
    expect(envSchemaValidated.safeParse({ ...good, NODE_ENV: 'production', COLLAB_ALLOWED_ORIGINS: 'https://y.example.com' }).success).toBe(true);
  });
  it('非 production 双缺不拒（dev 宽松——含 NODE_ENV 未设档）', () => {
    expect(envSchemaValidated.safeParse({ ...good, NODE_ENV: 'development' }).success).toBe(true);
    expect(envSchemaValidated.safeParse(good).success).toBe(true);
  });
});
