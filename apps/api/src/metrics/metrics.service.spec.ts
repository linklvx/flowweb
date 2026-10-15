import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockRegister, mockCollectDefaultMetrics, mockInc, mockObserve, mockCounter, mockHistogram, mockGauge, mockReadTree } = vi.hoisted(() => ({
  mockRegister: { metrics: vi.fn().mockResolvedValue('# HELP test_metric Test\n'), contentType: 'text/plain; version=0.0.4; charset=utf-8' },
  mockCollectDefaultMetrics: vi.fn(),
  mockInc: vi.fn(),
  mockObserve: vi.fn(),
  mockCounter: vi.fn().mockImplementation(() => ({ inc: vi.fn() })),
  mockHistogram: vi.fn().mockImplementation(() => ({ observe: vi.fn() })),
  mockGauge: vi.fn().mockImplementation(() => ({ set: vi.fn(), reset: vi.fn() })),
  mockReadTree: vi.fn(),
}));

vi.mock('prom-client', () => ({
  register: mockRegister,
  collectDefaultMetrics: mockCollectDefaultMetrics,
  Counter: mockCounter,
  Histogram: mockHistogram,
  Gauge: mockGauge,
}));

vi.mock('./process-tree-rss', () => ({
  readProcessTreeRssBytes: mockReadTree,
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

  it('should create callbackTotal counter with result label', () => {
    expect(mockCounter).toHaveBeenCalledWith(expect.objectContaining({
      name: 'recharge_callback_total',
      labelNames: ['result'],
    }));
  });

  it('should create callbackDurationSeconds histogram', () => {
    expect(mockHistogram).toHaveBeenCalledWith(expect.objectContaining({
      name: 'recharge_callback_duration_seconds',
      labelNames: ['result'],
    }));
  });

  it('should expose all 7 metrics as properties', () => {
    expect(service.callbackTotal).toBeDefined();
    expect(service.callbackDurationSeconds).toBeDefined();
    expect(service.subOrdersCreatedTotal).toBeDefined();
    expect(service.subPaymentsInitiatedTotal).toBeDefined();
    expect(service.subPaymentsSucceededTotal).toBeDefined();
    expect(service.subPaymentDurationSeconds).toBeDefined();
    expect(service.subCallbackLatencySeconds).toBeDefined();
  });

  it('should return prometheus text from getMetricsText', async () => {
    const text = await service.getMetricsText();
    expect(text).toBe('# HELP test_metric Test\n');
    expect(mockRegister.metrics).toHaveBeenCalledOnce();
  });
});

// Y0c T29（Z91①/Z117①）：process_tree_rss_bytes 注册点=MetricsService 构造器（collectDefaultMetrics
// 旁——MetricsCoreModule 双进程装配，api/worker 各自暴露自进程树）。collect 每次先 reset 再算
// （防陈旧值）；null（非 Linux/采集失败）⇒ 不 set——不上报任何样本不给假数。
describe('MetricsService process_tree_rss_bytes（Y0c T29）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    new MetricsService();
  });

  it('Gauge 注册于构造器（name=process_tree_rss_bytes+collect 回调）', () => {
    expect(mockGauge).toHaveBeenCalledWith(expect.objectContaining({
      name: 'process_tree_rss_bytes',
      collect: expect.any(Function),
    }));
  });

  it('collect 成功档：先 reset 再 set（防陈旧值——顺序断言）', async () => {
    mockReadTree.mockReturnValue(12345);
    const cfg = mockGauge.mock.calls[0][0];
    const ctx = { reset: vi.fn(), set: vi.fn() };
    await cfg.collect.call(ctx);
    expect(ctx.reset).toHaveBeenCalledOnce();
    expect(ctx.set).toHaveBeenCalledWith(12345);
    expect(ctx.reset.mock.invocationCallOrder[0]).toBeLessThan(ctx.set.mock.invocationCallOrder[0]);
  });

  it('collect 失败档（null=非 Linux/采集失败）：reset 后不 set——不上报任何样本', async () => {
    mockReadTree.mockReturnValue(null);
    const cfg = mockGauge.mock.calls[0][0];
    const ctx = { reset: vi.fn(), set: vi.fn() };
    await cfg.collect.call(ctx);
    expect(ctx.reset).toHaveBeenCalledOnce();
    expect(ctx.set).not.toHaveBeenCalled();
  });
});
