import { Module } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { PricingService } from './pricing.service';
import { SubscriptionController } from './subscription.controller';
import { CreditModule } from '../credit/credit.module';
import { OrderModule } from '../order/order.module';

@Module({
  imports: [CreditModule, OrderModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, PricingService],
  exports: [SubscriptionService, PricingService],
})
export class SubscriptionModule {}
