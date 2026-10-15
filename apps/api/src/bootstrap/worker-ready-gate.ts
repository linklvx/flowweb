// apps/api/src/bootstrap/worker-ready-gate.ts
// Y0c T26（Z102）：worker 启动 ready 门——main-worker 在 createApplicationContext **之前**轮询
// GET /api/ready（@Processor 实例化即开始消费——「订阅队列前」的唯一落点=装配前）；上限 60s
// （env WORKER_READY_TIMEOUT_MS 可调）超限 throw WorkerReadyTimeoutError（main-worker 捕获后
// process.exit(1) 交 pm2 autorestart）。判据=deploy.sh :136 同源：响应体 ready===true（连接拒绝/
// 503/ready:false 均继续轮询——api 启动期三态全覆盖）。
/** Z102 字面默认：ready 门上限 60s（env WORKER_READY_TIMEOUT_MS 覆盖——默认值落使用点纪律）。 */
export const WORKER_READY_TIMEOUT_DEFAULT_MS = 60_000;

/** fetch 结构面子集（HttpCollabWritePort.HttpFetchLike 同形态——测试 mock 同形免环境依赖）。 */
type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

export class WorkerReadyTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`[WorkerReady] api ready 门超限（${timeoutMs}ms）：${url} —— process.exit(1) 交 pm2 autorestart（Z102）`);
    this.name = 'WorkerReadyTimeoutError';
  }
}

export interface ReadyGateOptions {
  url: string;
  /** 超限上限（默认 WORKER_READY_TIMEOUT_DEFAULT_MS=60_000——env WORKER_READY_TIMEOUT_MS 消费点）。 */
  timeoutMs?: number;
  /** 轮询间隔（默认 1000ms——deploy.sh curl 1s 同节奏；测试注入 1ms 提速）。 */
  intervalMs?: number;
  /** fetch 实现（测试缝；默认 node 原生 fetch）。 */
  fetchImpl?: FetchLike;
}

/** 轮询直至 ready===true 或超限。网络错误族（ECONNREFUSED/fetch failed）=继续轮询非终态。 */
export async function waitForApiReady(opts: ReadyGateOptions): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? WORKER_READY_TIMEOUT_DEFAULT_MS;
  const intervalMs = opts.intervalMs ?? 1000;
  const doFetch = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await doFetch(opts.url, { signal: AbortSignal.timeout(2000) });
      const body = await r.json().catch(() => null);
      if (body && (body as { ready?: unknown }).ready === true) return;
    } catch { /* 连接拒绝/单次探测超时/非 JSON——继续轮询（api 未就绪是预期态非错误） */ }
    if (Date.now() >= deadline) throw new WorkerReadyTimeoutError(opts.url, timeoutMs);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
