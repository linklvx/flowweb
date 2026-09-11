// apps/web/src/pages/canvas/video-editor/export/upload.ts
import axios from 'axios';
import { registerGeneratedMedia, confirmGeneratedMedia } from '@/api/videoProjectApi';

export interface UploadProductInput { workflowId: string; videoProjectId: string; resolution: '720p' | '1080p'; durationSec: number; file: Blob | File; }

/** 编码完成后登记（actualSize 过配额终判）→ presigned POST 浏览器 FormData 直传（零新依赖）→ confirm 实际大小落库+缩略图。
 *  File（FSA getFile 零内存读回）与 Blob 同走 FormData。 */
export async function uploadExportedProduct(input: UploadProductInput): Promise<{ mediaId: string }> {
  const { mediaId, upload } = await registerGeneratedMedia({
    workflowId: input.workflowId,
    videoProjectId: input.videoProjectId,
    resolution: input.resolution,
    durationSec: input.durationSec,
    actualSize: input.file.size,
  });
  const fd = new FormData();
  Object.entries(upload.fields).forEach(([k, v]) => fd.append(k, v));
  fd.append('file', input.file);
  await axios.post(upload.url.replace(/^https?:\/\/[^/]+\/flowai/, '/flowai'), fd); // 同源代理改写（AddNodeMenu 同款）
  await confirmGeneratedMedia(mediaId);
  return { mediaId };
}
