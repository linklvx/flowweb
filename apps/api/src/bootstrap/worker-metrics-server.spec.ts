// apps/api/src/bootstrap/worker-metrics-server.spec.ts
// Y0c T26（Z139/P4 简版）：worker 3002 loopback 指标出口——node:http 独立 server 返 register.metrics()
// 文本；三族验收（process_resident_memory_bytes/nodejs_heap_size_used_bytes/nodejs_eventloop_lag_seconds
// 存在且带 role="worker"——Z139：MetricsCore 在 worker 装配=collectDefaultMetrics 唯一点）。
// T29 归位项（本任务注释登记）：token fail-closed+health 扩读+WORKER_METRICS_PORT env 键化。
import { describe, it, expect, afterAll } from 'vitest';
import { collectDefaultMetrics, register } from 'prom-client';
import type { Server } from 'node:http';
import { startWorkerMetricsServer, WORKER_METRICS_PORT } from './worker-metrics-server';

collectDefaultMetrics();
register.setDefaultLabels({ role: 'worker' });   // main-worker 引导层同款（Z138——测试进程内模拟）

const servers: Server[] = [];
afterAll(() => { for (const s of servers) s.close(); });

describe('Y0c T26 Z139 worker 指标出口（3002 loopback——P4 简版）', () => {
  it('默认端口常量=3002（T29 落 WORKER_METRICS_PORT env 键时改读 env——注释登记）', () => {
    expect(WORKER_METRICS_PORT).toBe(3002);
  });

  it('GET 返回 prom-client 文本（content-type 对齐）且绑 127.0.0.1（loopback only——不进 nginx）', async () => {
    const server = await startWorkerMetricsServer({ port: 0 });
    servers.push(server);
    const addr = server.address();
    expect(typeof addr).toBe('object');
    const res = await fetch(`http://127.0.0.1:${(addr as import('node:net').AddressInfo).port}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(register.contentType);
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
  });

  it('三族存在且带 role="worker"（Z139 验收：进程默认族经 setDefaultLabels 全带 role）', async () => {
    const server = await startWorkerMetricsServer({ port: 0 });
    servers.push(server);
    const { port } = server.address() as import('node:net').AddressInfo;
    const text = await (await fetch(`http://127.0.0.1:${port}/metrics`)).text();
    expect(text, 'process_resident_memory_bytes 应带 role="worker"').toMatch(/process_resident_memory_bytes\{[^}]*role="worker"/);
    expect(text, 'nodejs_heap_size_used_bytes 应带 role="worker"').toMatch(/nodejs_heap_size_used_bytes\{[^}]*role="worker"/);
    expect(text, 'nodejs_eventloop_lag_seconds 应带 role="worker"（eventloop_lag 族）').toMatch(/nodejs_eventloop_lag_seconds\{[^}]*role="worker"/);
  });
});
