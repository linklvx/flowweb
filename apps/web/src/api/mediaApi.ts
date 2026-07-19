import { apiFetch } from './client';

export async function getMediaUrl(fileId: string): Promise<{ url: string }> {
  const res = await apiFetch(`/media/${fileId}/url`);
  // Rewrite presigned MinIO URL through same-path proxy to avoid CORS/signature issues
  res.url = (res.url as string).replace(/^https?:\/\/[^/]+\/flowai/, '/flowai');
  return res;
}

/**
 * Get a presigned GET URL for a MinIO object key, rewritten through the Vite proxy.
 * Used for banner background images.
 */
export async function getPresignedUrlByKey(key: string): Promise<string> {
  const res = await fetch(`/api/media/by-key?key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error('Failed to get presigned URL');
  const body = await res.json();
  const url = body.data?.url || body.url;
  // Rewrite through /flowai proxy (consistent with all other MinIO access patterns)
  return url.replace(/^https?:\/\/[^/]+\/flowai/, '/flowai');
}
