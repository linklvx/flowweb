import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../../config/queue.constants';

@Injectable()
export class RechargeSchedulerService implements OnModuleInit {
  constructor(
    @InjectQueue(QUEUE_NAMES.RECHARGE_DAILY_SCAN) private readonly dailyScanQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.dailyScanQueue.add('daily-scan', {}, {
      repeat: { pattern: '0 0 * * *' },
      jobId: 'daily-scan-scheduled',
    });
  }
}
