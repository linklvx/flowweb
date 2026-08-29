import { presignUpload, confirmUpload } from '@/api/storageApi';
import { getMediaUrl } from '@/api/mediaApi';
import axios from 'axios';

export interface UploadImageBlobResult {
  url: string;
  fileId: string;
}

/**
 * Upload a Blob to MinIO and return the media URL + fileId.
 * Internal flow: presign → FormData POST → confirm → getMediaUrl.
 * Auto-generates filename: frame_{timestamp}_{8-random-chars}.jpg
 */
export async function uploadImageBlob(blob: Blob, projectId?: string): Promise<UploadImageBlobResult> {
  const randomStr = Math.random().toString(36).slice(2, 10);
  const fileName = `frame_${Date.now()}_${randomStr}.jpg`;

  const presign = await presignUpload({
    fileName,
    fileSize: blob.size,
    fileType: 'image/jpeg',
    type: 'uploaded',
    projectId,
  });

  const formData = new FormData();
  Object.entries(presign.fields).forEach(([k, v]) => formData.append(k, v));
  formData.append('file', blob, presign.key.split('/').pop() || fileName);

  const proxyUrl = presign.uploadUrl.replace(/^https?:\/\/[^/]+\/flowai/, '/flowai');

  await axios.post(proxyUrl, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  await confirmUpload({ fileId: presign.fileId, key: presign.key, fileSize: blob.size });

  const { url } = await getMediaUrl(presign.fileId);

  return { url, fileId: presign.fileId };
}
