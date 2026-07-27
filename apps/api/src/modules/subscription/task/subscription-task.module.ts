import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { GrantCreditProcessor } from './grant-credit.processor';
import { ExpireSubscriptionProcessor } from './expire-subscription.processor';
import { BannerCleanupProcessor } from './banner-cleanup.processor';
import { PaymentSuccessProcessor } from './payment-success.processor';
import { CloseExpiredSubOrderProcessor } from './close-expired-sub-order.processor';
import { SubscriptionSchedulerService } from './subscription-scheduler.service';
import { RechargeModule } from '../../recharge/recharge.module';
import { QUEUE_NAMES } from '../../../config/queue.constants';

@Module({
  imports: [
    RechargeModule,
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
    BullModule.registerQueue({ name: QUEUE_NAMES.BANNER_CLEANUP }),
    BullModule.registerQueue({
      name: QUEUE_NAMES.SUBSCRIPTION_PAYMENT_SUCCESS,
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    }),
    BullModule.registerQueue({
      name: QUEUE_NAMES.SUBSCRIPTION_CLOSE_EXPIRED,
      defaultJobOptions: { attempts: 1 },
    }),
  ],
  providers: [
    GrantCreditProcessor,
    ExpireSubscriptionProcessor,
    BannerCleanupProcessor,
    PaymentSuccessProcessor,
    CloseExpiredSubOrderProcessor,
    SubscriptionSchedulerService,
  ],
})
export class SubscriptionTaskModule {}
