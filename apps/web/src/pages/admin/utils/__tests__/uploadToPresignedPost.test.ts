import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { uploadToPresignedPost } from '../uploadToPresignedPost';

vi.mock('axios');
const post = vi.mocked(axios.post);

describe('uploadToPresignedPost', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('FormData fields 在前、file 在后（S3 presigned POST 硬要求）+ 显式 multipart 头', async () => {
    post.mockResolvedValue({} as any);
    await uploadToPresignedPost({ url: '/flowai/up', fields: { key: 'k', Policy: 'p' }, file: new File(['x'], 'a.mp4') });
    const [, formData, config] = post.mock.calls[0];
    const entries = [...(formData as FormData).entries()];
    expect(entries.map(([k]) => k)).toEqual(['key', 'Policy', 'file']); // fields 先、file 后
    expect((config as any).headers['Content-Type']).toBe('multipart/form-data');
  });

  it('onUploadProgress 喂 {loaded,total} → onProgress 百分比（useImageUpload.test.ts:265-267 先例）', async () => {
    post.mockImplementation(async (_url: string, _fd: unknown, cfg: any) => {
      cfg.onUploadProgress?.({ loaded: 50, total: 100 });
      return {};
    });
    const onProgress = vi.fn();
    await uploadToPresignedPost({ url: '/flowai/up', fields: {}, file: new File(['x'], 'a.mp4'), onProgress });
    expect(onProgress).toHaveBeenCalledWith(50);
  });

  it('signal 透传给 axios（abort 贯穿三段）', async () => {
    post.mockResolvedValue({} as any);
    const controller = new AbortController();
    await uploadToPresignedPost({ url: '/flowai/up', fields: {}, file: new File(['x'], 'a.mp4'), signal: controller.signal });
    expect((post.mock.calls[0][2] as any).signal).toBe(controller.signal);
  });

  it('403 → "上传超时（签名过期），请重试"（与体积超 policy ±1024 同症状——排查注意）', async () => {
    post.mockRejectedValue({ response: { status: 403 } });
    await expect(uploadToPresignedPost({ url: '/flowai/up', fields: {}, file: new File(['x'], 'a.mp4') }))
      .rejects.toThrow('上传超时（签名过期），请重试');
  });

  it('其他错误原样抛出', async () => {
    post.mockRejectedValue(new Error('network'));
    await expect(uploadToPresignedPost({ url: '/flowai/up', fields: {}, file: new File(['x'], 'a.mp4') }))
      .rejects.toThrow('network');
  });
});
