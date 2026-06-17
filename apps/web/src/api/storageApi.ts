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
