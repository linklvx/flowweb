import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class SubscriptionSchedulerService implements OnModuleInit {
  constructor(
    @InjectQueue('subscription-expire') private readonly expireQueue: Queue,
    @InjectQueue('subscription-grant-credit') private readonly grantQueue: Queue,
  ) {}

  async onModuleInit() {
    // Remove existing repeatable jobs to avoid duplicates on restart
    const expireJobs = await this.expireQueue.getRepeatableJobs();
    for (const job of expireJobs) await this.expireQueue.removeRepeatableByKey(job.key);

    const grantJobs = await this.grantQueue.getRepeatableJobs();
    for (const job of grantJobs) await this.grantQueue.removeRepeatableByKey(job.key);

    // Schedule: expire at 0:30 UTC, grant at 2:00 UTC
    await this.expireQueue.add('expire-scan', {}, {
      repeat: { pattern: '30 0 * * *', tz: 'UTC' },
      jobId: 'expire-scheduled',
    });

    await this.grantQueue.add('grant-scan', {}, {
      repeat: { pattern: '0 2 * * *', tz: 'UTC' },
      jobId: 'grant-scheduled',
    });
  }
}
