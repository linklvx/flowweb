import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockRegister, mockCollectDefaultMetrics, mockInc, mockObserve, mockCounter, mockHistogram } = vi.hoisted(() => ({
  mockRegister: { metrics: vi.fn().mockResolvedValue('# HELP test_metric Test\n'), contentType: 'text/plain; version=0.0.4; charset=utf-8' },
  mockCollectDefaultMetrics: vi.fn(),
  mockInc: vi.fn(),
  mockObserve: vi.fn(),
  mockCounter: vi.fn().mockImplementation(() => ({ inc: vi.fn() })),
  mockHistogram: vi.fn().mockImplementation(() => ({ observe: vi.fn() })),
}));

vi.mock('prom-client', () => ({
  register: mockRegister,
  collectDefaultMetrics: mockCollectDefaultMetrics,
  Counter: mockCounter,
  Histogram: mockHistogram,
}));

import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MetricsService();
  });

  it('should call collectDefaultMetrics on construction', () => {
    expect(mockCollectDefaultMetrics).toHaveBeenCalledOnce();
  });

  it('should create ordersCreatedTotal counter', () => {
    expect(mockCounter).toHaveBeenCalledWith(expect.objectContaining({
      name: 'recharge_orders_created_total',
      labelNames: ['amount_tier'],
      registers: [mockRegister],
    }));
  });

  it('should create ordersCompletedTotal counter with channel label', () => {
    expect(mockCounter).toHaveBeenCalledWith(expect.objectContaining({
      name: 'recharge_orders_completed_total',
      labelNames: ['channel'],
    }));
  });

  it('should create ordersClosedTotal counter with reason label', () => {
    expect(mockCounter).toHaveBeenCalledWith(expect.objectContaining({
      name: 'recharge_orders_closed_total',
      labelNames: ['reason'],
    }));
  });

  it('should create callbackTotal counter with result label', () => {
    expect(mockCounter).toHaveBeenCalledWith(expect.objectContaining({
      name: 'recharge_callback_total',
      labelNames: ['result'],
    }));
  });

  it('should create wechatApiDurationSeconds histogram with custom buckets', () => {
    expect(mockHistogram).toHaveBeenCalledWith(expect.objectContaining({
      name: 'recharge_wechat_api_duration_seconds',
      labelNames: ['api'],
      buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
    }));
  });

  it('should create amountFenTotal counter without labels', () => {
    expect(mockCounter).toHaveBeenCalledWith(expect.objectContaining({
      name: 'recharge_amount_fen_total',
    }));
  });

  it('should create callbackDurationSeconds histogram', () => {
    expect(mockHistogram).toHaveBeenCalledWith(expect.objectContaining({
      name: 'recharge_callback_duration_seconds',
      labelNames: ['result'],
    }));
  });

  it('should expose all 7 metrics as properties', () => {
    expect(service.ordersCreatedTotal).toBeDefined();
    expect(service.ordersCompletedTotal).toBeDefined();
    expect(service.ordersClosedTotal).toBeDefined();
    expect(service.callbackTotal).toBeDefined();
    expect(service.wechatApiDurationSeconds).toBeDefined();
    expect(service.amountFenTotal).toBeDefined();
    expect(service.callbackDurationSeconds).toBeDefined();
  });

  it('should return prometheus text from getMetricsText', async () => {
    const text = await service.getMetricsText();
    expect(text).toBe('# HELP test_metric Test\n');
    expect(mockRegister.metrics).toHaveBeenCalledOnce();
  });
});
