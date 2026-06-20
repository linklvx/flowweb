import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiImageEditController } from './ai-image-edit.controller';
import { AiImageEditService } from './ai-image-edit.service';
import { AiImageEditProcessor } from './ai-image-edit.processor';
import { LightingController } from './lighting/lighting.controller';
import { LightingService } from './lighting/lighting.service';
import { LightingConsumer } from './lighting/lighting.consumer';
import { ExecutionModule } from '../execution/execution.module';
import { CreditModule } from '../credit/credit.module';
import { AI_IMAGE_EDIT_QUEUE_NAME, AI_IMAGE_EDIT_CONNECTION_NAME } from './ai-image-edit.constants';

@Module({
  imports: [
    ExecutionModule,
    CreditModule,
    BullModule.registerQueue({
      name: AI_IMAGE_EDIT_QUEUE_NAME,
      configKey: AI_IMAGE_EDIT_CONNECTION_NAME,
    }),
  ],
  controllers: [AiImageEditController, LightingController],
  providers: [AiImageEditService, AiImageEditProcessor, LightingService, LightingConsumer],
  exports: [AiImageEditService],
})
export class AiImageEditModule {}
