import { z } from 'zod';

// B13：空串=未设（dotenv/shell 清开关常见形态——'' 不当值验、按未设走 optional/default，防拒启动）
const blankToUnset = (v: unknown) => (v === '' ? undefined : v);

/** Y0b-2 T1（Z117）：EXEC_* 默认值常量表单源——zod 不写 .default（COLLAB_* 同款防双源 P3）；
 *  消费点读 EXEC_DEFAULTS.*；zod 仅验形态（int+下限）。EXEC_MAX_NODES T8 移入（键随读者同批）。 */
export const EXEC_DEFAULTS = {
  /** EXEC_MAX_NODES——execute 显式 nodeIds 上限（T8 Z90/Z117 移入；Σdeadline 硬闸的 DTO 级补充） */
  MAX_NODES: 20,
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

/** Y0c T23（Z48/Z67/Z98）：COLLAB_ROLE 词汇表与默认值单源常量——zod .default 与装配点
 *  （ExecutionDaemonModule.register 读值 fallback）共用本常量防双源（P3，EXEC_DEFAULTS 同款纪律）。
 *  默认 api=安全方向（worker 漏设 role⇒不消费；反向「漏设变 all 抢 3001」永不发生）。 */
export const COLLAB_ROLE_VALUES = ['api', 'worker', 'all'] as const;
export type CollabRole = (typeof COLLAB_ROLE_VALUES)[number];
export const COLLAB_ROLE_DEFAULT: CollabRole = 'api';

/** Y0c T32（Z11/RC1——§0.6 偏离 47）：DATABASE_URL connection_limit 显式预算——per-role 单源常量。
 *  api=8/worker=4（spec §5.3）；all=8（降级瞬态从 api 预算——单进程承担双面）。
 *  量纲算式（runbook §2）：(api 客户端数 3×8)+(worker 客户端数 2×4)+协作头寸 ≤ max_connections 100。
 *  重写发生在 process.env 层（引导层 dotenv 后立即调用 applyDatabaseUrlConnectionLimit——
 *  authPrisma 顶层自建/preload 临时客户端均先于 validateEnv，解析后重写对两者无效）；
 *  zod schema 零改动（解析前变换非默认值——「zod 不写 default」纪律不破）。 */
export const DB_CONNECTION_LIMIT: Record<CollabRole, number> = {
  api: 8,
  worker: 4,
  all: 8,
};

/** 纯函数重写：对 DATABASE_URL 追加/幂等替换 connection_limit 查询参数（URL 对象操作——
 *  其余参数与连接要素保留；非法 URL 抛错由调用方 catch 兜底=zod 拒启唯一失败面）。 */
export function withConnectionLimit(databaseUrl: string, role: CollabRole): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('connection_limit', String(DB_CONNECTION_LIMIT[role]));
  return url.toString();
}

/** 引导层调用位（main.ts/main-worker.ts dotenv config() 后立即）：按 env.COLLAB_ROLE 重写
 *  env.DATABASE_URL。整对象传递（census ㉒ 无按键 process.env 裸读——单源入口同形态）。
 *  role 归一：词表内取值/其余（未设、空串、非法值）回落 COLLAB_ROLE_DEFAULT——非法值的拒启
 *  归 validateEnv zod（本函数不新增失败面）；DATABASE_URL 缺失/非法 URL ⇒ no-op 原样保留
 *  （z.string().url() 拒启是唯一失败面）。重复调用幂等（searchParams.set 替换语义）。 */
export function applyDatabaseUrlConnectionLimit(env: NodeJS.ProcessEnv): void {
  const raw = env.DATABASE_URL;
  if (!raw) return;
  const roleRaw = env.COLLAB_ROLE;
  const role: CollabRole = (COLLAB_ROLE_VALUES as readonly string[]).includes(roleRaw ?? '')
    ? (roleRaw as CollabRole)
    : COLLAB_ROLE_DEFAULT;
  try {
    env.DATABASE_URL = withConnectionLimit(raw, role);
  } catch {
    /* 非法 URL——validateEnv z.string().url() 拒启，此处静默保留原值 */
  }
}

/** 全局不变式（superRefine）挂在本 schema 之上的 envSchemaValidated（Y0b-3 T1 P-R）——
 *  本体保持 ZodObject（collab-env-single-source 结构锚读 .shape）；validateEnv 只消费 refined 版。 */
