import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enqueueWorkflow } from './executionApi';

vi.mock('@/stores/canvasCollabRuntime', () => ({ getStateVector: () => null }));

const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data }), { status: 200 });

describe('executionApi 手势 token 透传形态（Y0b-2 T6/Z91——enqueue 端点读 body.regenToken 入 job.data）', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueueWorkflow → body.regenToken（改名自 intentId 位——Z103）', async () => {
    fetchSpy.mockResolvedValueOnce(ok({ jobId: 'j1', status: 'queued' }));
    await enqueueWorkflow({ projectId: 'p1', nodeId: 'n1', regenToken: 'cli-token-1' });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/execution/enqueue');
    expect(JSON.parse(String(init.body)).regenToken).toBe('cli-token-1');
  });
});
