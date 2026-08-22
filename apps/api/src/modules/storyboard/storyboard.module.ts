import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { StoryboardController } from './storyboard.controller';
import { StoryboardService } from './storyboard.service';
import { StitchConsumer } from './stitch.consumer';
import { STORYBOARD_STITCH_QUEUE } from './storyboard.constants';

@Module({
  imports: [BullModule.registerQueue({
    name: STORYBOARD_STITCH_QUEUE,
    // P1-4：job 级指数退避重试，防 MinIO/网络异常导致 worker 永久挂起
    defaultJobOptions: { attempts: 2, backoff: { type: 'exponential', delay: 5000 } },
  })],
  controllers: [StoryboardController],
  providers: [StoryboardService, StitchConsumer],
  exports: [StoryboardService],
})
export class StoryboardModule {}
