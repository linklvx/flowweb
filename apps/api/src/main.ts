import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env') });

import { applyDatabaseUrlConnectionLimit, validateEnv } from './config/env';
// Y0c T32（Z11/§0.6 偏离 47）：DATABASE_URL connection_limit 显式预算（api=8/worker=4/all=8）——
// 必须先于一切 PrismaClient 构造执行：authPrisma（auth/auth.ts:12 模块顶层自建）随下方 app.module
// import 即构造、preload 临时客户端亦先于 validateEnv——「解析后重写」对两者无效。dotenv 后立即
// 同位=唯一全覆盖点（CJS require 顺序即语句顺序，与上行 config() 先于 app.module 同机制）。
applyDatabaseUrlConnectionLimit(process.env);

import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import { register } from 'prom-client';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { CollabNotServingFilter } from './modules/collab/collab-not-serving.filter';
import { TransformInterceptor } from './interceptors/transform.interceptor';
import { installProcessErrorGuards } from './bootstrap/guard';
import { scrubEvent, resolveSentryRelease } from './utils/sentry-scrub';
import { requestTraceMiddleware } from './middleware/request-trace.middleware';
import { httpRedMiddleware } from './middleware/http-red.middleware';
import { collabRoleInfo } from './modules/collab/store.metrics';

/**
 * 白名单：允许 DB SystemSetting 覆盖 process.env 的 key。
 * 只有非敏感业务配置在此列，密钥/证书等敏感凭证永久保留在 .env。
 */
const ALLOWED_DB_OVERRIDE_KEYS = new Set([
  'TENCENT_SMS_SDK_APP_ID',
  'TENCENT_SMS_TEMPLATE_ID',
  'TENCENT_SMS_SIGN_NAME',
  'WECHAT_PAY_APP_ID',
  'WECHAT_PAY_MCH_ID',
  'WECHAT_PAY_MERCHANT_SERIAL_NO',
  'WECHAT_PAY_MERCHANT_CERT',
  'WECHAT_PAY_PUBLIC_KEY_ID',
  'WECHAT_PAY_PUBLIC_KEY',
  'WECHAT_PAY_NOTIFY_URL',
  'WECHAT_APP_ID',
]);

/** 从 DB 预加载非敏感配置覆盖 process.env */
async function preloadDbConfig() {
  // 应急开关：.env 中设置 DISABLE_DB_CONFIG_PRELOAD=true 跳过 DB 读取
  if (process.env.DISABLE_DB_CONFIG_PRELOAD === 'true') {
    console.log('[ConfigPreload] 已禁用（DISABLE_DB_CONFIG_PRELOAD=true），使用纯 .env 配置');
    return;
  }

  const prisma = new PrismaClient();   // 声明提到 try 外（try 内 const 块级作用域在 catch 不可见）
  try {
    const rows = await prisma.systemSetting.findMany();
    let overridden = 0;
    for (const row of rows) {
      if (ALLOWED_DB_OVERRIDE_KEYS.has(row.key) && row.value) {
        process.env[row.key] = row.value;
        overridden++;
      }
    }
    await prisma.$disconnect();
    console.log(`[ConfigPreload] 从 DB 加载了 ${overridden} 项配置（共 ${rows.length} 条记录）`);
  } catch (err) {
    console.error('[ConfigPreload] 读取 DB 配置失败，使用 .env 兜底:', (err as Error).message);
    await prisma.$disconnect().catch(() => {});   // Y0a-4/E46+B30：catch 后启动继续——不 disconnect 则该池存活整进程
  }
}

