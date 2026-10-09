import { z } from 'zod';

// B13：空串=未设（dotenv/shell 清开关常见形态——'' 不当值验、按未设走 optional/default，防拒启动）
const blankToUnset = (v: unknown) => (v === '' ? undefined : v);

/** Y0b-2 T1（Z117）：EXEC_* 默认值常量表单源——zod 不写 .default（COLLAB_* 同款防双源 P3）；
 *  消费点读 EXEC_DEFAULTS.*；zod 仅验形态（int+下限）。EXEC_MAX_NODES 整体移 T8（键随读者同批）。 */
export const EXEC_DEFAULTS = {
  /** EXEC_SUBMIT_TIMEOUT_MS——外呼 submit 阶段超时 */
  SUBMIT: 30_000,
  /** EXEC_POLL_TIMEOUT_MS——同步轮询单次超时 */
  POLL: 10_000,
  /** EXEC_DEADLINE_TEXT_MS——文本外呼硬截止 */
  DEADLINE_TEXT: 90_000,
  /** EXEC_DEADLINE_IMAGE_MS——图片外呼硬截止 */
  DEADLINE_IMAGE: 300_000,
  /** EXEC_DEADLINE_VIDEO_MS——视频外呼硬截止 */
  DEADLINE_VIDEO: 900_000,
  /** EXEC_DEADLINE_EDIT_MS——编辑（outpaint/erase/redraw）外呼硬截止 */
  DEADLINE_EDIT: 300_000,
  /** EXEC_DEADLINE_LIGHTING_MS——打光外呼硬截止 */
  DEADLINE_LIGHTING: 1_800_000,
  /** EXEC_SYNC_HARD_CAP——同步路径总预算硬帽（check-nginx-budget.mjs 同值共用本常量导出，禁两处各写数值） */
  SYNC_HARD_CAP: 1_800_000,
} as const;

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
  // Y0a-4（P25）：绑定面收窄——reader 在 gateway listen 配置（键随读者同批收口，防 T1 结构锚方向二死键红）。
  // 默认缺省=0.0.0.0 不变；ecosystem 未来注入 127.0.0.1（nginx 同机唯一合法路径）。
  COLLAB_BIND_ADDR: z.preprocess(blankToUnset, z.string().min(1).optional()),

  // Y0b-2 T1（Z117）：执行运行时超时/预算键——默认值=EXEC_DEFAULTS 常量表单源（上表），
  // zod 只验形态不写 default（防双源）；读点按【字面量】process.env 直读纪律（collab-env-single-source 方向②）。
  // EXEC_MAX_NODES 不在此（整体移 T8——键随读者同批，防死键）。
  EXEC_SUBMIT_TIMEOUT_MS: z.preprocess(blankToUnset, z.coerce.number().int().min(1_000).optional()),        // 默认 EXEC_DEFAULTS.SUBMIT=30_000
  EXEC_POLL_TIMEOUT_MS: z.preprocess(blankToUnset, z.coerce.number().int().min(1_000).optional()),          // 默认 EXEC_DEFAULTS.POLL=10_000
  EXEC_DEADLINE_TEXT_MS: z.preprocess(blankToUnset, z.coerce.number().int().min(10_000).optional()),        // 默认 EXEC_DEFAULTS.DEADLINE_TEXT=90_000
  EXEC_DEADLINE_IMAGE_MS: z.preprocess(blankToUnset, z.coerce.number().int().min(30_000).optional()),       // 默认 EXEC_DEFAULTS.DEADLINE_IMAGE=300_000
  EXEC_DEADLINE_VIDEO_MS: z.preprocess(blankToUnset, z.coerce.number().int().min(60_000).optional()),       // 默认 EXEC_DEFAULTS.DEADLINE_VIDEO=900_000
  EXEC_DEADLINE_EDIT_MS: z.preprocess(blankToUnset, z.coerce.number().int().min(30_000).optional()),        // 默认 EXEC_DEFAULTS.DEADLINE_EDIT=300_000
  EXEC_DEADLINE_LIGHTING_MS: z.preprocess(blankToUnset, z.coerce.number().int().min(120_000).optional()),   // 默认 EXEC_DEFAULTS.DEADLINE_LIGHTING=1_800_000
  EXEC_SYNC_HARD_CAP: z.preprocess(blankToUnset, z.coerce.number().int().min(60_000).optional()),           // 默认 EXEC_DEFAULTS.SYNC_HARD_CAP=1_800_000

  // Y0b-2 T1（Z80）：provider 密钥 env——seed.ts 灌值来源（运行时外呼读 AIModel.apiKey 列）
  PROVIDER_MOONSHOT_API_KEY: z.string().optional().default(''),
  PROVIDER_TENCENT_API_KEY: z.string().optional().default(''),   // 归并 HY_IMAGE_API_KEY
  DASHSCOPE_API_KEY: z.string().optional().default(''),
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
