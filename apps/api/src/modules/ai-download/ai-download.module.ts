import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiDownloadProcessor } from './ai-download.processor';
import { AI_DOWNLOAD_QUEUE_NAME } from './ai-download.constants';

@Module({
  imports: [
    BullModule.registerQueue({
      name: AI_DOWNLOAD_QUEUE_NAME,
    }),
  ],
  providers: [AiDownloadProcessor],
  exports: [BullModule],
})
export class AiDownloadModule {}
