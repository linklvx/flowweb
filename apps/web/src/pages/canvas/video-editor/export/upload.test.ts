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
  it('三步顺序调用：register(actualSize+width/height=file 尺寸存档+clientRequestId 幂等键) → FormData POST（fields+file、/flowai 同源改写）→ confirm(mediaId)', async () => {
    const file = new Blob(['abcd'], { type: 'video/mp4' });
    await uploadExportedProduct({ workflowId: 'w', videoProjectId: 'vp', resolution: '720p', durationSec: 10, width: 1280, height: 720, file, clientRequestId: 'req-1' });
    expect(registerApi).toHaveBeenCalledWith({ workflowId: 'w', videoProjectId: 'vp', resolution: '720p', durationSec: 10, width: 1280, height: 720, actualSize: file.size, clientRequestId: 'req-1' });
    expect(axiosPost).toHaveBeenCalledWith('/flowai/x', expect.any(FormData));
    expect(confirmApi).toHaveBeenCalledWith('uuid-1');
  });
  it('返回 mediaId（uuid，前端勿假设 cuid）', async () => {
    const r = await uploadExportedProduct({ workflowId: 'w', videoProjectId: 'vp', resolution: '720p', durationSec: 1, width: 1280, height: 720, file: new Blob(['x']), clientRequestId: 'req-1' });
    expect(r).toEqual({ mediaId: 'uuid-1' });
  });
  it('POST 失败 → confirm 不被调用（失败中间态：Media 留服务端 pending，不占配额）', async () => {
    axiosPost.mockRejectedValue(new Error('net'));
    await expect(uploadExportedProduct({ workflowId: 'w', videoProjectId: 'vp', resolution: '720p', durationSec: 1, width: 1280, height: 720, file: new Blob(['x']), clientRequestId: 'req-1' })).rejects.toThrow('net');
    expect(confirmApi).not.toHaveBeenCalled();
  });
  it('FormData 字段顺序：file 在 fields 之后（presigned POST 的 policy 签名硬约束）', async () => {
    await uploadExportedProduct({ workflowId: 'w', videoProjectId: 'vp', resolution: '720p', durationSec: 1, width: 1280, height: 720, file: new Blob(['x']), clientRequestId: 'req-1' });
    const fd = axiosPost.mock.calls[0][1] as FormData;
    expect(fd.get('key')).toBe('k');
    expect(fd.get('policy')).toBe('p');
    expect(fd.get('file')).toBeInstanceOf(Blob);
    // M-1 强断言：不仅存在，且顺序正确（file 必须在 fields 之后）
    const keys = Array.from(fd.keys());
    expect(keys.indexOf('file')).toBeGreaterThan(keys.indexOf('policy'));
  });
  it('R19① register 失败重试一次：同 clientRequestId 原参再调（网络抖动命中服务端幂等分支，零重编码成本）', async () => {
    registerApi.mockRejectedValueOnce(new Error('net')); // 首调 reject、次调 resolve
    const r = await uploadExportedProduct({ workflowId: 'w', videoProjectId: 'vp', resolution: '720p', durationSec: 1, width: 1280, height: 720, file: new Blob(['x']), clientRequestId: 'req-1' });
    expect(registerApi).toHaveBeenCalledTimes(2);
    expect(registerApi.mock.calls[0][0].clientRequestId).toBe('req-1');
    expect(registerApi.mock.calls[1][0].clientRequestId).toBe('req-1'); // 同尝试内复用同幂等键
    expect(registerApi.mock.calls[1][0]).toEqual(registerApi.mock.calls[0][0]); // 原参重调
    expect(r).toEqual({ mediaId: 'uuid-1' }); // 幂等重入后流程正常走完
  });
  it('R19① register 两次都失败 → 异常传播（重试仅一次，不无限循环）', async () => {
    registerApi.mockRejectedValue(new Error('quota 400'));
    await expect(uploadExportedProduct({ workflowId: 'w', videoProjectId: 'vp', resolution: '720p', durationSec: 1, width: 1280, height: 720, file: new Blob(['x']), clientRequestId: 'req-1' })).rejects.toThrow('quota 400');
    expect(registerApi).toHaveBeenCalledTimes(2);
    expect(axiosPost).not.toHaveBeenCalled();
  });
});
