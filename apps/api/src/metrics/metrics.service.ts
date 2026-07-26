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
  }

  async getMetricsText(): Promise<string> {
    return register.metrics();
  }
}
