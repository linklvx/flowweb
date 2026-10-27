// apps/web/src/api/collabApi.test.ts
// Y0b-4 T11：shrink/export-fresh/vacuum 三调用——URL/method/body 契约+信封解包+
// 422 SHRINK_STILL_OVER 结构体解包（{stillOver,bytes,limit}——apiFetch 错误面透传 body）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  shrink, exportFresh, vacuum, getMediaSlot, postMediaCommand,
  replaceNodeMedia, clearNodeMedia, MediaRevConflictError,
  bindMedia, cloneBinding, fetchServerCanvas, importDraftEnvelope,
} from './collabApi';

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

// ════════ Y1a T11 + F2（用户裁定②①）：replaceMedia/clearMedia 命令（GET 槽位→POST 单次；
// 409 ARTIFACT_REV_CONFLICT → throw MediaRevConflictError——取消静默换 rev 重提）════════
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

  it('replaceNodeMedia 409 ARTIFACT_REV_CONFLICT → throw MediaRevConflictError（取消静默重试——旧操作禁自动换 rev 重提）', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(okEnvelope({ targetField: 'fileId', rev: 5, mediaId: null }))   // GET① rev=5
      .mockResolvedValueOnce(err409());                                                        // POST① 409——到此为止
    const p = replaceNodeMedia('p1', 'n1', 'm-8');
    await expect(p).rejects.toBeInstanceOf(MediaRevConflictError);
    await expect(p).rejects.toMatchObject({ status: 409, errorCode: 'ARTIFACT_REV_CONFLICT' });
    expect((global.fetch as any)).toHaveBeenCalledTimes(2);   // GET+POST 恰两次（禁复读槽位/禁二次 POST）
  });

  it('replaceNodeMedia expectedRev 预捕获透传：跳过入口 GET 直用（处理开始时捕获的槽位版本——裁定②）', async () => {
    (global.fetch as any).mockResolvedValueOnce(okEnvelope({ action: 'replace', rev: 10, mediaId: 'm-8' }));
    const r = await replaceNodeMedia('p1', 'n1', 'm-8', { expectedRev: 9 });
    expect((global.fetch as any)).toHaveBeenCalledTimes(1);   // 零 GET——POST 单发
    expect(JSON.parse((global.fetch as any).mock.calls[0][1].body)).toEqual({ action: 'replace', mediaId: 'm-8', expectedRev: 9 });
    expect(r).toEqual({ action: 'replace', rev: 10, mediaId: 'm-8' });
  });

  it('replaceNodeMedia 非 409 错误照 throw 原错误（不被包装成 MediaRevConflictError——单次 POST）', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(okEnvelope({ targetField: 'fileId', rev: 5, mediaId: null }))
      .mockResolvedValueOnce({
        ok: false, status: 403, statusText: 'Forbidden',
        clone: () => ({ json: async () => ({ code: -1, message: '无项目编辑权限' }) }),
        json: async () => ({ code: -1, message: '无项目编辑权限' }),
        headers: new Headers(),
      });
    const p = replaceNodeMedia('p1', 'n1', 'm-8');
    await expect(p).rejects.not.toBeInstanceOf(MediaRevConflictError);
    await expect(p).rejects.toMatchObject({ status: 403 });
    expect((global.fetch as any)).toHaveBeenCalledTimes(2);   // GET+POST 恰两次（未复读槽位）
  });

  it('clearNodeMedia：GET→POST {action:"clear",expectedRev}；expectedRev 透传+409 throw 同构', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(okEnvelope({ targetField: 'fileId', rev: 2, mediaId: 'm-2' }))
      .mockResolvedValueOnce(okEnvelope({ action: 'clear', rev: 3, mediaId: null }));
    const r = await clearNodeMedia('p1', 'n1');
    expect(r).toEqual({ action: 'clear', rev: 3, mediaId: null });
    expect(JSON.parse((global.fetch as any).mock.calls[1][1].body)).toEqual({ action: 'clear', expectedRev: 2 });

    (global.fetch as any).mockReset().mockImplementation(async () => { throw new Error('reset'); });
    (global.fetch as any)
      .mockResolvedValueOnce(err409());
    await expect(clearNodeMedia('p1', 'n1', { expectedRev: 7 })).rejects.toBeInstanceOf(MediaRevConflictError);
    expect(JSON.parse((global.fetch as any).mock.calls[0][1].body)).toEqual({ action: 'clear', expectedRev: 7 });
  });
});

