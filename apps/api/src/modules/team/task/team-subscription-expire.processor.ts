import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TeamSubscriptionService } from '../team-subscription.service';

@Injectable()
export class TeamSubscriptionExpireProcessor {
  private readonly logger = new Logger(TeamSubscriptionExpireProcessor.name);

  constructor(private readonly subscription: TeamSubscriptionService) {}

  @Cron('0 5 * * *')
  async handle() {
    const count = await this.subscription.expireSubscriptions();
    if (count > 0) this.logger.log(`expired ${count} team subscriptions`);
  }
}
