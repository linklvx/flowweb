// Y1c T8（spec v5.4 §4.3/§4.4+ADR-01）：spool=WAL 帧协议升级（v1.7）——段头+52B 帧+walSeq+
// SHA-256 去重+恢复扫描+fsync 分档。段格式**单源=本文件编码器**（语料
// packages/shared/src/testing/y1c-wal-fault-corpus.ts 声明式消费——T0-S4 spike 原型收敛，
// spike 两份实现自此退役）。帧记录 `[payloadLen u32|crc32 u32|walSeq u64|generation u32|
// frameHash 32B|payload]`（52B 头）——CRC 覆盖 [walSeq‖generation‖frameHash‖payload]
// （帧头撕裂同落 CRC 网）；CRC 管损坏、hash 管身份（双层不混）。
// 段文件 `<projectId>.g<generation>.<segSeq>.spool`（owner 子目录——fenced 前任各写各目录
// 物理不撞名；换代=namespace 切代+旧段 quarantine+水位/去重重置）；段满 4MB 滚动。
// 段头 164B {magic,version,generation,projectId,historyId,createdAt,lastWriteAt,headerCrc32}
// ——lastWriteAt pwrite 与 headerCrc32 **成对**更新（F-S4-6：只写时间戳不更新 CRC=自毁段头）；
// 新建段 fsync 文件+父目录。putStash 语义=append 帧+同步 fsync（唯一持久动作——fsync 分档
// 注入缝=syncSegmentHandle）；confirm=按 frameId 内存记账，段内全部帧 confirmed（或整段
// 隔离且人工处置）→整段 unlink。持久化模型头注释见 collab.gateway.ts（§2.1 契约声明）。
// 崩溃语义：confirmed 集丢失→重启 scan 后全部帧重新可见→重复回灌由**去重索引（有界
// 24h/100k）+CRDT 幂等**双防线吸收。恢复扫描（recoverScan，T13 boot 消费）=ADR-01 §3：
// 段级双栅栏（historyId 每次必查；时间戳栅栏仅恢复怀疑态求值——F-S4-5）+完整有效前缀截断
// +PG 前缀校验（WAL 损坏只允许丢 walSeq>pgSeq 的帧）+坏段四档分类码（契约 walDefectTier 单源）。
// 修正 #6 铁律：时间戳栅栏=recoverySuspect 恢复怀疑态（自动扫描零重放），永不直接 quarantine。
import { Injectable, Logger, Optional } from '@nestjs/common';
import { FileHandle, open, readFile, readdir, rmdir, stat, truncate, unlink, mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import {
  WAL_SEGMENT_MAGIC,
  WAL_SEGMENT_VERSION,
  WAL_SEGMENT_HEADER_SIZE,
  WAL_ID_FIELD_BYTES,
  WAL_FRAME_FIXED_BYTES,
  WAL_DEDUP_INDEX_TTL_MS,
  WAL_DEDUP_INDEX_MAX_ENTRIES,
  shouldQuarantineSegment,
  walDefectTier,
  assertWatermarkInvariants,
  type WalSegmentHeader,
  type SystemHistoryState,
  type WalBadSegmentTier,
  type WalDefectKind,
  type WalQuarantineReason,
  type WalFsyncFailureTier,
  type WatermarkTriple,
  type WalFrameFixtureInput,
  type WalFaultInjection,
} from '@flowweb/shared';
import { captureCollabException } from '../../utils/sentry-scrub';
import {
  yjsSpoolTruncatedTotal,
  yjsSpoolWriteFailuresTotal,
  yjsSpoolCapacityTotal,
  yjsSpoolQuarantinedTotal,
  yjsUpdatesDiscardedDeletedTotal,
  walFsyncErrorTotal,
  yjsSpoolBadSegmentTotal,
  walSegmentQuarantinedTotal,
  walRecoverySuspectTotal,
} from './store.metrics';
import { isFkGone } from './pg-error.util';
import type { CanvasDocUpdateRepository } from './canvas-doc-update.repository';

export interface SpoolFrame { frameId: string; payload: Uint8Array }

const SEGMENT_MAX_BYTES = 4 * 1024 * 1024;
/** 帧记录 payloadLen 合法上界（spike 同源格式级 sanity 界——>9MiB WS 门/4MiB 批界的宽松上限）。 */
const WAL_MAX_FRAME_BYTES = 16 * 1024 * 1024;

// ═══════════════════ 段格式编解码（单源——语料/spike/生产共消费）═══════════════════

/** 段文件名（v1.7 换代 namespace 切代）：`<projectId>.g<generation>.<segSeq>.spool`。 */
export function walSegmentFileName(projectId: string, generation: number, segSeq: number): string {
  return `${projectId}.g${generation}.${segSeq}.spool`;
}

/** 段文件名解析：g-form 主档+legacy 平铺兼容（generation=null=旧名段——只可隔离不可追加）。 */
export function parseSegFileName(f: string): { projectId: string; segSeq: number; generation: number | null } | null {
  const g = /^(.+)\.g(\d+)\.(\d+)\.spool$/.exec(f);
  if (g) return { projectId: g[1], generation: Number(g[2]), segSeq: Number(g[3]) };
  const m = /^(.+)\.(\d+)\.spool$/.exec(f);
  return m ? { projectId: m[1], generation: null, segSeq: Number(m[2]) } : null;
}

/** 段头编码（164B LE——布局=契约 WAL_SEGMENT_HEADER_LAYOUT；id 域 zero-pad，超长拒绝）。 */
export function encodeWalSegmentHeader(meta: WalSegmentHeader): Buffer {
  for (const s of [meta.projectId, meta.historyId]) {
    if (Buffer.byteLength(s, 'utf8') > WAL_ID_FIELD_BYTES) throw new Error(`WAL id 域超长（>${WAL_ID_FIELD_BYTES}B）: ${s.slice(0, 32)}`);
  }
  const h = Buffer.alloc(WAL_SEGMENT_HEADER_SIZE);
  Buffer.from(WAL_SEGMENT_MAGIC, 'latin1').copy(h, 0);
  h.writeUInt16LE(WAL_SEGMENT_VERSION, 8);
  h.writeUInt16LE(WAL_SEGMENT_HEADER_SIZE, 10);
  h.writeUInt32LE(meta.generation, 12);
  h.write(meta.projectId, 16, 'utf8');
  h.write(meta.historyId, 16 + WAL_ID_FIELD_BYTES, 'utf8');
  h.writeBigUInt64LE(BigInt(meta.createdAtMs), 144);
  h.writeBigUInt64LE(BigInt(meta.lastWriteAtMs), 152);
  h.writeUInt32LE(crc32(h.subarray(0, 160)) >>> 0, 160);
  return h;
}

/** 段头解码+校验（magic/version/headerSize/headerCrc32 任一不符=bad-header——调用方整段隔离）。 */
export function decodeWalSegmentHeader(buf: Buffer): { header: WalSegmentHeader } | { badHeader: true } {
  if (buf.byteLength < WAL_SEGMENT_HEADER_SIZE) return { badHeader: true };
  if (buf.subarray(0, 8).toString('latin1') !== WAL_SEGMENT_MAGIC
    || buf.readUInt16LE(8) !== WAL_SEGMENT_VERSION
    || buf.readUInt16LE(10) !== WAL_SEGMENT_HEADER_SIZE) return { badHeader: true };
  if ((crc32(buf.subarray(0, 160)) >>> 0) !== buf.readUInt32LE(160)) return { badHeader: true };
  const trim = (s: Buffer) => s.toString('utf8').replace(/\0+$/, '');
  return {
    header: {
      projectId: trim(buf.subarray(16, 16 + WAL_ID_FIELD_BYTES)),
      generation: buf.readUInt32LE(12),
      historyId: trim(buf.subarray(16 + WAL_ID_FIELD_BYTES, 16 + 2 * WAL_ID_FIELD_BYTES)),
      createdAtMs: Number(buf.readBigUInt64LE(144)),
      lastWriteAtMs: Number(buf.readBigUInt64LE(152)),
    },
  };
}

const frameHashOf = (payload: Uint8Array): Buffer => createHash('sha256').update(payload).digest();

/** 帧记录编码：crc32 覆盖 [walSeq‖generation‖frameHash‖payload]（帧头撕裂同落 CRC 网）。 */
export function encodeWalFrame(rec: { walSeq: bigint; payload: Uint8Array }, generation: number): Buffer {
  const hash = frameHashOf(rec.payload);
  const body = Buffer.alloc(12 + 32 + rec.payload.length);
  body.writeBigUInt64LE(rec.walSeq, 0);
  body.writeUInt32LE(generation, 8);
  hash.copy(body, 12);
  Buffer.from(rec.payload.buffer, rec.payload.byteOffset, rec.payload.byteLength).copy(body, 44);
  const out = Buffer.alloc(WAL_FRAME_FIXED_BYTES + rec.payload.length);
  out.writeUInt32LE(rec.payload.length, 0);
  out.writeUInt32LE(crc32(body) >>> 0, 4);
  body.copy(out, 8);
  return out;
}

/** 段字节物化（语料消费——七 fixture 故障注入计划的字节级实现；seq 形态故障由 frames 偏序自表达）：
 *  bad-crc=帧载荷单字节翻转（CRC 网拦）；truncated=帧记录前 keepBytes 半写（撕裂尾）；
 *  history-mismatch/timestamp-fence=段头域覆写（头 CRC 随编码成对重算）。 */
export function encodeWalSegmentBytes(
  header: WalSegmentHeader,
  frames: WalFrameFixtureInput[],
  fault?: WalFaultInjection,
): Buffer {
  const h: WalSegmentHeader = { ...header };
  if (fault?.kind === 'history-mismatch') h.historyId = fault.historyId;
  if (fault?.kind === 'timestamp-fence') h.lastWriteAtMs = fault.lastWriteAtMs;
  const parts: Buffer[] = [encodeWalSegmentHeader(h)];
  const offsets: number[] = [];
  let off = WAL_SEGMENT_HEADER_SIZE;
  for (const f of frames) {
    offsets.push(off);
    const b = encodeWalFrame(f, f.generation ?? h.generation);
    parts.push(b);
    off += b.length;
  }
  let out = Buffer.concat(parts);
  if (fault?.kind === 'bad-crc') {
    out[offsets[fault.frameIndex] + WAL_FRAME_FIXED_BYTES + frames[fault.frameIndex].payload.length - 1] ^= 0xff;
  } else if (fault?.kind === 'truncated') {
    out = out.subarray(0, offsets[fault.frameIndex] + fault.keepBytes);
  }
  return out;
}

// ═══════════════════ 帧扫描核心（恢复扫描单源——spike 收敛）═══════════════════

/** granular 缺陷（fatal=段内即停+链级停链；benign=跳过不停链——崩溃重试天然产生跨段重复）。 */
interface WalScanDefect { kind: WalDefectKind; atOffset: number; walSeq?: bigint; fatal: boolean; detail: string }
interface WalScanFrame { walSeq: bigint; payload: Buffer; frameHash: Buffer }
/** 跨段共享去重状态（链式续段判定 dup-seq 良性与否的依据——段 N+1 重放段 N 帧须判良性）。 */
interface WalDedupeState { hashBySeq: Map<bigint, Buffer>; seenHashes: Set<string> }
interface WalSegmentScanResult {
  frames: WalScanFrame[];                    // 完整有效前缀（重放集）
  defects: WalScanDefect[];
  lastGoodOffset: number;                    // 首个致命缺陷记录起点（截断恢复点——其前恰为有效前缀）
  lastConsumedSeq: bigint | null;            // 含 dup-hash 消费的 seq（链式续段基准）
}

/** 单段帧扫描：完整有效前缀+granular 缺陷分类（首个致命缺陷即停——坏记录后的定界不可信）。
 *  精确性总断言（spike §4）：重建前缀=恰完整有效前缀（无漏好帧/无收坏帧）。 */
function scanWalSegmentBuffer(
  buf: Buffer,
  opts: { expectedNextSeq?: bigint | null; dedupe?: WalDedupeState; segmentGeneration?: number } = {},
): WalSegmentScanResult {
  const frames: WalScanFrame[] = [];
  const defects: WalScanDefect[] = [];
  const hashBySeq = opts.dedupe?.hashBySeq ?? new Map<bigint, Buffer>();
  const seenHashes = opts.dedupe?.seenHashes ?? new Set<string>();
  let lastAccepted: bigint | null = opts.expectedNextSeq != null ? opts.expectedNextSeq - 1n : null;
  let off = WAL_SEGMENT_HEADER_SIZE;
  while (off < buf.byteLength) {
    if (buf.byteLength - off < WAL_FRAME_FIXED_BYTES) {
      defects.push({ kind: 'truncated', atOffset: off, fatal: true, detail: `帧头不完整（余 ${buf.byteLength - off}B）` });
      break;
    }
    const payloadLen = buf.readUInt32LE(off);
    if (payloadLen > WAL_MAX_FRAME_BYTES || buf.byteLength - off < WAL_FRAME_FIXED_BYTES + payloadLen) {
      defects.push({ kind: 'truncated', atOffset: off, fatal: true, detail: `载荷不完整（len=${payloadLen} 余=${buf.byteLength - off}）` });
      break;
    }
    const crcExpect = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, off + WAL_FRAME_FIXED_BYTES + payloadLen);
    if ((crc32(body) >>> 0) !== crcExpect) {
      defects.push({ kind: 'bad-crc', atOffset: off, fatal: true, detail: `crc 期望 ${crcExpect.toString(16)} 实得 ${(crc32(body) >>> 0).toString(16)}` });
      break;
    }
    const walSeq = buf.readBigUInt64LE(off + 8);
    const generation = buf.readUInt32LE(off + 16);
    const frameHash = Buffer.from(buf.subarray(off + 20, off + 52));
    const payload = Buffer.from(buf.subarray(off + WAL_FRAME_FIXED_BYTES, off + WAL_FRAME_FIXED_BYTES + payloadLen));
    if (!frameHashOf(payload).equals(frameHash)) {
      defects.push({ kind: 'hash-mismatch', atOffset: off, walSeq, fatal: true, detail: '帧记录 frameHash≠SHA-256(payload)——骗过 CRC 网由 SHA 兜住' });
      break;
    }
    if (opts.segmentGeneration !== undefined && generation !== opts.segmentGeneration) {
      defects.push({ kind: 'generation-mismatch', atOffset: off, walSeq, fatal: true, detail: `帧 generation=${generation}≠段头 ${opts.segmentGeneration}（换代混段检测）` });
      break;
    }
    const hashKey = frameHash.toString('hex');
    if (lastAccepted != null && walSeq <= lastAccepted) {
      if (hashBySeq.get(walSeq)?.equals(frameHash)) {
        defects.push({ kind: 'dup-seq', atOffset: off, walSeq, fatal: false, detail: '旧 seq 同 hash 重放——去重跳过（良性）' });
        off += WAL_FRAME_FIXED_BYTES + payloadLen;
        continue;
      }
      defects.push({ kind: 'dup-seq', atOffset: off, walSeq, fatal: true, detail: '旧 seq 异 hash——seq 被改写重用，隔离' });
      break;
    }
    if (lastAccepted != null && walSeq > lastAccepted + 1n) {
      defects.push({ kind: 'gap', atOffset: off, walSeq, fatal: true, detail: `缺号：期望 ${lastAccepted + 1n} 实得 ${walSeq}` });
      break;
    }
    if (seenHashes.has(hashKey)) {
      defects.push({ kind: 'dup-hash', atOffset: off, walSeq, fatal: false, detail: '新 seq 承载已见 frameHash——去重跳过并消费 seq（良性）' });
      lastAccepted = walSeq;
      off += WAL_FRAME_FIXED_BYTES + payloadLen;
      continue;
    }
    frames.push({ walSeq, payload, frameHash });
    hashBySeq.set(walSeq, frameHash);
    seenHashes.add(hashKey);
    lastAccepted = walSeq;
    off += WAL_FRAME_FIXED_BYTES + payloadLen;
  }
  return { frames, defects, lastGoodOffset: off, lastConsumedSeq: lastAccepted };
}

