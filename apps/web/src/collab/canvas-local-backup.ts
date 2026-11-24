// apps/web/src/collab/canvas-local-backup.ts
// Y0b-5 T6：本地备份导出双产物+导入核（纯模块——不依赖 runtime 会话态，doc/provider 入参注入；
// runtime 提供 importLocalBackup 会话包装）。零依赖 ydocBuilder/shared/yjs——循环依赖安全。
// 双产物：.yjs=Y.encodeStateAsUpdate 二进制（可回灌——hydration failed 时 store 为空，旧 store
// 投影导出空画布的根修）+ .json=readCanvasFromDoc 反投影（doc 直读——禁 store 投影）。
// Y5 T6b（P4）：.yjs 字节=版本+纪元帧（见下方 FRAME_PREFIX 注释）；.json 侧车格式不变。
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

/** Y5 T6b：.yjs 帧头载荷（导出值由调用方从会话上下文注入——纯模块不读全局）。 */
export interface LocalBackupHeader {
  schemaVersion: number;
  historyToken: string;
}

/** 帧内 JSON 头（含 magic——decode 原样返回，校验归 applyLocalBackup）。 */
export interface YjsFrameHeader extends LocalBackupHeader {
  magic: string;
}

export interface LocalBackupArtifact {
  yjsBytes: number;
  jsonBytes: number;
  nodeCount: number;
}

// ── Y5 T6b（P4）：版本+纪元帧 ──────────────────────────────────────────────
// ASCII 'FWYJS1\n'（7B）+ uint32 大端 JSON 长度 + UTF-8 JSON {magic,schemaVersion,historyToken}
// + 原始 update 字节。导入要求头与当前库 schemaVersion/historyToken 全等——旧无头导出不兼容
// （无用户数据禁垫片）。
const FRAME_PREFIX = 'FWYJS1\n';
const FRAME_MAGIC = 'flowweb-yjs';
const FRAME_PREFIX_BYTES = new TextEncoder().encode(FRAME_PREFIX);
const FRAME_HEADER_OFFSET = FRAME_PREFIX_BYTES.byteLength + 4;   // 前缀+长度字段=11

export type YjsFrameDecodeResult =
  | { ok: true; header: YjsFrameHeader; update: Uint8Array }
  | { ok: false; reason: 'no-header' | 'bad-magic' | 'bad-length' | 'bad-json' };

/** 编帧：前缀+大端长度+JSON 头+原始 update（逐字节原样，不做 yjs 解析）。 */
export function encodeYjsFrame(update: Uint8Array, header: LocalBackupHeader): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify({
    magic: FRAME_MAGIC,
    schemaVersion: header.schemaVersion,
    historyToken: header.historyToken,
  }));
  const out = new Uint8Array(FRAME_HEADER_OFFSET + jsonBytes.byteLength + update.byteLength);
  out.set(FRAME_PREFIX_BYTES, 0);
  new DataView(out.buffer).setUint32(FRAME_PREFIX_BYTES.byteLength, jsonBytes.byteLength, false);
  out.set(jsonBytes, FRAME_HEADER_OFFSET);
  out.set(update, FRAME_HEADER_OFFSET + jsonBytes.byteLength);
  return out;
}

/** 解帧：仅做结构/形状校验（magic 字段值原样返回——与当前库的比对在 applyLocalBackup）。
 *  <11B=no-header；前缀不符=bad-magic；声明长度越界=bad-length；JSON 解析或头形状不符=bad-json。 */
export function decodeYjsFrame(bin: Uint8Array): YjsFrameDecodeResult {
  if (bin.byteLength < FRAME_HEADER_OFFSET) return { ok: false, reason: 'no-header' };
  for (let i = 0; i < FRAME_PREFIX_BYTES.byteLength; i++) {
    if (bin[i] !== FRAME_PREFIX_BYTES[i]) return { ok: false, reason: 'bad-magic' };
  }
  const jsonLen = new DataView(bin.buffer, bin.byteOffset + FRAME_PREFIX_BYTES.byteLength, 4).getUint32(0, false);
  const updateOffset = FRAME_HEADER_OFFSET + jsonLen;
  if (updateOffset > bin.byteLength) return { ok: false, reason: 'bad-length' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bin.subarray(FRAME_HEADER_OFFSET, updateOffset)));
  } catch {
    return { ok: false, reason: 'bad-json' };
  }
  const h = parsed as Partial<YjsFrameHeader> | null;
  if (!h || typeof h.magic !== 'string' || typeof h.schemaVersion !== 'number' || typeof h.historyToken !== 'string') {
    return { ok: false, reason: 'bad-json' };
  }
  return {
    ok: true,
    header: { magic: h.magic, schemaVersion: h.schemaVersion, historyToken: h.historyToken },
    update: bin.subarray(updateOffset),
  };
}

/** 产物核（导出/测试共用）：null doc（无会话）→null。JSON=doc 反投影（readCanvasFromDoc——作者态
 * records 同形，非 zustand store 投影：store 在 failed 态为空=不可作为内容源）。
 *  Y5 T6b：.yjs 产物=带版本+纪元头的帧（header 由调用方注入——本模块不读会话/全局）。 */
