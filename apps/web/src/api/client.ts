import { useSessionExpiry } from '@/auth/sessionExpiry';

const BASE_URL = '/api';

interface FetchOptions {
  method?: string;
  body?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export async function apiFetch<T>(path: string, options?: FetchOptions): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options?.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    body: options?.body,
    signal: options?.signal,
  });
  if (!res.ok) {
    let msg = `API error: ${res.status} ${res.statusText}`;
    let errorCode: string | undefined; // 批0.5-8b：业务错误码透传（调用方判 INTENT_EXHAUSTED 等）
    let body: unknown; // Y0b-4 T11：结构体错误 body 透传（shrink 422 SHRINK_STILL_OVER 的 bytes/limit 解包源）
    try {
      const j = await res.clone().json();
      if (j?.message) msg = j.message;
      errorCode = j?.errorCode;
      body = j;
    } catch { /* body 非 JSON，保留状态行 */ }
    // 批3-3：401 → httpExpired 电平置位（登录横幅挂点，批 2 消费）
    if (res.status === 401) useSessionExpiry.getState().setHttpExpired();
    throw Object.assign(new Error(msg), { status: res.status, errorCode, retryAfter: parseRetryAfter(res), body });
  }
  const json = await res.json();
  if (json.code !== 0) {
    // 批3-3：业务失败不再丢 HTTP status（消费面按 status 分型瞬态/终态）
    throw Object.assign(new Error(json.message), { status: res.status, errorCode: json.errorCode, retryAfter: parseRetryAfter(res) });
  }
  return json.data;
}

/** Y0b-3 T9（§5.3 v2.1）：Retry-After 头→毫秒（消费方=withSyncRetry 等待后自动重试一次）。
 *  缺头/非数值秒（HTTP-date 形态）→undefined（禁 NaN 传播——不重试档）。 */
function parseRetryAfter(res: Response): number | undefined {
  const raw = res.headers.get('retry-after');
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n * 1000 : undefined;
}
