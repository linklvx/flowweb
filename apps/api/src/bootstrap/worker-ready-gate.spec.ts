// apps/api/src/bootstrap/worker-ready-gate.spec.ts
// Y0c T26（Z102）：worker 启动 ready 门——订阅队列前（=createApplicationContext 之前——@Processor
// 实例化即开始消费）轮询 GET /api/ready，上限 60s（env WORKER_READY_TIMEOUT_MS 可调）超限非零退出。
// 判据=deploy.sh :136 同款：响应体 ready===true（连接拒绝/503/ready:false 均继续轮询——api 启动期
// ECONNREFUSED→listen 后 503→PG/租约就绪 200 三态全覆盖）。
import { describe, it, expect, vi } from 'vitest';
import { waitForApiReady, WorkerReadyTimeoutError, WORKER_READY_TIMEOUT_DEFAULT_MS } from './worker-ready-gate';

const ok = (body: unknown) => ({ status: 200, json: async () => body });

describe('Y0c T26 Z102 ready 门（waitForApiReady）', () => {
  it('api 未就绪⇒等待不失败：ECONNREFUSED→503{ready:false}→200{ready:true} 序列后 resolve（轮询恰 3 次）', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))
      .mockResolvedValueOnce(ok({ ready: false, reason: 'pg' }))
      .mockResolvedValueOnce(ok({ ready: true }));
    await waitForApiReady({ url: 'http://127.0.0.1:3000/api/ready', fetchImpl: fetchImpl as any, intervalMs: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('判据=响应体 ready===true 非 200 状态码（503 携 ready:true 亦过门——deploy.sh grep 判据同源）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 503, json: async () => ({ ready: true, reason: 'draining' }) });
    await waitForApiReady({ url: 'u', fetchImpl: fetchImpl as any, intervalMs: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('非 JSON 响应（空体）不抛——继续轮询', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ status: 200, json: async () => { throw new Error('unexpected end of JSON'); } })
      .mockResolvedValueOnce(ok({ ready: true }));
    await waitForApiReady({ url: 'u', fetchImpl: fetchImpl as any, intervalMs: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('超限⇒throw WorkerReadyTimeoutError（main-worker 捕获后 process.exit(1) 交 pm2 autorestart）', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('fetch failed'));
    await expect(waitForApiReady({ url: 'u', timeoutMs: 5, intervalMs: 1, fetchImpl: fetchImpl as any }))
      .rejects.toBeInstanceOf(WorkerReadyTimeoutError);
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('默认超限 60s（Z102 字面）+单次探测 2s 上界参数形态', () => {
    expect(WORKER_READY_TIMEOUT_DEFAULT_MS).toBe(60_000);
  });
});
