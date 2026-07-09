import { Module } from '@nestjs/common';
import { AdminSubscriptionController } from './admin-subscription.controller';
import { AdminSubscriptionService } from './admin-subscription.service';
import { SubscriptionModule } from '../subscription.module';

@Module({
  imports: [SubscriptionModule],
  controllers: [AdminSubscriptionController],
  providers: [AdminSubscriptionService],
})
export class AdminSubscriptionModule {}
