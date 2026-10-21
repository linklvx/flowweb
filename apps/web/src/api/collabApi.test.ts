// apps/web/src/api/collabApi.test.ts
// Y0b-4 T11：shrink/export-fresh/vacuum 三调用——URL/method/body 契约+信封解包+
// 422 SHRINK_STILL_OVER 结构体解包（{stillOver,bytes,limit}——apiFetch 错误面透传 body）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shrink, exportFresh, vacuum, getMediaSlot, postMediaCommand, replaceNodeMedia, clearNodeMedia } from './collabApi';

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

// ════════ Y1a T11：replaceMedia/clearMedia 命令（GET 槽位→POST→409 重试一轮）════════
describe('collabApi（T11 媒体命令）', () => {
  const okEnvelope = (data: unknown) => ({ ok: true, json: async () => ({ code: 0, data, message: 'ok' }) });
  const err409 = () => ({
    ok: false, status: 409, statusText: 'Conflict',
    clone: () => ({ json: async () => ({ code: -1, message: '槽位已换代', errorCode: 'ARTIFACT_REV_CONFLICT' }) }),
    json: async () => ({ code: -1, message: '槽位已换代', errorCode: 'ARTIFACT_REV_CONFLICT' }),
    headers: new Headers(),
  });

  it('getMediaSlot：GET /api/projects/:pid/collab/nodes/:nid/media + 信封解包', async () => {
    (global.fetch as any).mockResolvedValue(okEnvelope({ targetField: 'fileId', rev: 3, mediaId: 'm-3' }));
    const r = await getMediaSlot('p1', 'n1');
    expect((global.fetch as any).mock.calls[0][0]).toBe('/api/projects/p1/collab/nodes/n1/media');
    expect((global.fetch as any).mock.calls[0][1].method).toBe('GET');
    expect(r).toEqual({ targetField: 'fileId', rev: 3, mediaId: 'm-3' });
  });

  it('postMediaCommand：POST 判别联合 body（replace 携 mediaId+expectedRev）', async () => {
    (global.fetch as any).mockResolvedValue(okEnvelope({ action: 'replace', rev: 4, mediaId: 'm-4' }));
    const r = await postMediaCommand('p1', 'n1', { action: 'replace', mediaId: 'm-4', expectedRev: 3 });
    expect((global.fetch as any).mock.calls[0][0]).toBe('/api/projects/p1/collab/nodes/n1/media');
    const init = (global.fetch as any).mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ action: 'replace', mediaId: 'm-4', expectedRev: 3 });
    expect(r).toEqual({ action: 'replace', rev: 4, mediaId: 'm-4' });
  });

  it('replaceNodeMedia happy：GET 槽位 rev → POST {expectedRev=槽位 rev}', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(okEnvelope({ targetField: 'fileId', rev: 7, mediaId: null }))
      .mockResolvedValueOnce(okEnvelope({ action: 'replace', rev: 8, mediaId: 'm-8' }));
    const r = await replaceNodeMedia('p1', 'n1', 'm-8');
    expect(r.rev).toBe(8);
    expect(JSON.parse((global.fetch as any).mock.calls[1][1].body)).toEqual({ action: 'replace', mediaId: 'm-8', expectedRev: 7 });
  });

  it('replaceNodeMedia 409 一轮重试：首 POST 409 ARTIFACT_REV_CONFLICT → 复读槽位 → 新 rev 重试成功', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(okEnvelope({ targetField: 'fileId', rev: 5, mediaId: null }))   // GET① rev=5（过期前）
      .mockResolvedValueOnce(err409())                                                        // POST① 409
      .mockResolvedValueOnce(okEnvelope({ targetField: 'fileId', rev: 6, mediaId: 'm-gen' })) // GET② 复读 rev=6
      .mockResolvedValueOnce(okEnvelope({ action: 'replace', rev: 7, mediaId: 'm-8' }));      // POST② 胜
    const r = await replaceNodeMedia('p1', 'n1', 'm-8');
    expect(r).toEqual({ action: 'replace', rev: 7, mediaId: 'm-8' });
    expect(JSON.parse((global.fetch as any).mock.calls[1][1].body)).toEqual({ action: 'replace', mediaId: 'm-8', expectedRev: 5 });
    expect(JSON.parse((global.fetch as any).mock.calls[3][1].body)).toEqual({ action: 'replace', mediaId: 'm-8', expectedRev: 6 });
    expect((global.fetch as any)).toHaveBeenCalledTimes(4);   // 重试恰一轮（非 409 错误不重试）
  });

  it('replaceNodeMedia 409 耗尽上抛（两轮均 409 → throw——禁无限重试）', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(okEnvelope({ targetField: 'fileId', rev: 5, mediaId: null }))
      .mockResolvedValueOnce(err409())
      .mockResolvedValueOnce(okEnvelope({ targetField: 'fileId', rev: 6, mediaId: 'm-gen' }))
      .mockResolvedValueOnce(err409());
    await expect(replaceNodeMedia('p1', 'n1', 'm-8')).rejects.toMatchObject({ status: 409, errorCode: 'ARTIFACT_REV_CONFLICT' });
  });

  it('replaceNodeMedia 非 409 错误不重试（网络/403 照 throw——单次 POST）', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(okEnvelope({ targetField: 'fileId', rev: 5, mediaId: null }))
      .mockResolvedValueOnce({
        ok: false, status: 403, statusText: 'Forbidden',
        clone: () => ({ json: async () => ({ code: -1, message: '无项目编辑权限' }) }),
        json: async () => ({ code: -1, message: '无项目编辑权限' }),
        headers: new Headers(),
      });
    await expect(replaceNodeMedia('p1', 'n1', 'm-8')).rejects.toMatchObject({ status: 403 });
    expect((global.fetch as any)).toHaveBeenCalledTimes(2);   // GET+POST 恰两次（未复读槽位）
  });

  it('clearNodeMedia：GET→POST {action:"clear",expectedRev}+409 重试同构', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(okEnvelope({ targetField: 'fileId', rev: 2, mediaId: 'm-2' }))
      .mockResolvedValueOnce(err409())
      .mockResolvedValueOnce(okEnvelope({ targetField: 'fileId', rev: 3, mediaId: 'm-3' }))
      .mockResolvedValueOnce(okEnvelope({ action: 'clear', rev: 4, mediaId: null }));
    const r = await clearNodeMedia('p1', 'n1');
    expect(r).toEqual({ action: 'clear', rev: 4, mediaId: null });
    expect(JSON.parse((global.fetch as any).mock.calls[1][1].body)).toEqual({ action: 'clear', expectedRev: 2 });
    expect(JSON.parse((global.fetch as any).mock.calls[3][1].body)).toEqual({ action: 'clear', expectedRev: 3 });
  });
});
