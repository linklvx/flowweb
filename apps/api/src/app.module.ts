import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import Redis from 'ioredis';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { ContentModule } from './modules/content/content.module';
import { ProjectModule } from './modules/project/project.module';
import { AdminModule } from './modules/admin/admin.module';
import { CreditModule } from './modules/credit/credit.module';
import { ExecutionModule } from './modules/execution/execution.module';
import { TemplateModule } from './modules/template/template.module';
import { AuthModule } from './auth/auth.module';
import { MinioModule } from './modules/minio/minio.module';
import { StorageModule } from './modules/storage/storage.module';
import { MediaModule } from './modules/media/media.module';
import { AiDownloadModule } from './modules/ai-download/ai-download.module';
import { TempCleanupModule } from './modules/temp-cleanup/temp-cleanup.module';
import { AuthGuard } from './auth/auth.guard';
import { validateEnv } from './config/env';

const env = validateEnv();

@Module({
  imports: [
    BullModule.forRoot('default', {
      connection: { url: env.REDIS_URL },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400 * 7 },
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
    PrismaModule,
    HealthModule,
    ContentModule,
    ProjectModule,
    AdminModule,
    CreditModule,
    ExecutionModule,
    MinioModule,
    StorageModule,
    TemplateModule,
    AuthModule,
    MediaModule,
    AiDownloadModule,
    TempCleanupModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => new Redis(env.REDIS_URL),
    },
  ],
})
export class AppModule {}
