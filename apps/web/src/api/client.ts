const BASE_URL = '/api';

interface FetchOptions {
  method?: string;
  body?: string;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, options?: FetchOptions): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options?.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options?.body,
    signal: options?.signal,
  });
  if (!res.ok) {
    const err = Object.assign(
      new Error(`API error: ${res.status} ${res.statusText}`),
      { status: res.status },
    );
    throw err;
  }
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(json.message);
  }
  return json.data;
}
