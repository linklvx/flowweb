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
    try {
      const j = await res.clone().json();
      if (j?.message) msg = j.message;
      errorCode = j?.errorCode;
    } catch { /* body 非 JSON，保留状态行 */ }
    // 批3-3：401 → httpExpired 电平置位（登录横幅挂点，批 2 消费）
    if (res.status === 401) useSessionExpiry.getState().setHttpExpired();
    const err = Object.assign(new Error(msg), { status: res.status, errorCode });
    throw err;
  }
  const json = await res.json();
  if (json.code !== 0) {
    // 批3-3：业务失败不再丢 HTTP status（消费面按 status 分型瞬态/终态）
    throw Object.assign(new Error(json.message), { status: res.status, errorCode: json.errorCode });
  }
  return json.data;
}
