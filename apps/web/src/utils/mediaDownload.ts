import { message } from 'antd';
import { getMediaUrl } from '@/api/mediaApi';

export type DownloadResult = { ok: true } | { ok: false; reason: string };

export interface DownloadArgs {
  fileId?: string;
  url?: string;
  filename: string;
  /** 测试注入缝（仓内先例：deps 注入）；缺省走 api getMediaUrl */
  getMediaUrl?: (fileId: string) => Promise<{ url: string; ttlSec: number }>;
}

// FETCH_TIMEOUT_MS：headers 阶段卡死保护（AbortSignal.timeout 覆盖 fetch 全生命周期含 body 读取，大视频会误杀，故用 AbortController+clearTimeout）
const FETCH_TIMEOUT_MS = 30_000;

// mime→扩展名映射：仅收仓内实际产出的类型（reupload.js + video-separate.constants + 上传 allowlist）
const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-matroska': '.mkv',
  'video/x-msvideo': '.avi',
  'audio/mp4': '.m4a',
};

export async function downloadMediaFile(args: DownloadArgs, opts?: { silent?: boolean }): Promise<DownloadResult> {
  const fetcher = args.getMediaUrl ?? getMediaUrl;
  const fail = (reason: string) => {
    if (!opts?.silent) message.error(`下载失败：${args.filename}`);
    return { ok: false as const, reason };
  };
  const attempt = async (u: string) => {
    // v2.2：AbortController+headers 后 clearTimeout——AbortSignal.timeout 覆盖 fetch 全生命周期含 body 读取
    // （signal abort 中断流），大视频 30s 内读不完 body 即误杀；卡死保护限 headers 阶段，body 读取不限时
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(u, { signal: ctrl.signal });
      clearTimeout(timer);
      return res;
    } catch {
      clearTimeout(timer);
      return null;
    }
  };
  try {
    let url = args.url;
    if (!url && args.fileId) url = (await fetcher(args.fileId)).url;
    let res = url ? await attempt(url) : null;
    if ((!res || !res.ok) && args.fileId) {
      url = (await fetcher(args.fileId)).url;
      res = await attempt(url);
    }
    if (!res || !res.ok) return fail('fetch-failed');
    const blob = await res.blob();
    const ext = EXT_BY_MIME[blob.type] ?? '';
    const name = /\.[a-z0-9]{2,5}$/i.test(args.filename) || !ext ? args.filename : args.filename + ext;
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return { ok: true };
  } catch {
    return fail('fetch-failed');
  }
}
