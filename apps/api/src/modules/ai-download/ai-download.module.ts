import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiDownloadProcessor } from './ai-download.processor';
import { AI_DOWNLOAD_QUEUE_NAME } from './ai-download.constants';
import { ExecutionModule } from '../execution/execution.module';

@Module({
  imports: [
    ExecutionModule,
    BullModule.registerQueue({
      name: AI_DOWNLOAD_QUEUE_NAME,
    }),
  ],
  providers: [AiDownloadProcessor],
  exports: [BullModule],
})
export class AiDownloadModule {}
