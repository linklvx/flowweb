import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SubscriptionService } from './subscription.service';
import { PricingService } from './pricing.service';
import { SubscriptionBannerService } from './subscription-banner.service';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionBannerPublicController } from './subscription-banner.public.controller';
import { CreditModule } from '../credit/credit.module';
import { OrderModule } from '../order/order.module';
import { AuditService } from '../../common/audit/audit.service';
import { QUEUE_NAMES } from '../../config/queue.constants';
import Redis from 'ioredis';
import { validateEnv } from '../../config/env';

const env = validateEnv();

@Module({
  imports: [
    CreditModule,
    OrderModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.BANNER_CLEANUP }),
  ],
  controllers: [SubscriptionController, SubscriptionBannerPublicController],
  providers: [
    SubscriptionService,
    PricingService,
    SubscriptionBannerService,
    AuditService,
    { provide: 'REDIS_CLIENT', useFactory: () => new Redis(env.REDIS_URL) },
  ],
  exports: [SubscriptionService, PricingService, SubscriptionBannerService],
})
export class SubscriptionModule {}
