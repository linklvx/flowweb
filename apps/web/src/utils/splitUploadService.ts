import { presignUpload, confirmUpload } from '@/api/storageApi';

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

function isRetryable(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  const status = (error as any)?.status;
  if (typeof status === 'number') {
    return status >= 500;
  }
  return false;
}

/** Presign + POST form upload (retryable). Does NOT call confirmUpload. */
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

  const { fileId, uploadUrl, key, fields } = await presignUpload(
    {
      fileName,
      fileSize: blob.size,
      fileType: 'image/webp',
      type: 'uploaded',
    },
    signal,
  );

  signal?.throwIfAborted();

  // Build FormData (minIO presigned POST)
  const formData = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    formData.append(k, v);
  }
  formData.append('file', blob, fileName);

  // Rewrite presigned URL through Vite proxy in dev (same as FileUpload.tsx)
  const proxyUrl = uploadUrl.replace(/^https?:\/\/[^/]+\/flowai/, '/flowai');

  const postRes = await fetch(proxyUrl, {
    method: 'POST',
    body: formData,
    signal,
  });

  if (!postRes.ok) {
    throw Object.assign(
      new Error(`Upload failed: ${postRes.status} ${postRes.statusText}`),
      { status: postRes.status },
    );
  }

  return { index, fileId, key, fileSize: blob.size };
}

/** Upload with retry (presign + PUT). confirmUpload is called once after retry succeeds. */
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
    .filter((item): item is { blob: Blob; index: number } => {
      if (!item.blob) {
        failed.push({ index: item.index, error: '子图裁剪失败（浏览器渲染异常）' });
        return false;
      }
      return true;
    });

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
          failed.push({ index: item.index, error: 'aborted' });
        } else {
          failed.push({ index: item.index, error: (err as Error).message });
        }
      } finally {
        activeCount--;
        await enqueue();
      }
    }
  };

  const pool = Array.from({ length: Math.min(maxConcurrent, queue.length) }, () => enqueue());
  await Promise.all(pool);

  return { success, failed };
}
