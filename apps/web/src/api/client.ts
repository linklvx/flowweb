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
    try {
      const j = await res.clone().json();
      if (j?.message) msg = j.message;
    } catch { /* body 非 JSON，保留状态行 */ }
    const err = Object.assign(new Error(msg), { status: res.status });
    throw err;
  }
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(json.message);
  }
  return json.data;
}
