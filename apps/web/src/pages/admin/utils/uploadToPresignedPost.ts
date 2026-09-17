import axios from 'axios';

/** 预签直传（spec §5.1）。裸 axios（非应用实例——api/client.ts 默认 Content-Type: application/json，
 *  S3 policy 对表单字段敏感）；模板 mediaUploadUtils.ts:27-35（该模板无进度参数——进度写法另引 VideoGenNode.tsx:498）。
 *  url 由调用方先过 toFlowaiUrl（桶非公开读 + dev CORS——同源改写后走 /flowai 代理/Vite 代理）。 */
export async function uploadToPresignedPost(args: {
  url: string;
  fields: Record<string, string>;
  file: File | Blob;
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const formData = new FormData();
  for (const [k, v] of Object.entries(args.fields)) formData.append(k, v); // fields 在前
  formData.append('file', args.file, args.file instanceof File ? args.file.name : 'cover.jpg'); // file 在后（S3 硬要求）
  try {
    await axios.post(args.url, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (e.total) args.onProgress?.(Math.round((e.loaded / e.total) * 100));
      },
      signal: args.signal,
    });
  } catch (e: any) {
    if (e?.response?.status === 403) throw new Error('上传超时（签名过期），请重试');
    throw e;
  }
}
