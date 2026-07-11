import { apiFetch } from './client';

export async function getMediaUrl(fileId: string): Promise<{ url: string }> {
  const res = await apiFetch(`/media/${fileId}/url`);
  // Rewrite presigned MinIO URL through same-path proxy to avoid CORS/signature issues
  res.url = (res.url as string).replace(/^https?:\/\/[^/]+\/flowai/, '/flowai');
  return res;
}