/** 坏段四档分类计数（分类码单源=契约 walDefectTier——禁散写字符串）。 */
function noteBadSegmentTier(kind: WalDefectKind): WalBadSegmentTier {
  const tier = walDefectTier(kind);
  yjsSpoolBadSegmentTotal.inc({ tier });
  return tier;
}

// ═══════════════════ 恢复扫描报告（T13 消费面）═══════════════════

/** 整段隔离原因（契约三档+本服务内部扩展档：换代切段/PG 前缀 violation 证据保全/链断截尾
 *  ——扩展档不进契约枚举，只在服务内部分派 peek/replay 零帧语义）。 */
export type SegQuarantineReason = WalQuarantineReason | 'generation-switch' | 'pg-prefix-violation' | 'chain-stopped';

export interface WalRecoveryProjectReport {
  projectId: string;
  /** 自动扫描裁定重放的 walSeq 前缀（quarantine/recoverySuspect 段零帧——suspect 重放归恢复流裁定） */
  replayPrefix: bigint[];
  watermarks: WatermarkTriple;
  defects: Array<{ tier: WalBadSegmentTier; kind: WalDefectKind; segKey: string; fatal: boolean }>;
  quarantined: Array<{ segKey: string; reason: SegQuarantineReason }>;
  /** 修正 #6：时间戳栅栏触发段（自动扫描零重放——RESTORED_READONLY 恢复流裁定面，非静默丢段） */
  recoverySuspect: Array<{ segKey: string; lastWriteAtMs: number }>;
  /** WAL 损坏丢帧合法性 violation：lastGoodSeq<pgSeq（PG 已提交帧 WAL 无法证明——禁截断保证据） */
  pgPrefixViolation: Array<{ segKey: string; lastGoodSeq: bigint | null; pgSeq: bigint }>;
  truncated: Array<{ segKey: string; lastGoodOffset: number }>;
}

export interface WalRecoveryReport { projects: WalRecoveryProjectReport[] }

/** 段头七字段+帧区记账（scan 重建与运行期同构维护）。
 *  frameCount=**可解析**帧数（scan 只数好帧；运行期追加恒好帧）；goodBytes=已证干净字节上界
 *  （**含 164B 段头**——空段=164；追加守卫：stat().size 不符即封段滚动）；
 *  quarantinedRange=帧级坏尾字节区间事实（quarantineTruncatedFrames 写入——null=无坏尾）；
 *  segQuarantined=整段隔离（bad-header/history-mismatch/换代/violation/链断——peek/replay 零帧，
 *  其中 history-mismatch/generation-switch 有 sidecar 持久标记跨重启禁重放）。
 *  dir=段所在绝对目录；seq=段号；foreign=P18 外来段标记；generation=文件名 g 域（null=legacy 名）。 */
interface SegmentMeta {
  frameCount: number;
  goodBytes: number;
  bytes: number;
  confirmed: Set<number>;                        // 帧序号（内存态——崩溃丢失=幂等降级）
  confirmedCount: number;                        // confirmed 去重计数（confirm 段回收 O(1) 判据）
  sealed: boolean;                               // 封段后永不再追加（只置位不删字节——禁 ftruncate，R6）
  quarantinedRange: { fromOffset: number } | null;   // 帧级坏尾区间（坏帧起始偏移→EOF）
  quarantinedBytes: number;
  dir: string;
  seq: number;
  foreign: boolean;
  generation: number | null;
  seqs: bigint[];                                // 各帧 walSeq（confirm 推进内存 pgSeq 水位用）
  frameHashes: string[];                         // 各帧 SHA-256 hex（启动重建去重索引用）
  header: WalSegmentHeader | null;               // 段头缓存（lastWriteAt 成对 pwrite 基准）
  segQuarantined: SegQuarantineReason | null;
}

