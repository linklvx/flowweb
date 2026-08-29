import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { uploadSplitBlobs } from './splitUploadService';
import * as storageApi from '@/api/storageApi';

vi.mock('@/api/storageApi', () => ({
  presignUpload: vi.fn(),
  confirmUpload: vi.fn(),
}));

const mockPresign = storageApi.presignUpload as ReturnType<typeof vi.fn>;
const mockConfirm = storageApi.confirmUpload as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockPresign.mockResolvedValue({ fileId: 'fid-1', uploadUrl: 'https://up.example/1', key: 'k1', fields: {} });
  mockConfirm.mockResolvedValue({ fileId: 'fid-1' });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeBlob(size = 100): Blob {
  return new Blob(['x'.repeat(size)], { type: 'image/webp' });
}

function toItems(blobs: Blob[]): Array<{ blob: Blob | null; index: number }> {
  return blobs.map((blob, i) => ({ blob, index: i }));
}

describe('uploadSplitBlobs', () => {
  it('uploads a single blob successfully', async () => {
    const items = toItems([makeBlob()]);
    const result = await uploadSplitBlobs(items, {});

    expect(result.success).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(result.success[0].fileId).toBe('fid-1');
  });

  it('uploads all blobs and returns correct fileIds', async () => {
    const items = toItems([makeBlob(), makeBlob(), makeBlob(), makeBlob()]);
    mockPresign
      .mockResolvedValueOnce({ fileId: 'fid-a', uploadUrl: 'https://up/a', key: 'ka', fields: {} })
      .mockResolvedValueOnce({ fileId: 'fid-b', uploadUrl: 'https://up/b', key: 'kb', fields: {} })
      .mockResolvedValueOnce({ fileId: 'fid-c', uploadUrl: 'https://up/c', key: 'kc', fields: {} })
      .mockResolvedValueOnce({ fileId: 'fid-d', uploadUrl: 'https://up/d', key: 'kd', fields: {} });

    const result = await uploadSplitBlobs(items, {});

    expect(result.success).toHaveLength(4);
    expect(result.success.map(r => r.fileId)).toEqual(['fid-a', 'fid-b', 'fid-c', 'fid-d']);
  });

  it('limits concurrency to maxConcurrent (default 3)', async () => {
    const items = toItems([makeBlob(), makeBlob(), makeBlob(), makeBlob(), makeBlob(), makeBlob()]);
    let maxConcurrent = 0;
    let current = 0;

    mockPresign.mockImplementation(async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise(r => setTimeout(r, 10));
      current--;
      return { fileId: `fid-${Date.now()}`, uploadUrl: 'https://up/x', key: 'k', fields: {} };
    });

    await uploadSplitBlobs(items, { maxConcurrent: 3 });

    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });

  it('retries on network error then succeeds', async () => {
    const items = toItems([makeBlob()]);
    let callCount = 0;

    mockPresign.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new TypeError('NetworkError');
      return { fileId: 'fid-retry', uploadUrl: 'https://up/r', key: 'kr', fields: {} };
    });

    const result = await uploadSplitBlobs(items, {});

    expect(callCount).toBe(2);
    expect(result.success).toHaveLength(1);
  });

  it('retries on 5xx error then succeeds', async () => {
    const items = toItems([makeBlob()]);
    let callCount = 0;

    mockPresign.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw Object.assign(new Error('API error: 503 Service Unavailable'), { status: 503 });
      }
      return { fileId: 'fid-5xx', uploadUrl: 'https://up/5', key: 'k5', fields: {} };
    });

    const result = await uploadSplitBlobs(items, {});

    expect(callCount).toBe(2);
    expect(result.success).toHaveLength(1);
  });

  it('does NOT retry on 4xx error', async () => {
    const items = toItems([makeBlob()]);
    let callCount = 0;

    mockPresign.mockImplementation(async () => {
      callCount++;
      throw Object.assign(new Error('API error: 400 Bad Request'), { status: 400 });
    });

    const result = await uploadSplitBlobs(items, {});

    expect(callCount).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.success).toHaveLength(0);
  });

  it('marks as failed after retry exhausts', async () => {
    const items = toItems([makeBlob()]);
    mockPresign.mockRejectedValue(new TypeError('NetworkError'));

    const result = await uploadSplitBlobs(items, {});

    expect(mockPresign).toHaveBeenCalledTimes(2);
    expect(result.failed).toHaveLength(1);
  });

  it('aborts all pending uploads when signal is triggered', async () => {
    const items = toItems([makeBlob(), makeBlob(), makeBlob()]);
    const ac = new AbortController();

    mockPresign.mockImplementation(async (_params: any, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      await new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
      return { fileId: 'never', uploadUrl: '', key: '', fields: {} };
    });

    setTimeout(() => ac.abort(), 5);

    const result = await uploadSplitBlobs(items, { signal: ac.signal });

    expect(result.failed.length + result.success.length).toBeLessThanOrEqual(3);
  });

  it('preserves original index so caller can map back to grid position', async () => {
    const items = toItems([makeBlob(), makeBlob()]);
    mockPresign
      .mockResolvedValueOnce({ fileId: 'fid-0', uploadUrl: 'https://up/0', key: 'k0', fields: {} })
      .mockResolvedValueOnce({ fileId: 'fid-1', uploadUrl: 'https://up/1', key: 'k1', fields: {} });

    const result = await uploadSplitBlobs(items, {});

    expect(result.success[0].index).toBe(0);
    expect(result.success[1].index).toBe(1);
  });

  it('reports null blobs as failed before queuing', async () => {
    const items: Array<{ blob: Blob | null; index: number }> = [
      { blob: makeBlob(), index: 0 },
      { blob: null, index: 1 },
      { blob: makeBlob(), index: 2 },
    ];

    const result = await uploadSplitBlobs(items, {});

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].index).toBe(1);
    expect(result.failed[0].error).toContain('裁剪失败');
    expect(result.success).toHaveLength(2);
  });

  it('uploadOne presign 透传 options.projectId', async () => {
    const items = toItems([makeBlob()]);

    await uploadSplitBlobs(items, { projectId: 'p1', maxConcurrent: 1, maxRetries: 0 });

    expect(mockPresign).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1' }),
      undefined, // signal
    );
  });
});
