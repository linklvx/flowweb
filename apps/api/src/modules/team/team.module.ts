import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TeamService } from './team.service';
import { TeamCreditService } from './team-credit.service';
import { TeamRechargeService } from './team-recharge.service';
import { TeamController } from './team.controller';
import { TeamGuard } from './team.guard';
import { TeamCloseExpiredProcessor } from './task/team-recharge-close-expired.processor';
import { TeamActiveQueryProcessor } from './task/team-recharge-active-query.processor';
import { RechargeModule } from '../recharge/recharge.module';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'team-media-cleanup' },
      { name: 'team-recharge-close-expired' },
      { name: 'team-recharge-active-query' },
    ),
    forwardRef(() => RechargeModule),
  ],
  controllers: [TeamController],
  providers: [TeamService, TeamCreditService, TeamRechargeService, TeamGuard, TeamCloseExpiredProcessor, TeamActiveQueryProcessor],
  exports: [TeamService, TeamCreditService, TeamRechargeService, TeamGuard],
})
export class TeamModule {}
