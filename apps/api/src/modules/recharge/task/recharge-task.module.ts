import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../../../config/queue.constants';
import { PrismaService } from '../../../prisma/prisma.service';
import { CloseExpiredOrderProcessor } from './close-expired-order.processor';
import { ActiveQueryProcessor } from './active-query.processor';
import { DailyScanProcessor } from './daily-scan.processor';
import { RechargeSchedulerService } from './recharge-scheduler.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_NAMES.RECHARGE_CLOSE_EXPIRED, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } } },
      { name: QUEUE_NAMES.RECHARGE_ACTIVE_QUERY, defaultJobOptions: { attempts: 2, backoff: { type: 'exponential', delay: 5000 } } },
      { name: QUEUE_NAMES.RECHARGE_DAILY_SCAN, defaultJobOptions: { attempts: 2 } },
    ),
  ],
  providers: [
    PrismaService,
    CloseExpiredOrderProcessor,
    ActiveQueryProcessor,
    DailyScanProcessor,
    RechargeSchedulerService,
  ],
})
export class RechargeTaskModule {}
