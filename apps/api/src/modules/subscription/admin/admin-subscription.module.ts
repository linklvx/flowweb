import { Module } from '@nestjs/common';
import { AdminSubscriptionController } from './admin-subscription.controller';
import { AdminBannerController } from './admin-banner.controller';
import { AdminSubscriptionService } from './admin-subscription.service';
import { SubscriptionModule } from '../subscription.module';
import { TeamModule } from '../../team/team.module';

@Module({
  imports: [SubscriptionModule, TeamModule],   // TeamModule：CreditLedgerService（grantCredit/clearPersonalTeamSubscription 经台账）
  controllers: [AdminSubscriptionController, AdminBannerController],
  providers: [AdminSubscriptionService],
})
export class AdminSubscriptionModule {}
