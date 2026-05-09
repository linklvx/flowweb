import { Module } from '@nestjs/common';
import { NodeTypeService } from './node-type/node-type.service';
import { NodeTypeController } from './node-type/node-type.controller';
import { ModelService } from './model/model.service';
import { ModelController } from './model/model.controller';
import { PricingService } from './pricing/pricing.service';
import { PricingController } from './pricing/pricing.controller';

@Module({
  controllers: [NodeTypeController, ModelController, PricingController],
  providers: [NodeTypeService, ModelService, PricingService],
})
export class AdminModule {}
