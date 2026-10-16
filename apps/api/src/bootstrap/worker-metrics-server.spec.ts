// apps/api/src/bootstrap/worker-metrics-server.spec.ts
// Y0c T26（Z139）+T29-I（Z116）：worker 3002 loopback 指标出口——node:http 独立 server 返
// register.metrics() 文本；三族验收（process_resident_memory_bytes/nodejs_heap_size_used_bytes/
// nodejs_eventloop_lag_seconds 存在且带 role="worker"——Z139：MetricsCore 在 worker 装配=
// collectDefaultMetrics 唯一点）；token fail-closed+WORKER_METRICS_PORT env 键化=T29-I 已落，
// health 扩读归 T29 第二包。
import { describe, it, expect, afterAll, vi } from 'vitest';
import { collectDefaultMetrics, register } from 'prom-client';
import * as net from 'node:net';
import type { Server } from 'node:http';
import { startWorkerMetricsServer, WORKER_METRICS_PORT } from './worker-metrics-server';

collectDefaultMetrics();
register.setDefaultLabels({ role: 'worker' });   // main-worker 引导层同款（Z138——测试进程内模拟）

const servers: Server[] = [];
afterAll(() => { for (const s of servers) s.close(); });

describe('Y0c T26 Z139 worker 指标出口（3002 loopback）', () => {
  it('端口缺省常量=3002（使用点默认单源——env WORKER_METRICS_PORT 未设时生效，T29-I 键化已落）', () => {
    expect(WORKER_METRICS_PORT).toBe(3002);
  });

  it('GET 返回 prom-client 文本（content-type 对齐）且绑 127.0.0.1（loopback only——不进 nginx）', async () => {
    const server = await startWorkerMetricsServer({ port: 0, nodeEnv: 'development' });
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
    const server = await startWorkerMetricsServer({ port: 0, nodeEnv: 'development' });
    servers.push(server);
    const { port } = server.address() as import('node:net').AddressInfo;
    const text = await (await fetch(`http://127.0.0.1:${port}/metrics`)).text();
    expect(text, 'process_resident_memory_bytes 应带 role="worker"').toMatch(/process_resident_memory_bytes\{[^}]*role="worker"/);
    expect(text, 'nodejs_heap_size_used_bytes 应带 role="worker"').toMatch(/nodejs_heap_size_used_bytes\{[^}]*role="worker"/);
    expect(text, 'nodejs_eventloop_lag_seconds 应带 role="worker"（eventloop_lag 族）').toMatch(/nodejs_eventloop_lag_seconds\{[^}]*role="worker"/);
  });
});

