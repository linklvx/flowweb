# Image Grid Split (宫格切分) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add grid-split dropdown to ImageNodeToolbar's "宫格切分" button, allowing users to split an image into 2×2 to 5×5 (or custom) pieces, upload them, and create new connected image nodes.

**Architecture:** Pure utility layer (`imageSplit.ts`) for coordinate math + Canvas slicing → orchestration layer (`splitUploadService.ts`) for upload queue/concurrency/retry → store layer (`canvasStore.ts`) for state + node creation → component layer (toolbar UI + ImageGenNode wiring).

**Tech Stack:** React 18, TypeScript strict, antd 5, @xyflow/react 12, zustand 4, vitest, @testing-library/react

---

### File Structure Summary

| File | Action | Responsibility |
|------|--------|---------------|
| `apps/web/src/api/client.ts` | Modify | Accept optional `AbortSignal` in `apiFetch` |
| `apps/web/src/api/storageApi.ts` | Modify | Pass `signal` through to `apiFetch` |
| `apps/web/src/utils/imageSplit.ts` | Create | Pure functions: grid math, image load, Canvas slice |
| `apps/web/src/utils/imageSplit.test.ts` | Create | Unit tests for pure functions |
| `apps/web/src/utils/splitUploadService.ts` | Create | Upload orchestration: queue, retry, concurrency |
| `apps/web/src/utils/splitUploadService.test.ts` | Create | Tests for upload orchestration |
| `apps/web/src/stores/canvasStore.ts` | Modify | Add `splitImageNode`, `addChildNodes`, `splittingNodeId`, `splitAbortMap` |
| `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.tsx` | Modify | Add grid-split dropdown + custom sub-panel |
| `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx` | Modify | Add dropdown interaction tests |
| `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx` | Modify | Wire `handleGridSplit` + `fitView` |
| `apps/web/src/pages/canvas/components/nodes/ImageGenNode.test.tsx` | Modify | Add split integration tests |

---

### Task 1: apiFetch — AbortSignal support

**Files:**
- Modify: `apps/web/src/api/client.ts:1-22`

- [ ] **Step 1: Add signal to apiFetch**

```ts
// apps/web/src/api/client.ts
const BASE_URL = '/api';

interface FetchOptions {
  method?: string;
  body?: string;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, options?: FetchOptions): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options?.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options?.body,
    signal: options?.signal,
  });
  if (!res.ok) {
    const err = Object.assign(
      new Error(`API error: ${res.status} ${res.statusText}`),
      { status: res.status },
    );
    throw err;
  }
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(json.message);
  }
  return json.data;
}
```

- [ ] **Step 2: Run tests to verify no regression**

Run: `pnpm --filter web test --run src/api/`
Expected: All existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api/client.ts
git commit -m "feat: add AbortSignal support to apiFetch"
```

---

### Task 2: storageApi — pass signal through presignUpload/confirmUpload

**Files:**
- Modify: `apps/web/src/api/storageApi.ts:1-31`

- [ ] **Step 1: Add optional signal parameter**

```ts
import { apiFetch } from './client';

export interface PresignResponse {
  fileId: string;
  uploadUrl: string;
  key: string;
  fields: Record<string, string>;
}

export async function presignUpload(
  params: {
    fileName: string;
    fileSize: number;
    fileType: string;
    type: 'uploaded' | 'temp';
  },
  signal?: AbortSignal,
): Promise<PresignResponse> {
  return apiFetch('/storage/presign', {
    method: 'POST',
    body: JSON.stringify(params),
    signal,
  });
}

export async function confirmUpload(
  params: {
    fileId: string;
    key: string;
    fileSize: number;
  },
  signal?: AbortSignal,
): Promise<{ fileId: string }> {
  return apiFetch('/storage/confirm', {
    method: 'POST',
    body: JSON.stringify(params),
    signal,
  });
}
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter web test --run src/api/`
Expected: All existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api/storageApi.ts
git commit -m "feat: pass AbortSignal through presignUpload and confirmUpload"
```

---

### Task 3: imageSplit — pure functions

