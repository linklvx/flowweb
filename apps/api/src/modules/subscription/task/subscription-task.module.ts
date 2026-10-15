import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { GrantCreditProcessor } from './grant-credit.processor';
import { ExpireSubscriptionProcessor } from './expire-subscription.processor';
import { BannerCleanupProcessor } from './banner-cleanup.processor';
import { PaymentSuccessProcessor } from './payment-success.processor';
import { CloseExpiredSubOrderProcessor } from './close-expired-sub-order.processor';
import { DailyReconProcessor } from './daily-recon.processor';
import { RechargeModule } from '../../recharge/recharge.module';
import { TeamModule } from '../../team/team.module';
import { QUEUE_NAMES } from '../../../config/queue.constants';

@Module({
  imports: [
    RechargeModule,
    TeamModule,   // TeamModule：CreditLedgerService（grant/expire/payment processor 入账经台账）
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
    BullModule.registerQueue({
      name: QUEUE_NAMES.SUBSCRIPTION_DAILY_RECON,
      defaultJobOptions: { attempts: 1 },
    }),
  ],
  providers: [
    GrantCreditProcessor,
    ExpireSubscriptionProcessor,
    BannerCleanupProcessor,
    PaymentSuccessProcessor,
    CloseExpiredSubOrderProcessor,
    DailyReconProcessor,
    // Y0c T23（Z98）：SubscriptionSchedulerService（subscription-expire/grant-credit repeatable 注册）
    // 迁 ExecutionDaemonModule——守护与定时器装配按 COLLAB_ROLE 门控；本模块留 processor 面
  ],
})
export class SubscriptionTaskModule {}
