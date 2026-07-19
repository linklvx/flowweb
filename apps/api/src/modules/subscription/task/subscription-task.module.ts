import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { GrantCreditProcessor } from './grant-credit.processor';
import { ExpireSubscriptionProcessor } from './expire-subscription.processor';
import { BannerCleanupProcessor } from './banner-cleanup.processor';
import { SubscriptionSchedulerService } from './subscription-scheduler.service';
import { QUEUE_NAMES } from '../../../config/queue.constants';

@Module({
  imports: [
    BullModule.registerQueue(
      {
        name: 'subscription-expire',
        defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      },
      {
        name: 'subscription-grant-credit',
        defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      },
      {
        name: QUEUE_NAMES.BANNER_CLEANUP,
        defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      },
    ),
  ],
  providers: [GrantCreditProcessor, ExpireSubscriptionProcessor, BannerCleanupProcessor, SubscriptionSchedulerService],
})
export class SubscriptionTaskModule {}
