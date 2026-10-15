import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { StoryboardController } from './storyboard.controller';
import { StoryboardService } from './storyboard.service';
import { StitchConsumer } from './stitch.consumer';
import { STORYBOARD_STITCH_QUEUE } from './storyboard.constants';
import { ExecutionCoreModule } from '../execution/execution-core.module';   // Y0c T25：模块拆分改道（EmitPort 导出——StitchConsumer T25 三族改道消费）
import { TeamModule } from '../team/team.module';

@Module({
  imports: [
    TeamModule,
    ExecutionCoreModule,
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