**Files:**
- Create: `apps/web/src/utils/imageSplit.ts`
- Create: `apps/web/src/utils/imageSplit.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/web/src/utils/imageSplit.test.ts
import { describe, it, expect } from 'vitest';
import { computeGridSizes, validateGridParams, scaleToMaxSize, isSubImageTooSmall } from './imageSplit';

describe('computeGridSizes', () => {
  it('returns equal sizes when total is divisible by count', () => {
    expect(computeGridSizes(1000, 2)).toEqual([500, 500]);
  });

  it('handles non-divisible: first N-1 floor, last absorbs remainder', () => {
    const result = computeGridSizes(100, 3);
    expect(result).toEqual([33, 33, 34]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('handles 10x10 image with 4x4 grid (edge case)', () => {
    const result = computeGridSizes(10, 4);
    expect(result.reduce((a, b) => a + b, 0)).toBe(10);
  });
});

describe('validateGridParams', () => {
  it('accepts valid grid params (2x2 to 5x5)', () => {
    expect(validateGridParams(2, 2)).toBe(true);
    expect(validateGridParams(3, 3)).toBe(true);
    expect(validateGridParams(5, 5)).toBe(true);
  });

  it('rejects rows < 2', () => {
    expect(validateGridParams(1, 3)).toBe(false);
    expect(validateGridParams(0, 3)).toBe(false);
  });

  it('rejects cols < 2', () => {
    expect(validateGridParams(3, 1)).toBe(false);
  });

  it('rejects rows > 5', () => {
    expect(validateGridParams(6, 3)).toBe(false);
  });

  it('rejects cols > 5', () => {
    expect(validateGridParams(3, 6)).toBe(false);
  });
});

describe('scaleToMaxSize', () => {
  it('scales down when long edge exceeds maxSize', () => {
    const result = scaleToMaxSize(8000, 4000, 4096);
    expect(result.width).toBe(4096);
    expect(result.height).toBe(2048);
  });

  it('preserves aspect ratio when scaling', () => {
    const result = scaleToMaxSize(6000, 3000, 4096);
    expect(result.width).toBe(4096);
    expect(result.height).toBe(2048);
  });

  it('returns original size when within limit', () => {
    const result = scaleToMaxSize(4096, 2048, 4096);
    expect(result.width).toBe(4096);
    expect(result.height).toBe(2048);
  });

  it('handles square image exactly at limit', () => {
    const result = scaleToMaxSize(4096, 4096, 4096);
    expect(result.width).toBe(4096);
    expect(result.height).toBe(4096);
  });

  it('handles portrait image exceeding limit', () => {
    const result = scaleToMaxSize(2000, 6000, 4096);
    expect(result.width).toBeLessThanOrEqual(4096);
    expect(result.height).toBeLessThanOrEqual(4096);
    expect(result.width / result.height).toBeCloseTo(2000 / 6000, 3);
  });
});

describe('isSubImageTooSmall', () => {
  it('returns false when sub-image long edge >= minSize', () => {
    expect(isSubImageTooSmall(100, 100, 2, 2, 10)).toBe(false);
  });

  it('returns true when sub-image long edge < minSize', () => {
    // 10x10 image / 5x5 = cell 2x2, long edge = 2 < 10
    expect(isSubImageTooSmall(10, 10, 5, 5, 10)).toBe(true);
  });

  it('boundary: sub-image exactly 10px', () => {
    // 20x20 image / 2x2 = cell 10x10
    expect(isSubImageTooSmall(20, 20, 2, 2, 10)).toBe(false);
  });

  it('boundary: sub-image exactly 9px', () => {
    // 18x18 image / 2x2 = cell 9x9
    expect(isSubImageTooSmall(18, 18, 2, 2, 10)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test --run src/utils/imageSplit.test.ts`
Expected: All tests FAIL (module not found / functions not exported).

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/web/src/utils/imageSplit.ts

/** Split total into `count` roughly equal parts. First N-1 are floor(total/count), last absorbs remainder. */
export function computeGridSizes(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) =>
    i < count - 1 ? base : total - base * (count - 1),
  );
}

/** Grid params must be in [2, 5]. */
export function validateGridParams(rows: number, cols: number): boolean {
  return rows >= 2 && rows <= 5 && cols >= 2 && cols <= 5;
}

/** Scale dimensions so long edge ≤ maxSize, maintaining aspect ratio. */
export function scaleToMaxSize(
  width: number,
  height: number,
  maxSize: number,
): { width: number; height: number } {
  if (width <= maxSize && height <= maxSize) return { width, height };
  const ratio = maxSize / Math.max(width, height);
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
}

export const MIN_SUB_IMAGE_PX = 10;

/** True if any cell's long edge is smaller than minSize. */
export function isSubImageTooSmall(
  imageWidth: number,
  imageHeight: number,
  rows: number,
  cols: number,
  minSize: number = MIN_SUB_IMAGE_PX,
): boolean {
  const cellW = Math.floor(imageWidth / cols);
  const cellH = Math.floor(imageHeight / rows);
  return Math.max(cellW, cellH) < minSize;
}

/**
 * Load an image from a URL with crossOrigin. AbortSignal support.
 * Timeout is controlled by the caller via AbortSignal — this function has no internal timer.
 */
export function loadImage(
  url: string,
  signal?: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const img = new Image();
    img.crossOrigin = 'anonymous';  // must be set BEFORE src

    const onDone = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
    };

    const onLoad = () => {
      onDone();
      if (img.naturalWidth === 0 || img.naturalHeight === 0) {
        reject(new Error('图片损坏，无法切分'));
      } else {
        resolve(img);
      }
    };

    const onError = () => {
      onDone();
      reject(new Error('图片加载失败'));
    };

    const onAbort = () => {
      onDone();
      img.src = '';
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    img.onload = onLoad;
    img.onerror = onError;
    img.src = url;
  });
}

/**
 * Split a loaded image into grid cells.
 * Returns all cells with their original index, including nulls for failed crops.
 * Setting canvas.width/height auto-clears the canvas (clearRect is redundant).
 */
export async function splitImageToBlobs(
  img: HTMLImageElement,
  imageWidth: number,
  imageHeight: number,
  rows: number,
  cols: number,
): Promise<Array<{ blob: Blob | null; index: number }>> {
  const cellWidths = computeGridSizes(imageWidth, cols);
  const cellHeights = computeGridSizes(imageHeight, rows);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const results: Array<{ blob: Blob | null; index: number }> = [];
  let index = 0;
  let offsetY = 0;

  for (let r = 0; r < rows; r++) {
    const ch = cellHeights[r];
    let offsetX = 0;
    for (let c = 0; c < cols; c++) {
      const cw = cellWidths[c];

      // Setting width/height auto-clears the canvas
      canvas.width = cw;
      canvas.height = ch;

      ctx.drawImage(
        img,
        offsetX, offsetY, cw, ch,   // source
        0, 0, cw, ch,                // dest
      );

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', 0.9),
      );

      results.push({ blob, index });

      offsetX += cw;
      index++;
    }
    offsetY += ch;
  }

  // Release canvas
  canvas.width = 0;
  canvas.height = 0;

  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test --run src/utils/imageSplit.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/imageSplit.ts apps/web/src/utils/imageSplit.test.ts
