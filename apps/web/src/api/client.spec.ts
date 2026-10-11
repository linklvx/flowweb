// apps/web/src/api/client.spec.ts
// Y0b-3 T9 Step5（§5.3 v2.1 收窄=仅补 retryAfter）：apiFetch 503 语义化——Retry-After 头透传毫秒数
// （消费方=withSyncRetry 等待后自动重试一次；缺头/非数值=undefined 不重试）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiFetch } from './client';

const fetchSpy = vi.spyOn(globalThis, 'fetch');

describe('Y0b-3 T9：apiFetch 503 retryAfter 透传', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('503 带 Retry-After: 2 → error.retryAfter===2000（毫秒）', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ message: 'Service Unavailable' }),
      { status: 503, statusText: 'Service Unavailable', headers: { 'retry-after': '2' } },
    ));
    await expect(apiFetch('/execution/execute', { method: 'POST', body: '{}' }))
      .rejects.toMatchObject({ status: 503, retryAfter: 2000 });
  });

  it('503 缺头 → retryAfter undefined（不重试档）', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'down' }), { status: 503 }));
    await expect(apiFetch('/x')).rejects.toMatchObject({ status: 503, retryAfter: undefined });
  });

  it('Retry-After 非数值（HTTP-date 形态）→ retryAfter undefined（禁 NaN 传播）', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{}', {
      status: 503, headers: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' },
    }));
    await expect(apiFetch('/x')).rejects.toMatchObject({ status: 503, retryAfter: undefined });
  });
});