// ══ T25b 四读径③：BindMedia/CloneBinding typed 命令（复制/粘贴——shared 契约 typed body）══
describe('collabApi（T25b 四读径③：BindMedia/CloneBinding）', () => {
  const err409 = () => ({
    ok: false, status: 409, statusText: 'Conflict',
    clone: () => ({ json: async () => ({ code: -1, message: '槽位已换代', errorCode: 'ARTIFACT_REV_CONFLICT' }) }),
    json: async () => ({ code: -1, message: '槽位已换代', errorCode: 'ARTIFACT_REV_CONFLICT' }),
    headers: new Headers(),
  });
  it('bindMedia：POST /api/projects/:pid/collab/bindings typed body（shared BindMediaCommand 原样）+409 类型化', async () => {
    (global.fetch as any).mockResolvedValue(okEnvelope({ type: 'BindMedia', rev: 1, mediaId: 'm1' }));
    const r = await bindMedia('p1', { type: 'BindMedia', sourceNodeId: 'n-src', mediaId: 'm1', targetNodeId: 'n-tgt', expectedRev: 0 });
    expect((global.fetch as any).mock.calls[0][0]).toBe('/api/projects/p1/collab/bindings');
    const init = (global.fetch as any).mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ type: 'BindMedia', sourceNodeId: 'n-src', mediaId: 'm1', targetNodeId: 'n-tgt', expectedRev: 0 });
    expect(r).toEqual({ type: 'BindMedia', rev: 1, mediaId: 'm1' });

    (global.fetch as any).mockReset();
    (global.fetch as any).mockResolvedValueOnce(err409());
    await expect(bindMedia('p1', { type: 'BindMedia', sourceNodeId: 'n-src', mediaId: 'm1', targetNodeId: 'n-tgt', expectedRev: 3 }))
      .rejects.toBeInstanceOf(MediaRevConflictError);   // CAS 冲突类型化（粘贴档同 F2 纪律——用户裁定后重提）
  });

  it('★T25b 收口 I-2/I-3：fetchServerCanvas GET /collab/doc/:pid/canvas+importDraftEnvelope deletionNodeIds 随 body', async () => {
    (global.fetch as any).mockResolvedValue(okEnvelope({ nodes: [{ id: 's1' }], edges: [] }));
    const model = await fetchServerCanvas('p1');
    expect((global.fetch as any).mock.calls[0][0]).toBe('/api/collab/doc/p1/canvas');
    expect(model).toEqual({ nodes: [{ id: 's1' }], edges: [] });
    (global.fetch as any).mockReset();
    (global.fetch as any).mockResolvedValue(okEnvelope({ confirmation: { contentCounts: { nodeCount: 0, edgeCount: 0 }, droppedRefs: { danglingEdges: 0, missingParentNodes: 0 }, notRestored: { artifacts: true, executionHistory: true, billingRecords: true } }, dispositions: [], resultReplayed: false, deletions: { requested: 1, applied: 1 }, epoch: { envelopeGeneration: 3, envelopeHistoryId: 'h', crossGeneration: false } }));
    await importDraftEnvelope('p1', { draftId: 'd', projectId: 'p1', generation: 3, schemaVersion: 3, historyId: 'h', capturedAtMs: 1, tabId: 't', nodes: [], edges: [], meta: {}, hashes: { nodes: 'n', edges: 'e' } }, { 'n1': 'replace' }, ['n3']);
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.deletionNodeIds).toEqual(['n3']);   // T25b I-3：删除确认 typed 随 body
    expect(body.conflictChoices).toEqual({ n1: 'replace' });
  });

  it('cloneBinding：POST 同端点 typed body（CloneBindingCommand）', async () => {
    (global.fetch as any).mockResolvedValue(okEnvelope({ type: 'CloneBinding', cloned: 2, skippedDeleted: 1 }));
    const r = await cloneBinding('p1', { type: 'CloneBinding', sourceNodeId: 'n-src', targetNodeId: 'n-tgt' });
    expect((global.fetch as any).mock.calls[0][0]).toBe('/api/projects/p1/collab/bindings');
    expect(JSON.parse((global.fetch as any).mock.calls[0][1].body)).toEqual({ type: 'CloneBinding', sourceNodeId: 'n-src', targetNodeId: 'n-tgt' });
    expect(r).toEqual({ type: 'CloneBinding', cloned: 2, skippedDeleted: 1 });
  });
});
