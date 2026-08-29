import { Injectable, Inject, Optional } from '@nestjs/common';
import type Redis from 'ioredis';
import * as Sentry from '@sentry/nestjs';
import { MetricsService } from '../../metrics/metrics.service';
import type { IPaymentProvider } from './providers/payment.provider.interface';

@Injectable()
export class RechargeService {
  constructor(
    @Inject(MetricsService) private readonly metrics: MetricsService,
    @Inject('PAYMENT_PROVIDER') private readonly payment: IPaymentProvider,
    @Optional() @Inject('REDIS_CLIENT') private readonly redis?: Redis,
    @Optional() @Inject('SUB_ORDER_SERVICE') private readonly subOrderService?: any,
    @Optional() @Inject('TEAM_RECHARGE_SERVICE') private readonly teamRechargeService?: any,
  ) {}

  // 微信支付回调唯一入口：按单号前缀分发（SUB→订阅 / TEAM→团队充值与订阅 / 未知→FAIL）
  async handleCallback(headers: Record<string, string>, rawBody: Buffer) {
    const endDuration = this.metrics.callbackDurationSeconds.startTimer();

    const contentType = headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      endDuration({ result: 'error' });
      return { code: 'FAIL', message: 'Invalid Content-Type' };
    }

    // Nonce dedup via Redis
    const nonce = headers['wechatpay-nonce'];
    if (nonce && this.redis) {
      const key = `wechat:pay:notify:nonce:${nonce}`;
      const exists = await this.redis.get(key);
      if (exists) {
        endDuration({ result: 'success' });
        return { code: 'SUCCESS', message: 'OK' };
      }
      await this.redis.set(key, '1', 'EX', 300);
    }

    // Parse and verify signature
    let notify;
    try {
      notify = await this.payment.parseNotify(headers, rawBody);
    } catch (err) {
      this.metrics.callbackTotal.inc({ result: 'sig_fail' });
      endDuration({ result: 'sig_fail' });

      Sentry.captureException(err, (scope) => {
        scope.setTag('module', 'recharge');
        scope.setLevel('error');
        return scope;
      });

      return { code: 'FAIL', message: 'signature verification failed' };
    }

    // === Route by out_trade_no prefix (MUST come before table query) ===
    const outTradeNo = notify.outTradeNo;

    if ((outTradeNo as string).startsWith('SUB')) {
      // Subscription order callback — route to subscription handler
      if (!this.subOrderService) {
        endDuration({ result: 'error' });
        return { code: 'FAIL', message: 'subscription processing not available' };
      }
      try {
        const result = await this.subOrderService.processPaymentCallback(notify);
        endDuration({ result: result.code === 'SUCCESS' ? 'success' : 'error' });
        return result;
      } catch (err) {
        Sentry.captureException(err, (scope) => {
          scope.setTag('module', 'subscription-callback');
          scope.setTag('orderNo', outTradeNo);
          scope.setLevel('fatal');
          return scope;
        });
        endDuration({ result: 'error' });
        return { code: 'FAIL', message: 'internal error' };
      }
    }

    if ((outTradeNo as string).startsWith('TEAM')) {
      // Team order callback (recharge / Task10: subscription) — route to team handler
      if (!this.teamRechargeService) {
        endDuration({ result: 'error' });
        return { code: 'FAIL', message: 'team order processing not available' };
      }
      try {
        const result = await this.teamRechargeService.completeTeamCallback(notify);
        endDuration({ result: result.code === 'SUCCESS' ? 'success' : 'error' });
        return result;
      } catch {
        endDuration({ result: 'error' });
        return { code: 'FAIL', message: 'internal error' };
      }
    }

    // Unknown order number — reject to let WeChat retry/stop
    this.metrics.callbackTotal.inc({ result: 'unknown_order' });
    endDuration({ result: 'error' });
    return { code: 'FAIL', message: 'order not found' };
  }
}
