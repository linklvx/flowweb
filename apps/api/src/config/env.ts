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
