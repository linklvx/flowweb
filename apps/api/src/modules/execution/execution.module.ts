import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';
import { GenerationIntentService } from './generation-intent.service';
import { TopologyService } from './topology.service';
import { ValidationService } from './validation.service';
import { ApiCallerService } from './api-caller.service';
import { ExecutionProcessor } from './execution.processor';
import { TeamModule } from '../team/team.module';
import { CollabModule } from '../collab/collab.module';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { SessionService } from '../../auth/session.service';
import { EXECUTION_QUEUE_NAME, EXECUTION_CONNECTION_NAME } from './execution.constants';
import { AI_IMAGE_EDIT_QUEUE_NAME } from '../ai-image-edit/ai-image-edit.constants';
import { EXECUTION_JOB_OPTIONS } from './execution.queue-options';
import { VideoTrimController } from './video-trim.controller';
import { VideoTrimService } from './video-trim.service';
import { VideoTrimProcessor } from './video-trim.processor';
import { VIDEO_TRIM_QUEUE, VIDEO_TRIM_CONNECTION } from './video-trim.constants';
import { VideoSeparateController } from './video-separate.controller';
import { VideoSeparateService } from './video-separate.service';
import { VideoSeparateProcessor } from './video-separate.processor';
import { MediaProcessModule } from '../media-process/media-process.module';
import { IntentReconcileService } from './intent-reconcile.service';
import { PricingResolverService } from './pricing-resolver.service';
import { VIDEO_SEPARATE_QUEUE } from './video-separate.constants';
import { REDIS_CLIENT, createManagedRedis } from '../../common/redis/managed-redis';

@Module({
  imports: [
    CollabModule,
    TeamModule,
    MediaProcessModule,
    BullModule.registerQueue({
      name: EXECUTION_QUEUE_NAME,
      configKey: EXECUTION_CONNECTION_NAME,
      defaultJobOptions: { ...EXECUTION_JOB_OPTIONS },
    }),
    // 批0.5-8b：IntentReconcileService A 路径按 kind 路由查 ai-image-edit 队列（outpaint/erase/redraw/lighting
    // 的 jobId 在该队列）——队列注册非全局，本模块须注册方可注入；default 连接与 AiImageEditModule 同队列同名无冲突
    BullModule.registerQueue({
      name: AI_IMAGE_EDIT_QUEUE_NAME,
    }),
    BullModule.registerQueue({
      name: 'ai-result-download',
    }),
    BullModule.registerQueue({
      name: VIDEO_TRIM_QUEUE,
      configKey: VIDEO_TRIM_CONNECTION,
    }),
    BullModule.registerQueue({
      name: VIDEO_SEPARATE_QUEUE,
      configKey: 'default',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: { age: 86400 * 7 },
      },
    }),
  ],
  controllers: [ExecutionController, VideoTrimController, VideoSeparateController],
  providers: [
    ExecutionService,
    GenerationIntentService,
    TopologyService,
    ValidationService,
    ApiCallerService,
    SessionService,   // 批3-3：ExecutionGateway authorize 走 touch（鉴权读面顺带续期）
    ExecutionGateway,
    ExecutionProcessor,
    VideoTrimService,
    VideoTrimProcessor,
    VideoSeparateService,
    VideoSeparateProcessor,
    IntentReconcileService,
    PricingResolverService,   // Y0b-1：定价唯一解析器（AdminModule/AiImageEditModule 经本模块 imports 消费）
    { provide: REDIS_CLIENT, useFactory: () => createManagedRedis() },   // 批3-2 B6 受管工厂
  ],
  exports: [ExecutionService, ExecutionGateway, ApiCallerService, PricingResolverService, GenerationIntentService],   // Y0b-1：GenerationIntentService 注入 AdminModule（force-void 终态化）
})
export class ExecutionModule {}
