// apps/api/src/bootstrap/worker-metrics-server.ts
// Y0c T26（Z139）+T29（Z116）：worker 指标出口——node:http 独立 server 返 register.metrics() 文本，
// 绑 127.0.0.1:3002 loopback（**不进 nginx**——nginx 无 /metrics 路由是故意的）。3002 承载
// process_*/nodejs_* 族的前提=MetricsCoreModule 在 worker 装配（collectDefaultMetrics 全仓唯一
// 调用点=MetricsService 构造器，进程内恰一次）。T29-I 已归位：token fail-closed（复用
// PROMETHEUS_TOKEN——请求级 403 纵深冗余，主防线=env superRefine production∧worker 未设拒启）
// +WORKER_METRICS_PORT env 键化（main-worker 经 validateEnv 透传）+process_tree_rss_bytes
// （MetricsService 注册——非本文件）。T29 第二包归位项：health 扩读（check-collab-health 3002）。
import * as http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { register } from 'prom-client';

/** Z139 契约值：worker 指标端口缺省 3002（使用点默认单源——env WORKER_METRICS_PORT 未设时生效）。 */
export const WORKER_METRICS_PORT = 3002;

export interface WorkerMetricsServerOptions {
  /** 默认 WORKER_METRICS_PORT=3002（main-worker 传 env.WORKER_METRICS_PORT；测试注入 0=ephemeral）。 */
  port?: number;
  /** 默认 127.0.0.1（loopback only——公网不可达是契约非缺省）。 */
  host?: string;
  /** PROMETHEUS_TOKEN（main-worker 从 validateEnv 返回值透传——本文件零 process.env 裸读，census ㉒ 零新增面）。 */
  token?: string;
  /** NODE_ENV（同上透传）——token 未设 ∧ production ⇒ 403（纵深冗余；主防线=env superRefine 拒启）。 */
  nodeEnv?: string;
}

/** 请求级鉴权（Z116「同 token 形态」——prometheus-auth.guard 语义镜像+timingSafeEqual 强化）：
 *  token 已设⇒比对不符/缺失拒；未设∧production⇒拒；未设∧非 production⇒放行（本地开发便利）。 */
export function workerMetricsAuthOk(providedHeader: unknown, token: string | undefined, nodeEnv: string | undefined): boolean {
  if (!token) return nodeEnv !== 'production';
  if (typeof providedHeader !== 'string') return false;
  const provided = Buffer.from(providedHeader);
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/** 起 worker 指标 server（main-worker 引导序列消费；返回原 server 供关停钩子 close）。 */
export async function startWorkerMetricsServer(opts: WorkerMetricsServerOptions = {}): Promise<http.Server> {
  const port = opts.port ?? WORKER_METRICS_PORT;
  const host = opts.host ?? '127.0.0.1';
  const server = http.createServer(async (req, res) => {
    if (!workerMetricsAuthOk(req.headers['x-prometheus-token'], opts.token, opts.nodeEnv)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
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
