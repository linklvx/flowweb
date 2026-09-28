import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./client', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from './client';
import { STITCH_JOB_KEYS } from '@flowweb/shared';
import { createStitchTask, type StitchParams } from './stitchApi';

describe('stitch 线上载荷契约（R0d——sourceGroupId 剥离 + STITCH_JOB_KEYS 跨端锚定）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST body 键集恰=STITCH_JOB_KEYS——sourceGroupId 不上线（注释"不发给后端"曾为假，forbid pipe 后每次拼接 400）', async () => {
    (apiFetch as any).mockResolvedValue({ taskId: 't1', status: 'PENDING' });
    const params: StitchParams = {
      fileIds: ['f1'], gridRows: 1, gridCols: 1, aspectRatio: '16:9', showIndex: false, resolution: '2K',
      sourceGroupId: 'g1',
    };
    await createStitchTask('p1', params);
    expect(apiFetch).toHaveBeenCalled();
    const body = JSON.parse((apiFetch as any).mock.calls[0][1].body);
    expect(Object.keys(body).sort()).toEqual([...STITCH_JOB_KEYS].sort());
    expect(body).not.toHaveProperty('sourceGroupId');
  });

  it('无 sourceGroupId 的调用不受影响（六键直传）', async () => {
    (apiFetch as any).mockResolvedValue({ taskId: 't1', status: 'PENDING' });
    await createStitchTask('p1', { fileIds: ['f1'], gridRows: 1, gridCols: 1, aspectRatio: '16:9', showIndex: false, resolution: '2K' });
    expect(Object.keys(JSON.parse((apiFetch as any).mock.calls[0][1].body))).toHaveLength(6);
  });
});
