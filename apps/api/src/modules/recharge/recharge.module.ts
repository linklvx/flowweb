import { Module, OnApplicationBootstrap } from '@nestjs/common';
import * as crypto from 'crypto';
import { CreditModule } from '../credit/credit.module';
import { RechargeTaskModule } from './task/recharge-task.module';
import { RechargeController } from './recharge.controller';
import { RechargeService } from './recharge.service';
import { WechatPaymentProvider } from './providers/wechat-payment.provider';
import { PaymentGateway } from './payment.gateway';

@Module({
  imports: [CreditModule, RechargeTaskModule],
  controllers: [RechargeController],
  providers: [
    RechargeService,
    PaymentGateway,
    {
      provide: 'PAYMENT_PROVIDER',
      useFactory: () => {
        validateWeChatPayConfig();
        return new WechatPaymentProvider({
          WECHAT_PAY_APP_ID: process.env.WECHAT_PAY_APP_ID!,
          WECHAT_PAY_MCH_ID: process.env.WECHAT_PAY_MCH_ID!,
          WECHAT_PAY_API_V3_KEY: process.env.WECHAT_PAY_API_V3_KEY!,
          WECHAT_PAY_MERCHANT_SERIAL_NO: process.env.WECHAT_PAY_MERCHANT_SERIAL_NO!,
          WECHAT_PAY_PRIVATE_KEY: process.env.WECHAT_PAY_PRIVATE_KEY!,
          WECHAT_PAY_PUBLIC_KEY_ID: process.env.WECHAT_PAY_PUBLIC_KEY_ID!,
          WECHAT_PAY_PUBLIC_KEY: process.env.WECHAT_PAY_PUBLIC_KEY!,
        });
      },
    },
  ],
  exports: [RechargeService],
})
export class RechargeModule implements OnApplicationBootstrap {
  onApplicationBootstrap() {
    validateWeChatPayConfig();
  }
}

function validateWeChatPayConfig() {
  const pemKeys: [string, string][] = [
    ['WECHAT_PAY_PRIVATE_KEY', process.env.WECHAT_PAY_PRIVATE_KEY!],
    ['WECHAT_PAY_MERCHANT_CERT', process.env.WECHAT_PAY_MERCHANT_CERT!],
    ['WECHAT_PAY_PUBLIC_KEY', process.env.WECHAT_PAY_PUBLIC_KEY!],
  ];

  for (const [name, value] of pemKeys) {
    const normalized = WechatPaymentProvider.normalizePem(value);
    if (!normalized.includes('-----BEGIN')) {
      throw new Error(`[WeChat Pay] ${name} 格式无效 — 缺少 PEM 头尾标记`);
    }
  }

  try {
    crypto.createPrivateKey(WechatPaymentProvider.normalizePem(process.env.WECHAT_PAY_PRIVATE_KEY!));
  } catch (e) {
    throw new Error(`[WeChat Pay] WECHAT_PAY_PRIVATE_KEY 密钥格式无效: ${(e as Error).message}`);
  }

  try {
    crypto.createPublicKey(WechatPaymentProvider.normalizePem(process.env.WECHAT_PAY_PUBLIC_KEY!));
  } catch (e) {
    throw new Error(`[WeChat Pay] WECHAT_PAY_PUBLIC_KEY 密钥格式无效: ${(e as Error).message}`);
  }

  try {
    new crypto.X509Certificate(WechatPaymentProvider.normalizePem(process.env.WECHAT_PAY_MERCHANT_CERT!));
  } catch (e) {
    throw new Error(`[WeChat Pay] WECHAT_PAY_MERCHANT_CERT 证书格式无效: ${(e as Error).message}`);
  }
}
