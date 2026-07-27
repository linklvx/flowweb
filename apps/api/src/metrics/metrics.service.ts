import { Injectable } from '@nestjs/common';
import { Counter, Histogram, register, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly ordersCreatedTotal: Counter<string>;
  readonly ordersCompletedTotal: Counter<string>;
  readonly ordersClosedTotal: Counter<string>;
  readonly callbackTotal: Counter<string>;
  readonly wechatApiDurationSeconds: Histogram<string>;
  readonly amountFenTotal: Counter<string>;
  readonly callbackDurationSeconds: Histogram<string>;
  readonly subOrdersCreatedTotal: Counter<string>;
  readonly subPaymentsInitiatedTotal: Counter<string>;
  readonly subPaymentsSucceededTotal: Counter<string>;
  readonly subPaymentDurationSeconds: Histogram<string>;
  readonly subCallbackLatencySeconds: Histogram<string>;

  constructor() {
    collectDefaultMetrics();

    this.ordersCreatedTotal = new Counter({
      name: 'recharge_orders_created_total',
      help: '各金额档位充值订单创建数。标签 amount_tier 为充值金额（元）。',
      labelNames: ['amount_tier'],
      registers: [register],
    });
    this.ordersCompletedTotal = new Counter({
      name: 'recharge_orders_completed_total',
      help: '支付成功数，channel 区分来源（callback/active_query）。',
      labelNames: ['channel'],
      registers: [register],
    });
    this.ordersClosedTotal = new Counter({
      name: 'recharge_orders_closed_total',
      help: '订单关闭数，reason 区分原因（expired/manual/api_fail）。',
      labelNames: ['reason'],
      registers: [register],
    });
    this.callbackTotal = new Counter({
      name: 'recharge_callback_total',
      help: '微信支付回调处理结果计数。',
      labelNames: ['result'],
      registers: [register],
    });
    this.wechatApiDurationSeconds = new Histogram({
      name: 'recharge_wechat_api_duration_seconds',
      help: '微信支付 API 调用耗时（秒）。',
      labelNames: ['api'],
      buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
      registers: [register],
    });
    this.amountFenTotal = new Counter({
      name: 'recharge_amount_fen_total',
      help: '累计充值金额（分），用于财务对账。',
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
