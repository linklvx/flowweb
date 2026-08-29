import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RechargeService } from './recharge.service';
import type Redis from 'ioredis';

vi.mock('@sentry/nestjs', () => ({
  captureException: vi.fn(),
  withScope: vi.fn((fn: Function) => fn({ setTag: vi.fn(), setLevel: vi.fn() })),
}));

function mockMetrics() {
  return {
    ordersCreatedTotal: { inc: vi.fn() },
    ordersCompletedTotal: { inc: vi.fn() },
    ordersClosedTotal: { inc: vi.fn() },
    callbackTotal: { inc: vi.fn() },
    wechatApiDurationSeconds: { startTimer: vi.fn(() => vi.fn()) },
    amountFenTotal: { inc: vi.fn() },
    callbackDurationSeconds: { startTimer: vi.fn(() => vi.fn()) },
  } as any;
}

const JSON_HEADERS = {
  'content-type': 'application/json',
  'wechatpay-nonce': 'n1',
};

describe('RechargeService.handleCallback（回调分发）', () => {
  let metrics: any;
  let payment: any;
  let redis: any;
  let subOrderService: any;
  let teamRechargeService: any;
  let service: RechargeService;

  beforeEach(() => {
    metrics = mockMetrics();
    payment = {
      parseNotify: vi.fn(),
    };
    redis = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK') };
    subOrderService = { processPaymentCallback: vi.fn() };
    teamRechargeService = { completeTeamCallback: vi.fn() };
    service = new RechargeService(metrics, payment, redis as unknown as Redis, subOrderService, teamRechargeService);
  });

  it('should return FAIL for non-JSON content-type', async () => {
    const result = await service.handleCallback({ 'content-type': 'text/plain' }, Buffer.from('{}'));
    expect(result.code).toBe('FAIL');
    expect(payment.parseNotify).not.toHaveBeenCalled();
  });

  it('should return SUCCESS without parsing when nonce already seen (dedup)', async () => {
    redis.get.mockResolvedValue('1');
    const result = await service.handleCallback({ ...JSON_HEADERS, 'wechatpay-nonce': 'dup' }, Buffer.from('{}'));
    expect(result).toEqual({ code: 'SUCCESS', message: 'OK' });
    expect(payment.parseNotify).not.toHaveBeenCalled();
  });

  it('should return FAIL on signature verification failure', async () => {
    payment.parseNotify.mockRejectedValue(new Error('bad signature'));
    const result = await service.handleCallback(JSON_HEADERS, Buffer.from('{}'));
    expect(result.code).toBe('FAIL');
    expect(metrics.callbackTotal.inc).toHaveBeenCalledWith({ result: 'sig_fail' });
  });

  it('should route SUB-prefixed order to subscription handler', async () => {
    payment.parseNotify.mockResolvedValue({ outTradeNo: 'SUB202608290001', tradeState: 'SUCCESS' });
    subOrderService.processPaymentCallback.mockResolvedValue({ code: 'SUCCESS', message: 'OK' });

    const result = await service.handleCallback(JSON_HEADERS, Buffer.from('{}'));

    expect(subOrderService.processPaymentCallback).toHaveBeenCalledWith({ outTradeNo: 'SUB202608290001', tradeState: 'SUCCESS' });
    expect(teamRechargeService.completeTeamCallback).not.toHaveBeenCalled();
    expect(result.code).toBe('SUCCESS');
  });

  it('should route TEAM-prefixed order to team handler', async () => {
    payment.parseNotify.mockResolvedValue({ outTradeNo: 'TEAM202608290001', tradeState: 'SUCCESS' });
    teamRechargeService.completeTeamCallback.mockResolvedValue({ code: 'SUCCESS', message: 'OK' });

    const result = await service.handleCallback(JSON_HEADERS, Buffer.from('{}'));

    expect(teamRechargeService.completeTeamCallback).toHaveBeenCalledWith({ outTradeNo: 'TEAM202608290001', tradeState: 'SUCCESS' });
    expect(subOrderService.processPaymentCallback).not.toHaveBeenCalled();
    expect(result.code).toBe('SUCCESS');
  });

  it('should return FAIL for unknown order number (User-level orders removed)', async () => {
    payment.parseNotify.mockResolvedValue({ outTradeNo: 'RC20260726USER00123456', tradeState: 'SUCCESS' });

    const result = await service.handleCallback(JSON_HEADERS, Buffer.from('{}'));

    expect(result).toEqual({ code: 'FAIL', message: 'order not found' });
    expect(metrics.callbackTotal.inc).toHaveBeenCalledWith({ result: 'unknown_order' });
  });
});
