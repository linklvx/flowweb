import { Module } from '@nestjs/common';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';
import { TopologyService } from './topology.service';
import { ValidationService } from './validation.service';
import { ApiCallerService } from './api-caller.service';
import { CreditModule } from '../credit/credit.module';
import { ExecutionGateway } from '../gateway/execution.gateway';

@Module({
  imports: [CreditModule],
  controllers: [ExecutionController],
  providers: [ExecutionService, TopologyService, ValidationService, ApiCallerService, ExecutionGateway],
})
export class ExecutionModule {}
