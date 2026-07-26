export interface CreatePaymentResult {
  codeUrl: string;
  prepayId: string;
}

export interface NotifyResult {
  outTradeNo: string;
  transactionId: string;
  tradeState: string;
  tradeStateDesc: string;
  amount: number;
  payerOpenid: string;
  appid: string;
  mchid: string;
}

export interface IPaymentProvider {
  createPayment(order: {
    orderNo: string;
    amount: number;
    userId: string;
    description: string;
    notifyUrl: string;
    timeExpire: string;
  }): Promise<CreatePaymentResult>;

  queryOrder(orderNo: string): Promise<{
    tradeState: string;
    tradeStateDesc: string;
    transactionId?: string;
    amount?: number;
    payerOpenid?: string;
  }>;

  parseNotify(headers: Record<string, string>, rawBody: Buffer): Promise<NotifyResult>;

  closePayment(orderNo: string): Promise<void>;
}
