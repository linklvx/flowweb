import { Module } from '@nestjs/common';
import { CreditModule } from '../credit/credit.module';
import { RechargeController } from './recharge.controller';
import { RechargeService } from './recharge.service';
import { MockPaymentProvider } from './providers/mock-payment.provider';

@Module({
  imports: [CreditModule],
  controllers: [RechargeController],
  providers: [
    RechargeService,
    { provide: 'PAYMENT_PROVIDER', useClass: MockPaymentProvider },
  ],
  exports: [RechargeService],
})
export class RechargeModule {}
