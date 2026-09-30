import { Module, OnApplicationBootstrap, forwardRef } from '@nestjs/common';
import * as crypto from 'crypto';
import { SubscriptionModule } from '../subscription/subscription.module';
import { SubscriptionOrderService } from '../subscription/subscription-order.service';
import { TeamModule } from '../team/team.module';
import { TeamRechargeService } from '../team/team-recharge.service';
import { RechargeController } from './recharge.controller';
import { RechargeService } from './recharge.service';
import { WechatPaymentProvider } from './providers/wechat-payment.provider';
import { PaymentGateway } from './payment.gateway';
import { REDIS_CLIENT, createManagedRedis } from '../../common/redis/managed-redis';

@Module({
  imports: [forwardRef(() => SubscriptionModule), forwardRef(() => TeamModule)],
  controllers: [RechargeController],
  providers: [
    RechargeService,
    PaymentGateway,
    { provide: REDIS_CLIENT, useFactory: () => createManagedRedis() },   // 批3-2 B6 受管工厂
    {
      provide: 'PAYMENT_PROVIDER',
      useFactory: () => {
        if (!process.env.WECHAT_PAY_APP_ID) {
          return null;
        }
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
    {
      provide: 'SUB_ORDER_SERVICE',
      useExisting: SubscriptionOrderService,
    },
    {
      provide: 'TEAM_RECHARGE_SERVICE',
      useExisting: TeamRechargeService,
    },
  ],
  exports: [RechargeService, PaymentGateway, 'PAYMENT_PROVIDER'],
})
export class RechargeModule implements OnApplicationBootstrap {
  onApplicationBootstrap() {
    validateWeChatPayConfig();
  }
}

function validateWeChatPayConfig() {
  if (!process.env.WECHAT_PAY_APP_ID) {
    return;
  }
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
    throw new Error(`[WeChat Pay] WECHAT_PAY_PRIVATE_KEY 密钥格式无效: ${(e as Error).message}`, { cause: e });
  }

  try {
    crypto.createPublicKey(WechatPaymentProvider.normalizePem(process.env.WECHAT_PAY_PUBLIC_KEY!));
  } catch (e) {
    throw new Error(`[WeChat Pay] WECHAT_PAY_PUBLIC_KEY 密钥格式无效: ${(e as Error).message}`, { cause: e });
  }

  try {
    new crypto.X509Certificate(WechatPaymentProvider.normalizePem(process.env.WECHAT_PAY_MERCHANT_CERT!));
  } catch (e) {
    throw new Error(`[WeChat Pay] WECHAT_PAY_MERCHANT_CERT 证书格式无效: ${(e as Error).message}`, { cause: e });
  }
}
