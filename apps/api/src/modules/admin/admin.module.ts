import { Module } from '@nestjs/common';
import { NodeTypeService } from './node-type/node-type.service';
import { NodeTypeController } from './node-type/node-type.controller';

@Module({
  controllers: [NodeTypeController],
  providers: [NodeTypeService],
})
export class AdminModule {}
