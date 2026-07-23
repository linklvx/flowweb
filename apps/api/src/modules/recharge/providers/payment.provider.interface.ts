export interface IPaymentProvider {
  pay(order: {
    orderNo: string;
    amount: number; // 单位：分
    userId: string;
  }): Promise<{
    success: boolean;
    tradeNo: string;
  }>;
}
