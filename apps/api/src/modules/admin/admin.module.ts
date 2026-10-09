import { Module } from '@nestjs/common';
import { NodeTypeService } from './node-type/node-type.service';
import { NodeTypeController } from './node-type/node-type.controller';
import { ModelService } from './model/model.service';
import { ModelController } from './model/model.controller';
import { PricingService } from './pricing/pricing.service';
import { PricingController } from './pricing/pricing.controller';
import { PublicService } from './public/public.service';
import { PublicController } from './public/public.controller';
import { SettingsService } from './settings/settings.service';
import { SettingsController } from './settings/settings.controller';
import { ExecutionModule } from '../execution/execution.module';
import { TeamModule } from '../team/team.module';
import { AdminIntentService } from './intent/intent.service';
import { AdminIntentController } from './intent/intent.controller';
import { AuditService } from '../../common/audit/audit.service';

// Y0b-1：PricingResolverService 定价单源经 ExecutionModule exports 注入（PricingService/PublicService——
// ExecutionModule 传递闭包=Collab/Team/MediaProcess，无反向依赖 AdminModule，无环）
// Y0b-1 force-void：GenerationIntentService 经 ExecutionModule exports 注入；TeamCreditService 经
// TeamModule 注入（TeamModule 传递闭包=Recharge，无反向依赖 AdminModule，无环）；AuditService 直注册（team/subscription 同款先例）
@Module({
  imports: [ExecutionModule, TeamModule],
  controllers: [NodeTypeController, ModelController, PricingController, PublicController, SettingsController, AdminIntentController],
  providers: [NodeTypeService, ModelService, PricingService, PublicService, SettingsService, AdminIntentService, AuditService],
})
export class AdminModule {}
