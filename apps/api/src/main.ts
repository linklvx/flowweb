import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env') });

import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { CollabNotServingFilter } from './modules/collab/collab-not-serving.filter';
import { TransformInterceptor } from './interceptors/transform.interceptor';
import { validateEnv } from './config/env';

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
  await preloadDbConfig();

  const env = validateEnv();

  // Sentry init — optional, must NOT block application startup
  try {
    const Sentry = await import('@sentry/nestjs');
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      release: process.env.GIT_COMMIT_HASH || 'unknown',
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

  app.set('trust proxy', true);

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
