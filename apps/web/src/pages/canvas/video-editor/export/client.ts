// apps/web/src/pages/canvas/video-editor/export/client.ts
import type { ExportResolution } from '@flowweb/shared';
import type { ProjectData } from '../types';

export interface ExportJobParams { data: ProjectData; resolution: ExportResolution; targetSize: { width: number; height: number }; mediaUrls: Record<string, string>; }
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

// P1-E 三态保存目标：canceled 必须中止（用户取消后不再白跑几分钟 CPU）；非 Chromium 无 FSA → OPFS 中转
// （navigator.storage.getDirectory() 无需手势）。jsdom 既无 showSaveFilePicker 也无 navigator.storage——deps 注入才可测
// （capabilities.ts ExportCapsDeps 同款先例）。
export type SaveTarget =
  | { kind: 'fsa'; handle: FileSystemFileHandle }
  | { kind: 'opfs'; handle: FileSystemFileHandle }   // OPFS 句柄同 FileSystemFileHandle 形状（getFile/createWritable 同接口）
  | { kind: 'canceled' };
export interface SaveTargetDeps {
  hasFsa?: () => boolean;                                          // 默认 () => 'showSaveFilePicker' in window
  pick?: (suggestedName: string) => Promise<FileSystemFileHandle>; // 默认 window.showSaveFilePicker（绑 window 调用防 this 丢失）
  getOpfsRoot?: () => Promise<FileSystemDirectoryHandle>;          // 默认 () => navigator.storage.getDirectory()
}
export async function pickSaveTarget(
  suggestedName: string,
  opts: { onDegraded?: (reason: 'security') => void; deps?: SaveTargetDeps } = {},
): Promise<SaveTarget> {
  const d = opts.deps ?? {};
  const hasFsa = d.hasFsa ?? (() => 'showSaveFilePicker' in window);
  const pick = d.pick ?? ((name: string) => (window as unknown as { showSaveFilePicker: (o: unknown) => Promise<FileSystemFileHandle> })
    .showSaveFilePicker({ suggestedName: name, types: [{ description: 'MP4 视频', accept: { 'video/mp4': ['.mp4'] } }] }));
  const getRoot = d.getOpfsRoot ?? (() => navigator.storage.getDirectory());
  const openOpfs = async (): Promise<SaveTarget> => {
    const root = await getRoot();
    const handle = await root.getFileHandle(`export-${crypto.randomUUID()}.mp4`, { create: true });
    sessionOpfsKeys.add(handle.name);
    return { kind: 'opfs', handle };
  };
  if (!hasFsa()) return openOpfs();                                    // 非 Chromium：OPFS 中转（无需用户手势）
  try {
    return { kind: 'fsa', handle: await pick(suggestedName) };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return { kind: 'canceled' }; // 用户取消——必须中止不回退（P1-E）
    if (e instanceof DOMException && e.name === 'SecurityError') {
      // 激活窗口耗尽/弹窗拦截——经 onDegraded 回调提示调用方，不得静默降级
      opts.onDegraded?.('security');
    }
    return openOpfs();                                                 // 其余异常（含 SecurityError 降级）→ OPFS
  }
}
// R7-N3：画布路径专用——不弹 FSA picker 直接开 OPFS（无手势依赖）
// R9-2：扁平参（非 { deps: {...} } 两层包装）
export async function openOpfsTarget(deps: Pick<SaveTargetDeps, 'getOpfsRoot'> = {}): Promise<SaveTarget> {
  const root = await (deps.getOpfsRoot?.() ?? navigator.storage.getDirectory());
  const handle = await root.getFileHandle(`export-${crypto.randomUUID()}.mp4`, { create: true });
  sessionOpfsKeys.add(handle.name);
  return { kind: 'opfs', handle };
}
// R6-B12：本会话创建的 OPFS key 登记（模块级 Set）——本地路径 a.click() 是 fire-and-forget 不能即时
// removeEntry（截断下载），成功清理延后到下次导出开头；陌生 key 仍按 24h 阈值清（防误删其他标签页在飞文件）
const sessionOpfsKeys = new Set<string>();
// OPFS 清理（画布路径成功/失败后即时调——upload 已 await 完成，无下载竞态）：
export async function cleanupOpfsTarget(target: SaveTarget): Promise<void> {
  if (target.kind !== 'opfs') return;
  try { await (await navigator.storage.getDirectory()).removeEntry(target.handle.name); } catch { /* 已不存在——幂等 */ }
  sessionOpfsKeys.delete(target.handle.name);
}
export { sessionOpfsKeys };
// （cleanupStaleOpfsExports 的实现体在 Task 19 结构落位段补——本任务只建三态+登记+fastStart。签名
// cleanupStaleOpfsExports(keepName?: string)，**不要在本任务实现**，保持任务边界）

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
