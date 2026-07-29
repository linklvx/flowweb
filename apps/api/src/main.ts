import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env') });

import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { TransformInterceptor } from './interceptors/transform.interceptor';
import { validateEnv } from './config/env';
import { TemplateService } from './modules/template/template.service';

async function bootstrap() {
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

  // nestIntegration() in Sentry.init() handles exception capture automatically
  // No separate SentryGlobalFilter required in @sentry/nestjs v10.x

  app.set('trust proxy', true);

  // 初始化官方模板
  const templateService = app.get(TemplateService);
  await templateService.initOfficialTemplates();
  console.log('[Seed] Official templates initialized');

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));
  const corsOrigins = (env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim());
  app.enableCors({ origin: corsOrigins, credentials: true });

  await app.listen(env.PORT);
  console.log(`Server running on port ${env.PORT}`);
}

bootstrap();
