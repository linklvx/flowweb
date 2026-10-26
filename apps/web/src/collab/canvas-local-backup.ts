// apps/web/src/collab/canvas-local-backup.ts
// Y0b-5 T6：本地备份导出双产物+导入核（纯模块——不依赖 runtime 会话态，doc/provider 入参注入；
// runtime 提供 importLocalBackup 会话包装）。零依赖 ydocBuilder/shared/yjs——循环依赖安全。
// 双产物：.yjs=Y.encodeStateAsUpdate 二进制（可回灌——hydration failed 时 store 为空，旧 store
// 投影导出空画布的根修）+ .json=readCanvasFromDoc 反投影（doc 直读——禁 store 投影）。
import * as Y from 'yjs';
import { readCanvasFromDoc } from './ydocBuilder';
import { LOCAL_CACHE_MAX_DOC_BYTES } from './local-collab-cache';

/** 导入上限判据=单文档上限同源（裁定 25⑷——非 2×maxTxBytes）。T8 换名落地：
 *  LOCAL_BACKUP_MAX_BYTES=LOCAL_CACHE_MAX_DOC_BYTES（=QUOTA_DEFAULTS.maxDocBytes 同源，零行为差）。 */
export const LOCAL_BACKUP_MAX_BYTES: number = LOCAL_CACHE_MAX_DOC_BYTES;

export interface LocalBackupOptions {
  /** 文件名标注（safeReload('generation') 传 oldgen<N>——标注旧代，世代被超的编辑本就无法合并） */
  tag?: string;
}

export interface LocalBackupArtifact {
  yjsBytes: number;
  jsonBytes: number;
  nodeCount: number;
}

/** 产物核（导出/测试共用）：null doc（无会话）→null。JSON=doc 反投影（readCanvasFromDoc——作者态
 *  records 同形，非 zustand store 投影：store 在 failed 态为空=不可作为内容源）。 */
export function buildLocalBackupPayload(d: Y.Doc | null): { yjs: Uint8Array; json: string; nodeCount: number } | null {
  if (!d) return null;
  const yjs = Y.encodeStateAsUpdate(d);
  const { nodes, edges } = readCanvasFromDoc(d);
  return { yjs, json: JSON.stringify({ nodes, edges }), nodeCount: nodes.length };
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 导出双产物（两个下载）：.yjs（octet-stream）+.json（json）。返回字节面元数据（测试/toast 消费）。 */
export function exportLocalBackup(d: Y.Doc | null, opts?: LocalBackupOptions): LocalBackupArtifact | null {
  const payload = buildLocalBackupPayload(d);
  if (!payload) return null;
  const base = `canvas-local-backup${opts?.tag ? `-${opts.tag}` : ''}-${Date.now()}`;
  downloadBlob(new Blob([payload.yjs], { type: 'application/octet-stream' }), `${base}.yjs`);
  downloadBlob(new Blob([payload.json], { type: 'application/json' }), `${base}.json`);
  return { yjsBytes: payload.yjs.byteLength, jsonBytes: payload.json.length, nodeCount: payload.nodeCount };
}

/** Y1c T18（spec §3.4 换代禁静默丢）：原始 CRDT 字节导出——单 .yjs 产物（可回灌=importLocalBackup
 *  消费同格式）。消费面=换代清族前的他 tab 脏草稿保全（mergeUpdates 并集字节——离线 tab 的
 *  唯一副本在盘上，无内存 doc 可反投影 ⇒ 不产 .json；不建 temp doc=零新增 applyUpdate 消费面）。 */
export function exportRawYjsBackup(yjs: Uint8Array, opts?: LocalBackupOptions): number | null {
  if (yjs.byteLength === 0) return null;
  const base = `canvas-local-backup${opts?.tag ? `-${opts.tag}` : ''}-${Date.now()}`;
  downloadBlob(new Blob([yjs], { type: 'application/octet-stream' }), `${base}.yjs`);
  return yjs.byteLength;
}

export interface ImportLocalBackupDeps {
  doc: Y.Doc;
  /** 缝：只需 forceSync（HocuspocusProvider 结构子集——origin 判定按引用相等） */
  provider: { forceSync(): void };
}

export type ApplyLocalBackupResult =
  | { ok: true }
  | { ok: false; reason: 'over-limit'; limitBytes: number; backupBytes: number };

/** 导入核（runtime importLocalBackup 会话包装消费——dirty 标记在 runtime 侧）：
 *  `Y.applyUpdate(doc, bin, provider)` 以 provider 为 origin——documentUpdateHandler
 *  esm:762 `if (origin === this) return` 抑制整 bin Update 帧回发（默认 null origin 形态=整个
 *  备份一条 Update 帧上送⇒512KB tx 闸⇒3MB 备份被拒=导出 8MB/导入 512KB 不对称的逃生断点）；
 *  随后 `forceSync()` ⇒上行改走 SS2 差分（服务端 maxDocBytes+ALLOWANCE 闸权威裁定）。
 *  ★≤2 次尝试收敛锚：8MB SS2 差分可能抽干 bytes 桶（refill≈4s）→单发吃 1008 退避——重试由
 *  supervisor 全局承接（1008→close 路由 exponential→重连→SS2 重同步自然收敛），本函数零自带
 *  重试（二次尝试=supervisor 重连后的 SS2，≤2 次满足；禁在此另起重试循环=双头恢复）。 */
export function applyLocalBackup(bin: Uint8Array, deps: ImportLocalBackupDeps): ApplyLocalBackupResult {
  if (bin.byteLength > LOCAL_BACKUP_MAX_BYTES) {
    return { ok: false, reason: 'over-limit', limitBytes: LOCAL_BACKUP_MAX_BYTES, backupBytes: bin.byteLength };
  }
  Y.applyUpdate(deps.doc, bin, deps.provider);
  deps.provider.forceSync();
  return { ok: true };
}
