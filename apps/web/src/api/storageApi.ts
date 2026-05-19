import { apiFetch } from './client';

export interface PresignResponse {
  fileId: string;
  uploadUrl: string;
  key: string;
  fields: Record<string, string>;
}

export async function presignUpload(params: {
  fileName: string;
  fileSize: number;
  fileType: string;
  type: 'uploaded' | 'temp';
}): Promise<PresignResponse> {
  return apiFetch('/storage/presign', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function confirmUpload(params: {
  fileId: string;
  key: string;
  fileSize: number;
}): Promise<{ fileId: string }> {
  return apiFetch('/storage/confirm', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}
