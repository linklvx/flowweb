import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { TransformInterceptor } from './interceptors/transform.interceptor';
import { validateEnv } from './config/env';
import { ExecutionService } from './modules/execution/execution.service';
import { auth } from './auth/auth';
import { toNodeHandler } from 'better-auth/node';

async function bootstrap() {
  const env = validateEnv();

  const app = await NestFactory.create(AppModule);

  // Better Auth handler at /api/auth/*
  app.use('/api/auth', (req: any, _res: any, next: any) => {
    // forward requests to /api/auth/* to better-auth's toNodeHandler
    // only intercept sign-in, sign-up, sign-out, refresh, session
    if (['/sign-in', '/sign-up', '/sign-out', '/refresh', '/session', '/callback', '/forget-password', '/reset-password'].some(p => req.path === p)) {
      const authHandler = toNodeHandler(auth);
      return authHandler(req, _res);
    }
    next();
  });

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  app.enableCors({ origin: 'http://localhost:5173' });

  // Start BullMQ Worker (runs in same process, uses NestJS DI)
  const executionService = app.get(ExecutionService);
  const Queue = require('bull');
  const worker = new Queue('execution', { redis: { host: 'localhost', port: 6379 } });
  worker.process(async (job: any) => {
    const { projectId, nodeId, userId } = job.data;
    console.log('[Worker] Processing job', job.id, projectId, nodeId);
    const result = await executionService.execute(projectId, nodeId, userId || 'default-user');
    console.log('[Worker] Job', job.id, 'done:', result.success);
    return result;
  });
  console.log('[Worker] BullMQ worker started');

  await app.listen(env.PORT);
  console.log(`Server running on port ${env.PORT}`);
}

bootstrap();
