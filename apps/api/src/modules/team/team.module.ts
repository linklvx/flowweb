import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TeamService } from './team.service';
import { TeamCreditService } from './team-credit.service';
import { TeamRechargeService } from './team-recharge.service';
import { TeamSubscriptionService } from './team-subscription.service';
import { StorageQuotaService } from './storage-quota.service';
import { ProjectPermissionService } from './project-permission.service';
import { ProjectMemberService } from './project-member.service';
import { ProjectMemberController } from './project-member.controller';
import { TeamController } from './team.controller';
import { TeamGuard } from './team.guard';
import { TeamCloseExpiredProcessor } from './task/team-recharge-close-expired.processor';
import { TeamActiveQueryProcessor } from './task/team-recharge-active-query.processor';
import { TeamSubscriptionExpireProcessor } from './task/team-subscription-expire.processor';
import { TeamMediaCleanupProcessor } from './task/team-media-cleanup.processor';
import { AdminTeamPlanController } from './admin-team-plan.controller';
import { RechargeModule } from '../recharge/recharge.module';
import { AuditService } from '../../common/audit/audit.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'team-media-cleanup' },
      { name: 'team-recharge-close-expired' },
      { name: 'team-recharge-active-query' },
    ),
    forwardRef(() => RechargeModule),
  ],
  controllers: [TeamController, AdminTeamPlanController, ProjectMemberController],
  providers: [
    TeamService, TeamCreditService, TeamRechargeService, TeamSubscriptionService, StorageQuotaService, TeamGuard,
    ProjectPermissionService, ProjectMemberService, AuditService,
    TeamCloseExpiredProcessor, TeamActiveQueryProcessor, TeamSubscriptionExpireProcessor, TeamMediaCleanupProcessor,
  ],
  exports: [TeamService, TeamCreditService, TeamRechargeService, TeamSubscriptionService, StorageQuotaService, TeamGuard, ProjectPermissionService],
})
export class TeamModule {}
