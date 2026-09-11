// apps/web/src/pages/canvas/video-editor/export/upload.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const registerApi = vi.fn();
const confirmApi = vi.fn();
vi.mock('@/api/videoProjectApi', () => ({
  registerGeneratedMedia: (...a: unknown[]) => registerApi(...a),
  confirmGeneratedMedia: (...a: unknown[]) => confirmApi(...a),
}));
const axiosPost = vi.fn();
vi.mock('axios', () => ({ default: { post: (...a: unknown[]) => axiosPost(...a) } }));

import { uploadExportedProduct } from './upload';

beforeEach(() => {
  registerApi.mockReset(); confirmApi.mockReset(); axiosPost.mockReset();
  registerApi.mockResolvedValue({ mediaId: 'uuid-1', upload: { url: 'https://minio/flowai/x', fields: { key: 'k', policy: 'p' } } });
  confirmApi.mockResolvedValue({});
  axiosPost.mockResolvedValue({ status: 200 });
});

describe('uploadExportedProduct（编码完成后登记→presigned POST 直传→confirm）', () => {
  it('三步顺序调用：register(actualSize=file.size) → FormData POST（fields+file、/flowai 同源改写）→ confirm(mediaId)', async () => {
    const file = new Blob(['abcd'], { type: 'video/mp4' });
    await uploadExportedProduct({ workflowId: 'w', videoProjectId: 'vp', resolution: '720p', durationSec: 10, file });
    expect(registerApi).toHaveBeenCalledWith({ workflowId: 'w', videoProjectId: 'vp', resolution: '720p', durationSec: 10, actualSize: file.size });
    expect(axiosPost).toHaveBeenCalledWith('/flowai/x', expect.any(FormData));
    expect(confirmApi).toHaveBeenCalledWith('uuid-1');
  });
  it('返回 mediaId（uuid，前端勿假设 cuid）', async () => {
    const r = await uploadExportedProduct({ workflowId: 'w', videoProjectId: 'vp', resolution: '720p', durationSec: 1, file: new Blob(['x']) });
    expect(r).toEqual({ mediaId: 'uuid-1' });
  });
  it('POST 失败 → confirm 不被调用（失败中间态：Media 留服务端 pending，不占配额）', async () => {
    axiosPost.mockRejectedValue(new Error('net'));
    await expect(uploadExportedProduct({ workflowId: 'w', videoProjectId: 'vp', resolution: '720p', durationSec: 1, file: new Blob(['x']) })).rejects.toThrow('net');
    expect(confirmApi).not.toHaveBeenCalled();
  });
  it('FormData 字段顺序：file 在 fields 之后（presigned POST 的 policy 签名硬约束）', async () => {
    await uploadExportedProduct({ workflowId: 'w', videoProjectId: 'vp', resolution: '720p', durationSec: 1, file: new Blob(['x']) });
    const fd = axiosPost.mock.calls[0][1] as FormData;
    expect(fd.get('key')).toBe('k');
    expect(fd.get('policy')).toBe('p');
    expect(fd.get('file')).toBeInstanceOf(Blob);
    // M-1 强断言：不仅存在，且顺序正确（file 必须在 fields 之后）
    const keys = Array.from(fd.keys());
    expect(keys.indexOf('file')).toBeGreaterThan(keys.indexOf('policy'));
  });
});