async function bootstrap() {
  // Y0b-5 T11：进程兜底首行安装（原 :99 装在 create 之后=引导期窗口裸奔——unhandledRejection/
  // uncaughtException 计数+Sentry capture，先于 preloadDbConfig/Sentry.init 全程覆盖）
  installProcessErrorGuards();

  // Y0c T0（Z134/Z138）：全族指标默认 role 标签——引导层单点（census ⑳ A 结构断言：全仓恰 1 调用点
  // 且在 main.ts；模块级调用禁入——prom-client register.clear() 连清 _defaultLabels，di-smoke 既有
  // clear 会静默消灭模块级效果；标签仅在 getMetricsAsString 输出时注入，getSingleMetric().get()
  // 断言零影响。worker 侧 main-worker.ts role='worker' 归 T26/T29）。
  register.setDefaultLabels({ role: 'api' });

  await preloadDbConfig();

  const env = validateEnv();

  // Y0c T23（Z67③）：进程角色观测——引导层单点（与 setDefaultLabels 同区）。gauge 值恒 1，
  // role 标签携带值；worker 侧 main-worker.ts 引导归 T26。dev 下 role=api 打 WARN：本地单进程
  // 开发需显式 COLLAB_ROLE=all（processor 注册门已落 T30：app.module forRoot extraOptions.
  // manualRegistration 按 role——api 角色进程不装配消费面）。
  collabRoleInfo.set({ role: env.COLLAB_ROLE }, 1);
  console.log(JSON.stringify({ event: 'process_role', role: env.COLLAB_ROLE }));
  if (env.COLLAB_ROLE === 'api' && env.NODE_ENV !== 'production') {
    console.warn('[Role] 本进程不消费队列——本地开发需 COLLAB_ROLE=all');
  }

  // Sentry init — optional, must NOT block application startup
  try {
    const Sentry = await import('@sentry/nestjs');
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      // T11（裁定 23⑰）：release 读 build-info.json（部署链产物——pm2 剥 GIT_* ⇒ env 路恒 'unknown'
      // 事故查不出对应提交）；本地 dev 回落 package.json version → 'unknown'
      release: resolveSentryRelease(),
      beforeSend: scrubEvent,   // T11：事件面 scrub——剥 query 除 csv/cb 外全部+token/query 键族打码
      integrations: [Sentry.nestIntegration()],
    });
  } catch (err) {
    console.warn('[Sentry] Init failed, continuing without error reporting:', (err as Error).message);
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // R1b 方案 C 承重墙：pm2 restart 的 SIGINT 触发 collab.gateway onApplicationShutdown → server.destroy()
  // flush 内存 doc（服务端是唯一持久化层）——不开此行生命周期钩子不执行，重启即丢未落库 doc
  app.enableShutdownHooks();

  // nestIntegration() in Sentry.init() handles exception capture automatically
  // No separate SentryGlobalFilter required in @sentry/nestjs v10.x

  app.set('trust proxy', 'loopback'); // P-I：与 WS 侧 X-Real-IP 同信任前提（E58 完整收口归 Y0.5；全信任=true 收敛为一跳 loopback）

  // Y0b-5 T13：trace/RED 全局最前（先于 throttle/auth——trace 覆盖全请求含 401/429）。
  // request-trace：入站 traceparent 严格校验（不合法丢弃新建）+ALS+x-request-id 响应头（不回声 traceparent）；
  // http-red：计时+在飞 gauge+path 归一。WS 帧不进（collab 独立端口服务不经主 app——connectionId=T11 独立）。
  app.use(requestTraceMiddleware);
  app.use(httpRedMiddleware);

  // Y0a-3（V21）：COLLAB_NOT_SERVING 503 统一附 Retry-After: 2（过滤链首中即止：非标记 503 由其
  // 内部委托 HttpExceptionFilter 同壳透出，其余异常类型直接落默认链）
  app.useGlobalFilters(new HttpExceptionFilter(), new CollabNotServingFilter());   // Nest10 反转求值序——后注册者先求值：窄 Catch 必须排在宽 shell 之后注册（否则被遮蔽）
  app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));
  const corsOrigins = (env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim());
  app.enableCors({ origin: corsOrigins, credentials: true });

  await app.listen(env.PORT);
  console.log(`Server running on port ${env.PORT}`);
}

bootstrap();
