// apps/web/src/api/executionApi.test.ts
// Y0b-2 T6/Z91：enqueue body.regenToken 透传形态。
// Y0b-2 T7：①body stateVector=getStateVector()（SV 请求头退役——SV 随 body 上送）；
// ②withSyncRetry 反应式重发（Z56 修订：先发→409 SYNC_PENDING 才 forceSyncAndWaitUnsynced→重发恰一次；
// 再拒抛出不循环+诊断 ring 观测；非 SYNC_PENDING 直接抛零 forceSync；已同步零 forceSync）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';

const svDoc = new Y.Doc();
svDoc.getMap('meta').set('schemaVersion', 2);   // 非空 SV（空 doc 的 SV 是 0 字节——base64 空串）
const SV_FIX = Buffer.from(Y.encodeStateVector(svDoc)).toString('base64');

const forceSyncMock = vi.fn(async () => true);
const { messageWarning } = vi.hoisted(() => ({ messageWarning: vi.fn() }));
vi.mock('antd', () => ({ message: { warning: messageWarning, info: vi.fn() } }));
vi.mock('@/stores/canvasCollabRuntime', () => ({
  getStateVector: () => SV_FIX,
  forceSyncAndWaitUnsynced: (...a: unknown[]) => forceSyncMock(...(a as [])),
}));

const { executeGroupNodes, enqueueWorkflow } = await import('./executionApi');
const { getCollabDiagCounters, _resetCollabDiagForTest } = await import('@/utils/collabDiagnostics');

const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data }), { status: 200 });
const syncPending = () => new Response(
  JSON.stringify({ message: '本地内容尚未同步到服务端，请稍后重试', errorCode: 'SYNC_PENDING' }),
  { status: 409 },
);

describe('executionApi 手势 token 透传形态（Y0b-2 T6/Z91——enqueue 端点读 body.regenToken 入 job.data）', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  beforeEach(() => {
    vi.clearAllMocks();
    _resetCollabDiagForTest();
  });

  it('enqueueWorkflow → body.regenToken（改名自 intentId 位——Z103）+ body.stateVector（T7：SV 随 body）', async () => {
    fetchSpy.mockResolvedValueOnce(ok({ jobId: 'j1', status: 'queued' }));
    await enqueueWorkflow({ projectId: 'p1', nodeId: 'n1', regenToken: 'cli-token-1' });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/execution/enqueue');
    const body = JSON.parse(String(init.body));
    expect(body.regenToken).toBe('cli-token-1');
    expect(body.stateVector).toBe(SV_FIX);
  });

  it('executeGroupNodes → body.stateVector（T7：组执行同源）', async () => {
    fetchSpy.mockResolvedValueOnce(ok({ success: true, errors: [] }));
    await executeGroupNodes('p1', ['n1', 'n2']);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).stateVector).toBe(SV_FIX);
  });
});

describe('Y0b-2 T7：withSyncRetry 反应式重发（Z56 修订——SYNC_PENDING 恰重发一次）', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  beforeEach(() => {
    vi.clearAllMocks();
    _resetCollabDiagForTest();
  });

  it('409 SYNC_PENDING → forceSyncAndWaitUnsynced → 重发恰一次后成功', async () => {
    fetchSpy.mockResolvedValueOnce(syncPending()).mockResolvedValueOnce(ok({ success: true, errors: [] }));
    const r = await executeGroupNodes('p1', ['n1']);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(forceSyncMock).toHaveBeenCalledTimes(1);
    expect(forceSyncMock).toHaveBeenCalledWith(2_000);
    expect(r).toEqual({ success: true, errors: [] });
  });

  it('重发再 409 → 抛出不循环 + sync_pending_retry 诊断观测（服务端停滞信号）', async () => {
    fetchSpy.mockResolvedValue(syncPending());
    await expect(executeGroupNodes('p1', ['n1'])).rejects.toMatchObject({ errorCode: 'SYNC_PENDING' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);   // 恰一次重发——不循环
    expect(forceSyncMock).toHaveBeenCalledTimes(1);
    expect(getCollabDiagCounters().get('sync_pending_retry')).toBe(1);
  });

  it('非 SYNC_PENDING 错误 → 直接抛零 forceSync；成功路径零 forceSync', async () => {
    const bizErr = () => new Response(JSON.stringify({ message: 'x', errorCode: 'INTENT_EXHAUSTED' }), { status: 409 });
    fetchSpy.mockResolvedValueOnce(bizErr());
    await expect(executeGroupNodes('p1', ['n1'])).rejects.toMatchObject({ errorCode: 'INTENT_EXHAUSTED' });
    expect(forceSyncMock).not.toHaveBeenCalled();

    fetchSpy.mockResolvedValueOnce(ok({ success: true, errors: [] }));
    await executeGroupNodes('p1', ['n1']);
    expect(forceSyncMock).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('Y0b-3 T9 Step5：withSyncRetry 503 语义化重试（Retry-After 后恰重试一次——同 SYNC_PENDING 范式，同 token 幂等零重复扣费）', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  const unavailable = (retryAfter?: number) => new Response(
    JSON.stringify({ message: 'Service Unavailable' }),
    { status: 503, headers: retryAfter != null ? { 'retry-after': String(retryAfter) } : {} },
  );

  beforeEach(() => {
    vi.clearAllMocks();
    _resetCollabDiagForTest();
  });

  it('503 + Retry-After → 维护提示+等待 retryAfter 后自动重试恰一次', async () => {
    vi.useFakeTimers();
    try {
      fetchSpy.mockResolvedValueOnce(unavailable(2)).mockResolvedValueOnce(ok({ success: true, errors: [] }));
      const pending = executeGroupNodes('p1', ['n1']);
      await vi.advanceTimersByTimeAsync(2_000);   // Retry-After=2s——等待窗内不重试
      expect(await pending).toEqual({ success: true, errors: [] });
      expect(messageWarning).toHaveBeenCalledWith('服务重启/维护中，请稍后重试');
      expect(fetchSpy).toHaveBeenCalledTimes(2);  // 恰一次重试——不循环
    } finally { vi.useRealTimers(); }
  });

  it('重试再 503 → 抛出不循环（恰两次 fetch——服务端仍不可用，不无限等）', async () => {
    vi.useFakeTimers();
    try {
      fetchSpy.mockResolvedValue(unavailable(1));
      const pending = executeGroupNodes('p1', ['n1']).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await pending).toMatchObject({ status: 503 });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it('503 缺 Retry-After → 不自动重试直接抛（零等待零重试）', async () => {
    fetchSpy.mockResolvedValueOnce(unavailable());
    await expect(executeGroupNodes('p1', ['n1'])).rejects.toMatchObject({ status: 503 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(messageWarning).not.toHaveBeenCalled();
  });
});
