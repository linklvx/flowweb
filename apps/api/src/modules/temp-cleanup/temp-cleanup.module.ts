import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TempCleanupProcessor } from './temp-cleanup.processor';
import { TEMP_CLEANUP_QUEUE_NAME } from './temp-cleanup.constants';

@Module({
  imports: [
    BullModule.registerQueue({
      name: TEMP_CLEANUP_QUEUE_NAME,
    }),
  ],
  // Y0c T23（Z98）：TempCleanupSchedulerService（repeatable 注册）迁 ExecutionDaemonModule——
  // 守护与定时器装配按 COLLAB_ROLE 门控；本模块留 processor（注册门已落 T30：app.module
  // forRoot manualRegistration 按 role——api 进程 explorer 不建 Worker）
  providers: [TempCleanupProcessor],
})
export class TempCleanupModule {}
