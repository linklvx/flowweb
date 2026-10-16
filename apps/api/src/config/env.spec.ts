import { describe, it, expect, vi } from 'vitest';
import {
  envSchema, envSchemaValidated, validateEnv, resolveSecureTransport,
  DB_CONNECTION_LIMIT, withConnectionLimit, applyDatabaseUrlConnectionLimit,
} from './env';

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
  // T36 密封（同偏离 56 形态）：production 档新增判据 COLLAB_TRUSTED_PROXY（Z14②）——既有判据
  // 用例显式满足新键，保持各用例鉴别力单指向原判定面
  it('production+BETTER_AUTH_URL 与 COLLAB_ALLOWED_ORIGINS 双缺 → 拒', () => {
    expect(envSchemaValidated.safeParse({ ...good, NODE_ENV: 'production', WORKER_WRITE_TOKEN: 'tok', COLLAB_TRUSTED_PROXY: '1' }).success).toBe(false);
  });
  it('production+任一在 → 过（BETTER_AUTH_URL 在/COLLAB_ALLOWED_ORIGINS 在）', () => {
    expect(envSchemaValidated.safeParse({ ...good, NODE_ENV: 'production', WORKER_WRITE_TOKEN: 'tok', COLLAB_TRUSTED_PROXY: '1', BETTER_AUTH_URL: 'https://x.example.com' }).success).toBe(true);
    expect(envSchemaValidated.safeParse({ ...good, NODE_ENV: 'production', WORKER_WRITE_TOKEN: 'tok', COLLAB_TRUSTED_PROXY: '1', COLLAB_ALLOWED_ORIGINS: 'https://y.example.com' }).success).toBe(true);
  });
  it('非 production 双缺不拒（dev 宽松）；NODE_ENV 未设档 T34 起退役——default production fail-closed（Z12）', () => {
    expect(envSchemaValidated.safeParse({ ...good, NODE_ENV: 'development' }).success).toBe(true);
    // T34 翻转（原断言 true）：未设 ⇒ default('production') ⇒ superRefine 生产分支 ⇒ 双缺拒
    expect(envSchemaValidated.safeParse(good).success).toBe(false);
  });
});

