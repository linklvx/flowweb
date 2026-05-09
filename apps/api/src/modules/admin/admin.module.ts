import { Module } from '@nestjs/common';
import { NodeTypeService } from './node-type/node-type.service';
import { NodeTypeController } from './node-type/node-type.controller';
import { ModelService } from './model/model.service';
import { ModelController } from './model/model.controller';

@Module({
  controllers: [NodeTypeController, ModelController],
  providers: [NodeTypeService, ModelService],
})
export class AdminModule {}
