import { Module } from '@nestjs/common';
import { CreditController } from './credit.controller';

@Module({
  controllers: [CreditController],
})
export class CreditModule {}
