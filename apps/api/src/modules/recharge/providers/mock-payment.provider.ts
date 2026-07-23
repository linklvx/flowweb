import { Injectable } from '@nestjs/common';
import type { IPaymentProvider } from './payment.provider.interface';

@Injectable()
export class MockPaymentProvider implements IPaymentProvider {
  async pay(order: { orderNo: string; amount: number; userId: string }) {
    return { success: true, tradeNo: `MOCK_${order.orderNo}` };
  }
}
