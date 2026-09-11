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
// Task 19：OPFS 残留清理（导出启动时 fire-and-forget 调用）。
// ① 先清本会话登记 key 但跳过 keepName（本次在用的中转——不排除则 worker createWritable 撞并发
//    removeEntry → NotFoundError → .catch(()=>null) 回退 Buffer → P0-B 磁盘中转静默失效）；
// ② 再迭代根目录匹配 export-*.mp4 且 lastModified > 24h 的陌生 key → removeEntry
//    （24h 门槛防误删其他标签页在飞文件）。
// 整体 try/catch 静默——Firefox 无痕 getDirectory 拒绝不得影响导出主流程。
export async function cleanupStaleOpfsExports(keepName?: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    for (const name of [...sessionOpfsKeys]) {
      if (name === keepName) continue;
      try { await root.removeEntry(name); } catch { /* 已不存在——幂等 */ }
      sessionOpfsKeys.delete(name);
    }
    // 陌生 key 迭代：TS DOM lib 未声明 keys() 迭代器时的形态兜底（如可直接用可去强转）
    for await (const name of (root as unknown as { keys(): AsyncIterableIterator<string> }).keys()) {
      if (name === keepName || sessionOpfsKeys.has(name)) continue; // 会话 key 已在 ① 处理
      if (!/^export-.+\.mp4$/.test(name)) continue;
      try {
        const f = await (await root.getFileHandle(name)).getFile(); // lastModified 经 getFile() 取
        if (Date.now() - f.lastModified > 24 * 60 * 60 * 1000) await root.removeEntry(name);
      } catch { /* 单文件失败不阻断整体 */ }
    }
  } catch { /* navigator.storage 缺失/无痕模式拒绝——静默 */ }
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
