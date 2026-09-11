// apps/web/src/pages/canvas/video-editor/export/client.ts
import type { ProjectData } from '../types';

export interface ExportJobParams { data: ProjectData; resolution: '720p' | '1080p'; mediaUrls: Record<string, string>; }
export interface ExportJobResult { blob: Blob; fsa: boolean; } // fsa=true 且调用方持 handle → getFile() 择源
export class ExportJobError extends Error {
  constructor(public category: 'unsupported' | 'memory' | 'unknown' | 'canceled', message: string) { super(message); }
}
export interface ExportJobHandle {
  promise: Promise<ExportJobResult>;
  cancel(): void;
}

/** FSA picker 需用户手势——由调用方（ExportModal）在点击处理器内先调本函数拿 handle */
export async function pickSaveFile(suggestedName: string): Promise<FileSystemFileHandle | null> {
  if (!('showSaveFilePicker' in window)) return null;
  try {
    return await (window as unknown as { showSaveFilePicker: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
      suggestedName,
      types: [{ description: 'MP4 视频', accept: { 'video/mp4': ['.mp4'] } }],
    });
  } catch { return null; } // 用户取消 picker
}

export function runExportJob(
  params: ExportJobParams,
  callbacks: { onProgress: (phase: 'mix' | 'encode', ratio: number) => void; onEta?: (etaSec: number) => void },
  saveFileHandle: FileSystemFileHandle | null = null,
): ExportJobHandle {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  let cancelFn: () => void = () => {};
  const promise = new Promise<ExportJobResult>((resolve, reject) => {
    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as { type: string; buffer?: ArrayBuffer; phase?: 'mix' | 'encode'; ratio?: number; etaSec?: number; category?: string; message?: string; fsa?: boolean };
      if (msg.type === 'progress' && msg.phase !== undefined && msg.ratio !== undefined) callbacks.onProgress(msg.phase, msg.ratio);
      else if (msg.type === 'eta' && msg.etaSec !== undefined) callbacks.onEta?.(msg.etaSec);
      else if (msg.type === 'done') {
        resolve({ blob: msg.buffer ? new Blob([msg.buffer], { type: 'video/mp4' }) : new Blob(), fsa: msg.fsa === true });
        worker.terminate();
      } else if (msg.type === 'error') {
        reject(new ExportJobError((msg.category as 'memory') ?? 'unknown', msg.message ?? ''));
        worker.terminate();
      }
    };
    worker.onerror = (ev: ErrorEvent) => {
      // worker.onerror / OOM 被杀归内存/未知
      reject(new ExportJobError(/memory|allocation/i.test(ev.message) ? 'memory' : 'unknown', ev.message || 'Worker 异常终止'));
      worker.terminate();
    };
    cancelFn = () => {
      worker.terminate();
      reject(new ExportJobError('canceled', '已取消'));
    };
    worker.postMessage({ type: 'run', params: { ...params, saveFileHandle } });
  });
  return { promise, cancel: () => cancelFn() };
}
