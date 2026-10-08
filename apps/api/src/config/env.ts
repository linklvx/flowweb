import { z } from 'zod';

// B13：空串=未设（dotenv/shell 清开关常见形态——'' 不当值验、按未设走 optional/default，防拒启动）
const blankToUnset = (v: unknown) => (v === '' ? undefined : v);

export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  REDIS_URL: z.string().default('redis://localhost:6379/0'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  MINIO_ENDPOINT: z.string().url(),
  MINIO_ACCESS_KEY: z.string().min(3),
  MINIO_SECRET_KEY: z.string().min(8),
  MINIO_BUCKET: z.string().default('flowai'),
  // normalize 不 reject：任意串过验、语义按 lowercase==='true'——消灭 z.coerce.boolean 的
  // Boolean('false')=true 反相，且不新增启动失败面（该键行为惰性）
  MINIO_USE_SSL: z.preprocess(blankToUnset, z.string().optional())
    .transform((v) => (v ?? '').toLowerCase() === 'true'),

  // WeChat Pay API v3 (optional — only required for recharge feature)
  WECHAT_PAY_APP_ID: z.string().optional().default(''),
  WECHAT_PAY_MCH_ID: z.string().optional().default(''),
  WECHAT_PAY_API_V3_KEY: z.string().optional().default(''),
  WECHAT_PAY_MERCHANT_SERIAL_NO: z.string().optional().default(''),
  WECHAT_PAY_PRIVATE_KEY: z.string().optional().default(''),
  WECHAT_PAY_MERCHANT_CERT: z.string().optional().default(''),
  WECHAT_PAY_PUBLIC_KEY_ID: z.string().optional().default(''),
  WECHAT_PAY_PUBLIC_KEY: z.string().optional().default(''),
  WECHAT_PAY_NOTIFY_URL: z.string().optional().default(''),

  // WeChat Login (website app scan login)
  WECHAT_APP_ID: z.string().optional().default(''),
  WECHAT_APP_SECRET: z.string().optional().default(''),
  WECHAT_LOGIN_REDIRECT_URI: z.string().optional().default(''),

  // Observability (Phase 9)
  SENTRY_DSN: z.string().optional(),
  PROMETHEUS_TOKEN: z.string().optional(),

  // Y0a-4（spec §3 4.6）：COLLAB_* 全族收口——zod=类型契约单源（错值启动拒）；默认值唯一定义在
  // 消费点（不写 default 防双源，P3）。空串=未设（B13：dotenv/shell 清开关常见形态，防拒启动）。
  // COMPACT_INTERVAL_MS=真实键名（gateway:25 无 COLLAB_ 前缀——前缀统一登记 Y0c env 根修）。
  // MAX_LOADED_DOCS=spec §3 4.6:502 原文点名预留（仅解析零消费，enforcement 归 Y1c-3）。
  // BIND_ADDR 不在此（键随读者——T4 与 gateway listen 同批落地，防方向二死键红）。
  // COLLAB_FAKE_AI 不在此（Y0b 资金批域，结构锚豁免表登记）。
  COLLAB_PORT: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),
  COLLAB_DEBOUNCE: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),
  COLLAB_TIMEOUT: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),
  COMPACT_INTERVAL_MS: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),
  COLLAB_SWEEP_ENABLED: z.preprocess(blankToUnset, z.enum(['true', 'false']).optional()),
  COLLAB_SPOOL_DIR: z.preprocess(blankToUnset, z.string().min(1).optional()),
  COLLAB_SPOOL_CAPACITY_BYTES: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),
  COLLAB_LEASE_TTL_MS: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),
  COLLAB_LEASE_HEARTBEAT_MS: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),
  COLLAB_ADMIN_TOKEN: z.preprocess(blankToUnset, z.string().min(1).optional()),
  COLLAB_MAX_LOADED_DOCS: z.preprocess(blankToUnset, z.coerce.number().int().min(0).optional()),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.format());
    process.exit(1);
  }
  return result.data;
}
