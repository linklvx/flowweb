// apps/api/src/modules/temp-cleanup/temp-cleanup.scheduler.service.ts
// 调度注册——镜像 modules/subscription/task/subscription-scheduler.service.ts 先例：
// 先 getRepeatableJobs/removeRepeatableByKey 清旧再 add（防重启重复注册）
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TEMP_CLEANUP_QUEUE_NAME } from './temp-cleanup.constants';

@Injectable()
export class TempCleanupSchedulerService implements OnModuleInit {
  constructor(@InjectQueue(TEMP_CLEANUP_QUEUE_NAME) private readonly queue: Queue) {}

  async onModuleInit() {
    // Remove existing repeatable jobs to avoid duplicates on restart
    const jobs = await this.queue.getRepeatableJobs();
    for (const job of jobs) await this.queue.removeRepeatableByKey(job.key);

    // 每小时 17 分（避开整点任务扎堆）+ tz 显式（先例同款）
    await this.queue.add('temp-cleanup', undefined, {
      repeat: { pattern: '17 * * * *', tz: 'UTC' },
      jobId: 'temp-cleanup-hourly',
    });
  }
}
