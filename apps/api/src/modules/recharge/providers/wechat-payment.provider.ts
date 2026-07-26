import { Injectable } from '@nestjs/common';
import { Wechatpay, Aes } from 'wechatpay-axios-plugin';
import type { IPaymentProvider, CreatePaymentResult, NotifyResult } from './payment.provider.interface';

@Injectable()
export class WechatPaymentProvider implements IPaymentProvider {
  private readonly wxpay: InstanceType<typeof Wechatpay>;
  private readonly appId: string;
  private readonly mchId: string;
  private readonly apiV3Key: string;

  constructor(config: {
    WECHAT_PAY_APP_ID: string;
    WECHAT_PAY_MCH_ID: string;
    WECHAT_PAY_API_V3_KEY: string;
    WECHAT_PAY_MERCHANT_SERIAL_NO: string;
    WECHAT_PAY_PRIVATE_KEY: string;
    WECHAT_PAY_PUBLIC_KEY_ID: string;
    WECHAT_PAY_PUBLIC_KEY: string;
  }) {
    this.appId = config.WECHAT_PAY_APP_ID;
    this.mchId = config.WECHAT_PAY_MCH_ID;
    this.apiV3Key = config.WECHAT_PAY_API_V3_KEY;

    this.wxpay = new Wechatpay({
      mchid: this.mchId,
      serial: config.WECHAT_PAY_MERCHANT_SERIAL_NO,
      privateKey: WechatPaymentProvider.normalizePem(config.WECHAT_PAY_PRIVATE_KEY),
      certs: {
        [config.WECHAT_PAY_PUBLIC_KEY_ID]: WechatPaymentProvider.normalizePem(config.WECHAT_PAY_PUBLIC_KEY),
      },
    });
  }

  static normalizePem(key: string): string {
    if (!key.includes('-----BEGIN')) {
      // Base64 encoded
      key = Buffer.from(key, 'base64').toString('utf-8');
    }
    return key.replace(/\\n/g, '\n');
  }

  static formatTimeExpire(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d}T${hh}:${mm}:${ss}+08:00`;
  }

  async createPayment(order: {
    orderNo: string;
    amount: number;
    userId: string;
    description: string;
    notifyUrl: string;
    timeExpire: string;
  }): Promise<CreatePaymentResult> {
    const body = {
      appid: this.appId,
      mchid: this.mchId,
      description: order.description,
      out_trade_no: order.orderNo,
      time_expire: order.timeExpire,
      notify_url: order.notifyUrl,
      amount: { total: order.amount, currency: 'CNY' },
    };

    const response = await this.withRetry(() =>
      (this.wxpay as any).v3.pay.transactions.native.post(body),
    ) as any;

    const data = response.data as Record<string, any>;
    return {
      codeUrl: data.code_url,
      prepayId: data.prepay_id,
    };
  }

  async queryOrder(orderNo: string) {
    const response = await (this.wxpay as any).v3.pay.transactions.outTradeNo(orderNo).get();
    const data = response.data as Record<string, unknown>;
    const amount = (data.amount as Record<string, number>)?.total;
    const payer = data.payer as Record<string, string> | undefined;

    return {
      tradeState: data.trade_state as string,
      tradeStateDesc: data.trade_state_desc as string,
      transactionId: data.transaction_id as string | undefined,
      amount,
      payerOpenid: payer?.openid,
    };
  }

  async closePayment(orderNo: string): Promise<void> {
    await (this.wxpay as any).v3.pay.transactions.outTradeNo(orderNo).close.post({
      mchid: this.mchId,
    });
  }

  async parseNotify(headers: Record<string, string>, rawBody: Buffer): Promise<NotifyResult> {
    const timestamp = Number(headers['wechatpay-timestamp']);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(timestamp - now) > 300) {
      throw new Error(`Callback timestamp expired: diff=${Math.abs(timestamp - now)}s`);
    }

    const body = JSON.parse(rawBody.toString('utf-8'));
    const resource = body.resource as { ciphertext: string; nonce: string; associated_data: string };

    const decrypted = Aes.AesGcm.decrypt(
      resource.ciphertext,
      this.apiV3Key,
      resource.nonce,
      resource.associated_data,
    );

    const notify = JSON.parse(decrypted) as Record<string, unknown>;
    const notifyAmount = notify.amount as Record<string, number>;
    const notifyPayer = notify.payer as Record<string, string>;

    return {
      outTradeNo: notify.out_trade_no as string,
      transactionId: notify.transaction_id as string,
      tradeState: notify.trade_state as string,
      tradeStateDesc: notify.trade_state_desc as string,
      amount: notifyAmount.total,
      payerOpenid: notifyPayer.openid,
      appid: notify.appid as string,
      mchid: notify.mchid as string,
    };
  }

  private async withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
    let lastError: Error | undefined;
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err as Error;
        if (i < maxRetries) {
          await new Promise((r) => setTimeout(r, Math.pow(2, i) * 1000));
        }
      }
    }
    throw lastError;
  }
}
