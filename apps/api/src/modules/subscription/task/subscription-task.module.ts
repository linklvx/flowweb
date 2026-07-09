import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { GrantCreditProcessor } from './grant-credit.processor';
import { ExpireSubscriptionProcessor } from './expire-subscription.processor';
import { SubscriptionSchedulerService } from './subscription-scheduler.service';

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
    ),
  ],
  providers: [GrantCreditProcessor, ExpireSubscriptionProcessor, SubscriptionSchedulerService],
})
export class SubscriptionTaskModule {}