const legacySegFileName = (projectId: string, segSeq: number) => `${projectId}.${segSeq}.spool`;
const segFileNameOf = (projectId: string, generation: number | null, segSeq: number) =>
  generation == null ? legacySegFileName(projectId, segSeq) : walSegmentFileName(projectId, generation, segSeq);

/** R3 单源枚举（scan+quarantine 脚本+reconciler 共消费）：root 平铺段+一级子目录段（owner 目录）。
 *  非段条目（sidecar/`__probe__`）由消费方过滤；`__probe__` 探针文件在 owner 子目录内亦被枚举。 */
export async function listSpoolFiles(dir: string): Promise<{ dir: string; name: string }[]> {
  const out: { dir: string; name: string }[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) for (const f of await readdir(join(dir, e.name))) out.push({ dir: join(dir, e.name), name: f });
    else out.push({ dir, name: e.name });
  }
  return out;
}

/** 整段隔离 sidecar 记录（跨重启禁重放的持久标记——scan/recoverScan 识别）。 */
interface WholeSegmentQuarantineRecord { segSeq: number; reason: string; wholeSegment: true; firstSeenAt: string }

async function readWholeSegmentQuarantine(dir: string, segFile: string): Promise<WholeSegmentQuarantineRecord | null> {
  const raw = await readFile(join(dir, `${segFile}.quarantine`), 'utf8').catch(() => null);
  if (raw == null) return null;
  for (const line of raw.split('\n').reverse()) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as WholeSegmentQuarantineRecord;
      if (rec && rec.wholeSegment === true) return rec;
    } catch { /* 畸形行跳过（审计面——逐行 JSONL） */ }
  }
  return null;
}

/** sidecar 追加一行（先落盘后记账纪律——I1：写失败即异常上抛且调用方 meta 不动）。 */
async function appendSidecarLine(dir: string, segFile: string, rec: object): Promise<void> {
  const sc = await open(join(dir, `${segFile}.quarantine`), 'a');
  try {
    await sc.writeFile(`${JSON.stringify(rec)}\n`);
    await sc.sync();
  } finally {
    await sc.close().catch(() => {});
  }
}

/** 整段隔离持久标记（history-mismatch/generation-switch——跨重启禁重放）。 */
async function writeWholeSegmentSidecar(dir: string, segFile: string, reason: string): Promise<void> {
  await appendSidecarLine(dir, segFile, {
    segSeq: parseSegFileName(segFile)?.segSeq ?? -1, reason, wholeSegment: true, firstSeenAt: new Date().toISOString(),
  });
}

/** fsync 失败分档（契约 WAL_FSYNC_TIER_SEMANTICS——EIO=fail-stop；ENOSPC/写前失败=截断复用档）。 */
function classifyFsyncFailure(e: unknown): WalFsyncFailureTier {
  const code = (e as NodeJS.ErrnoException | null)?.code;
  if (code === 'EIO') return 'EIO';
  if (code === 'ENOSPC') return 'ENOSPC';
  return 'fsync-fail-pre';
}

const ZERO_WATERMARK: WatermarkTriple = { pgSeq: 0n, appliedSeq: 0n, spoolHeadSeq: 0n };

@Injectable()
export class CollabSpoolService {
  private readonly logger = new Logger(CollabSpoolService.name);
  private readonly dir: string;
  /** V15：原始入参（未 resolve）——validateDir 的相对路径检查对象（this.dir 恒为绝对路径）。 */
  private readonly rawDir: string;
  /** projectId → segKey → 段元数据（scan 重建与运行期同构维护）。R3：内键=段键（root 段=文件名；
   *  子目录段='<ownerDir>/<文件名>'）；scan 的临时 map 整体 swap（非 readonly）。 */
  private index = new Map<string, Map<string, SegmentMeta>>();

  // —— Task 2 追加（V14 两态熔断/V3 字节区间/V16 预算化回灌）——
  private static readonly WRITE_FAILURE_CIRCUIT = 5;          // 连续 5 次写失败→ioBroken
  private static readonly PROBE_INTERVAL_MS = 30_000;
  private static readonly SPOOL_CAPACITY_BYTES = 256 * 1024 * 1024;   // 默认容量（R3 测试缝同族 env 读）
  private static readonly REPLAY_BUDGET_MS = 5_000;           // V16：总墙钟预算
  private static readonly REPLAY_RETRY_MS = 200;              // V16：固定短退避
  private static readonly REPLAY_MERGE_MAX_FRAMES = 8;        // X8：合并上界（帧数）
  private static readonly REPLAY_MERGE_MAX_BYTES = 4 * 1024 * 1024;   // X8：合并上界（字节）
  private static readonly REPLAY_MAX_ATTEMPTS = 3;            // 每帧有界重试环
  private writeFailureStreak = 0;
  private ioBroken = false;                                   // V14：IO 态（探针可解）
  private overCapacityFlag = false;                           // V14：容量态（仅 depth 回落可解）
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  /** Y10：恢复回调 seam——gateway 注入（幂等调用安全）。 */
  onRecovered?: () => void;
  /** T8：EIO fail-stop seam（gateway T9 接线=close 全部连接 1011 WAL_FSYNC_EIO——spool 无 WS 通道）。 */
  onWalFailStop?: () => void;