export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  REDIS_URL: z.string().default('redis://localhost:6379/0'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  // Y0b-3 T1（P-R）：superRefine 的两个判据键——此前仅 process.env 直读未进 schema（zod strip 未知键
  // 则 superRefine 恒读 undefined，fail-fast 失效/误伤），故同批注册。
  // Y0c T34（Z12 显式裁定例外登记）：NODE_ENV 收口为 enum 三值封闭词表+default('production')——
  // **与 T0「zod 不写 default」纪律相反是刻意的 fail-closed 方向**（部署档位缺失不得静默落 dev 宽松
  // 档：cookie Secure/三 guard fail-open/debounce 档位全随此键；仿同文件 COLLAB_ROLE
  // .default(COLLAB_ROLE_DEFAULT) 既有例外先例）。非法值（'staging' 等拼错档位）拒启；空串=未设（B13）走 default。
  NODE_ENV: z.preprocess(blankToUnset, z.enum(['development', 'test', 'production']).default('production')),
  // Y0c T36（Z14①）：API HTTP 绑定面——main.ts app.listen 第二参（使用点默认 '127.0.0.1'——
  // nginx 同机反代唯一合法路径，COLLAB_BIND_ADDR/P25 同族）。分叉键（Z89 ㉑：生产只经 ecosystem
  // api env 块注入，禁入服务器 .env）；zod 不写 default（默认值落使用点——防双源 P3）。
  API_BIND_ADDR: z.preprocess(blankToUnset, z.string().optional()),
  // Y0c T36（Z14③）：限流 IP 白名单进 schema（与删手写 XFF 解析同 commit——防半修状态）。
  // zod 只验形态不写 default：默认 '127.0.0.1,::1' 唯一落使用点 rate-limiter.service ipWhitelist()
  // （T34 惰性调用期读形态保留——census ㉒ 白名单条目在案）。
  RATE_LIMIT_IP_WHITELIST: z.preprocess(blankToUnset, z.string().optional()),
  // Y0c T35（Z13+Z45⑤）：COOKIE_SECURE 显式三态（禁推导）——'true'/'false' 封闭词表；未设/空串
  // （B13）=按档位兜底（resolveSecureTransport 单点，production 恒 true）；production∧'false'=
  // 拒启（下方 superRefine——传输通道属性不得在生产档显式降级）。消费面=auth.ts cookie secure
  // +update-profile.dto 严格档（同一 resolver 驱动，zod 不写 default 防双源 P3）。
  COOKIE_SECURE: z.preprocess(blankToUnset, z.enum(['true', 'false']).optional()),
  BETTER_AUTH_URL: z.preprocess(blankToUnset, z.string().min(1).optional()),
  MINIO_ENDPOINT: z.string().url(),
  MINIO_ACCESS_KEY: z.string().min(3),
  MINIO_SECRET_KEY: z.string().min(8),
  MINIO_BUCKET: z.string().default('flowai'),
  // normalize 不 reject：任意串过验、语义按 lowercase==='true'——消灭 z.coerce.boolean 的
  // Boolean('false')=true 反相，且不新增启动失败面（该键行为惰性）
  MINIO_USE_SSL: z.preprocess(blankToUnset, z.string().optional())
    .transform((v) => (v ?? '').toLowerCase() === 'true'),

  // Y1a+Y1b T5：SafeRemoteFetch（SSRF 原语——media/safe-remote-fetch.service）配置面。zod 只验形态
  // 不写 default（防双源 P3）——默认值单源在消费点（DEFAULT_SAFE_FETCH_ALLOWLIST/
  // DEFAULT_SAFE_FETCH_MAX_CONTENT_LENGTH）。allowlist=逗号分隔 host 后缀（默认 provider 域
  // aliyuncs.com/myqcloud.com——来源实证见 service 头注）。
  SAFE_FETCH_HOST_ALLOWLIST: z.preprocess(blankToUnset, z.string().optional()),
  SAFE_FETCH_MAX_CONTENT_LENGTH: z.preprocess(blankToUnset, z.coerce.number().int().min(1).optional()),
  // Y1a+Y1b T5：content ready 态 X-Accel 生产档开关——设值（如 /internal-media）即 api 返回
  // X-Accel-Redirect 由 nginx internal location 承载字节（deploy/nginx/internal-media-location.replace.conf）；
  // 未设（dev/CI）= API 直流 S3。零 default：档位本身是部署事实非代码默认。
  MEDIA_X_ACCEL_PREFIX: z.preprocess(blankToUnset, z.string().optional()),

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
  // Y0c T34（Z45/RC5）：COLLAB_FAKE_AI 注册进 schema（原「不在此/结构锚豁免表」状态收口——Y0b spec
  // 对象6 收口义务递延至本批兑现；EXEMPT 表条目同批移除）。任意串过验（语义=仅 '1' 生效，'0'/杂值
  // 无害不拒——不新增启动失败面）；拒启判据唯一在 superRefine（production∧'1'）。消费面=
  // provider-adapters fakeAiEnabled() 惰性单源 helper（形态不变——调用期读，写回等价）。
  COLLAB_FAKE_AI: z.preprocess(blankToUnset, z.string().optional()),
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
  // Y0c T0（Z127）：三键一次性注册——消费点随后续 Task 落地（T15 会话空闲 TTL/T16 常驻字节主约束）；
  // zod 只验形态不写 default（默认值落使用点——Z107 TTL 默认 120_000/Z142 RESIDENT 默认 384MiB；防双源 P3 同款）。
  COLLAB_SESSION_IDLE_TTL_MS: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),
  COLLAB_MAX_RESIDENT_BYTES: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),
  // Y1c T10（偏离 38⑤ maxResidentDocBytes）：全局驻留 doc 字节上界（load 入口闸——默认 384MiB 落使用点 DR）。
  COLLAB_MAX_RESIDENT_DOC_BYTES: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),
  // Y0a-4（P25）：绑定面收窄——reader 在 gateway listen 配置（键随读者同批收口，防 T1 结构锚方向二死键红）。
  // 默认缺省=0.0.0.0 不变；ecosystem 未来注入 127.0.0.1（nginx 同机唯一合法路径）。
  COLLAB_BIND_ADDR: z.preprocess(blankToUnset, z.string().min(1).optional()),
  // Y0c T23（Z48/Z89）：进程角色键——分叉键（生产只经 ecosystem env 块按 app 注入 api/worker，
  // 禁入服务器 .env 本体）；非法值 fail-fast 拒启（spec :693）。默认值=COLLAB_ROLE_DEFAULT 单源常量
  // （上方——装配点读值 fallback 同引防双源）。消费点=ExecutionDaemonModule.register（第四面：
  // 守护与定时器装配）+main.ts 引导层观测。
  COLLAB_ROLE: z.preprocess(blankToUnset, z.enum(COLLAB_ROLE_VALUES).default(COLLAB_ROLE_DEFAULT)),

  // Y0c T26（Z102/偏离 29）：worker 引导两键——zod 只验形态不写 default（默认值落使用点纪律同上）。
  // WORKER_WRITE_TOKEN：api/worker 共读同值键（Z49 单文件 .env——分叉键禁入是 COLLAB_ROLE 族，
  // 本键两进程同值无分叉）＝读端点（T26）+写端点（T27 write-batch）鉴权（WorkerWriteAuthGuard
  // timingSafeEqual）；worker 侧 HttpCollabWritePort Bearer 注入同源。production 未设=拒启
  // （envSchemaValidated superRefine 单点——T27 收口，api/worker 双进程同款）；dev 未设放行
  // （fail-open——guard 请求级 403 为纵深冗余）。
  WORKER_WRITE_TOKEN: z.preprocess(blankToUnset, z.string().min(1).optional()),
  // WORKER_READY_TIMEOUT_MS：Z102 ready 门上限——使用点默认 60_000（worker-ready-gate.ts
  // WORKER_READY_TIMEOUT_DEFAULT_MS 单源）。
  WORKER_READY_TIMEOUT_MS: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),
  // WORKER_METRICS_PORT：Y0c T29（Z116/Z139）worker 指标出口端口——使用点默认 3002
  // （worker-metrics-server.ts WORKER_METRICS_PORT 常量单源；zod 不写 default 防双源 P3）。
  WORKER_METRICS_PORT: z.preprocess(blankToUnset, z.coerce.number().int().min(1).max(65535).optional()),

  // Y0b-3 T1（§0.3 表十键一次注册——消费点随后续 Task 落地，单源结构锚 EXEMPT 表登记）：
  // zod 只验形态不写 default（默认值落使用点——防双源 P3 同款）；读点按【字面量】process.env 直读纪律。
  COLLAB_ALLOWED_ORIGINS: z.preprocess(blankToUnset, z.string().min(1).optional()),            // T2 消费，默认=BETTER_AUTH_URL origin 推导+仅 dev 含 localhost:5173
  COLLAB_TRUSTED_PROXY: z.preprocess(blankToUnset, z.enum(['1']).optional()),                  // T2 消费，未设=不信任 X-Real-IP；T36（Z14②）production∧未设=拒启（下方 superRefine）
  COLLAB_UPGRADE_RATE_PER_MIN: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),   // T2 消费，默认 60
  COLLAB_AUTH_ATTEMPTS_PER_MIN: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),  // T3 消费，默认 10
  COLLAB_AUTH_INFLIGHT_MAX: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),      // T3 消费，默认 4
  COLLAB_REFUSAL_CACHE_TTL_MS: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),   // T3 消费，默认 15000
  COLLAB_RSS_TRIP_BYTES: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),         // T4 消费，默认 786432000（750MiB）
  COLLAB_RSS_RELEASE_BYTES: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),      // T4 消费，默认 629145600（600MiB）
  COLLAB_HEAP_PRESSURE_RATIO: z.preprocess(blankToUnset, z.coerce.number().min(0.5).max(0.95).optional()),  // T4 消费，默认 0.8
  COLLAB_CONN_MAX_LIFETIME_MS: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),   // T6 消费，默认 43_200_000（12h）

  // Y0b-4 T2（spec §7.1）：配额四键——zod 只验形态不写 default（默认值唯一定义在 gateway 构造期
  // 读入：maxDocBytes/maxTxBytes=QUOTA_DEFAULTS、msgRate/bytesRate=常量 fallback——防双源 P3）；
  // 消费点=gateway this.quota（构造期一次读入，运行期不再读 env），后续读者=T3/T4/T6/T8/T9a。
  COLLAB_MAX_DOC_BYTES: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),
  COLLAB_MAX_TX_BYTES: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),
  COLLAB_MSG_RATE_PER_CONN: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),
  COLLAB_BYTES_RATE_PER_CONN: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),

  // Y0b-2 T1（Z117）：执行运行时超时/预算键——默认值=EXEC_DEFAULTS 常量表单源（上表），
  // zod 只验形态不写 default（防双源）；读点按【字面量】process.env 直读纪律（collab-env-single-source 方向②）。
  // EXEC_MAX_NODES T8 移入（读者=execution.controller EXEC_MAX_NODES 硬闸——键随读者同批）。
  EXEC_MAX_NODES: z.preprocess(blankToUnset, z.coerce.number().int().min(1).optional()),                     // 默认 EXEC_DEFAULTS.MAX_NODES=20
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

