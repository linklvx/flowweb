import { apiFetch } from './client';
import { withSyncRetry } from './executionApi';

export interface PresignResponse {
  fileId: string;
  uploadUrl: string;
  key: string;
  fields: Record<string, string>;
}

// Y0b-5 T9（spec §5.3）：上传路径 503 语义化——withSyncRetry 扩消费（executionApi.ts:26 单源，
// 禁三处复制；503+Retry-After=部署/维护窗口预期瞬态：提示后等待自动重试恰一次）。SYNC_PENDING
// 分支对上传为死代码（仅执行受理端点回该码）——分支无害，单源复用优先。
export function presignUpload(
  params: {
    fileName: string;
    fileSize: number;
    fileType: string;
    type: 'uploaded' | 'temp';
    projectId?: string;
    teamId?: string;
  },
  signal?: AbortSignal,
): Promise<PresignResponse> {
  return withSyncRetry(() => apiFetch('/storage/presign', {
    method: 'POST',
    body: JSON.stringify(params),
    signal,
  }));
}

export function confirmUpload(
  params: {
    fileId: string;
    key: string;
    fileSize: number;
  },
  signal?: AbortSignal,
): Promise<{ fileId: string }> {
  return withSyncRetry(() => apiFetch('/storage/confirm', {
    method: 'POST',
    body: JSON.stringify(params),
    signal,
  }));
}
