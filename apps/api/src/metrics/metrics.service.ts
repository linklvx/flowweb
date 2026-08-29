import { Injectable } from '@nestjs/common';
import { Counter, Histogram, register, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly callbackTotal: Counter<string>;
  readonly callbackDurationSeconds: Histogram<string>;
  readonly subOrdersCreatedTotal: Counter<string>;
  readonly subPaymentsInitiatedTotal: Counter<string>;
  readonly subPaymentsSucceededTotal: Counter<string>;
  readonly subPaymentDurationSeconds: Histogram<string>;
  readonly subCallbackLatencySeconds: Histogram<string>;

  constructor() {
    collectDefaultMetrics();

    this.callbackTotal = new Counter({
      name: 'recharge_callback_total',
      help: '微信支付回调处理结果计数。',
      labelNames: ['result'],
      registers: [register],
    });
    this.callbackDurationSeconds = new Histogram({
      name: 'recharge_callback_duration_seconds',
      help: '回调全链路处理耗时（秒），包含验签+入账。',
      labelNames: ['result'],
      registers: [register],
    });
    this.subOrdersCreatedTotal = new Counter({
      name: 'subscription_orders_created_total',
      help: '订阅订单创建数，标签 plan_tier (套餐等级) / type (new_purchase|upgrade)。',
      labelNames: ['plan_tier', 'type'],
      registers: [register],
    });
    this.subPaymentsInitiatedTotal = new Counter({
      name: 'subscription_payments_initiated_total',
      help: '订阅支付发起数。',
      registers: [register],
    });
    this.subPaymentsSucceededTotal = new Counter({
      name: 'subscription_payments_succeeded_total',
      help: '订阅支付成功数（回调触发）。',
      registers: [register],
    });
    this.subPaymentDurationSeconds = new Histogram({
      name: 'subscription_payment_duration_seconds',
      help: '订阅订单从创建到支付的耗时（秒）。',
      buckets: [10, 30, 60, 120, 300, 600, 1800, 3600, 7200],
      registers: [register],
    });
    this.subCallbackLatencySeconds = new Histogram({
      name: 'subscription_callback_latency_seconds',
      help: '微信回调到达延迟（秒）。',
      buckets: [1, 3, 5, 10, 30, 60, 120, 300],
      registers: [register],
    });
  }

  async getMetricsText(): Promise<string> {
    return register.metrics();
  }
}