// Y0b-3 T1（P-R）：生产 Origin 双缺 fail-fast——Origin 白名单推导源缺失=部署配置错误启动即拒。
// superRefine 返 ZodEffects 丢 .shape（collab-env-single-source 结构锚读 envSchema.shape），
// 故 refined 单列导出——validateEnv 消费本值；envSchema 保持 ZodObject 供结构锚与形态测试。
export const envSchemaValidated = envSchema.superRefine((v, ctx) => {
  if (v.NODE_ENV !== 'production') return;
  if (!v.BETTER_AUTH_URL && !v.COLLAB_ALLOWED_ORIGINS) {
    ctx.addIssue({ code: 'custom', path: ['BETTER_AUTH_URL'], message: '生产必须显式 BETTER_AUTH_URL 或 COLLAB_ALLOWED_ORIGINS（Origin 白名单推导源缺失=部署配置错误 fail-fast）' });
  }
  // Y0c T27：production 未设 WORKER_WRITE_TOKEN=拒启（plan T27 字面——非 guard 403）。api/worker
  // 双进程同经 validateEnv（main.ts/main-worker.ts）——读端点（T26）+写端点（T27）两端点同批统一
  // 收口为同款拒启（T26 落地时 guard 的请求级 403 fail-closed 为纵深冗余保留）；dev 维持 fail-open。
  if (!v.WORKER_WRITE_TOKEN) {
    ctx.addIssue({ code: 'custom', path: ['WORKER_WRITE_TOKEN'], message: '生产必须设置 WORKER_WRITE_TOKEN（worker 内部读写端点鉴权——未设即拒启，禁 fail-open）' });
  }
  // Y0c T29（Z116）：production ∧ worker ∧ PROMETHEUS_TOKEN 未设=拒启——3002 指标出口 fail-closed
  // 主防线（与 api /metrics 同 token 同语义；worker-metrics-server 请求级 403 为纵深冗余）。
  // api role 启动语义不变（其未设面由 PrometheusAuthGuard 请求级 403 承接——精准修改不扩面）。
  if (v.COLLAB_ROLE === 'worker' && !v.PROMETHEUS_TOKEN) {
    ctx.addIssue({ code: 'custom', path: ['PROMETHEUS_TOKEN'], message: '生产 worker 必须设置 PROMETHEUS_TOKEN（3002 指标出口同 token 鉴权——未设即拒启，禁 fail-open）' });
  }
  // Y0c T34（Z45/RC5）：production ∧ COLLAB_FAKE_AI='1' ⇒ 拒启——fake 外呼豁免档启动期 fail-closed。
  // 与 Z93 关系：Z93 删的是运行期守卫（fake 与 NODE_ENV 解耦，主线=缺密钥拒启）；本条是 env 校验层
  // 拒启（Y0b spec 对象6「NODE_ENV==='production' 拒 '1'」同源）——运行期行为面与进程启动面并存
  // 不冲突=提级非回退。gate-collab/CI 豁免档以 NODE_ENV='development' 显式注入配套（Z45④——
  // harness 自带档位不继承外壳；NODE_ENV 未设 default production 使漏注入即拒=防线自证）。
  if (v.COLLAB_FAKE_AI === '1') {
    ctx.addIssue({ code: 'custom', path: ['COLLAB_FAKE_AI'], message: '生产禁止 COLLAB_FAKE_AI=1（fake 外呼豁免档仅限 dev/test/gate——env 校验层启动期拒启 fail-closed）' });
  }
  // Y0c T35（Z13）：production ∧ COOKIE_SECURE='false' ⇒ 拒启——cookie secure 是传输通道属性
  // 非运行档位属性，生产档显式降级=fail-closed 方向拒启动（三态的拒启半在此单点；运行期
  // 布尔判据半在 resolveSecureTransport——本条是 schema 层判据非第二处 resolver 判断，RC7 边界）。
  if (v.COOKIE_SECURE === 'false') {
    ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: '生产禁止 COOKIE_SECURE=false（Z13 三态 fail-closed：传输通道属性不得在生产档显式降级——删除本键即按档位兜底 Secure）' });
  }
  // Y0c T36（Z14②）：production ∧ COLLAB_TRUSTED_PROXY 未设 ⇒ 拒启——WS 升级限流键双门
  // （gateway clientIpOf：loopback peer ∧ trusted）未设即 X-Real-IP 静默不采信，升级限流桶
  // 退化 nginx loopback 源 IP 全站共享且零探针（静默失效）。服务器 .env 已设=1（勘察事实）——
  // 本判据是防回归门；dev/test 未设不拒（WS 侧 fail-open 现状维持，精准修改不扩面）。
  if (!v.COLLAB_TRUSTED_PROXY) {
    ctx.addIssue({ code: 'custom', path: ['COLLAB_TRUSTED_PROXY'], message: '生产必须设置 COLLAB_TRUSTED_PROXY=1（WS 升级限流 X-Real-IP 信任开关——未设即全站单限流桶静默失效零探针，Z14② fail-closed）' });
  }
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
  const result = envSchemaValidated.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.format());
    process.exit(1);
  }
  // Y0c T34（Z45②）：成功后写回 process.env.NODE_ENV——把 default 显式化到进程环境。设计意图：
  // 非 DI 惰性上下文（三 guard canActivate/resolveCollabDebounce/gateway allowedOrigins/dto 自定义
  // constraint/auth.ts 惰性函数）保持 process.env.NODE_ENV 直读（调用期求值恒在本写回之后——CJS
  // require 序+DI/请求时序），写回使其与 env.NODE_ENV 恒同答案（否则 guard 读 process.env 与 env
  // 读法两答案）=「8 读点统一改读 env 单源」（Z12）的写回等价形态。census ㉒ 白名单登记本写点
  // （env.ts NODE_ENV n1「单源写回点」——字面量 process.env.NODE_ENV 赋值会被键级普查命中）。
  process.env.NODE_ENV = result.data.NODE_ENV;
  return result.data;
}

/** Y0c T35（Z13+Z45⑤——§0.6 偏离 55）：COOKIE_SECURE 三态 resolver 单点函数（禁第二处判断）。
 *  语义：显式值优先（'true'/'false'——本地 HTTPS 唯一出路=NODE_ENV=development+COOKIE_SECURE=true
 *  ⇒ cookie 仍 Secure+dto 严格档）→未设/空串（B13）=按档位兜底（production 恒 true）。惰性读
 *  （调用期求值恒在 validateEnv 写回后——Z45② 等价，auth.ts/dto constraint 同形态）。
 *  production∧'false' 由 envSchemaValidated superRefine 拒启拦截（三态的拒启半），运行期到不了
 *  该分支。消费面=getSessionCookieOptions().secure（auth.ts）+EnvAware 两 constraint 严格档
 *  （update-profile.dto）——「传输必须 TLS」两执法面同一 resolver 驱动（Z45⑤ 同批对齐）。 */
export function resolveSecureTransport(): boolean {
  const raw = process.env.COOKIE_SECURE;   // Z13 resolver 单点（census ㉒ 白名单）
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return process.env.NODE_ENV === 'production';   // Z13 resolver 单点（未设/空串=档位兜底）
}