git commit -m "feat: add imageSplit pure functions (grid math, load, slice)"
```

---

### Task 4: splitUploadService — upload orchestration

**Files:**
- Create: `apps/web/src/utils/splitUploadService.ts`
- Create: `apps/web/src/utils/splitUploadService.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/web/src/utils/splitUploadService.test.ts
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
  // Default: success
  mockPresign.mockResolvedValue({ fileId: 'fid-1', uploadUrl: 'https://up.example/1', key: 'k1', fields: {} });
  mockConfirm.mockResolvedValue({ fileId: 'fid-1' });
  // Mock global fetch for PUT upload
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
        const err = Object.assign(new Error('API error: 503 Service Unavailable'), { status: 503 });
        throw err;
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
      const err = Object.assign(new Error('API error: 400 Bad Request'), { status: 400 });
      throw err;
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

    // 1 attempt + 1 retry = 2 calls, still fails
    expect(mockPresign).toHaveBeenCalledTimes(2);
    expect(result.failed).toHaveLength(1);
  });

  it('aborts all pending uploads when signal is triggered', async () => {
    const items = toItems([makeBlob(), makeBlob(), makeBlob()]);
    const ac = new AbortController();

    mockPresign.mockImplementation(async (_params: any, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      // Block until aborted
      await new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
      return { fileId: 'never', uploadUrl: '', key: '', fields: {} };
    });

    // Abort after a short delay
    setTimeout(() => ac.abort(), 5);

    const result = await uploadSplitBlobs(items, { signal: ac.signal });

    // All should fail (aborted)
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test --run src/utils/splitUploadService.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write implementation**

```ts
// apps/web/src/utils/splitUploadService.ts
import { presignUpload, confirmUpload } from '@/api/storageApi';

interface UploadBlobInput {
  blob: Blob;
  index: number;
}

interface UploadResult {
  index: number;
  fileId: string;
}

interface UploadFailed {
  index: number;
  error: string;
}

interface UploadAllResult {
  success: UploadResult[];
  failed: UploadFailed[];
}

interface UploadOptions {
  signal?: AbortSignal;
  maxConcurrent?: number;
  maxRetries?: number;
  cols?: number;
  namePrefix?: string;
}

interface BlobWithIndex {
  blob: Blob;
  index: number;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof TypeError) return true; // network error
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  // Check attached status property first (set by apiFetch), fallback to message regex
  const status = (error as any)?.status;
  if (typeof status === 'number') {
    return status >= 500;
  }
  const msg = (error as any)?.message ?? '';
  if (/5\d\d/.test(msg)) return true;
  return false;
}

/**
 * Presign + PUT upload (retryable). Does NOT call confirmUpload — that's done separately
 * after all uploads succeed, to avoid retrying the confirmation step.
 */
async function uploadOne(
  blob: Blob,
  index: number,
  cols: number,
  namePrefix: string,
  signal?: AbortSignal,
): Promise<{ index: number; fileId: string; key: string; fileSize: number }> {
  signal?.throwIfAborted();

  const row = Math.floor(index / cols);
  const col = index % cols;
  const fileName = `${namePrefix}_r${row}_c${col}.webp`;

  const presignResult = await presignUpload(
    {
      fileName,
      fileSize: blob.size,
      fileType: 'image/webp',
      type: 'uploaded',
    },
    signal,
  );

  signal?.throwIfAborted();

  // PUT to presigned URL
  const putRes = await fetch(presignResult.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/webp' },
    body: blob,
    signal,
  });

  if (!putRes.ok) {
    const err = Object.assign(
      new Error(`Upload failed: ${putRes.status} ${putRes.statusText}`),
      { status: putRes.status },
    );
    throw err;
  }

  return {
    index,
    fileId: presignResult.fileId,
    key: presignResult.key,
    fileSize: blob.size,
  };
}

/**
 * Upload with retry (presign + PUT). confirmUpload is called once after retry succeeds.
 */
async function uploadOneWithRetry(
  blob: Blob,
  index: number,
  cols: number,
  namePrefix: string,
  signal?: AbortSignal,
  maxRetries = 1,
): Promise<UploadResult> {
  let data: { index: number; fileId: string; key: string; fileSize: number } | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      signal?.throwIfAborted();
      data = await uploadOne(blob, index, cols, namePrefix, signal);
      break;
    } catch (err) {
      lastError = err;
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      if (!isRetryable(err)) throw err;
    }
  }

  if (!data) throw lastError!;
  signal?.throwIfAborted();

  // confirmUpload — NOT retried (avoid double-confirm side effects)
  await confirmUpload(
    { fileId: data.fileId, key: data.key, fileSize: data.fileSize },
    signal,
  );

  return { index: data.index, fileId: data.fileId };
}

export async function uploadSplitBlobs(
  items: Array<{ blob: Blob | null; index: number }>,
  options: UploadOptions = {},
): Promise<UploadAllResult> {
  const { signal, maxConcurrent = 3, maxRetries = 1, cols = 1, namePrefix = 'split' } = options;

  const success: UploadResult[] = [];
  const failed: UploadFailed[] = [];
  // Filter null blobs (canvas crop failures) before queuing — reported as failed
  const queue = items
    .filter(item => {
      if (!item.blob) {
        failed.push({ index: item.index, error: '子图裁剪失败（浏览器渲染异常）' });
        return false;
      }
      return true;
    });
  // queue is now Array<{ blob: Blob; index: number }>

  let activeCount = 0;
  let queueIndex = 0;

  const enqueue = async (): Promise<void> => {
    while (queueIndex < queue.length) {
      if (signal?.aborted) break;
      if (activeCount >= maxConcurrent) return;

      const item = queue[queueIndex++];
      activeCount++;

      try {
        const result = await uploadOneWithRetry(item.blob, item.index, cols, namePrefix, signal, maxRetries);
        success.push(result);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // Mark remaining as aborted silently
          failed.push({ index: item.index, error: 'aborted' });
        } else {
          failed.push({ index: item.index, error: (err as Error).message });
        }
      } finally {
        activeCount--;
        await enqueue(); // pump next
      }
    }
  };

  // Kick off initial pool
  const pool = Array.from({ length: Math.min(maxConcurrent, queue.length) }, () => enqueue());
  await Promise.all(pool); // wait for pool to drain

  return { success, failed };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter web test --run src/utils/splitUploadService.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/splitUploadService.ts apps/web/src/utils/splitUploadService.test.ts
git commit -m "feat: add splitUploadService with concurrency control and retry"
```

---

### Task 5: canvasStore — addChildNodes + splitImageNode + deleteNode abort

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts:1-282`

- [ ] **Step 1: Add abort trigger to existing deleteNode / deleteTransformNode**

Modify `deleteNode` (L84-90) to abort any running split task:

```ts
deleteNode: (id) => {
  // Abort any in-progress split task for this node
  const state = get();
  if (state.splitAbortMap[id]) {
    state.splitAbortMap[id].abort();
  }
  set((s) => ({
    nodes: s.nodes.filter((n) => n.id !== id),
    edges: s.edges.filter((e) => e.source !== id && e.target !== id),
    selectedId: s.selectedId === id ? null : s.selectedId,
  }));
},
```

Same for `deleteTransformNode`:

```ts
deleteTransformNode: (id) => {
  // Abort any in-progress split task
  const state = get();
  if (state.splitAbortMap[id]) {
    state.splitAbortMap[id].abort();
  }
  const ns = useNodeStore.getState();
  ns.deleteNode(id);
  ns.unregisterSaveHandler(id);
  set((s) => ({
    nodes: s.nodes.filter((n) => n.id !== id),
    edges: s.edges.filter((e) => e.source !== id && e.target !== id),
    selectedId: s.selectedId === id ? null : s.selectedId,
  }));
},
```

- [ ] **Step 2: Add addChildNodes method**

In `apps/web/src/stores/canvasStore.ts`, add these interfaces and state fields inside `CanvasState`:

```ts
// Add after existing imports and before CanvasState interface:

interface AddChildNodeItem {
  data: Record<string, unknown>;
  gridRow: number;
  gridCol: number;
}

interface SplitResult {
  newIds: string[];
  sourcePosition: { x: number; y: number };
  sourceSize: { w: number; h: number };
}

// Add to CanvasState interface:
splittingNodeId: string | null;
splitAbortMap: Record<string, AbortController>;
addChildNodes: (sourceId: string, nodeDataList: AddChildNodeItem[]) => string[];
splitImageNode: (nodeId: string, rows: number, cols: number) => Promise<SplitResult | null>;

// Add to create() initial state:
splittingNodeId: null,
splitAbortMap: {},
```

- [ ] **Step 2: Implement addChildNodes (batch create)**

Insert after `addChildNode` method in canvasStore:

```ts
addChildNodes: (sourceId, nodeDataList) => {
  const sourceNode = get().nodes.find((n) => n.id === sourceId);
  if (!sourceNode || nodeDataList.length === 0) return [];

  const sw = sourceNode.measured?.width ?? sourceNode.width ?? 400;
  const sh = sourceNode.measured?.height ?? sourceNode.height ?? 300;
  const startX = sourceNode.position.x + sw + 120;
  const startY = sourceNode.position.y;
  const GAP = 20;

  const newNodes: Node[] = [];
  const newEdges: Edge[] = [];
  const newIds: string[] = [];

  for (const item of nodeDataList) {
    const nodeId = getId('node');
    const edgeId = getId('edge');

    const x = startX + item.gridCol * (sw + GAP);
    const y = startY + item.gridRow * (sh + GAP);

    const newNode: Node = {
      id: nodeId,
      type: sourceNode.type,
      position: { x, y },
      data: item.data,
      selected: false,
    };

    const edge: Edge = { id: edgeId, source: sourceId, target: nodeId };

    newNodes.push(newNode);
    newEdges.push(edge);
    newIds.push(nodeId);
  }

  set((s) => ({
    nodes: [...s.nodes, ...newNodes],
    edges: [...s.edges, ...newEdges],
  }));

  // Populate nodeStore
  const ns = useNodeStore.getState();
  for (const node of newNodes) {
    ns.addNode({
      id: node.id,
      type: node.type!,
      position: node.position,
      data: node.data as any,
    });
  }

  return newIds;
},
```

- [ ] **Step 3: Implement splitImageNode**

Insert after `addChildNodes`:

```ts
import { loadImage, splitImageToBlobs, scaleToMaxSize, computeGridSizes, validateGridParams, isSubImageTooSmall, MIN_SUB_IMAGE_PX } from '@/utils/imageSplit';
import { uploadSplitBlobs } from '@/utils/splitUploadService';
import { getMediaUrl } from '@/api/mediaApi';
import { message } from 'antd';

splitImageNode: async (nodeId, rows, cols) => {
  const state = get();

  // Guard: already splitting
  if (state.splittingNodeId !== null) return null;

  // Guard: invalid params
  if (!validateGridParams(rows, cols)) return null;

  const sourceNode = state.nodes.find((n) => n.id === nodeId);
  if (!sourceNode) return null;

  const nsData = useNodeStore.getState().nodes[nodeId]?.data as any;
  const fileId: string | undefined = nsData?.fileId;
  const referenceImage: string | undefined = nsData?.referenceImage;

  // No image — resolve URL via mediaId (fileId or referenceImage)
  const mediaId = fileId || referenceImage;
  if (!mediaId) return null;

  // Snapshot source position/size
  const sourceW = sourceNode.measured?.width ?? sourceNode.width ?? 400;
  const sourceH = sourceNode.measured?.height ?? sourceNode.height ?? 300;
  const sourcePosition = { x: sourceNode.position.x, y: sourceNode.position.y };

  const ac = new AbortController();
  set((s) => ({
    splittingNodeId: nodeId,
    splitAbortMap: { ...s.splitAbortMap, [nodeId]: ac },
  }));

  let isTimeout = false;
  const timer = setTimeout(() => {
    isTimeout = true;
    ac.abort();
  }, 10_000);

  let imageUrl: string | null = null;

  try {
    // Resolve image URL via API
    imageUrl = (await getMediaUrl(mediaId)).url;

    // Abort check before loading
    ac.signal.throwIfAborted();

    const img = await loadImage(imageUrl, ac.signal);
    clearTimeout(timer);

    // Validate
    if (img.naturalWidth === 0 || img.naturalHeight === 0) {
      message.error('图片损坏，无法切分');
      return null;
    }

    // Scale if needed
    let finalW = img.naturalWidth;
    let finalH = img.naturalHeight;
    if (Math.max(finalW, finalH) > 4096) {
      const scaled = scaleToMaxSize(finalW, finalH, 4096);
      finalW = scaled.width;
      finalH = scaled.height;
    }

    // Min size check
    if (isSubImageTooSmall(finalW, finalH, rows, cols, MIN_SUB_IMAGE_PX)) {
      message.warning('切分后子图尺寸过小，无法使用');
      return null;
    }

    // Split to blobs
    const blobResults = await splitImageToBlobs(img, finalW, finalH, rows, cols);

    // Double-check source node still exists
    if (!get().nodes.find((n) => n.id === nodeId)) {
      ac.abort();
      return null;
    }

    // Upload (pass blobResults directly — preserves original indices)
    const namePrefix = (nsData?.fileName as string) || fileId || referenceImage || 'split';
    const uploadResult = await uploadSplitBlobs(
      blobResults,
      { signal: ac.signal, maxConcurrent: 3, maxRetries: 1, cols, namePrefix },
    );

    // Check again
    if (!get().nodes.find((n) => n.id === nodeId)) {
      ac.abort();
      return null;
    }

    // Build node data list (pair upload results with grid positions)
    const nodeDataList: AddChildNodeItem[] = [];
    for (const r of uploadResult.success) {
      const gridRow = Math.floor(r.index / cols);
      const gridCol = r.index % cols;
      nodeDataList.push({
        gridRow,
        gridCol,
        data: {
          fileId: r.fileId,
          fileName: `${namePrefix}_r${gridRow}_c${gridCol}.webp`,
          status: 'done',
          width: sourceW,
          height: sourceH,
        },
      });
    }

    // Batch create nodes
    const newIds = get().addChildNodes(nodeId, nodeDataList);

    // Report results
    const total = uploadResult.success.length + uploadResult.failed.length;
    const successCount = uploadResult.success.length;
    const failCount = uploadResult.failed.length;

    if (failCount === 0 && successCount > 0) {
      message.success(`成功切分为 ${successCount} 张图片`);
    } else if (successCount > 0 && failCount > 0) {
      message.warning(`切分完成：成功 ${successCount} 张，失败 ${failCount} 张`);
    } else if (successCount === 0 && total > 0) {
      message.error('切分失败：所有子图上传失败');
    }

    return {
      newIds,
      sourcePosition,
      sourceSize: { w: sourceW, h: sourceH },
    };
  } catch (err) {
    if (isTimeout) {
      message.error('图片加载超时，请检查网络');
    } else if (err instanceof DOMException && err.name === 'AbortError') {
      // Silent abort (user cancelled or node deleted)
    } else {
      message.error(`切分失败：${(err as Error).message}`);
    }
    return null;
  } finally {
    clearTimeout(timer);
    if (imageUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(imageUrl);
    }
    set((s) => {
      const { [nodeId]: _, ...restMap } = s.splitAbortMap;
      return { splittingNodeId: null, splitAbortMap: restMap };
    });
  }
},
```

- [ ] **Step 4: Run all existing tests to check no regressions**

Run: `pnpm --filter web test --run`
Expected: All existing tests pass. No canvasStore test exists so we rely on integration.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/canvasStore.ts
git commit -m "feat: add splitImageNode and addChildNodes to canvasStore"
```

---

### Task 6: ImageNodeToolbar — grid split dropdown UI

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.tsx`
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx`

- [ ] **Step 1: Write failing tests for dropdown UI**

Add to `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx` (after existing tests, before closing `});`):

```ts
  // ── Grid Split Dropdown Tests ──

  it('renders 宫格切分 button with text label', () => {
    setupPortalTarget();
    render(<ImageNodeToolbar {...defaultProps} />);
    expect(screen.getByText('宫格切分')).toBeInTheDocument();
    cleanupPortalTarget();
  });

  it('no grid-split onGridSplit callback when no image (disabled)', () => {
    setupPortalTarget();
    render(<ImageNodeToolbar {...defaultProps} fileId={undefined} referenceImage={undefined} />);
    // In upload-only mode, full toolbar (including 宫格切分) is not rendered
    expect(screen.queryByText('宫格切分')).not.toBeInTheDocument();
    cleanupPortalTarget();
  });

  it('宫格切分 button is disabled when splitting=true', () => {
    setupPortalTarget();
    render(<ImageNodeToolbar {...defaultProps} splitting={true} />);
    const btn = screen.getByText('宫格切分');
    expect(btn).toBeDisabled();
    cleanupPortalTarget();
  });

  it('disables all nodes 宫格切分 when splitting is in progress (store-driven)', () => {
    setupPortalTarget();
    // The button should have disabled styling/attribute when splitting
    render(<ImageNodeToolbar {...defaultProps} splitting={true} />);
    const btn = screen.getByText('宫格切分');
    expect(btn.closest('button')).toBeDisabled();
    cleanupPortalTarget();
  });
```

- [ ] **Step 2: Run to see tests fail**

Run: `pnpm --filter web test --run src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx`
Expected: New tests FAIL (splitting prop not accepted / button not disabled).

- [ ] **Step 3: Add splitting prop to interface and wire disabled**

Modify `ImageNodeToolbar.tsx`:

```tsx
// Add to interface ImageNodeToolbarProps:
onGridSplit?: (rows: number, cols: number) => void;
splitting?: boolean;

// Update props destructuring:
function ImageNodeToolbarComponent({
  nodeId,
  fileId,
  referenceImage,
  selected,
  onUpload = () => {},
  onRotateMirror,
  onCrop,
  onOutpaint,
  onErase,
  onRedraw,
  onFullscreen,
  onDownload,
  triggerRef,
  onGridSplit,
  splitting = false,
}: ImageNodeToolbarProps) {
```

- [ ] **Step 4: Wire disabled state on the button**

In the toolbar Row 2, modify the 宫格切分 button:

```tsx
<TextIconButton
  icon={<BorderlessTableOutlined style={{ fontSize: 16 }} />}
  ariaLabel="宫格切分"
  text="宫格切分"
  disabled={splitting || !hasImage || !onGridSplit}
/>
```

- [ ] **Step 5: Add Dropdown wrapper around the 宫格切分 button**

Replace the standalone button with antd Dropdown (add imports at top):

```tsx
import { Dropdown } from 'antd';
```

Then replace the 宫格切分 TextIconButton with:

```tsx
<Dropdown
  open={gridSplitOpen}
  onOpenChange={(next) => {
    if (splitting || !hasImage || !onGridSplit) return;
    setGridSplitOpen(next);
    if (!next) setSubMenuOpen(false);
  }}
  trigger={['click']}
  getPopupContainer={() => document.querySelector('.react-flow') || document.body}
  dropdownRender={() => (
    <div
      className="flex relative"
      onMouseLeave={() => {
        // 150ms debounce close sub-panel only
        subCloseTimerRef.current = window.setTimeout(() => setSubMenuOpen(false), 150);
      }}
      onMouseEnter={() => {
        if (subCloseTimerRef.current) clearTimeout(subCloseTimerRef.current);
      }}
    >
      {/* Main menu column */}
      <div
        className="flex flex-col gap-0.5 p-1.5 font-sans"
        style={{
          borderRadius: '12px',
          border: '0.5px solid #363636',
          background: 'rgba(31, 31, 31, 0.92)',
          boxShadow: '0 4px 10px rgba(0,0,0,0.2)',
          backdropFilter: 'blur(16px)',
          minWidth: 150,
        }}
      >
        {[
          { label: '4宫格 (2×2)', rows: 2, cols: 2 },
          { label: '9宫格 (3×3)', rows: 3, cols: 3 },
          { label: '16宫格 (4×4)', rows: 4, cols: 4 },
          { label: '25宫格 (5×5)', rows: 5, cols: 5 },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            className="flex w-full cursor-pointer items-center rounded-lg px-3 py-2.5 text-left font-sans text-[14px] leading-snug transition-colors duration-200 hover:bg-white/10"
            style={{ color: 'rgb(247,247,247)', background: 'transparent', border: 0 }}
            onClick={() => {
              onGridSplit?.(item.rows, item.cols);
              setGridSplitOpen(false);
            }}
            onMouseEnter={() => setSubMenuOpen(false)}
          >
            <span className="min-w-0 truncate">{item.label}</span>
          </button>
        ))}

        {/* Divider */}
        <div className="mx-2 my-0.5 h-px" style={{ background: '#363636' }} />

        {/* Custom button */}
        <button
          type="button"
          className="flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-left font-sans text-[14px] leading-snug transition-colors duration-200"
          style={{
            color: 'rgb(247,247,247)',
            background: subMenuOpen ? 'rgba(255,255,255,0.08)' : 'transparent',
            border: 0,
          }}
          onMouseEnter={() => {
            if (subCloseTimerRef.current) clearTimeout(subCloseTimerRef.current);
            setSubMenuOpen(true);
          }}
          onClick={() => setSubMenuOpen((v) => !v)}
        >
          <span className="min-w-0 truncate">自定义</span>
          <svg className="h-3 w-3 shrink-0 -rotate-90 opacity-60" viewBox="0 0 16 16" fill="currentColor">
            <path d="M6.198 0.117A0.4 0.4 0 0 1 6.765 0.117L7.188 0.541A0.4 0.4 0 0 1 7.188 1.107L4.147 4.148a0.4 0.4 0 0 1-.99 0L0.117 1.107A0.4 0.4 0 0 1 0.117 0.541L0.541 0.117a0.4 0.4 0 0 1 0.566 0L3.652 2.663 6.198 0.117Z" />
          </svg>
        </button>
      </div>

      {/* Sub-panel (conditional) */}
      {subMenuOpen && (
        <SubGridPanel
          selectedRows={selectedRows}
          selectedCols={selectedCols}
          onHover={(r, c) => { setPreviewRows(r); setPreviewCols(c); }}
          onSelect={(r, c) => { setSelectedRows(r); setSelectedCols(c); }}
          onConfirm={() => {
            onGridSplit?.(selectedRows, selectedCols);
            setGridSplitOpen(false);
            setSubMenuOpen(false);
          }}
          previewRows={previewRows}
          previewCols={previewCols}
          containerRef={subPanelContainerRef}
        />
      )}
    </div>
  )}
>
  <span>
    <TextIconButton
      icon={<BorderlessTableOutlined style={{ fontSize: 16 }} />}
      ariaLabel="宫格切分"
      text="宫格切分"
      disabled={splitting || !hasImage || !onGridSplit}
    />
  </span>
</Dropdown>
```

- [ ] **Step 6: Add state and SubGridPanel component**

Add state variables at top of the component function:

```tsx
const [gridSplitOpen, setGridSplitOpen] = useState(false);
const [subMenuOpen, setSubMenuOpen] = useState(false);
const [selectedRows, setSelectedRows] = useState(2);
const [selectedCols, setSelectedCols] = useState(2);
const [previewRows, setPreviewRows] = useState(2);
const [previewCols, setPreviewCols] = useState(2);
const subCloseTimerRef = useRef<number>(0);
const subPanelContainerRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  return () => {
    if (subCloseTimerRef.current) clearTimeout(subCloseTimerRef.current);
  };
}, []);
```

Add SubGridPanel component outside ImageNodeToolbarComponent (before the main component):

```tsx
interface SubGridPanelProps {
  selectedRows: number;
  selectedCols: number;
  previewRows: number;
  previewCols: number;
  onHover: (r: number, c: number) => void;
  onSelect: (r: number, c: number) => void;
  onConfirm: () => void;
  containerRef: React.RefObject<HTMLDivElement>;
}

function SubGridPanel({
  selectedRows,
  selectedCols,
  previewRows,
  previewCols,
  onHover,
  onSelect,
  onConfirm,
  containerRef,
}: SubGridPanelProps) {
  const [flipLeft, setFlipLeft] = useState(false);

  // Check right boundary on mount
  useEffect(() => {
    const el = containerRef.current?.closest('.ant-dropdown') as HTMLElement | null;
    if (el) {
      const rect = el.getBoundingClientRect();
      // Use viewport boundary (better UX than canvas-container boundary — avoids overflow beyond browser window)
      setFlipLeft(rect.right + 220 > window.innerWidth);
    }
  }, [containerRef]);

  return (
    <div
      ref={containerRef}
      className="absolute"
      style={{
        left: flipLeft ? 'auto' : '100%',
        right: flipLeft ? '100%' : 'auto',
        marginLeft: flipLeft ? 0 : 6,
        marginRight: flipLeft ? 6 : 0,
        top: 0,
      }}
    >
      <div
        className="p-1.5 font-sans"
        style={{
          borderRadius: '12px',
          border: '0.5px solid #363636',
          background: 'rgba(31,31,31,0.92)',
          boxShadow: '0 4px 10px rgba(0,0,0,0.2)',
          backdropFilter: 'blur(16px)',
        }}
      >
        <div className="flex flex-col gap-2.5 p-2">
          {/* Header */}
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[13px]" style={{ color: 'rgb(168,168,168)' }}>自定义宫格</span>
            <span className="text-[13px] font-medium" style={{ color: 'rgb(247,247,247)' }}>
              {previewRows} × {previewCols}
            </span>
          </div>

          {/* 5×5 grid */}
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}
          >
            {Array.from({ length: 5 }, (_, r) =>
              Array.from({ length: 5 }, (_, c) => {
                const row = r + 1; // 1-based for display
                const col = c + 1;
                const isPreview = row <= previewRows && col <= previewCols;
                const isDisabled = row === 1 || col === 1; // min 2×2
                return (
                  <button
                    key={`${row}-${col}`}
                    type="button"
                    disabled={isDisabled}
                    className="h-8 w-8 rounded border transition-colors duration-75"
                    style={{
                      borderColor: isPreview ? 'rgba(96,165,250,0.6)' : 'rgb(82,82,82)',
                      backgroundColor: isPreview ? 'rgba(59,130,246,0.4)' : 'rgba(64,64,64,0.5)',
                      opacity: isDisabled ? 0.3 : 1,
                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                    }}
                    onMouseEnter={() => !isDisabled && onHover(row, col)}
                    onClick={() => !isDisabled && onSelect(row, col)}
                  />
                );
              })
            )}
          </div>

          {/* Confirm button */}
          <button
            type="button"
            disabled={selectedRows < 2 || selectedCols < 2}
            className="w-full rounded-lg py-1.5 text-[13px] font-medium transition-colors"
            style={{
              background: 'rgb(59,130,246)',
              color: '#fff',
              border: 0,
              opacity: selectedRows < 2 || selectedCols < 2 ? 0.5 : 1,
              cursor: selectedRows < 2 || selectedCols < 2 ? 'not-allowed' : 'pointer',
            }}
            onClick={onConfirm}
          >
            确认切分
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter web test --run src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx`
Expected: All tests PASS (including new grid split tests).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.tsx apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx
git commit -m "feat: add grid split dropdown with custom sub-panel to ImageNodeToolbar"
```

---

### Task 7: ImageGenNode — wire up handleGridSplit + fitView

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx`
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.test.tsx`

- [ ] **Step 1: Wire handleGridSplit in ImageGenNode**

In `ImageGenNode.tsx`, add:

```tsx
// Add to store selectors (after existing useCanvasStore selectors, ~L64):
const splitImageNode = useCanvasStore((s) => s.splitImageNode);
const splittingNodeId = useCanvasStore((s) => s.splittingNodeId);

// Add handleGridSplit callback (after handleDownload ~L118):
const handleGridSplit = useCallback(async (rows: number, cols: number) => {
  const result = await splitImageNode(id, rows, cols);
  if (!result) return;
  fitView({
    nodes: [
      { id },
      ...result.newIds.map(nid => ({ id: nid })),
    ],
    padding: 0.2,
    duration: 300,
  });
}, [id, splitImageNode, fitView]);
```

Pass props to ImageNodeToolbar (around L776-790):

```tsx
<ImageNodeToolbar
  nodeId={id}
  fileId={fileId}
  referenceImage={referenceImage}
  selected={selected ?? false}
  onUpload={() => fileInputRef.current?.click()}
  onRotateMirror={handleRotateMirror}
  onCrop={() => enterEditMode('crop')}
  onOutpaint={() => enterEditMode('outpaint')}
  onErase={() => enterEditMode('erase')}
  onRedraw={() => enterEditMode('redraw')}
  onFullscreen={handleOpenFullscreen}
  onDownload={handleDownload}
  triggerRef={fullscreenTriggerRef}
  onGridSplit={handleGridSplit}
  splitting={splittingNodeId !== null}
/>
```

- [ ] **Step 2: Update ImageGenNode test mocks**

In `ImageGenNode.test.tsx`, add the new store selectors to the mock:

```ts
// Add to mockUseCanvasStore or canvasStore mock setup:
splitImageNode: vi.fn(),
splittingNodeId: null,
```

- [ ] **Step 3: Add canvas page unmount cleanup**

In `apps/web/src/pages/canvas/page.tsx`, add a `useEffect` that aborts all in-progress splits when the user leaves the canvas page:

```tsx
// page.tsx — add import:
import { useCanvasStore } from '@/stores/canvasStore';

// Inside CanvasPage component:
useEffect(() => {
  return () => {
    const { splitAbortMap } = useCanvasStore.getState();
    for (const ac of Object.values(splitAbortMap)) {
      ac.abort();
    }
  };
}, []);
```

- [ ] **Step 4: Run all tests**

Run: `pnpm --filter web test --run`
Expected: All tests pass. No regressions.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx apps/web/src/pages/canvas/components/nodes/ImageGenNode.test.tsx apps/web/src/pages/canvas/page.tsx
git commit -m "feat: wire grid split callback, fitView, and page-unmount cleanup"
```

---

### Task 8: Final integration verification

- [ ] **Step 1: TypeScript check**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: No type errors.

- [ ] **Step 2: Run full test suite**

Run: `pnpm --filter web test --run`
Expected: All tests pass.

- [ ] **Step 3: Verify build**

Run: `pnpm --filter web build`
Expected: Build succeeds.

---

## Self-Review Checklist

1. **Spec coverage**: 
   - UI 交互 (dropdown, sub-panel, hover/click, boundary flip) → Task 6
   - 切分逻辑 (grid math, Canvas slice, webp output) → Task 3
   - 上传编排 (concurrency, retry, 5xx/4xx, AbortController) → Task 4
   - Store (splitImageNode, addChildNodes, splittingNodeId, abortMap) → Task 5
   - fitView integration → Task 7
   - 状态反馈 (loading, success/fail messages) → Task 5
   - 测试 (unit, component, integration) → Tasks 3,4,6,7
   - Signal chain (apiFetch → presignUpload → upload) → Tasks 1,2,4

2. **Placeholder scan**: No TBD/TODO. All code is complete.

3. **Type consistency**: 
   - `AddChildNodeItem` used in Tasks 5 and 7 (same shape)
   - `SplitResult` defined in Task 5, consumed in Task 7
   - `onGridSplit(rows, cols)` signature: Tasks 6 and 7 aligned
   - `splitting` prop: Tasks 6 and 7 aligned