export function buildLocalBackupPayload(
  d: Y.Doc | null,
  header: LocalBackupHeader,
): { yjs: Uint8Array; json: string; nodeCount: number } | null {
  if (!d) return null;
  const yjs = encodeYjsFrame(Y.encodeStateAsUpdate(d), header);
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

/** 导出双产物（两个下载）：.yjs（octet-stream，带版本+纪元帧头）+.json（json）。返回字节面元数据
 *  （测试/toast 消费）。Y5 T6b：header 必传（会话上下文注入——不读全局）。 */
export function exportLocalBackup(
  d: Y.Doc | null,
  header: LocalBackupHeader,
  opts?: LocalBackupOptions,
): LocalBackupArtifact | null {
  const payload = buildLocalBackupPayload(d, header);
  if (!payload) return null;
  const base = `canvas-local-backup${opts?.tag ? `-${opts.tag}` : ''}-${Date.now()}`;
  downloadBlob(new Blob([payload.yjs], { type: 'application/octet-stream' }), `${base}.yjs`);
  downloadBlob(new Blob([payload.json], { type: 'application/json' }), `${base}.json`);
  return { yjsBytes: payload.yjs.byteLength, jsonBytes: payload.json.length, nodeCount: payload.nodeCount };
}

/** Y1c T18（spec §3.4 换代禁静默丢）：原始 CRDT 字节导出——单 .yjs 产物（可回灌=importLocalBackup
 *  消费同格式）。消费面=换代清族前的他 tab 脏草稿保全（mergeUpdates 并集字节——离线 tab 的
 *  唯一副本在盘上，无内存 doc 可反投影 ⇒ 不产 .json；不建 temp doc=零新增 applyUpdate 消费面）。
 *  Y5 T6b：下载体=带当前纪元头的帧；返回字节数=帧字节（落盘文件大小）。 */
export function exportRawYjsBackup(yjs: Uint8Array, header: LocalBackupHeader, opts?: LocalBackupOptions): number | null {
  if (yjs.byteLength === 0) return null;
  const framed = encodeYjsFrame(yjs, header);
  const base = `canvas-local-backup${opts?.tag ? `-${opts.tag}` : ''}-${Date.now()}`;
  downloadBlob(new Blob([framed], { type: 'application/octet-stream' }), `${base}.yjs`);
  return framed.byteLength;
}

export interface ImportLocalBackupDeps {
  doc: Y.Doc;
  /** 缝：只需 forceSync（HocuspocusProvider 结构子集——origin 判定按引用相等） */
  provider: { forceSync(): void };
}

export type ApplyLocalBackupResult =
  | { ok: true }
  | { ok: false; reason: 'over-limit'; limitBytes: number; backupBytes: number }
  | {
      ok: false;
      reason: 'no-header' | 'bad-magic' | 'bad-length' | 'bad-json' | 'epoch-mismatch' | 'schema-mismatch';
    };

/** 导入核（runtime importLocalBackup 会话包装消费——dirty 标记在 runtime 侧）：
 *  Y5 T6b 顺序锚：①解帧（结构校验）②over-limit 量 imported update 原始字节（上限=单文档上限；
 *  `backupBytes` 同报 update 长度——帧头开销不计入文档预算）③magic/字段与 expected 全等
 *  （不一致=拒绝，不 applyUpdate——旧纪元字节禁回放新纪元 log）④`Y.applyUpdate(doc,update,provider)`。
 *  以 provider 为 origin——documentUpdateHandler esm:762 `if (origin === this) return` 抑制整 bin
 *  Update 帧回发（默认 null origin 形态=整个备份一条 Update 帧上送⇒512KB tx 闸⇒3MB 备份被拒=导出
 *  8MB/导入 512KB 不对称的逃生断点）；随后 `forceSync()` ⇒上行改走 SS2 差分（服务端 maxDocBytes+
 *  ALLOWANCE 闸权威裁定）。
 *  ★≤2 次尝试收敛锚：8MB SS2 差分可能抽干 bytes 桶（refill≈4s）→单发吃 1008 退避——重试由
 *  supervisor 全局承接（1008→close 路由 exponential→重连→SS2 重同步自然收敛），本函数零自带
 *  重试（二次尝试=supervisor 重连后的 SS2，≤2 次满足；禁在此另起重试循环=双头恢复）。 */
export function applyLocalBackup(
  bin: Uint8Array,
  deps: ImportLocalBackupDeps,
  expected: LocalBackupHeader,
): ApplyLocalBackupResult {
  const framed = decodeYjsFrame(bin);
  if (!framed.ok) return { ok: false, reason: framed.reason };
  if (framed.update.byteLength > LOCAL_BACKUP_MAX_BYTES) {
    return {
      ok: false, reason: 'over-limit',
      limitBytes: LOCAL_BACKUP_MAX_BYTES,
      backupBytes: framed.update.byteLength,
    };
  }
  if (framed.header.magic !== FRAME_MAGIC) return { ok: false, reason: 'bad-magic' };
  if (framed.header.schemaVersion !== expected.schemaVersion) return { ok: false, reason: 'schema-mismatch' };
  if (framed.header.historyToken !== expected.historyToken) return { ok: false, reason: 'epoch-mismatch' };
  Y.applyUpdate(deps.doc, framed.update, deps.provider);
  deps.provider.forceSync();
  return { ok: true };
}
