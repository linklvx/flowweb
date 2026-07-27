import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SubscriptionService } from './subscription.service';
import { SubscriptionOrderService } from './subscription-order.service';
import { SubscriptionOrderController } from './subscription-order.controller';
import { PricingService } from './pricing.service';
import { SubscriptionBannerService } from './subscription-banner.service';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionBannerPublicController } from './subscription-banner.public.controller';
import { CreditModule } from '../credit/credit.module';
import { OrderModule } from '../order/order.module';
import { RechargeModule } from '../recharge/recharge.module';
import { AuditService } from '../../common/audit/audit.service';
import { MetricsService } from '../../metrics/metrics.service';
import { QUEUE_NAMES } from '../../config/queue.constants';
import Redis from 'ioredis';
import { validateEnv } from '../../config/env';

const env = validateEnv();

@Module({
  imports: [
    CreditModule,
    OrderModule,
    forwardRef(() => RechargeModule),
    BullModule.registerQueue({ name: QUEUE_NAMES.BANNER_CLEANUP }),
    BullModule.registerQueue({ name: QUEUE_NAMES.SUBSCRIPTION_CLOSE_EXPIRED }),
    BullModule.registerQueue({ name: QUEUE_NAMES.SUBSCRIPTION_PAYMENT_SUCCESS }),
  ],
  controllers: [SubscriptionController, SubscriptionBannerPublicController, SubscriptionOrderController],
  providers: [
    SubscriptionService,
    SubscriptionOrderService,
    PricingService,
    MetricsService,
    SubscriptionBannerService,
    AuditService,
    { provide: 'REDIS_CLIENT', useFactory: () => new Redis(env.REDIS_URL) },
  ],
  exports: [SubscriptionService, SubscriptionOrderService, PricingService, SubscriptionBannerService],
})
export class SubscriptionModule {}
