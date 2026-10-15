// apps/api/src/bootstrap/worker-metrics-server.ts
// Y0c T26（Z139/P4 简版）：worker 指标出口——node:http 独立 server 返 register.metrics() 文本，
// 绑 127.0.0.1:3002 loopback（**不进 nginx**——nginx 无 /metrics 路由是故意的）。3002 承载
// process_*/nodejs_* 族的前提=MetricsCoreModule 在 worker 装配（collectDefaultMetrics 全仓唯一
// 调用点=MetricsService 构造器，进程内恰一次）。T29 归位项（本文件注释登记）：token fail-closed
// （production 未设拒启）+WORKER_METRICS_PORT env 键化+health 扩读+process_tree_rss_bytes。
import * as http from 'node:http';
import { register } from 'prom-client';

/** Z139 契约值：worker 指标端口 3002（T29 落 WORKER_METRICS_PORT env 键时改读 env）。 */
export const WORKER_METRICS_PORT = 3002;

export interface WorkerMetricsServerOptions {
  /** 默认 WORKER_METRICS_PORT=3002（测试注入 0=ephemeral）。 */
  port?: number;
  /** 默认 127.0.0.1（loopback only——公网不可达是契约非缺省）。 */
  host?: string;
}

/** 起 worker 指标 server（main-worker 引导序列消费；返回原 server 供关停钩子 close）。 */
export async function startWorkerMetricsServer(opts: WorkerMetricsServerOptions = {}): Promise<http.Server> {
  const port = opts.port ?? WORKER_METRICS_PORT;
  const host = opts.host ?? '127.0.0.1';
  const server = http.createServer(async (_req, res) => {
    try {
      res.writeHead(200, { 'content-type': register.contentType });
      res.end(await register.metrics());
    } catch (err) {
      res.writeHead(500);
      res.end(`worker metrics error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  return server;
}
