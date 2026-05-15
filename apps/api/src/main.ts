import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { TransformInterceptor } from './interceptors/transform.interceptor';
import { validateEnv } from './config/env';
import { ExecutionService } from './modules/execution/execution.service';

async function bootstrap() {
  const env = validateEnv();

  const app = await NestFactory.create(AppModule);

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  app.enableCors({ origin: 'http://localhost:5173', credentials: true });

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