  /** Y0a-3 T2 最小缝（R3 前置）：lease owner=spool 子目录名——fs 安全形态校验（构造期同规则）。 */
  private owner: string | null = null;
  setOwner(owner: string): void {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(owner)) throw new Error(`spool owner 非文件系统安全名: ${owner}`);
    this.owner = owner;
  }
  private activeDir(): string {
    if (!this.owner) throw new Error('spool owner not set——lease service 唯一写者必先 setOwner（契约 16 同族）');
    return join(this.dir, this.owner);
  }
  /** R3 段键：root 段=文件名；子目录段='<ownerDir>/<文件名>'（含 '/' 无 ':'——frameId 解析安全）。 */
  private segKeyOf(dir: string, name: string): string {
    return dir === this.dir ? name : `${relative(this.dir, dir).split(sep).join('/')}/${name}`;
  }

  // —— Y1c T8：WAL 上下文+walSeq+去重索引+水位 ——
  /** 段头 historyId（SystemHistory 单行权威——gateway/T9 注入；未注入=''：recoverScan 会按
   *  history-mismatch fail-closed 整段隔离——空串永不等于真实 historyId，fail-closed 方向正确）。 */
  private walHistoryId = '';
  setWalHistory(historyId: string): void { this.walHistoryId = historyId; }
  /** per-project 当前世代（帧内一律携带 generation；缺省 1——T9 actor 接线真实 CanvasDoc.generation）。 */
  private projectGeneration = new Map<string, number>();
  setProjectGeneration(projectId: string, generation: number): void { this.projectGeneration.set(projectId, generation); }
  /** per-project 下一 walSeq（单调；崩溃后 scan/recoverScan 自段内容重建）。 */
  private walSeqCounters = new Map<string, bigint>();
  peekNextWalSeq(projectId: string): bigint { return this.walSeqCounters.get(projectId) ?? 1n; }
  private allocateWalSeq(projectId: string): bigint {
    const next = this.peekNextWalSeq(projectId);
    this.walSeqCounters.set(projectId, next + 1n);
    return next;
  }
  /** EIO fail-stop 唯一态（false 后停收一切新帧+探针拒写——仅进程重启可复位，禁自动恢复）。 */
  private walHealthyFlag = true;
  walHealthy(): boolean { return this.walHealthyFlag; }
  /** 水位三元注册表（内存——pgSeq 持久列归 T10；assertWatermarkInvariants 每次推进断言）。 */
  private watermarks = new Map<string, WatermarkTriple>();
  watermark(projectId: string): WatermarkTriple | undefined { return this.watermarks.get(projectId); }
  /** SHA-256 去重有界索引（偏离 38④——跨重启「零重复 walSeq」成立）：键 `${projectId}\u0000${hashHex}`，
   *  插入序 FIFO——超 100k 驱逐最老；条目 24h TTL（查找惰性清除）。探针键排除（探针必须真写）。 */
  private dedupIndex = new Map<string, { frameId: string; at: number }>();
  private dedupLookup(projectId: string, hashHex: string): { frameId: string; at: number } | null {
    const e = this.dedupIndex.get(`${projectId}\u0000${hashHex}`);
    if (e == null) return null;
    if (Date.now() - e.at > WAL_DEDUP_INDEX_TTL_MS) { this.dedupIndex.delete(`${projectId}\u0000${hashHex}`); return null; }
    return e;
  }
  private dedupInsert(projectId: string, hashHex: string, frameId: string): void {
    const key = `${projectId}\u0000${hashHex}`;
    this.dedupIndex.set(key, { frameId, at: Date.now() });
    while (this.dedupIndex.size > WAL_DEDUP_INDEX_MAX_ENTRIES) {
      const oldest = this.dedupIndex.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.dedupIndex.delete(oldest);
    }
  }
  private dedupClearProject(projectId: string): void {
    const prefix = `${projectId}\u0000`;
    for (const k of [...this.dedupIndex.keys()]) if (k.startsWith(prefix)) this.dedupIndex.delete(k);
  }

  // @Optional()：Nest DI 对原始类型参数无法解析，不加会在模块实例化时让整个应用 boot 崩。
  private readonly capacityBytes: number;
  constructor(@Optional() dir?: string) {
    this.rawDir = dir ?? process.env.COLLAB_SPOOL_DIR ?? join(process.cwd(), '.data', 'collab-spool');
    this.dir = resolve(this.rawDir);
    const capEnv = Number(process.env.COLLAB_SPOOL_CAPACITY_BYTES);
    this.capacityBytes = capEnv > 0 ? capEnv : CollabSpoolService.SPOOL_CAPACITY_BYTES;
  }

  /** 键集（同步内存——gateway 键集缓存即此）。X8'：恒排除 `__probe__`。 */
  hasFrames(projectId: string): boolean {
    if (projectId === '__probe__') return false;
    return (this.index.get(projectId)?.size ?? 0) > 0;
  }
  keys(): string[] { return [...this.index.keys()].filter((k) => k !== '__probe__' && (this.index.get(k)?.size ?? 0) > 0); }

  /** V14 原语义+EIO fail-stop：综合可写判定——无 IO 熔断、无容量超限、walHealthy。写失败 streak
   *  不参与（streak 1-4 区间探针未启动，收窄受理面=单败停摆窗口）；EIO 立即 false（禁探针解）。 */
  isWritable(): boolean { return !this.ioBroken && !this.overCapacityFlag && this.walHealthyFlag; }
  overCapacity(): boolean { return this.overCapacityFlag; }
  failureStreak(): number { return this.writeFailureStreak; }

  /** Y24：depth 排除 `__probe__` 键；quarantinedBytes 含坏帧头（V3）+整段隔离字节。
   *  R3/P16 双口径：own=本实例 owner 子目录；stranded=外来段；容量核算取 total。 */
  depth(): { ownFiles: number; ownBytes: number; strandedFiles: number; strandedBytes: number; quarantinedBytes: number } {
    let ownFiles = 0, ownBytes = 0, strandedFiles = 0, strandedBytes = 0, quarantinedBytes = 0;
    for (const [pid, segs] of this.index) {
      if (pid === '__probe__') continue;
      for (const m of segs.values()) {
        if (m.foreign) { strandedFiles++; strandedBytes += m.bytes; }
        else { ownFiles++; ownBytes += m.bytes; }
        quarantinedBytes += m.quarantinedBytes;
      }
    }
    return { ownFiles, ownBytes, strandedFiles, strandedBytes, quarantinedBytes };
  }
  private depthTotalBytes(d: ReturnType<CollabSpoolService['depth']>): number { return d.ownBytes + d.strandedBytes; }
  totalFiles(d: ReturnType<CollabSpoolService['depth']> = this.depth()): number { return d.ownFiles + d.strandedFiles; }

  hasForeignSegments(): boolean {
    for (const segs of this.index.values()) for (const m of segs.values()) if (m.foreign) return true;
    return false;
  }

  /** 隔离段清单（诊断/运维面——帧级坏尾+整段隔离）。 */
  quarantinedSegments(): { projectId: string; segKey: string; quarantinedBytes: number }[] {
    const out: { projectId: string; segKey: string; quarantinedBytes: number }[] = [];
    for (const [pid, segs] of this.index) {
      for (const [key, m] of segs.entries()) {
        if (m.quarantinedRange != null || m.segQuarantined != null) out.push({ projectId: pid, segKey: key, quarantinedBytes: m.quarantinedBytes });
      }
    }
    return out;
  }

  /** W21/Z11（SV4）：收养静默外来段（boot 后新出现者；mtime ≥silentMs 无写入=其进程已死）。
   *  完整重扫（帧循环单源）；收养后 foreign=false 纳入 own 口径；整段隔离段不收养（sidecar 裁定优先）。 */
  async adoptSilentForeignSegments(silentMs: number): Promise<{ projectId: string; dir: string; name: string }[]> {
    const now = Date.now();
    const adopted: { projectId: string; dir: string; name: string }[] = [];
    for (const [pid, segs] of [...this.index.entries()]) {
      for (const [key, m] of [...segs.entries()]) {
        if (!m.foreign || m.segQuarantined != null) continue;
        const path = join(m.dir, segFileNameOf(pid, m.generation, m.seq));
        const st = await stat(path).catch(() => null);
        if (!st || now - st.mtimeMs < silentMs) continue;
        const buf = await readFile(path).catch(() => null);
        if (!buf) continue;
        const hdr = decodeWalSegmentHeader(buf);
        if ('badHeader' in hdr) continue;   // 坏头段不收养（隔离裁定归 scan/recoverScan）
        const { frameCount, goodBytes, truncated, seqs, frameHashes } = parseSegmentFramesPermissive(buf);
        segs.set(key, { frameCount, goodBytes, bytes: buf.byteLength, confirmed: new Set(), confirmedCount: 0,
          sealed: truncated, quarantinedRange: null, quarantinedBytes: 0, dir: m.dir, seq: m.seq, foreign: false,
          generation: m.generation, seqs, frameHashes, header: hdr.header, segQuarantined: null });
        adopted.push({ projectId: pid, dir: m.dir, name: segFileNameOf(pid, m.generation, m.seq) });
      }
    }
    return adopted;
  }

  /** putStash：append 帧+fsync——入账先于一切返回（失败 throw 交调用方走 BOI 队列路径）。
   *  T8：EIO fail-stop 停收前置+SHA-256 去重先于 walSeq 分配（§3.2 准入链 ③——命中返回原
   *  frameId 不写新帧不烧 seq；探针键排除=探针必须真写否则熔断永不解）。
   *  V14：容量判定=总字节（own+stranded 磁盘真值）；容量计数不进写失败 streak；10% 滞回。 */
  async append(projectId: string, payload: Uint8Array): Promise<string[]> {
    if (!this.walHealthyFlag) throw new Error('wal fail-stop（EIO）——walHealthy=false 停收全部新帧：要求进程重启+磁盘检查（不进复用路径）');
    if (projectId !== '__probe__') {
      const total = this.depthTotalBytes(this.depth());
      if (!this.overCapacityFlag && total + payload.byteLength > this.capacityBytes) {
        this.overCapacityFlag = true;
        yjsSpoolCapacityTotal.inc();
        this.logger.error('spool capacity exceeded（总口径含隔离/外来字节）——拒新编辑（不丢最旧：丢=蒸发同罪）；人工处置=collab-spool-quarantine 脚本');
      } else if (this.overCapacityFlag && total <= this.capacityBytes * 0.9) {
        this.overCapacityFlag = false;                        // 滞回解除（10% 余量防抖动）
        this.logger.log('spool capacity recovered');
        try { this.onRecovered?.(); } catch { /* I-3：容量恢复缝与 confirm 自评对称 */ }
      }
      if (this.overCapacityFlag) throw new Error('spool capacity exceeded');
      const hit = this.dedupLookup(projectId, frameHashOf(payload).toString('hex'));
      if (hit != null) return [hit.frameId];                  // 命中 applied=no-op 确认（原帧已 fsync）
    }
    try {
      const ids = await this.appendRaw(projectId, payload);
      this.noteWriteSuccess();
      if (projectId !== '__probe__') this.dedupInsert(projectId, frameHashOf(payload).toString('hex'), ids[0]);
      return ids;
    } catch (e) {
      this.noteWriteFailure();
      captureCollabException(e, { docName: `project:${projectId}`, reason: 'spool-append-failed', connectionId: '-' });
      throw e;
    }
  }

  // —— V14 两态熔断（ioBroken 探针可解 / overCapacity 仅 depth 回落可解；EIO 两态皆不可解）——
  private noteWriteFailure(): void {
    this.writeFailureStreak += 1;
    yjsSpoolWriteFailuresTotal.inc();
    if (this.writeFailureStreak >= CollabSpoolService.WRITE_FAILURE_CIRCUIT && !this.ioBroken) {
      this.ioBroken = true;
      this.logger.error('spool IO circuit OPEN：连续写失败——批次留队列（BOI）；受理面由 gateway.isWritableOrDegraded 只读降级');
      this.startProbe();
    }
  }
  private noteWriteSuccess(): void {
    this.writeFailureStreak = 0;
    if (this.ioBroken) {
      this.ioBroken = false;
      this.stopProbe();
      this.logger.log('spool IO circuit CLOSED：探针帧写删成功');
      try { this.onRecovered?.(); } catch { /* 回调异常不损恢复事实 */ }
    }
  }
  private startProbe(): void {
    if (this.probeTimer) return;
    this.probeTimer = setInterval(() => { void this.probe().catch(() => {}); }, CollabSpoolService.PROBE_INTERVAL_MS);
    this.probeTimer.unref?.();
  }
  private stopProbe(): void {
    if (this.probeTimer) { clearInterval(this.probeTimer); this.probeTimer = null; }
  }
  /** 探针=写 1 帧探针载荷+confirm 段回收+fsync——只解 ioBroken（EIO fail-stop 下 appendRaw 拒写）。 */
  async probe(): Promise<void> {
    const ids = await this.appendRaw('__probe__', new Uint8Array([0]));
    await this.confirm('__probe__', ids);
    this.noteWriteSuccess();
  }

  /** fsync 分档注入缝（生产恒 fh.sync()——测试 subclass 注入 EIO/ENOSPC 故障；非垫片：
   *  生产路径零分支变化，seam 与 onRecovered 同族）。 */
  protected async syncSegmentHandle(fh: FileHandle): Promise<void> { await fh.sync(); }

  /** 帧写入唯一实现（V2 封段守卫+X14 耐久性+WAL 帧协议 v1.7）。
   *  R3：写路径只落 activeDir（owner 子目录）；滚段计算只看同活动目录同 generation 段
   *  （换代=namespace 切代——旧代/legacy 段不参与追加候选）。
   *  收口7 契约：同项目 append 串行调用（生产由 gateway saveMutex/串行 drain 保证）。 */
  private async appendRaw(projectId: string, payload: Uint8Array): Promise<string[]> {
    if (!this.walHealthyFlag) throw new Error('wal fail-stop（EIO）——要求进程重启+磁盘检查（探针亦停）');
    const adir = this.activeDir();   // Z13：owner 必填断点
    await mkdir(adir, { recursive: true, mode: 0o700 });
    const gen = this.projectGeneration.get(projectId) ?? 1;
    const segs = this.index.get(projectId);
    let segSeq = -1; let meta: SegmentMeta | undefined;
    if (segs && segs.size > 0) {
      let maxSeq = -1;
      for (const m of segs.values()) {
        if (m.dir === adir && m.generation === gen && !m.segQuarantined && m.seq > maxSeq) maxSeq = m.seq;
      }
      if (maxSeq >= 0) {
        segSeq = maxSeq;
        meta = segs.get(this.segKeyOf(adir, segFileNameOf(projectId, gen, segSeq)));
        if (meta) {
          // stat 守卫：文件实际大小≠内存记账=外部写入/半写残留→封段滚动
          const st = await stat(join(adir, segFileNameOf(projectId, gen, segSeq))).catch(() => null);
          if (st && st.size !== meta.bytes) meta.sealed = true;
          if (meta.sealed || meta.goodBytes !== meta.bytes
            || meta.bytes + WAL_FRAME_FIXED_BYTES + payload.byteLength > SEGMENT_MAX_BYTES) {
            segSeq += 1; meta = undefined;
          }
        }
      }
    }
    if (segSeq < 0) segSeq = 0;
    const isNewSegment = !meta;
    if (!meta) {
      const header: WalSegmentHeader = {
        projectId, generation: gen, historyId: this.walHistoryId,
        createdAtMs: Date.now(), lastWriteAtMs: Date.now(),
      };
      meta = { frameCount: 0, goodBytes: WAL_SEGMENT_HEADER_SIZE, bytes: WAL_SEGMENT_HEADER_SIZE,
        confirmed: new Set(), confirmedCount: 0, sealed: false, quarantinedRange: null, quarantinedBytes: 0,
        dir: adir, seq: segSeq, foreign: false, generation: gen, seqs: [], frameHashes: [],
        header, segQuarantined: null };
      // 新建段：段头先落（头+首帧一次 fsync 后父目录 fsync——spike appendBatch 同款单 fsync 纪律）
      await writeFile(join(adir, segFileNameOf(projectId, gen, segSeq)), encodeWalSegmentHeader(header), { mode: 0o600 });
      if (!segs) this.index.set(projectId, new Map());
      this.index.get(projectId)!.set(this.segKeyOf(adir, segFileNameOf(projectId, gen, segSeq)), meta);
    }
    const path = join(adir, segFileNameOf(projectId, gen, segSeq));
    const frameIdx = meta.frameCount;
    const walSeq = this.allocateWalSeq(projectId);            // 分配（可恢复档失败回退=复用；EIO 烧号）
    const frame = encodeWalFrame({ walSeq, payload }, gen);
    const frameOffset = meta.bytes;
    try {
      const fh = await open(path, 'r+');   // 段已存在（新建=上方 writeFile 已落头）；X14 权限收敛
      try {
        await fh.chmod(0o600).catch(() => {});
        await fh.write(frame, 0, frame.length, frameOffset);
        // F-S4-6：lastWriteAt pwrite 与段头 CRC **成对**更新（只写时间戳不更新 CRC=自毁段头）
        const nh = encodeWalSegmentHeader({ ...meta.header!, lastWriteAtMs: Date.now() });
        await fh.write(nh.subarray(152, 160), 0, 8, 152);
        await fh.write(nh.subarray(160, 164), 0, 4, 160);
        await this.syncSegmentHandle(fh);   // fsync 完成才返回（契约 4：入账先于一切）
      } finally {
        await fh.close();
      }
    } catch (e) {
      meta.sealed = true;   // V2：写/同步失败即封段——消灭半写后继续追加同段黑洞
      const tier = classifyFsyncFailure(e);
      walFsyncErrorTotal.inc({ device: this.dir, tier });
      if (tier === 'EIO') {
        // fail-stop：不截断不复用（不进复用路径）——烧号防 dup-seq（字节可能已在缓存），要求重启+磁盘检查
        this.walHealthyFlag = false;
        this.logger.error(`WAL fsync EIO fail-stop：walHealthy=false/停收/close 1011（gateway seam）——要求进程重启+磁盘检查；段 ${path} 不截断（证据保留，恢复扫描裁定）`);
        try { this.onWalFailStop?.(); } catch { /* seam 异常不损 fail-stop 事实 */ }
      } else {
        // 可恢复档（写前失败/ENOSPC）：截断回 last-good+复用已分配未落盘 walSeq（不留洞）
        this.walSeqCounters.set(projectId, walSeq);
        try {
          await truncate(path, meta.goodBytes);
        } catch {
          // 截断本身失败=quarantine 段+拒服务（契约 fsync 分档）——sealed 已置，坏尾字节保留待人工
          this.logger.error(`WAL 截断回 last-good 失败——段 ${path} 拒服务待人工处置`);
          throw e;
        }
      }
      // 收口1：新段首帧失败→回滚 index 插入（不留幻影元数据；截断档已清帧字节，EIO 档留证）
      if (isNewSegment && meta.frameCount === 0) {
        const segsNow = this.index.get(projectId)!;
        segsNow.delete(this.segKeyOf(adir, segFileNameOf(projectId, gen, segSeq)));
        if (segsNow.size === 0) this.index.delete(projectId);
      }
      throw e;
    }
    meta.frameCount = frameIdx + 1;
    meta.seqs.push(walSeq);
    meta.frameHashes.push(frameHashOf(payload).toString('hex'));
    meta.bytes += frame.length;
    meta.goodBytes = meta.bytes;   // 追加成功则段尾干净
    if (meta.header) meta.header.lastWriteAtMs = Date.now();
    // X14：**新建段文件后 fsync 父目录**（文件数据落盘≠目录项落盘）。顺序不可倒；尽力而为加固层。
    if (isNewSegment) {
      try {
        const dh = await open(adir, 'r');
        try { await dh.sync(); } catch { /* ENOTSUP（Windows）——尽力而为 */ } finally { await dh.close(); }
      } catch { /* 目录句柄打开失败——写已成功，忽略 */ }
    }
    const segKey = this.segKeyOf(adir, segFileNameOf(projectId, gen, segSeq));
    this.advanceWatermark(projectId, walSeq);
    return [`${segKey}:${frameIdx}`];
  }

  /** 水位推进（append 成功——旧链帧入 spool 时已 apply：appliedSeq=spoolHeadSeq=walSeq；
   *  T9 actor 接管 appliedSeq 语义后本方法收缩为 spoolHead-only）。 */
  private advanceWatermark(projectId: string, seq: bigint): void {
    const w = this.watermarks.get(projectId) ?? ZERO_WATERMARK;
    const next: WatermarkTriple = { pgSeq: w.pgSeq, appliedSeq: seq, spoolHeadSeq: seq };
    assertWatermarkInvariants(next);
    this.watermarks.set(projectId, next);
  }

  /** 读全部未 confirm 好帧（以 index 的 frameCount=可解析帧数为界；整段隔离段零帧——
   *  bad-header/history-mismatch/换代/violation/链断统一 skip）。循环内解析失败=tripwire：计数+停读。 */
  async peek(projectId: string): Promise<SpoolFrame[]> {
    const segs = this.index.get(projectId);
    if (!segs) return [];
    const frames: SpoolFrame[] = [];
    const ordered = [...segs.entries()]
      .filter(([, m]) => m.segQuarantined == null)
      .sort(([, a], [, b]) => a.seq - b.seq || (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
    for (const [segKey, meta] of ordered) {
      let buf: Buffer;
      try { buf = await readFile(join(meta.dir, segFileNameOf(projectId, meta.generation, meta.seq))); }
      catch { continue; }   // 段文件消失（已 unlink）——跳过
      let off = WAL_SEGMENT_HEADER_SIZE; let idx = 0;
      while (idx < meta.frameCount) {
        if (off + WAL_FRAME_FIXED_BYTES > buf.byteLength) { this.reportTruncation(projectId, meta.seq); break; }
        const len = buf.readUInt32LE(off);
        if (off + WAL_FRAME_FIXED_BYTES + len > buf.byteLength) { this.reportTruncation(projectId, meta.seq); break; }
        const body = buf.subarray(off + 8, off + WAL_FRAME_FIXED_BYTES + len);
        if ((crc32(body) >>> 0) !== buf.readUInt32LE(off + 4)) { this.reportTruncation(projectId, meta.seq); break; }
        const payload = buf.subarray(off + WAL_FRAME_FIXED_BYTES, off + WAL_FRAME_FIXED_BYTES + len);
        if (!meta.confirmed.has(idx)) frames.push({ frameId: `${segKey}:${idx}`, payload: new Uint8Array(payload) });
        off += WAL_FRAME_FIXED_BYTES + len; idx += 1;
      }
    }
    return frames;
  }

  /** confirm=append 成功后的记账性动作（契约 12：本方法不触 DB）+内存 pgSeq 水位推进。
   *  段回收判据（V3）：全部可解析帧 confirmed ∧ 坏尾已处置（quarantinedRange 已记 ∨ 段尾干净）。 */
  async confirm(projectId: string, frameIds: string[]): Promise<void> {
    const segs = this.index.get(projectId);
    if (!segs) return;
    for (const id of frameIds) {
      const c = id.lastIndexOf(':');
      const segKey = c < 0 ? id : id.slice(0, c);
      const n = Number(id.slice(c + 1));
      const m = segs.get(segKey);
      if (m && !m.confirmed.has(n)) {
        m.confirmed.add(n); m.confirmedCount += 1;   // 收口4：去重+递增
        const fs = m.seqs[n];
        if (fs != null) {
          const w = this.watermarks.get(projectId) ?? ZERO_WATERMARK;
          const next: WatermarkTriple = { ...w, pgSeq: fs > w.pgSeq ? fs : w.pgSeq };
          assertWatermarkInvariants(next);
          this.watermarks.set(projectId, next);
        }
      }
    }
    for (const [segKey, meta] of [...segs.entries()]) {
      const allGoodConfirmed = meta.frameCount > 0 && meta.confirmedCount === meta.frameCount;
      const tailSettled = meta.quarantinedRange != null || meta.goodBytes === meta.bytes || meta.segQuarantined != null;
      if (!allGoodConfirmed || !tailSettled) continue;
      const file = join(meta.dir, segFileNameOf(projectId, meta.generation, meta.seq));
      try { await unlink(file); } catch { /* 已消失 */ }
      try { await unlink(`${file}.quarantine`); } catch { /* 无 sidecar */ }
      if (meta.dir !== this.dir) await rmdir(meta.dir).catch(() => {});   // R3：空 owner 目录回收
      segs.delete(segKey);
    }
    if (segs.size === 0) this.index.delete(projectId);
    // I-3：容量滞回自评——confirm 是 depth 回落的观测点（段回收时）；探针键排除。
    if (projectId !== '__probe__' && this.overCapacityFlag) {
      if (this.depthTotalBytes(this.depth()) <= this.capacityBytes * 0.9) {
        this.overCapacityFlag = false;
        this.logger.log('spool capacity recovered（confirm 时点自评）');
        try { this.onRecovered?.(); } catch { /* seam 同上 */ }
      }
    }
  }

  /** V3：坏帧段处置=字节区间隔离（坏帧起始偏移→EOF）；sidecar 记偏移区间；
   *  quarantinedBytes = byteLength - off（含坏帧头）；重复调用不重复递增计数。
   *  R3：枚举走 listSpoolFiles 单源；整段隔离段跳过（sidecar 裁定优先——不重复隔离）。 */
  async quarantineTruncatedFrames(projectId: string): Promise<number> {
    const segs = this.index.get(projectId);
    if (!segs) return 0;
    let newQuarantined = 0;
    for (const { dir, name: f } of await listSpoolFiles(this.dir)) {
      if (!f.endsWith('.spool')) continue;
      const parsed = parseSegFileName(f);
      if (!parsed || parsed.projectId !== projectId) continue;
      const meta = segs.get(this.segKeyOf(dir, f));
      if (!meta || meta.quarantinedRange != null || meta.segQuarantined != null) continue;
      const buf = await readFile(join(dir, f));
      let off: number;
      const hdr = decodeWalSegmentHeader(buf);
      if ('badHeader' in hdr) {
        off = 0;   // 段头即坏——整文件字节区间隔离（帧区不可信）
      } else {
        off = WAL_SEGMENT_HEADER_SIZE;
        while (off + WAL_FRAME_FIXED_BYTES <= buf.byteLength) {
          const len = buf.readUInt32LE(off);
          if (off + WAL_FRAME_FIXED_BYTES + len > buf.byteLength
            || (crc32(buf.subarray(off + 8, off + WAL_FRAME_FIXED_BYTES + len)) >>> 0) !== buf.readUInt32LE(off + 4)) break;
          off += WAL_FRAME_FIXED_BYTES + len;
        }
        if (off >= buf.byteLength) continue;                     // 干净段
      }
      // I1：sidecar 先落盘后记账——写失败即异常上抛且 meta 三字段未动（保守正确可重试）。
      const line = JSON.stringify({ segSeq: parsed.segSeq, quarantinedFromOffset: off, toOffset: buf.byteLength, reason: 'truncated-or-crc', firstSeenAt: new Date().toISOString() }) + '\n';
      await appendSidecarLineRaw(dir, f, line);
      meta.quarantinedRange = { fromOffset: off };
      meta.sealed = true;                                      // V2：含坏尾的段封禁
      meta.quarantinedBytes = buf.byteLength - off;
      newQuarantined += 1;
    }
    if (newQuarantined > 0) yjsSpoolQuarantinedTotal.inc(newQuarantined);
    return newQuarantined;
  }

  /** 启动扫描：重建 index（帧数/字节/walSeq/去重索引/水位）——确认集丢失即幂等降级。
   *  Y17：truncated 段直接置 sealed；X8'：`__probe__*` 段崩溃残留直接 unlink；
   *  收口2：零字节残片段直接回收；坏段头（magic/version/头 CRC 不符）=segQuarantined 'bad-header'
   *  （自明缺陷——每轮扫描自证，无需 sidecar）；整段隔离 sidecar 在位段禁重放（跨重启）；
   *  P18 截尾分档：本 owner 段坏尾=truncated 报告+计数；外来段坏尾=静默截断（sealed 置位）。
   *  V3 临时 map 末尾整体 swap——中途抛错不留半截索引（P19 幂等重建不变量）。 */
  async scan(): Promise<{ truncatedSegments: string[] }> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const adir = this.activeDir();   // Z13：owner 必填断点
    const next = new Map<string, Map<string, SegmentMeta>>();
    const truncatedSegments: string[] = [];
    for (const { dir, name: f } of await listSpoolFiles(this.dir)) {
      if (!f.endsWith('.spool')) continue;   // sidecar 等非段条目过滤
      const parsed = parseSegFileName(f);
      if (!parsed) continue;
      if (parsed.projectId === '__probe__') { await unlink(join(dir, f)).catch(() => {}); continue; }
      const buf = await readFile(join(dir, f)).catch(() => null);
      if (buf == null) continue;
      if (buf.byteLength === 0) {   // 收口2：零字节残片段——零帧零数据，直接回收
        await unlink(join(dir, f)).catch(() => {});
        continue;
      }
      const isForeign = dir !== adir;
      const hdr = decodeWalSegmentHeader(buf);
      let header: WalSegmentHeader | null = null;
      let segQuarantined: SegQuarantineReason | null = null;
      if ('badHeader' in hdr) {
        segQuarantined = 'bad-header';
        truncatedSegments.push(f);   // 可观测面（gateway 启动日志沿用）
        yjsSpoolTruncatedTotal.inc();
        this.logger.error(`spool bad-header segment ${f} at startup scan——整段隔离零帧重放，计数+人工介入`);
      } else {
        header = hdr.header;
        const whole = await readWholeSegmentQuarantine(dir, f);
        if (whole) segQuarantined = (whole.reason as SegQuarantineReason) ?? 'history-mismatch';
      }
      const { frameCount, goodBytes, truncated, seqs, frameHashes } = parseSegmentFramesPermissive(buf);
      if (truncated && segQuarantined == null && !isForeign) {
        truncatedSegments.push(f);
        yjsSpoolTruncatedTotal.inc();
        this.logger.error(`spool truncated segment ${f} at startup scan——sealed+待隔离处置（quarantineTruncatedFrames），计数+人工介入`);
      }
      const segs = next.get(parsed.projectId) ?? new Map<string, SegmentMeta>();
      segs.set(this.segKeyOf(dir, f), {
        frameCount, goodBytes, bytes: buf.byteLength,
        confirmed: new Set(), confirmedCount: 0,
        sealed: truncated || segQuarantined != null, quarantinedRange: null, quarantinedBytes: 0,
        dir, seq: parsed.segSeq, foreign: isForeign,
        generation: parsed.generation ?? header?.generation ?? null, seqs, frameHashes, header, segQuarantined,
      });
      next.set(parsed.projectId, segs);
    }
    this.index = next;   // P19 幂等重建不变量保持
    this.rebuildRuntimeStateFromIndex();
    return { truncatedSegments };
  }

  /** 换代切段（ADR-01 §6/契约 §5 注记）：旧段整段隔离（sidecar 持久——跨重启禁重放）
   *  +namespace 切代（后续 append 落 g<generation> 新段）+水位与去重索引重置（新代自 walSeq=1）。 */
  async switchGeneration(projectId: string, generation: number): Promise<void> {
    this.projectGeneration.set(projectId, generation);
    const segs = this.index.get(projectId);
    if (segs) {
      for (const [, m] of [...segs.entries()]) {
        const name = segFileNameOf(projectId, m.generation, m.seq);
        if (m.segQuarantined == null) {
          await writeWholeSegmentSidecar(m.dir, name, 'generation-switch');
          walSegmentQuarantinedTotal.inc({ reason: 'generation-switch' });
          m.quarantinedBytes = m.bytes - WAL_SEGMENT_HEADER_SIZE;
        }
        m.segQuarantined = m.segQuarantined ?? 'generation-switch';
        m.sealed = true;
      }
    }
    this.walSeqCounters.set(projectId, 1n);                    // 水位重置（新代自 1 起）
    this.watermarks.set(projectId, ZERO_WATERMARK);
    this.dedupClearProject(projectId);
  }

  /** 恢复扫描（ADR-01 §3——T13 boot 消费；旧链 scan 不经此路径）。
   *  F-S4-5（ADR-01 §5）：epochStartedAt/historyId 入口一次性快照（调用方自 SystemHistory 读入
   *  传入——扫描期间不重读）；时间戳栅栏**仅在恢复怀疑态求值**（evaluateTimestampFence——
   *  restore.lock marker 在位或 PG 水位倒挂时调用方置 true；正常崩溃恢复缺省 false 不求值）；
   *  historyId 栅栏每次必查。`--adopt-wal` 窄窗（adoptSuspect）：仅收养 recoverySuspect 段
   *  （historyId 已匹配+operator 显式确认+审计三条件）；history-mismatch 永不收养。
   *  PG 前缀校验：致命缺陷停点 lastGoodSeq<pgSeq=violation（PG 已提交帧 WAL 无法证明）——
   *  整段证据保全禁截断+violation 上报；丢帧全为 walSeq>pgSeq 才截断到 last-good 续跑。 */
  async recoverScan(opts: {
    systemHistory: SystemHistoryState;
    pgSeq: (projectId: string) => bigint;
    evaluateTimestampFence?: boolean;
    adoptSuspect?: boolean;
  }): Promise<WalRecoveryReport> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const adir = this.activeDir();   // Z13
    const next = new Map<string, Map<string, SegmentMeta>>();
    const report: WalRecoveryReport = { projects: [] };
    // 枚举+读入（单次 IO； projectId 分组）
    const byProject = new Map<string, Array<{ dir: string; name: string; parsed: { projectId: string; segSeq: number; generation: number | null }; buf: Buffer }>>();
    for (const { dir, name: f } of await listSpoolFiles(this.dir)) {
      if (!f.endsWith('.spool')) continue;
      const parsed = parseSegFileName(f);
      if (!parsed) continue;
      if (parsed.projectId === '__probe__') { await unlink(join(dir, f)).catch(() => {}); continue; }
      const buf = await readFile(join(dir, f)).catch(() => null);
      if (buf == null) continue;
      if (buf.byteLength === 0) { await unlink(join(dir, f)).catch(() => {}); continue; }
      const list = byProject.get(parsed.projectId) ?? [];
      list.push({ dir, name: f, parsed, buf });
      byProject.set(parsed.projectId, list);
    }
    for (const [projectId, segFiles] of byProject) {
      const segs = new Map<string, SegmentMeta>();
      next.set(projectId, segs);
      const pr: WalRecoveryProjectReport = {
        projectId, replayPrefix: [], watermarks: ZERO_WATERMARK, defects: [], quarantined: [],
        recoverySuspect: [], pgPrefixViolation: [], truncated: [],
      };
      report.projects.push(pr);
      // 段序：generation asc → seq asc → dir（代内链序确定性）
      const withGen = segFiles.map((s) => {
        const hdr = decodeWalSegmentHeader(s.buf);
        const header = 'badHeader' in hdr ? null : hdr.header;
        return { ...s, header, gen: header?.generation ?? s.parsed.generation ?? 0 };
      });
      withGen.sort((a, b) => a.gen - b.gen || a.parsed.segSeq - b.parsed.segSeq || (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
      const currentGen = Math.max(...withGen.map((s) => s.gen));
      const chainDedupe: WalDedupeState = { hashBySeq: new Map(), seenHashes: new Set() };
      let expectedNext: bigint | null = null;
      let chainStopped = false;
      for (const seg of withGen) {
        const segKey = this.segKeyOf(seg.dir, seg.name);
        const path = join(seg.dir, seg.name);
        const whole = await readWholeSegmentQuarantine(seg.dir, seg.name);
        const isForeign = seg.dir !== adir;
        // —— 段级裁定（顺序：坏头→旧代→既有隔离 sidecar→双栅栏）——
        if (seg.header == null) {
          segs.set(segKey, this.buildMeta(seg.dir, seg.parsed.segSeq, isForeign, seg.buf, seg.header, 0, WAL_SEGMENT_HEADER_SIZE, [], [], 'bad-header', true, 0, seg.parsed.generation));
          pr.quarantined.push({ segKey, reason: 'bad-header' });
          walSegmentQuarantinedTotal.inc({ reason: 'bad-header' });
          chainStopped = true;   // 坏头=链上不可证明缺口
          continue;
        }
        if (seg.gen < currentGen) {
          // 旧代段：namespace 已切（换代/vacuum）——sidecar 补记（幂等）+禁重放（不在当前代链上）
          if (whole == null) {
            await writeWholeSegmentSidecar(seg.dir, seg.name, 'generation-switch');
            walSegmentQuarantinedTotal.inc({ reason: 'generation-switch' });
          }
          const reason: SegQuarantineReason = whole ? (whole.reason as SegQuarantineReason) : 'generation-switch';
          const { frameCount, goodBytes, seqs, frameHashes } = parseSegmentFramesPermissive(seg.buf);
          segs.set(segKey, this.buildMeta(seg.dir, seg.parsed.segSeq, isForeign, seg.buf, seg.header, frameCount, goodBytes, seqs, frameHashes, reason, true));
          pr.quarantined.push({ segKey, reason });
          continue;   // 旧代段不停链（不在当前代链上）
        }
        if (whole) {
          const reason = whole.reason as SegQuarantineReason;
          const { frameCount, goodBytes, seqs, frameHashes } = parseSegmentFramesPermissive(seg.buf);
          segs.set(segKey, this.buildMeta(seg.dir, seg.parsed.segSeq, isForeign, seg.buf, seg.header, frameCount, goodBytes, seqs, frameHashes, reason, true));
          pr.quarantined.push({ segKey, reason });
          chainStopped = true;   // 隔离段=链上缺口（后续段不可证明连续）
          continue;
        }
        if (chainStopped) {
          // 链断后的当前代段：零重放（不可证明与前缀连续）——不隔离（下轮恢复重裁定）
          const { frameCount, goodBytes, seqs, frameHashes } = parseSegmentFramesPermissive(seg.buf);
          segs.set(segKey, this.buildMeta(seg.dir, seg.parsed.segSeq, isForeign, seg.buf, seg.header, frameCount, goodBytes, seqs, frameHashes, 'chain-stopped', true));
          continue;
        }
        // 双栅栏（契约 shouldQuarantineSegment——修正 #6 两维分派；F-S4-5 作用域门控）
        const fence = shouldQuarantineSegment(seg.header, opts.systemHistory, {
          evaluateTimestampFence: opts.evaluateTimestampFence ?? false,
        });
        if (fence.quarantine) {   // historyId 不匹配——唯一 quarantine 成因（fail-closed 零帧重放）
          await writeWholeSegmentSidecar(seg.dir, seg.name, 'history-mismatch');
          walSegmentQuarantinedTotal.inc({ reason: 'history-mismatch' });
          const { frameCount, goodBytes, seqs, frameHashes } = parseSegmentFramesPermissive(seg.buf);
          segs.set(segKey, this.buildMeta(seg.dir, seg.parsed.segSeq, isForeign, seg.buf, seg.header, frameCount, goodBytes, seqs, frameHashes, 'history-mismatch', true));
          pr.quarantined.push({ segKey, reason: 'history-mismatch' });
          chainStopped = true;
          continue;
        }
        if (fence.recoverySuspect && !opts.adoptSuspect) {   // 修正 #6：恢复怀疑态（非 quarantine）
          walRecoverySuspectTotal.inc();
          const { frameCount, goodBytes, seqs, frameHashes } = parseSegmentFramesPermissive(seg.buf);
          // 零帧重放（内存态——无 sidecar：裁定归恢复流，非持久隔离）
          segs.set(segKey, this.buildMeta(seg.dir, seg.parsed.segSeq, isForeign, seg.buf, seg.header, frameCount, goodBytes, seqs, frameHashes, 'timestamp-fence', true));
          pr.recoverySuspect.push({ segKey, lastWriteAtMs: seg.header.lastWriteAtMs });
          chainStopped = true;   // 未裁定的怀疑段=链上缺口
          continue;
        }
        if (fence.recoverySuspect && opts.adoptSuspect) {
          // --adopt-wal 窄窗：historyId 已匹配（fence.quarantine=false 前置保证）+operator 确认+审计
          this.logger.log(JSON.stringify({
            event: 'wal_adopt_suspect', projectId, segKey,
            historyId: seg.header.historyId, lastWriteAtMs: seg.header.lastWriteAtMs,
            epochStartedAtMs: opts.systemHistory.epochStartedAtMs,
            note: '--adopt-wal 收养（三条件：historyId 已匹配+operator 显式确认+本审计行）',
          }));
        }
        // —— 帧级扫描（链式：expectedNextSeq 续传+跨段去重状态共享）——
        const res = scanWalSegmentBuffer(seg.buf, {
          expectedNextSeq: expectedNext, dedupe: chainDedupe, segmentGeneration: seg.header.generation,
        });
        for (const d of res.defects) {
          const tier = noteBadSegmentTier(d.kind);
          pr.defects.push({ tier, kind: d.kind, segKey, fatal: d.fatal });
        }
        const fatal = res.defects.some((d) => d.fatal);
        if (!fatal) {
          pr.replayPrefix.push(...res.frames.map((f) => f.walSeq));
          if (res.lastConsumedSeq != null) expectedNext = res.lastConsumedSeq + 1n;
          const quarantinedBytes = seg.buf.byteLength - res.lastGoodOffset;
          segs.set(segKey, this.buildMeta(seg.dir, seg.parsed.segSeq, isForeign, seg.buf, seg.header,
            res.frames.length, res.lastGoodOffset, res.frames.map((f) => f.walSeq),
            res.frames.map((f) => f.frameHash.toString('hex')), null, false, quarantinedBytes));
          continue;
        }
        // PG 前缀校验（ADR-01 §3.2）：丢帧范围 (lastGoodSeq, …] 全部 >pgSeq 才合法
        const pg = opts.pgSeq(projectId);
        const lastGood = res.lastConsumedSeq;
        const lostIncludesCommitted = lastGood == null ? pg > 0n : lastGood < pg;
        if (lostIncludesCommitted) {
          // PG 已提交帧 WAL 无法证明=账本失真——整段证据保全（禁截断）+violation 上报
          pr.pgPrefixViolation.push({ segKey, lastGoodSeq: lastGood, pgSeq: pg });
          segs.set(segKey, this.buildMeta(seg.dir, seg.parsed.segSeq, isForeign, seg.buf, seg.header,
            res.frames.length, res.lastGoodOffset, res.frames.map((f) => f.walSeq),
            res.frames.map((f) => f.frameHash.toString('hex')), 'pg-prefix-violation', true));
          this.logger.error(`WAL PG 前缀校验 violation：${segKey} lastGoodSeq=${lastGood ?? 'null'}<pgSeq=${pg}——段证据保全禁截断，人工裁定`);
          chainStopped = true;
          continue;
        }
        // 完整有效前缀截断（丢的全是 walSeq>pgSeq 的帧——从未承诺 Durable）+sidecar 审计
        await truncate(path, res.lastGoodOffset);
        pr.truncated.push({ segKey, lastGoodOffset: res.lastGoodOffset });
        const firstFatalTier = walDefectTier(res.defects.find((d) => d.fatal)!.kind);
        await appendSidecarLineRaw(seg.dir, seg.name, `${JSON.stringify({
          segSeq: seg.parsed.segSeq, quarantinedFromOffset: res.lastGoodOffset, toOffset: seg.buf.byteLength,
          reason: 'recovery-truncate', tier: firstFatalTier, firstSeenAt: new Date().toISOString(),
        })}\n`);
        segs.set(segKey, this.buildMeta(seg.dir, seg.parsed.segSeq, isForeign, seg.buf, seg.header,
          res.frames.length, res.lastGoodOffset, res.frames.map((f) => f.walSeq),
          res.frames.map((f) => f.frameHash.toString('hex')), 'chain-stopped', true,
          seg.buf.byteLength - res.lastGoodOffset));
        pr.replayPrefix.push(...res.frames.map((f) => f.walSeq));
        chainStopped = true;   // 链断（后续段不可证明连续）
      }
      // 水位重建（ADR-01 §3.3）——violation 项目不重建（报告携带 violation，T13 阻断开放写）
      const maxSeq = pr.replayPrefix.reduce<bigint>((m, s) => (s > m ? s : m), 0n);
      if (pr.pgPrefixViolation.length === 0) {
        const w: WatermarkTriple = { pgSeq: opts.pgSeq(projectId), appliedSeq: maxSeq, spoolHeadSeq: maxSeq };
        assertWatermarkInvariants(w);
        pr.watermarks = w;
      }
    }
    this.index = next;   // 恢复裁定落 index（整段隔离/链断段 peek 零帧——与 replayPrefix 一致）
    this.rebuildRuntimeStateFromIndex();
    return report;
  }

  /** meta 构造辅助（recoverScan 各裁定分支共用）——generation 自文件名 g 域（header 缺失时兜底）。 */
  private buildMeta(
    dir: string, seq: number, foreign: boolean, buf: Buffer, header: WalSegmentHeader | null,
    frameCount: number, goodBytes: number, seqs: bigint[], frameHashes: string[],
    segQuarantined: SegQuarantineReason | null, sealed: boolean, quarantinedBytes = 0, generation: number | null = null,
  ): SegmentMeta {
    return {
      frameCount, goodBytes, bytes: buf.byteLength,
      confirmed: new Set(), confirmedCount: 0, sealed: sealed || segQuarantined != null,
      quarantinedRange: quarantinedBytes > 0 ? { fromOffset: goodBytes } : null, quarantinedBytes,
      dir, seq, foreign, generation: generation ?? header?.generation ?? null,
      seqs, frameHashes, header, segQuarantined,
    };
  }

  /** scan/recoverScan 后运行期状态重建：walSeq 续号（隔离段不计）+水位+有界去重索引。 */
  private rebuildRuntimeStateFromIndex(): void {
    for (const [pid, segs] of this.index) {
      let maxSeq = 0n;
      for (const m of segs.values()) {
        if (m.segQuarantined) continue;
        for (const s of m.seqs) if (s > maxSeq) maxSeq = s;
      }
      this.walSeqCounters.set(pid, maxSeq + 1n);
      const w: WatermarkTriple = { pgSeq: this.watermarks.get(pid)?.pgSeq ?? 0n, appliedSeq: maxSeq, spoolHeadSeq: maxSeq };
      assertWatermarkInvariants(w);
      this.watermarks.set(pid, w);
      if (pid === '__probe__') continue;
      for (const [segKey, m] of segs) {
        if (m.segQuarantined) continue;
        for (let i = 0; i < m.frameCount && i < m.frameHashes.length; i++) {
          this.dedupInsert(pid, m.frameHashes[i], `${segKey}:${i}`);
        }
      }
    }
  }

  /** V16+X8：启动回灌——总墙钟预算+固定退避+每帧有界重试环+合并上界（语义不变，WAL 协议无涉）。 */
  async replayAll(
    repo: Pick<CanvasDocUpdateRepository, 'append'>,
    opts?: { budgetMs?: number; retryDelayMs?: number; maxAttempts?: number; projectIds?: string[] },
  ): Promise<{ replayed: number; failed: number; discarded: number }> {
    const deadline = Date.now() + (opts?.budgetMs ?? CollabSpoolService.REPLAY_BUDGET_MS);
    const retryDelay = opts?.retryDelayMs ?? CollabSpoolService.REPLAY_RETRY_MS;
    const maxAttempts = opts?.maxAttempts ?? CollabSpoolService.REPLAY_MAX_ATTEMPTS;
    let replayed = 0, failed = 0, discarded = 0;
    for (const projectId of opts?.projectIds ?? this.keys()) {
      if (Date.now() > deadline) return { replayed, failed, discarded };   // I2：项目间守预算
      for (;;) {                                                 // X8：分轮合并
        const frames = (await this.peek(projectId)).slice(0, CollabSpoolService.REPLAY_MERGE_MAX_FRAMES);
        if (frames.length === 0) break;
        const totalBytes = frames.reduce((s, f) => s + f.payload.byteLength, 0);
        if (totalBytes > CollabSpoolService.REPLAY_MERGE_MAX_BYTES) frames.length = this.truncateByBytes(frames, CollabSpoolService.REPLAY_MERGE_MAX_BYTES);
        let roundAppended = false;
        try {
          const merged = frames.length === 1 ? frames[0].payload : Y.mergeUpdates(frames.map((f) => f.payload));
          const r = await repo.append(projectId, merged);
          if (!r.ok) throw new Error(`append returned no row (${r.reason})`);
          await this.confirm(projectId, frames.map((f) => f.frameId));
          replayed += frames.length;
          roundAppended = true;
        } catch (e) {
          if (isFkGone(e)) {                                     // V6：项目已删 DB 权威证据
            await this.confirm(projectId, frames.map((f) => f.frameId));
            discarded += frames.length; yjsUpdatesDiscardedDeletedTotal.inc({ source: 'spool' }, frames.length);
            this.logger.warn(`spool frames for ${projectId} discarded (project deleted, FK)`);
            continue;
          }
          for (const frame of frames) {
            for (let attempt = 1; ; attempt++) {
              if (Date.now() > deadline) { failed += 1; this.logger.error(`spool replay budget-exhausted for ${projectId}:${frame.frameId}——帧保留（运行期由退避梯自愈，X5）`); break; }
              try {
                const r2 = await repo.append(projectId, frame.payload);
                if (!r2.ok) throw new Error(`append returned no row (${r2.reason})`, { cause: e });
                await this.confirm(projectId, [frame.frameId]);
                replayed += 1;
                break;
              } catch (e2) {
                if (isFkGone(e2)) { await this.confirm(projectId, [frame.frameId]); discarded += 1; yjsUpdatesDiscardedDeletedTotal.inc({ source: 'spool' }); break; }
                if (attempt >= maxAttempts) { failed += 1; this.logger.error(`spool replay failed (${attempt} attempts) for ${projectId}:${frame.frameId}: ${(e2 as Error).message}`); break; }
                await new Promise((r3) => setTimeout(r3, retryDelay));
              }
            }
          }
        }
        if (!roundAppended) break;
        if (Date.now() > deadline) break;
      }
    }
    return { replayed, failed, discarded };
  }

  /** X8 辅助：按字节上限截断帧列表（保持顺序；至少 1 帧）。 */
  private truncateByBytes(frames: SpoolFrame[], maxBytes: number): number {
    let acc = 0, i = 0;
    while (i < frames.length && acc + frames[i].payload.byteLength <= maxBytes) { acc += frames[i].payload.byteLength; i += 1; }
    return Math.max(i, 1);
  }

  /** V15：构造后路径校验——只管路径形态（Y0a-4 重定语义）；目录可用性由 scan() 抛错 fail-fast。 */
  validateDir(): string {
    const abs = resolve(this.dir);
    if (process.env.COLLAB_SPOOL_DIR && !isAbsolute(this.rawDir)) {
      throw new Error(`COLLAB_SPOOL_DIR 必须为绝对路径（当前：${this.rawDir}——CWD 漂移会静默指向另一个空账本）`);
    }
    return abs;
  }

  private reportTruncation(projectId: string, segSeq: number) {
    yjsSpoolTruncatedTotal.inc();
    this.logger.error(`spool truncated frame at ${projectId}.${segSeq}——停读该段（坏帧从未持久化或落盘不完整），计数+人工介入`);
  }
}

/** sidecar 原始行追加（quarantineTruncatedFrames 既有形态保持——I1 先落盘后记账纪律同源）。 */
async function appendSidecarLineRaw(dir: string, segFile: string, line: string): Promise<void> {
  const sc = await open(join(dir, `${segFile}.quarantine`), 'a');
  try {
    await sc.writeFile(line);
    await sc.sync();
  } finally {
    await sc.close().catch(() => {});
  }
}

/** 帧循环 permissive 单源（scan/adoptSilentForeignSegments/recoverScan 非链分支共用）——
 *  只数可解析帧（len/CRC 界）+收集 walSeq/frameHash；链级缺陷（gap/dup/generation）归
 *  scanWalSegmentBuffer。好帧后残尾与坏帧同判 truncated。 */
function parseSegmentFramesPermissive(buf: Buffer): {
  frameCount: number; goodBytes: number; truncated: boolean; seqs: bigint[]; frameHashes: string[];
} {
  const seqs: bigint[] = [];
  const frameHashes: string[] = [];
  let off = WAL_SEGMENT_HEADER_SIZE, frameCount = 0;
  while (off + WAL_FRAME_FIXED_BYTES <= buf.byteLength) {
    const len = buf.readUInt32LE(off);
    if (off + WAL_FRAME_FIXED_BYTES + len > buf.byteLength) return { frameCount, goodBytes: off, truncated: true, seqs, frameHashes };
    const body = buf.subarray(off + 8, off + WAL_FRAME_FIXED_BYTES + len);
    if ((crc32(body) >>> 0) !== buf.readUInt32LE(off + 4)) return { frameCount, goodBytes: off, truncated: true, seqs, frameHashes };
    seqs.push(buf.readBigUInt64LE(off + 8));
    frameHashes.push(buf.subarray(off + 20, off + 52).toString('hex'));
    off += WAL_FRAME_FIXED_BYTES + len; frameCount += 1;
  }
  return { frameCount, goodBytes: off, truncated: off !== buf.byteLength, seqs, frameHashes };
}
