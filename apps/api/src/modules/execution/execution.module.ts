import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import Redis from 'ioredis';
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
import { EXECUTION_QUEUE_NAME, EXECUTION_CONNECTION_NAME } from './execution.constants';
import { EXECUTION_JOB_OPTIONS } from './execution.queue-options';
import { VideoTrimController } from './video-trim.controller';
import { VideoTrimService } from './video-trim.service';
import { VideoTrimProcessor } from './video-trim.processor';
import { VIDEO_TRIM_QUEUE, VIDEO_TRIM_CONNECTION } from './video-trim.constants';
import { VideoSeparateController } from './video-separate.controller';
import { VideoSeparateService } from './video-separate.service';
import { VideoSeparateProcessor } from './video-separate.processor';
import { VideoSeparateCronService } from './video-separate.cron';
import { MediaProcessModule } from '../media-process/media-process.module';
import { VIDEO_SEPARATE_QUEUE } from './video-separate.constants';
import { validateEnv } from '../../config/env';

const env = validateEnv();

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
    ExecutionGateway,
    ExecutionProcessor,
    VideoTrimService,
    VideoTrimProcessor,
    VideoSeparateService,
    VideoSeparateProcessor,
    VideoSeparateCronService,
    { provide: 'REDIS_CLIENT', useFactory: () => new Redis(env.REDIS_URL) },
  ],
  exports: [ExecutionService, ExecutionGateway, ApiCallerService],
})
export class ExecutionModule {}
