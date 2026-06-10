import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';
import { TopologyService } from './topology.service';
import { ValidationService } from './validation.service';
import { ApiCallerService } from './api-caller.service';
import { ExecutionProcessor } from './execution.processor';
import { CreditModule } from '../credit/credit.module';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { EXECUTION_QUEUE_NAME, EXECUTION_CONNECTION_NAME } from './execution.constants';

@Module({
  imports: [
    CreditModule,
    BullModule.registerQueue({
      name: EXECUTION_QUEUE_NAME,
      configKey: EXECUTION_CONNECTION_NAME,
    }),
    BullModule.registerQueue({
      name: 'ai-result-download',
    }),
  ],
  controllers: [ExecutionController],
  providers: [
    ExecutionService,
    TopologyService,
    ValidationService,
    ApiCallerService,
    ExecutionGateway,
    ExecutionProcessor,
  ],
  exports: [ExecutionService, ExecutionGateway, ApiCallerService],
})
export class ExecutionModule {}