// Y0c T29（Z116）：3002 fail-closed——复用 PROMETHEUS_TOKEN（与 api /metrics 同 token 同 header
// x-prometheus-token），请求级严格镜像 prometheus-auth.guard（token 已设⇒timingSafeEqual 比对不符 403；
// 未设⇒仅 development 放行，NODE_ENV 未设/'test'/'production'/其他一律拒〔production 纵深冗余——
// 主防线=env superRefine production∧worker 未设拒启〕）。token/nodeEnv 经 opts 注入（main-worker 从
// validateEnv 返回值透传——本文件零 process.env 裸读，census ㉒ 零新增登记面）。
describe('Y0c T29 Z116 3002 token fail-closed（同 PROMETHEUS_TOKEN 形态）', () => {
  const urlOf = (s: Server) => `http://127.0.0.1:${(s.address() as import('node:net').AddressInfo).port}/metrics`;

  it('token 已设：header 不符 403', async () => {
    const server = await startWorkerMetricsServer({ port: 0, token: 'tok-secret' });
    servers.push(server);
    const res = await fetch(urlOf(server), { headers: { 'x-prometheus-token': 'wrong-token' } });
    expect(res.status).toBe(403);
  });

  it('token 已设：header 缺失 403', async () => {
    const server = await startWorkerMetricsServer({ port: 0, token: 'tok-secret' });
    servers.push(server);
    expect((await fetch(urlOf(server))).status).toBe(403);
  });

  it('token 已设：header 相符 200 且返回 prom 文本', async () => {
    const server = await startWorkerMetricsServer({ port: 0, token: 'tok-secret' });
    servers.push(server);
    const res = await fetch(urlOf(server), { headers: { 'x-prometheus-token': 'tok-secret' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(register.contentType);
    expect((await res.text()).length).toBeGreaterThan(0);
  });

  it('token 未设 ∧ production：403（fail-closed 纵深冗余——主防线=env 拒启）', async () => {
    const server = await startWorkerMetricsServer({ port: 0, nodeEnv: 'production' });
    servers.push(server);
    expect((await fetch(urlOf(server))).status).toBe(403);
  });

  it('token 未设 ∧ NODE_ENV 未设：403（严格镜像 prometheus-auth.guard——「Production (or no NODE_ENV): token is mandatory」）', async () => {
    const server = await startWorkerMetricsServer({ port: 0 });
    servers.push(server);
    expect((await fetch(urlOf(server))).status).toBe(403);
  });

  it('token 未设 ∧ development：放行 200（本地开发便利——唯一放行档）', async () => {
    const server = await startWorkerMetricsServer({ port: 0, nodeEnv: 'development' });
    servers.push(server);
    expect((await fetch(urlOf(server))).status).toBe(200);
  });
});

// Y0c T29-II（R0①）：handler 顺序缺陷——writeHead(200) 先于 await register.metrics()，metrics()
// reject 时 catch 内 writeHead(500) 必抛 ERR_HTTP_HEADERS_SENT，客户端得 socket 挂断而非 500。
// 修法=先 await 文本再 writeHead(200)+end(text)，reject 走真 500。
describe('Y0c T29-II R0① metrics() reject → 真 500（非 socket 挂断）', () => {
  it('register.metrics() reject：客户端收到 500 + 错误正文', async () => {
    const server = await startWorkerMetricsServer({ port: 0, nodeEnv: 'development' });
    servers.push(server);
    const url = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/metrics`;
    const spy = vi.spyOn(register, 'metrics').mockRejectedValueOnce(new Error('metrics boom'));
    let outcome: { status: number; body: string } | { fetchError: string };
    try {
      const res = await fetch(url);
      outcome = { status: res.status, body: await res.text() };
    } catch (e) {
      outcome = { fetchError: e instanceof Error ? e.message : String(e) };
    }
    spy.mockRestore();
    expect(outcome, `期望 500（实得 ${JSON.stringify(outcome)}——writeHead(200) 先行则 catch 内 500 不可达）`).toMatchObject({ status: 500 });
    expect((outcome as { body: string }).body).toMatch(/metrics boom/);
  });
});

// Y0c T33（D 出口判据「ws 升级拒绝」·§0.6 偏离 52①）：3002=worker 唯一监听面——node:http 无
// 'upgrade' 监听器 ⇒ 协议切换结构性不可能（v24 实测：升级请求被当普通请求走 handler，回 200 文本
// 非 101；旧版行为=socket destroy。断言只钉「非 101」=版本鲁棒的两行为统一判据——WS 客户端收
// 非 101 即握手失败〔RFC 6455〕；显式钉死防未来加 upgrade 监听器静默漂移）。
// 判据其余两层=引用面：3000/3001 双 ECONNREFUSED（worker.module.spec——ws 握手前置 TCP 建连即拒）
// +结构面（worker.module 零 controller/providers 无 CollabGateway；PaymentGateway application-context
// 实例化不监听——worker.module.ts :156 注）。
describe('Y0c T33 D 出口：ws 升级拒绝（3002 唯一监听面——偏离 52①）', () => {
  it('裸 WS 升级请求 ⇒ 非 101（协议切换不可能）；server 不受污染（后续普通 GET 仍 200）', async () => {
    const server = await startWorkerMetricsServer({ port: 0, nodeEnv: 'development' });
    servers.push(server);
    const { port } = server.address() as import('node:net').AddressInfo;
    const head = await new Promise<string>((resolve) => {
      let buf = '';
      const sock = net.connect({ port, host: '127.0.0.1' }, () => {
        sock.write(
          'GET /metrics HTTP/1.1\r\n'
          + `Host: 127.0.0.1:${port}\r\n`
          + 'Upgrade: websocket\r\n'
          + 'Connection: Upgrade\r\n'
          + 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n'
          + 'Sec-WebSocket-Version: 13\r\n\r\n',
        );
      });
      // v24 行为=200+keep-alive 不主动关：收到完整响应头即判（首个 \r\n\r\n）；被关/3s 兜底同收口
      const watchdog = setTimeout(() => { sock.destroy(); resolve(buf); }, 3_000);
      sock.on('data', (d) => {
        buf += d.toString('latin1');
        if (buf.includes('\r\n\r\n')) { clearTimeout(watchdog); sock.destroy(); resolve(buf); }
      });
      sock.on('error', () => { /* ECONNRESET/被关=拒绝同族——首响应头已足判 */ });
      sock.on('close', () => { clearTimeout(watchdog); resolve(buf); });
    });
    expect(head.startsWith('HTTP/1.1 101'), `升级必须非 101（实收头 ${JSON.stringify(head.slice(0, 80))}）`).toBe(false);
    // server 不受污染：升级尝试后普通 GET 仍 200（拒绝面非崩溃面）
    expect((await fetch(`http://127.0.0.1:${port}/metrics`)).status).toBe(200);
  }, 15_000);
});