// Y0c T34（Z12+Z45②）：NODE_ENV 单源三件套——enum 三值封闭词表+default('production') fail-closed
// （Z12 显式裁定例外：与 T0「zod 不写 default」纪律相反是刻意的，仿 COLLAB_ROLE .default 先例）
// +validateEnv 成功后写回 process.env.NODE_ENV（Z45②：default 显式化到进程环境——否则 guard
// process.env 读与 env 读法两答案；写回后惰性读点〔guard canActivate/自定义 constraint/惰性函数〕
// 与 env.NODE_ENV 等价=「统一改读 env 单源」的写回等价形态）。
describe('Y0c T34：NODE_ENV enum 三值+default production（fail-closed）+validateEnv 写回（Z45②）', () => {
  it('非法值（staging）⇒ 拒（封闭词表——拼错档位不得静默回落）', () => {
    expect(envSchema.safeParse({ ...good, NODE_ENV: 'staging' }).success).toBe(false);
  });

  it('未设/空串 ⇒ production（default 显式化）；development/test/production 三值原样保持', () => {
    expect(envSchema.safeParse(good).data?.NODE_ENV).toBe('production');
    expect(envSchema.safeParse({ ...good, NODE_ENV: '' }).data?.NODE_ENV).toBe('production');   // B13 空串=未设
    for (const v of ['development', 'test', 'production'] as const) {
      expect(envSchema.safeParse({ ...good, NODE_ENV: v }).data?.NODE_ENV).toBe(v);
    }
  });

  // validateEnv 只测成功路径与写回（失败路径 process.exit(1)——safeParse 分支直测承担拒启面）；
  // vi.stubEnv+手动恢复（本文件首个 stubEnv 用例——Z45③ 形态）。
  // T35 密封（R6②+§0.6 偏离 56）：COLLAB_FAKE_AI/COLLAB_ROLE/COOKIE_SECURE 钉死——防外壳环境
  // 污染杀 vitest worker（production 档 superRefine 判据面：'1' 拒启/worker 缺 PROMETHEUS_TOKEN
  // 拒启/'false' 拒启均为真实外壳可现值）。
  it('validateEnv 成功写回：NODE_ENV 未设 ⇒ parse production+写回 process.env（拒启面由 BETTER_AUTH_URL/WORKER_WRITE_TOKEN/COLLAB_TRUSTED_PROXY 满足）', () => {
    vi.stubEnv('NODE_ENV', '');
    vi.stubEnv('DATABASE_URL', 'postgresql://x');
    vi.stubEnv('MINIO_ENDPOINT', 'http://localhost:9000');
    vi.stubEnv('MINIO_ACCESS_KEY', 'minio-key');
    vi.stubEnv('MINIO_SECRET_KEY', 'minio-secret-key');
    vi.stubEnv('BETTER_AUTH_URL', 'https://x.example.com');
    vi.stubEnv('WORKER_WRITE_TOKEN', 'tok');
    vi.stubEnv('COLLAB_TRUSTED_PROXY', '1');   // T36 密封（Z14②判据面——外壳未设即 production 档拒启误杀）
    vi.stubEnv('COLLAB_FAKE_AI', '');
    vi.stubEnv('COLLAB_ROLE', 'api');
    vi.stubEnv('COOKIE_SECURE', '');
    try {
      const env = validateEnv();
      expect(env.NODE_ENV).toBe('production');
      expect(process.env.NODE_ENV, '写回档（实现前红：validateEnv 无写回，process.env 停留空串）').toBe('production');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('validateEnv development 保持档：写回同值（guard dev fail-open 判据与 env 读法一致）', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DATABASE_URL', 'postgresql://x');
    vi.stubEnv('MINIO_ENDPOINT', 'http://localhost:9000');
    vi.stubEnv('MINIO_ACCESS_KEY', 'minio-key');
    vi.stubEnv('MINIO_SECRET_KEY', 'minio-secret-key');
    vi.stubEnv('COLLAB_FAKE_AI', '');   // T35 密封（R6②）：dev 档 superRefine 早退本无需——对称密封防未来判据面扩张
    vi.stubEnv('COLLAB_ROLE', 'api');
    try {
      const env = validateEnv();
      expect(env.NODE_ENV).toBe('development');
      expect(process.env.NODE_ENV).toBe('development');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// Y0c T29（Z116/Z134）：worker 指标出口 3002——WORKER_METRICS_PORT 形态校验（zod 不写 default，
// 默认值 3002 落使用点=worker-metrics-server.ts 常量单源）+production∧worker∧PROMETHEUS_TOKEN
// 未设拒启（3002 fail-closed 主防线——/metrics 同 token 同语义；api role 启动语义不变）。
describe('Y0c T29：WORKER_METRICS_PORT 形态 + production∧worker 未设 PROMETHEUS_TOKEN ⇒ 拒启', () => {
  it('WORKER_METRICS_PORT：1..65535 整数过/非数拒/0 拒/65536 拒/空串=未设过', () => {
    expect(envSchema.safeParse({ ...good, WORKER_METRICS_PORT: '3002' }).success).toBe(true);
    expect(envSchema.safeParse({ ...good, WORKER_METRICS_PORT: '1' }).success).toBe(true);
    expect(envSchema.safeParse({ ...good, WORKER_METRICS_PORT: '65535' }).success).toBe(true);
    expect(envSchema.safeParse({ ...good, WORKER_METRICS_PORT: 'abc' }).success).toBe(false);
    expect(envSchema.safeParse({ ...good, WORKER_METRICS_PORT: '0' }).success).toBe(false);
    expect(envSchema.safeParse({ ...good, WORKER_METRICS_PORT: '65536' }).success).toBe(false);
    expect(envSchema.safeParse({ ...good, WORKER_METRICS_PORT: '' }).success).toBe(true);   // B13：空串档
  });

  it('production ∧ COLLAB_ROLE=worker ∧ PROMETHEUS_TOKEN 未设 → 拒（issue 点名 PROMETHEUS_TOKEN）', () => {
    const r = envSchemaValidated.safeParse({ ...good, NODE_ENV: 'production', BETTER_AUTH_URL: 'https://x.example.com', WORKER_WRITE_TOKEN: 'tok', COLLAB_TRUSTED_PROXY: '1', COLLAB_ROLE: 'worker' });
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toContain('PROMETHEUS_TOKEN');
  });

  it('production ∧ worker ∧ 已设 → 过；production ∧ api（默认）未设不拒（api 侧维持请求级 403 现状）；dev worker 未设不拒', () => {
    // T36 密封：production 档显式 COLLAB_TRUSTED_PROXY:'1'（Z14②判据面——保持用例鉴别力单指向 PROMETHEUS_TOKEN）
    expect(envSchemaValidated.safeParse({ ...good, NODE_ENV: 'production', BETTER_AUTH_URL: 'https://x.example.com', WORKER_WRITE_TOKEN: 'tok', COLLAB_TRUSTED_PROXY: '1', COLLAB_ROLE: 'worker', PROMETHEUS_TOKEN: 'ptok' }).success).toBe(true);
    expect(envSchemaValidated.safeParse({ ...good, NODE_ENV: 'production', BETTER_AUTH_URL: 'https://x.example.com', WORKER_WRITE_TOKEN: 'tok', COLLAB_TRUSTED_PROXY: '1' }).success).toBe(true);
    expect(envSchemaValidated.safeParse({ ...good, NODE_ENV: 'development', COLLAB_ROLE: 'worker' }).success).toBe(true);
  });
});

// Y0c T27：production 未设 WORKER_WRITE_TOKEN ⇒ 拒启（plan T27 字面——非 guard 403）。api/worker
// 双进程同经 validateEnv（main.ts/main-worker.ts）——读端点（T26）+写端点（T27）两端点同批统一
// 收口为同款拒启；dev 维持 fail-open（WorkerWriteAuthGuard 请求级 403 为纵深冗余非主防线）。
describe('Y0c T27：production 未设 WORKER_WRITE_TOKEN ⇒ 拒启（envSchemaValidated superRefine）', () => {
  // T36 密封：production 档显式 COLLAB_TRUSTED_PROXY:'1'（Z14②判据面——保持用例鉴别力单指向 WORKER_WRITE_TOKEN）
  it('production 未设 → 拒（issue 点名 WORKER_WRITE_TOKEN）', () => {
    const r = envSchemaValidated.safeParse({ ...good, NODE_ENV: 'production', BETTER_AUTH_URL: 'https://x.example.com', COLLAB_TRUSTED_PROXY: '1' });
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toContain('WORKER_WRITE_TOKEN');
  });
  it('production 已设 → 过；dev 未设不拒（fail-open 归 guard）', () => {
    expect(envSchemaValidated.safeParse({ ...good, NODE_ENV: 'production', BETTER_AUTH_URL: 'https://x.example.com', WORKER_WRITE_TOKEN: 'tok', COLLAB_TRUSTED_PROXY: '1' }).success).toBe(true);
    expect(envSchemaValidated.safeParse({ ...good, NODE_ENV: 'development' }).success).toBe(true);
  });
});

// Y0c T34（Z45/RC5）：COLLAB_FAKE_AI 注册进 schema+production∧'1' ⇒ 拒启——fake 外呼豁免档的
// 启动期 fail-closed 提级。与 Z93 关系：Z93 删的是运行期守卫（fake 与 NODE_ENV 解耦，主线=缺密钥
// 拒启）；本条是 env 校验层拒启（Y0b spec 对象6「NODE_ENV==='production' 拒 '1'」收口递延至 T34）。
describe('Y0c T34：COLLAB_FAKE_AI ∧ production ⇒ 拒启（envSchemaValidated superRefine）', () => {
  const prodBase = { ...good, NODE_ENV: 'production', BETTER_AUTH_URL: 'https://x.example.com', WORKER_WRITE_TOKEN: 'tok', COLLAB_TRUSTED_PROXY: '1' };   // T36 密封（Z14②判据面）

  it("production ∧ COLLAB_FAKE_AI='1' → 拒（issue 点名 COLLAB_FAKE_AI）", () => {
    const r = envSchemaValidated.safeParse({ ...prodBase, COLLAB_FAKE_AI: '1' });
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toContain('COLLAB_FAKE_AI');
  });

  it("production ∧ 未设/空串 → 过；development/test ∧ '1' → 过（gate/CI 豁免档——Z45④ NODE_ENV 显式注入配套）", () => {
    expect(envSchemaValidated.safeParse(prodBase).success).toBe(true);
    expect(envSchemaValidated.safeParse({ ...prodBase, COLLAB_FAKE_AI: '' }).success).toBe(true);
    expect(envSchemaValidated.safeParse({ ...good, NODE_ENV: 'development', COLLAB_FAKE_AI: '1' }).success).toBe(true);
    expect(envSchemaValidated.safeParse({ ...good, NODE_ENV: 'test', COLLAB_FAKE_AI: '1' }).success).toBe(true);
  });

  it('形态面：任意串过验（语义=仅 \'1\' 生效——\'0\'/杂值无害不拒，不新增启动失败面）', () => {
    expect(envSchema.safeParse({ ...good, COLLAB_FAKE_AI: '0' }).success).toBe(true);
    expect(envSchema.safeParse({ ...good, COLLAB_FAKE_AI: 'garbage' }).success).toBe(true);
  });
});

// Y0c T35（Z13+Z45⑤）：COOKIE_SECURE 显式三态（禁推导）——resolver 单点函数（显式优先→未设按
// 档位兜底，production 恒 true）+production∧explicit 'false' ⇒ superRefine 拒启（fail-closed：
// cookie secure 是传输通道属性非运行档位属性）。三档先红后绿验收（spec §8 判据表）。
describe('Y0c T35：resolveSecureTransport() 单点三态（显式优先→档位兜底）', () => {
  // 六档直测（R2）+空串=未设（B13）；惰性读=每 stub 后立即求值（Z45② 写回等价形态）
  const cases: Array<[nodeEnv: string, cookieSecure: string, want: boolean, note: string]> = [
    ['development', 'true', true, '本地 HTTPS 唯一出路：dev+显式 true ⇒ cookie 仍 Secure'],
    ['development', '', false, 'dev 未设（空串=未设 B13）⇒ 档位兜底 false'],
    ['development', 'false', false, 'dev+显式 false ⇒ false（http 本地档合法）'],
    ['production', '', true, 'production 未设 ⇒ 恒 true（档位兜底 fail-closed 方向）'],
    ['test', '', false, 'test 档同 development 逻辑：未设 ⇒ false'],
    ['test', 'true', true, 'test+显式 true ⇒ true（enum 三档同则）'],
  ];
  it.each(cases)('NODE_ENV=%s COOKIE_SECURE=%j ⇒ %s（%s）', (nodeEnv, cookieSecure, want) => {
    vi.stubEnv('NODE_ENV', nodeEnv);
    vi.stubEnv('COOKIE_SECURE', cookieSecure);
    try {
      expect(resolveSecureTransport()).toBe(want);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('Y0c T35：COOKIE_SECURE schema 形态 + production∧explicit false ⇒ 拒启（envSchemaValidated）', () => {
  const prodBase = { ...good, NODE_ENV: 'production', BETTER_AUTH_URL: 'https://x.example.com', WORKER_WRITE_TOKEN: 'tok', COLLAB_TRUSTED_PROXY: '1' };   // T36 密封（Z14②判据面）

  it("形态：仅 'true'|'false' 过（enum 封闭）/'garbage' 拒/'1' 拒/空串=未设过（B13）", () => {
    expect(envSchema.safeParse({ ...good, COOKIE_SECURE: 'true' }).success).toBe(true);
    expect(envSchema.safeParse({ ...good, COOKIE_SECURE: 'false' }).success).toBe(true);
    expect(envSchema.safeParse({ ...good, COOKIE_SECURE: 'garbage' }).success, '实现前红：键未注册⇒zod strip 未知键恒过').toBe(false);
    expect(envSchema.safeParse({ ...good, COOKIE_SECURE: '1' }).success).toBe(false);
    expect(envSchema.safeParse({ ...good, COOKIE_SECURE: '' }).success).toBe(true);
  });

  it("production ∧ COOKIE_SECURE='false' → 拒（issue 点名 COOKIE_SECURE——显式降级禁）", () => {
    const r = envSchemaValidated.safeParse({ ...prodBase, COOKIE_SECURE: 'false' });
    expect(r.success, '实现前红：superRefine 无本判据⇒恒过').toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toContain('COOKIE_SECURE');
  });

  it("production ∧ 'true'/未设/空串 → 过；development/test ∧ 'false' 不拒（显式 false 仅 production 档非法）", () => {
    expect(envSchemaValidated.safeParse({ ...prodBase, COOKIE_SECURE: 'true' }).success).toBe(true);
    expect(envSchemaValidated.safeParse(prodBase).success).toBe(true);
    expect(envSchemaValidated.safeParse({ ...prodBase, COOKIE_SECURE: '' }).success).toBe(true);
    expect(envSchemaValidated.safeParse({ ...good, NODE_ENV: 'development', COOKIE_SECURE: 'false' }).success).toBe(true);
    expect(envSchemaValidated.safeParse({ ...good, NODE_ENV: 'test', COOKIE_SECURE: 'false' }).success).toBe(true);
  });
});

// Y0c T36（Z14②）：COLLAB_TRUSTED_PROXY production 未设 ⇒ 拒启——WS 升级限流键双门（gateway
// clientIpOf：loopback peer ∧ trusted）未设即 X-Real-IP 静默不采信=全站单限流桶退化共享且零探针。
// 服务器 .env 已设=1（勘察事实）——本判据是防回归门非新部署义务；dev/test 未设不拒（fail-open 现状维持）。
describe('Y0c T36：production 未设 COLLAB_TRUSTED_PROXY ⇒ 拒启（envSchemaValidated superRefine 第 6 条）', () => {
  const prodBase = { ...good, NODE_ENV: 'production', BETTER_AUTH_URL: 'https://x.example.com', WORKER_WRITE_TOKEN: 'tok', COLLAB_TRUSTED_PROXY: '1' };

  it('production ∧ 未设/空串 → 拒（issue 点名 COLLAB_TRUSTED_PROXY）', () => {
    const r = envSchemaValidated.safeParse({ ...good, NODE_ENV: 'production', BETTER_AUTH_URL: 'https://x.example.com', WORKER_WRITE_TOKEN: 'tok' });
    expect(r.success, '实现前红：superRefine 无本判据⇒恒过').toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toContain('COLLAB_TRUSTED_PROXY');
    expect(envSchemaValidated.safeParse({ ...prodBase, COLLAB_TRUSTED_PROXY: '' }).success).toBe(false);   // B13 空串=未设同拒
  });

  it("production ∧ '1' → 过；development/test 未设不拒（enum(['1']) 形态面 T1 既有——'true' 拒不变）", () => {
    expect(envSchemaValidated.safeParse(prodBase).success).toBe(true);
    expect(envSchemaValidated.safeParse({ ...good, NODE_ENV: 'development' }).success).toBe(true);
    expect(envSchemaValidated.safeParse({ ...good, NODE_ENV: 'test' }).success).toBe(true);
  });
});

// Y0c T36（Z14①+③）：API_BIND_ADDR/RATE_LIMIT_IP_WHITELIST 进 schema——zod 只验形态不写 default
// （默认值落使用点：main.ts listen '127.0.0.1'/rate-limiter ipWhitelist() '127.0.0.1,::1'——防双源 P3）。
describe('Y0c T36：API_BIND_ADDR + RATE_LIMIT_IP_WHITELIST 进 schema（形态校验）', () => {
  it('API_BIND_ADDR：设值原样保持/空串=未设过/未设过，且禁 zod default（默认 127.0.0.1 落 main.ts 使用点）', () => {
    const r = envSchema.safeParse({ ...good, API_BIND_ADDR: '127.0.0.1' });
    expect((r.data as Record<string, unknown> | undefined)?.['API_BIND_ADDR'], '实现前红：键未注册⇒zod strip 未知键⇒undefined').toBe('127.0.0.1');
    expect(envSchema.safeParse({ ...good, API_BIND_ADDR: '' }).success).toBe(true);
    expect(envSchema.safeParse(good).success).toBe(true);
    // 功能面钉死（T37 R6④）：preprocess 包 ZodEffects——下方 _def.typeName 断言抓不到 preprocess 内藏 default
    expect((envSchema.safeParse(good).data as Record<string, unknown> | undefined)?.['API_BIND_ADDR'], '缺键 parse ⇒ undefined（内藏 default 即红）').toBeUndefined();
    const f = (envSchema.shape as Record<string, any>)['API_BIND_ADDR'];
    expect(f, '实现前红：键未注册⇒shape 无此项').toBeTruthy();
    expect(f._def.typeName, '禁 zod .default（双源 P3——默认值唯一落 main.ts 使用点）').not.toBe('ZodDefault');
  });

  it('RATE_LIMIT_IP_WHITELIST：逗号分隔串原样保持/空串=未设过，且禁 zod default（默认值唯一落 ipWhitelist() 使用点——T34 惰性读形态保留）', () => {
    const r = envSchema.safeParse({ ...good, RATE_LIMIT_IP_WHITELIST: '127.0.0.1,::1,10.0.0.0/8' });
    expect((r.data as Record<string, unknown> | undefined)?.['RATE_LIMIT_IP_WHITELIST'], '实现前红：键未注册⇒strip⇒undefined').toBe('127.0.0.1,::1,10.0.0.0/8');
    expect(envSchema.safeParse({ ...good, RATE_LIMIT_IP_WHITELIST: '' }).success).toBe(true);
    // 功能面钉死（T37 R6④）：同 API_BIND_ADDR——preprocess 内藏 default 由缺键 parse 值面捕获
    expect((envSchema.safeParse(good).data as Record<string, unknown> | undefined)?.['RATE_LIMIT_IP_WHITELIST'], '缺键 parse ⇒ undefined（内藏 default 即红）').toBeUndefined();
    const f = (envSchema.shape as Record<string, any>)['RATE_LIMIT_IP_WHITELIST'];
    expect(f, '实现前红：键未注册').toBeTruthy();
    expect(f?._def?.typeName).not.toBe('ZodDefault');
  });
});

// Y0c T32（Z11/RC1——§0.6 偏离 47）：DATABASE_URL connection_limit 显式预算=env.ts 单源 role 重写。
// 调用位=main.ts/main-worker.ts 引导层 dotenv config() 后立即（authPrisma 顶层自建/preload 客户端均
// 先于 validateEnv——解析后重写无效，时序实证见偏离 47）；重写发生在 process.env 层，zod schema 零改动。
describe('Y0c T32：connection_limit role 重写（Z11 显式预算替代继承默认 CPU×2+1）', () => {
  const BASE = 'postgresql://flowweb:pw@127.0.0.1:5432/flowweb';

  it('DB_CONNECTION_LIMIT 单源常量：api=8/worker=4/all=8（all 从 api 预算=降级瞬态）', () => {
    expect(DB_CONNECTION_LIMIT).toEqual({ api: 8, worker: 4, all: 8 });
  });

  it('三 role 各自追加 connection_limit（api⇒8/worker⇒4/all⇒8）', () => {
    expect(new URL(withConnectionLimit(BASE, 'api')).searchParams.get('connection_limit')).toBe('8');
    expect(new URL(withConnectionLimit(BASE, 'worker')).searchParams.get('connection_limit')).toBe('4');
    expect(new URL(withConnectionLimit(BASE, 'all')).searchParams.get('connection_limit')).toBe('8');
  });

  it('已有 connection_limit ⇒ 幂等替换非重复追加', () => {
    const out = withConnectionLimit(`${BASE}?connection_limit=20`, 'worker');
    expect(new URL(out).searchParams.getAll('connection_limit')).toEqual(['4']);
  });

  it('URL 其他查询参数与连接要素保留', () => {
    const u = new URL(withConnectionLimit(`${BASE}?schema=public&pool_timeout=15`, 'api'));
    expect(u.searchParams.get('schema')).toBe('public');
    expect(u.searchParams.get('pool_timeout')).toBe('15');
    expect(u.username).toBe('flowweb');
    expect(u.password).toBe('pw');
    expect(u.host).toBe('127.0.0.1:5432');
    expect(u.pathname).toBe('/flowweb');
  });

  // applyDatabaseUrlConnectionLimit：process.env 整对象传递（census ㉒ 无按键裸读——单源入口同形态）
  describe('applyDatabaseUrlConnectionLimit（引导层调用位——role 读 env.COLLAB_ROLE）', () => {
    it('COLLAB_ROLE 未设/空串/非法值 ⇒ 默认 api=8（COLLAB_ROLE_DEFAULT 单源；非法值拒启归 validateEnv zod）', () => {
      for (const role of [undefined, '', 'bogus']) {
        const env: Record<string, string | undefined> = { DATABASE_URL: BASE, COLLAB_ROLE: role };
        applyDatabaseUrlConnectionLimit(env as NodeJS.ProcessEnv);
        expect(new URL(env.DATABASE_URL as string).searchParams.get('connection_limit'), `role=${JSON.stringify(role)}`).toBe('8');
      }
    });

    it('COLLAB_ROLE=worker⇒4 / all⇒8（三 role 全档）', () => {
      for (const [role, limit] of [['worker', '4'], ['all', '8'], ['api', '8']] as const) {
        const env: Record<string, string> = { DATABASE_URL: BASE, COLLAB_ROLE: role };
        applyDatabaseUrlConnectionLimit(env as NodeJS.ProcessEnv);
        expect(new URL(env.DATABASE_URL).searchParams.get('connection_limit')).toBe(limit);
      }
    });

    it('重复调用幂等（引导层与任何重入面同值收敛）', () => {
      const env: Record<string, string> = { DATABASE_URL: BASE, COLLAB_ROLE: 'worker' };
      applyDatabaseUrlConnectionLimit(env as NodeJS.ProcessEnv);
      const once = env.DATABASE_URL;
      applyDatabaseUrlConnectionLimit(env as NodeJS.ProcessEnv);
      expect(env.DATABASE_URL).toBe(once);
    });

    it('DATABASE_URL 缺失 ⇒ no-op 不抛（缺失=zod 拒启唯一失败面，不新增）', () => {
      const env: Record<string, string> = {};
      expect(() => applyDatabaseUrlConnectionLimit(env as NodeJS.ProcessEnv)).not.toThrow();
      expect(env.DATABASE_URL).toBeUndefined();
    });

    it('DATABASE_URL 非法 URL ⇒ 原样保留不抛（z.string().url() 拒启是唯一失败面）', () => {
      const env: Record<string, string> = { DATABASE_URL: 'not-a-url' };
      expect(() => applyDatabaseUrlConnectionLimit(env as NodeJS.ProcessEnv)).not.toThrow();
      expect(env.DATABASE_URL).toBe('not-a-url');
    });
  });
});
