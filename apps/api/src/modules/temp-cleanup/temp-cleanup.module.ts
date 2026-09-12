import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TempCleanupProcessor } from './temp-cleanup.processor';
import { TempCleanupSchedulerService } from './temp-cleanup.scheduler.service';
import { TEMP_CLEANUP_QUEUE_NAME } from './temp-cleanup.constants';

@Module({
  imports: [
    BullModule.registerQueue({
      name: TEMP_CLEANUP_QUEUE_NAME,
    }),
  ],
  providers: [TempCleanupProcessor, TempCleanupSchedulerService],
})
export class TempCleanupModule {}
