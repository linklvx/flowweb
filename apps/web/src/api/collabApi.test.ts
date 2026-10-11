// apps/web/src/api/collabApi.test.ts
// Y0b-4 T11：shrink/export-fresh/vacuum 三调用——URL/method/body 契约+信封解包+
// 422 SHRINK_STILL_OVER 结构体解包（{stillOver,bytes,limit}——apiFetch 错误面透传 body）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shrink, exportFresh, vacuum } from './collabApi';

const okEnvelope = (data: unknown) => ({ ok: true, json: async () => ({ code: 0, data, message: 'ok' }) });

beforeEach(() => {
  global.fetch = vi.fn();
});

describe('collabApi（T11）', () => {
  it('shrink：POST /api/collab/doc/:pid/shrink + deleteNodeIds body + 信封 data 解包', async () => {
    (global.fetch as any).mockResolvedValue(okEnvelope({ result: 'ok', watermark: 5_000, deletedIds: ['a'], thawed: true }));
    const r = await shrink('p1', { deleteNodeIds: ['a'] });
    expect((global.fetch as any).mock.calls[0][0]).toBe('/api/collab/doc/p1/shrink');
    const init = (global.fetch as any).mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ deleteNodeIds: ['a'] });
    expect(r).toEqual({ result: 'ok', watermark: 5_000, deletedIds: ['a'], thawed: true });
  });

  it('shrink 422 SHRINK_STILL_OVER：结构体 body 解包为 {stillOver:true,bytes,limit}（不 throw）', async () => {
    const errBody = { code: 'SHRINK_STILL_OVER', bytes: 9_000_000, limit: 8_388_608 };
    (global.fetch as any).mockResolvedValue({
      ok: false, status: 422, statusText: 'Unprocessable Entity',
      clone: () => ({ json: async () => errBody }),
      json: async () => errBody,
      headers: new Headers(),
    });
    const r = await shrink('p1', { deleteNodeIds: ['a'] });
    expect(r).toEqual({ stillOver: true, bytes: 9_000_000, limit: 8_388_608 });
  });

  it('shrink 非 422 错误（503 SHRINK_BUSY 等）照 throw（错误不解包吞掉）', async () => {
    const errBody = { code: 'SHRINK_BUSY', retryAfterSeconds: 10 };
    (global.fetch as any).mockResolvedValue({
      ok: false, status: 503, statusText: 'Service Unavailable',
      clone: () => ({ json: async () => errBody }),
      json: async () => errBody,
      headers: new Headers({ 'retry-after': '10' }),
    });
    await expect(shrink('p1', {})).rejects.toMatchObject({ status: 503 });
  });

  it('exportFresh：POST /api/collab/doc/:pid/export-fresh（无 body）+warning 透传', async () => {
    (global.fetch as any).mockResolvedValue(okEnvelope({
      result: 'ok', projectId: 'np', name: '副本', bytes: 9_000_000, warning: 'still-over-limit',
    }));
    const r = await exportFresh('p1');
    expect((global.fetch as any).mock.calls[0][0]).toBe('/api/collab/doc/p1/export-fresh');
    expect((global.fetch as any).mock.calls[0][1].method).toBe('POST');
    expect(r.warning).toBe('still-over-limit');
  });

  it('vacuum：POST /api/collab/doc/:pid/vacuum+代际透传', async () => {
    (global.fetch as any).mockResolvedValue(okEnvelope({ result: 'ok', generation: 3, bytes: 1_200 }));
    const r = await vacuum('p1');
    expect((global.fetch as any).mock.calls[0][0]).toBe('/api/collab/doc/p1/vacuum');
    expect((global.fetch as any).mock.calls[0][1].method).toBe('POST');
    expect(r).toEqual({ result: 'ok', generation: 3, bytes: 1_200 });
  });
});
