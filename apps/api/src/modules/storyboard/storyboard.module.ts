import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { StoryboardController } from './storyboard.controller';
import { StoryboardService } from './storyboard.service';
import { StitchConsumer } from './stitch.consumer';
import { STORYBOARD_STITCH_QUEUE } from './storyboard.constants';
import { ExecutionModule } from '../execution/execution.module';
import { CollabModule } from '../collab/collab.module';
import { TeamModule } from '../team/team.module';

@Module({
  imports: [
    CollabModule,
    TeamModule,
    ExecutionModule,
    BullModule.registerQueue({
      name: STORYBOARD_STITCH_QUEUE,
      // P1-4：指数退避重试防 MinIO/网络异常（bullmq 5.75 JobsOptions 无 timeout 字段，
      // job 级超时由 StitchConsumer 内部 Promise.race 实现）
      defaultJobOptions: { attempts: 2, backoff: { type: 'exponential', delay: 5000 } },
    }),
  ],
  controllers: [StoryboardController],
  providers: [StoryboardService, StitchConsumer],
  exports: [StoryboardService],
})
export class StoryboardModule {}
