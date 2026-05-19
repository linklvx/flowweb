import { apiFetch } from './client';

export async function getMediaUrl(fileId: string): Promise<{ url: string }> {
  return apiFetch(`/media/${fileId}/url`);
}
