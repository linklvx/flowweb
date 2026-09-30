import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiImageEditController } from './ai-image-edit.controller';
import { AiImageEditService } from './ai-image-edit.service';
import { AiImageEditProcessor } from './ai-image-edit.processor';
import { LightingController } from './lighting/lighting.controller';
import { LightingService } from './lighting/lighting.service';
import { LightingConsumer } from './lighting/lighting.consumer';
import { ExecutionModule } from '../execution/execution.module';
import { TeamModule } from '../team/team.module';
import { CollabModule } from '../collab/collab.module';
import { GenerationIntentService } from '../execution/generation-intent.service';
import { AI_IMAGE_EDIT_QUEUE_NAME, AI_IMAGE_EDIT_CONNECTION_NAME } from './ai-image-edit.constants';
import { AI_IMAGE_EDIT_JOB_OPTIONS } from './ai-image-edit.queue-options';

@Module({
  imports: [
    CollabModule,
    ExecutionModule,
    TeamModule,
    BullModule.registerQueue({
      name: AI_IMAGE_EDIT_QUEUE_NAME,
      configKey: AI_IMAGE_EDIT_CONNECTION_NAME,
      defaultJobOptions: { ...AI_IMAGE_EDIT_JOB_OPTIONS },
    }),
  ],
  controllers: [AiImageEditController, LightingController],
  // GenerationIntentService：本模块自注册（ExecutionModule 未导出它；PrismaModule @Global——execution.module 同款引法）
  providers: [AiImageEditService, AiImageEditProcessor, LightingService, LightingConsumer, GenerationIntentService],
  exports: [AiImageEditService],
})
export class AiImageEditModule {}
