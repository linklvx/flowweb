import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { EventEmitterModule } from '@nestjs/event-emitter';
import Redis from 'ioredis';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { ContentModule } from './modules/content/content.module';
import { HomeBannerModule } from './modules/home-banner/home-banner.module';
import { ProjectModule } from './modules/project/project.module';
import { TeamModule } from './modules/team/team.module';
import { CollabModule } from './modules/collab/collab.module';
import { AdminModule } from './modules/admin/admin.module';
import { CreditModule } from './modules/credit/credit.module';
import { ExecutionModule } from './modules/execution/execution.module';
import { TemplateModule } from './modules/template/template.module';
import { AuthModule } from './auth/auth.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { AdminSubscriptionModule } from './modules/subscription/admin/admin-subscription.module';
import { SubscriptionTaskModule } from './modules/subscription/task/subscription-task.module';
import { VideoProjectModule } from './modules/video-project/video-project.module';
import { MinioModule } from './modules/minio/minio.module';
import { StorageModule } from './modules/storage/storage.module';
import { MediaModule } from './modules/media/media.module';
import { AiDownloadModule } from './modules/ai-download/ai-download.module';
import { AiImageEditModule } from './modules/ai-image-edit/ai-image-edit.module';
import { TempCleanupModule } from './modules/temp-cleanup/temp-cleanup.module';
import { MaterialLibraryModule } from './modules/material-library/material-library.module';
import { FolderModule } from './modules/folder/folder.module';
import { CanvasModule } from './modules/canvas/canvas.module';
import { RechargeModule } from './modules/recharge/recharge.module';
import { MetricsModule } from './metrics/metrics.module';
import { StoryboardModule } from './modules/storyboard/storyboard.module';
import { AuthGuard } from './auth/auth.guard';
import { AdminGuard } from './auth/admin.guard';
import { validateEnv } from './config/env';

const env = validateEnv();

@Module({
  imports: [
    EventEmitterModule.forRoot(),
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
    HomeBannerModule,
    ProjectModule,
    TeamModule,
    CollabModule,
    AdminModule,
    CreditModule,
    ExecutionModule,
    MinioModule,
    StorageModule,
    TemplateModule,
    FolderModule,
    CanvasModule,
    AuthModule,
    MediaModule,
    AiDownloadModule,
    TempCleanupModule,
    MaterialLibraryModule,
    AiImageEditModule,
    RechargeModule,
    MetricsModule,
    StoryboardModule,
    SubscriptionModule,
    AdminSubscriptionModule,
    SubscriptionTaskModule,
    VideoProjectModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    // AdminGuard 必须注册在 AuthGuard 之后（Nest APP_GUARD 按注册顺序执行，否则 req.user 尚未挂载）
    { provide: APP_GUARD, useClass: AdminGuard },
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => new Redis(env.REDIS_URL),
    },
  ],
})
export class AppModule {}
