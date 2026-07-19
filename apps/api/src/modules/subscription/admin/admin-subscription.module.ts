import { Module } from '@nestjs/common';
import { AdminSubscriptionController } from './admin-subscription.controller';
import { AdminBannerController } from './admin-banner.controller';
import { AdminSubscriptionService } from './admin-subscription.service';
import { SubscriptionModule } from '../subscription.module';

@Module({
  imports: [SubscriptionModule],
  controllers: [AdminSubscriptionController, AdminBannerController],
  providers: [AdminSubscriptionService],
})
export class AdminSubscriptionModule {}
