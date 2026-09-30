import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeWorkflow, enqueueWorkflow } from './executionApi';

vi.mock('@/stores/canvasCollabRuntime', () => ({ getStateVector: () => null }));

const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data }), { status: 200 });

describe('executionApi 意图 id 透传形态（批0.5-8b——以 0.5-6 controller 端点读法为准）', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueueWorkflow → body.intentId（enqueue 端点读 body.intentId）', async () => {
    fetchSpy.mockResolvedValueOnce(ok({ jobId: 'j1', status: 'queued' }));
    await enqueueWorkflow({ projectId: 'p1', nodeId: 'n1', intentId: 'i-1' });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/execution/enqueue');
    expect(JSON.parse(String(init.body)).intentId).toBe('i-1');
  });

  it('executeWorkflow → x-intent-id header（execute 端点读 @Headers x-intent-id）', async () => {
    fetchSpy.mockResolvedValueOnce(ok({ success: true, errors: [] }));
    await executeWorkflow('p1', 'n1', 'i-2');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/execution/execute');
    expect((init.headers as Record<string, string>)['x-intent-id']).toBe('i-2');
  });

  it('executeWorkflow 未带 intentId → 不发空头（header 缺省）', async () => {
    fetchSpy.mockResolvedValueOnce(ok({ success: true, errors: [] }));
    await executeWorkflow('p1', 'n1');
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-intent-id']).toBeUndefined();
  });
});
