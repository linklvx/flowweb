// apps/api/src/modules/collab/wal-segment-format.spike.spec.ts —— Y1c T0-C spike S4(b)（plan v1.7 Task 0/S4；
// spec v5.4 §1.3/偏离 38④⑦）：WAL 段格式+恢复扫描原型（writer+scanner，T8/T13 继承格式测试）。
//   段头 {magic,version,projectId,generation,historyId,lastWriteAt,createdAt}（v1.7 增 lastWriteAt——时间戳栅栏）
//   + CRC 边界帧记录 {payloadLen,crc32,walSeq,generation,frameHash(SHA-256),payload}。
//   恢复扫描五验证：①坏 CRC 尾/撕裂尾→截断到 last-good（完整有效前缀重建）②缺号（gap）→隔离
//   ③重复帧→去重（dup-seq 跳过不挡后续 / dup-hash 跳过并消费 seq）④段头 historyId≠SystemHistory→整段
//   quarantine fail-closed ⑤lastWriteAt>epochStartedAt（忘 bump 时间戳栅栏）→整段 quarantine。
//   扫描器纪律：**首个致命缺陷即停**（坏记录之后的定界不可信——长度域可能同坏）；lastGoodOffset=停点。
//   链级停链=仅 quarantine/致命缺陷——良性 dup 不停链（跨段去重状态共享；崩溃重试天然产生跨段重复）。
//   精确性总断言：重建前缀=恰好完整有效前缀（无漏好帧/无收坏帧）。
// SPIKE 工件：零生产码改动、不接生产；T8 落地时按 y1c-t0-s4-wal-actor-baseline.md §5 移植
// （本文件与 scripts/collab-wal-fsync-bench.ts 各持一份格式实现——spike 级有意冗余，T8 收敛单源）。
// 纯 fs+os.tmpdir 真文件+真 fsync（appendBatch 内 FileHandle.sync()——Windows=FlushFileBuffers）。
import { createHash } from 'node:crypto';
import { FileHandle, copyFile, mkdtemp, open, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ── 段格式常量（T8 移植面——与 scripts/collab-wal-fsync-bench.ts 同构） ─────────────────────
const MAGIC = Buffer.from('FWWALS1\n', 'latin1');   // 8B："FlowWeb WAL Segment v1"
const WAL_VERSION = 1;
const HEADER_SIZE = 164;
const ID_FIELD_BYTES = 64;                          // projectId/historyId 定长 ASCII 域（zero-pad）
const FRAME_FIXED_BYTES = 52;                       // payloadLen(4)+crc32(4)+walSeq(8)+generation(4)+frameHash(32)
const MAX_FRAME_BYTES = 16 * 1024 * 1024;           // 帧闸上界（>9MiB SS2 门的宽松上限）

interface SegmentMeta { projectId: string; generation: number; historyId: string; createdAtMs: number; lastWriteAtMs: number }

function encodeHeader(meta: SegmentMeta): Buffer {
  for (const s of [meta.projectId, meta.historyId]) {
    if (Buffer.byteLength(s, 'utf8') > ID_FIELD_BYTES) throw new Error(`id 域超长: ${s}`);
  }
  const h = Buffer.alloc(HEADER_SIZE);
  MAGIC.copy(h, 0);
  h.writeUInt16LE(WAL_VERSION, 8);
  h.writeUInt16LE(HEADER_SIZE, 10);
  h.writeUInt32LE(meta.generation, 12);
  h.write(meta.projectId, 16, 'utf8');
  h.write(meta.historyId, 80, 'utf8');
  h.writeBigUInt64LE(BigInt(meta.createdAtMs), 144);
  h.writeBigUInt64LE(BigInt(meta.lastWriteAtMs), 152);
  h.writeUInt32LE(crc32(h.subarray(0, 160)) >>> 0, 160);
  return h;
}

interface FrameRec { walSeq: bigint; payload: Uint8Array }
const frameHashOf = (payload: Uint8Array): Buffer => createHash('sha256').update(payload).digest();

/** 帧记录编码；crc32 覆盖 [walSeq||generation||frameHash||payload]（帧头字段撕裂同落 CRC 网） */
function encodeFrame(rec: FrameRec, generation: number): Buffer {
  const hash = frameHashOf(rec.payload);
  const body = Buffer.alloc(12 + 32 + rec.payload.length);
  body.writeBigUInt64LE(rec.walSeq, 0);
  body.writeUInt32LE(generation, 8);
  hash.copy(body, 12);
  Buffer.from(rec.payload.buffer, rec.payload.byteOffset, rec.payload.byteLength).copy(body, 44);
  const out = Buffer.alloc(FRAME_FIXED_BYTES + rec.payload.length);
  out.writeUInt32LE(rec.payload.length, 0);
  out.writeUInt32LE(crc32(body) >>> 0, 4);
  body.copy(out, 8);
  return out;
}

/** 原型 writer：新建段（头）+ 批 append（单 write）+ 段头 lastWriteAt/CRC 成对 pwrite + 一次 fsync */
class SpikeSegmentWriter {
  private constructor(private readonly fh: FileHandle, private meta: SegmentMeta, private offset: number) {}
  static async create(path: string, meta: SegmentMeta): Promise<SpikeSegmentWriter> {
    await writeFile(path, encodeHeader(meta));
    const fh = await open(path, 'r+');
    return new SpikeSegmentWriter(fh, meta, HEADER_SIZE);
  }
  /** 续开既有段（解析段头取 meta；offset=当前文件尾——spike 装置用） */
  static async openExisting(path: string): Promise<SpikeSegmentWriter> {
    const fh = await open(path, 'r+');
    const st = await fh.stat();
    const { buffer } = await fh.read(Buffer.alloc(HEADER_SIZE), 0, HEADER_SIZE, 0);
    const meta: SegmentMeta = {
      projectId: buffer.subarray(16, 80).toString('utf8').replace(/\0+$/, ''),
      generation: buffer.readUInt32LE(12),
      historyId: buffer.subarray(80, 144).toString('utf8').replace(/\0+$/, ''),
      createdAtMs: Number(buffer.readBigUInt64LE(144)),
      lastWriteAtMs: Number(buffer.readBigUInt64LE(152)),
    };
    return new SpikeSegmentWriter(fh, meta, st.size);
  }
  /** T9 actor 批落盘路径的最小内核：一批帧=一次 write+一次 fsync；lastWriteAt pwrite **必须**成对更新
   *  段头 CRC（CRC 覆盖 0..159 含 152..159 的 lastWriteAt 域——只 pwrite 时间戳不更新 CRC=自毁段头，
   *  本 spike 首跑实测红的根因）——先帧后头、一次 fsync 覆盖全部。 */
  async appendBatch(frames: FrameRec[], lastWriteAtMs: number): Promise<number> {
    if (frames.length === 0) return 0;
    const buf = Buffer.concat(frames.map((f) => encodeFrame(f, this.meta.generation)));
    await this.fh.write(buf, 0, buf.length, this.offset);
    this.offset += buf.length;
    const head = Buffer.alloc(12);
    head.writeBigUInt64LE(BigInt(lastWriteAtMs), 0);
    const hdr = await this.fh.read(Buffer.alloc(160), 0, 160, 0);
    const crc = crc32(Buffer.concat([hdr.buffer.subarray(0, 152), head.subarray(0, 8)])) >>> 0;
    head.writeUInt32LE(crc, 8);
    await this.fh.write(head.subarray(0, 8), 0, 8, 152);        // lastWriteAt
    await this.fh.write(head.subarray(8, 12), 0, 4, 160);       // 段头 CRC（成对更新）
    this.meta = { ...this.meta, lastWriteAtMs };
    await this.fh.sync();   // 真 fsync（Windows=FlushFileBuffers）
    return buf.length;
  }
  async close(): Promise<void> { await this.fh.close(); }
}

// ── 原型 scanner ─────────────────────────────────────────────────────────────
type QuarantineReason = 'bad-header' | 'history-mismatch' | 'timestamp-fence';
type DefectKind = 'truncated' | 'bad-crc' | 'hash-mismatch' | 'gap' | 'dup-seq' | 'dup-hash' | 'generation-mismatch';
/** fatal=true：段内扫描即停+链级停链；false：良性 dup（跳过后继续——不停链） */
interface ScanDefect { kind: DefectKind; atOffset: number; walSeq?: bigint; fatal: boolean; detail: string }
interface ScanFrame { walSeq: bigint; payload: Buffer; frameHash: Buffer }
interface ScanResult {
  meta: SegmentMeta | null;
  frames: ScanFrame[];                    // 完整有效前缀（重放集）
  quarantined: QuarantineReason | null;   // 整段 quarantine（fail-closed：零帧重放）
  defects: ScanDefect[];                  // 坏段分类码（truncated/crc/missing-seq/dup-*）
  lastGoodOffset: number;                 // 首个致命缺陷记录起点（截断恢复点——其前恰为有效前缀）
  lastConsumedSeq: bigint | null;         // 扫描终态 lastAccepted（含 dup-hash 消费的 seq——链式续段基准）
}
/** 跨段去重状态（rebuild 链路共享——段 N+1 重放段 N 的帧须判良性 dup 而非「seq 改写」） */
interface DedupeState { hashBySeq: Map<bigint, Buffer>; seenHashes: Set<string> }

interface ScanExpected { historyId: string; epochStartedAtMs: number }

async function scanSegment(path: string, expected: ScanExpected, opts?: { expectedNextSeq?: bigint; dedupe?: DedupeState }): Promise<ScanResult> {
  const buf = await readFile(path);
  if (buf.length < HEADER_SIZE) return { meta: null, frames: [], quarantined: 'bad-header', defects: [], lastGoodOffset: 0, lastConsumedSeq: null };
  if (!buf.subarray(0, 8).equals(MAGIC) || buf.readUInt16LE(8) !== WAL_VERSION || buf.readUInt16LE(10) !== HEADER_SIZE) {
    return { meta: null, frames: [], quarantined: 'bad-header', defects: [], lastGoodOffset: 0, lastConsumedSeq: null };
  }
  if ((crc32(buf.subarray(0, 160)) >>> 0) !== buf.readUInt32LE(160)) {
    return { meta: null, frames: [], quarantined: 'bad-header', defects: [], lastGoodOffset: 0, lastConsumedSeq: null };
  }
  const meta: SegmentMeta = {
    projectId: buf.subarray(16, 80).toString('utf8').replace(/\0+$/, ''),
    generation: buf.readUInt32LE(12),
    historyId: buf.subarray(80, 144).toString('utf8').replace(/\0+$/, ''),
    createdAtMs: Number(buf.readBigUInt64LE(144)),
    lastWriteAtMs: Number(buf.readBigUInt64LE(152)),
  };
  // 双 quarantine 栅栏（T13 恢复顺序第一步）：historyId≠SystemHistory → 整段隔离；
  // lastWriteAt>epochStartedAt（忘 bump 形态——段比 epoch 新）→ 整段隔离。均零帧重放。
  if (meta.historyId !== expected.historyId) return { meta, frames: [], quarantined: 'history-mismatch', defects: [], lastGoodOffset: 0, lastConsumedSeq: null };
  if (meta.lastWriteAtMs > expected.epochStartedAtMs) return { meta, frames: [], quarantined: 'timestamp-fence', defects: [], lastGoodOffset: 0, lastConsumedSeq: null };

  const frames: ScanFrame[] = [];
  const defects: ScanDefect[] = [];
  const hashBySeq = opts?.dedupe?.hashBySeq ?? new Map<bigint, Buffer>();     // 已收养帧 seq→hash（dup-seq 判定；链路携带时跨段共享）
  const seenHashes = opts?.dedupe?.seenHashes ?? new Set<string>();           // 已见 frameHash（跨 seq 重复内容判定；同上共享）
  let lastAccepted: bigint | null = opts?.expectedNextSeq != null ? opts.expectedNextSeq - 1n : null;
  let off = HEADER_SIZE;
  while (off < buf.length) {
    if (buf.length - off < FRAME_FIXED_BYTES) { defects.push({ kind: 'truncated', atOffset: off, fatal: true, detail: `帧头不完整（余 ${buf.length - off}B）` }); break; }
    const payloadLen = buf.readUInt32LE(off);
    if (payloadLen > MAX_FRAME_BYTES || buf.length - off < FRAME_FIXED_BYTES + payloadLen) {
      defects.push({ kind: 'truncated', atOffset: off, fatal: true, detail: `载荷不完整（len=${payloadLen} 余=${buf.length - off}）` });
      break;
    }
    const crcExpect = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, off + FRAME_FIXED_BYTES + payloadLen);
    if ((crc32(body) >>> 0) !== crcExpect) {
      defects.push({ kind: 'bad-crc', atOffset: off, fatal: true, detail: `crc 期望 ${crcExpect.toString(16)} 实得 ${(crc32(body) >>> 0).toString(16)}` });
      break;
    }
    const walSeq = buf.readBigUInt64LE(off + 8);
    const generation = buf.readUInt32LE(off + 16);
    const frameHash = Buffer.from(buf.subarray(off + 20, off + 52));
    const payload = Buffer.from(buf.subarray(off + FRAME_FIXED_BYTES, off + FRAME_FIXED_BYTES + payloadLen));
    if (!frameHashOf(payload).equals(frameHash)) { defects.push({ kind: 'hash-mismatch', atOffset: off, walSeq, fatal: true, detail: '帧记录 frameHash≠SHA-256(payload)' }); break; }
    if (generation !== meta.generation) { defects.push({ kind: 'generation-mismatch', atOffset: off, walSeq, fatal: true, detail: `帧 generation=${generation}≠段头 ${meta.generation}` }); break; }
    const hashKey = frameHash.toString('hex');
    if (lastAccepted != null && walSeq <= lastAccepted) {
      // 旧 seq 重放：同 hash=良性重复（跳过去重不挡后续，**不停链**）；异 hash=seq 被改写重用（不可去重——隔离）
      if (hashBySeq.get(walSeq)?.equals(frameHash)) {
        defects.push({ kind: 'dup-seq', atOffset: off, walSeq, fatal: false, detail: '旧 seq 同 hash 重放——去重跳过（良性）' });
        off += FRAME_FIXED_BYTES + payloadLen;
        continue;
      }
      defects.push({ kind: 'dup-seq', atOffset: off, walSeq, fatal: true, detail: '旧 seq 异 hash——seq 被改写重用，隔离' });
      break;
    }
    if (lastAccepted != null && walSeq > lastAccepted + 1n) { defects.push({ kind: 'gap', atOffset: off, walSeq, fatal: true, detail: `缺号：期望 ${lastAccepted + 1n} 实得 ${walSeq}——隔离` }); break; }
    if (seenHashes.has(hashKey)) {
      // 新 seq 承载重复内容：该 seq 已被消费——跳过但推进 lastAccepted（后续帧不失连续性，**不停链**）
      defects.push({ kind: 'dup-hash', atOffset: off, walSeq, fatal: false, detail: '新 seq 承载已见 frameHash——去重跳过并消费 seq（良性）' });
      lastAccepted = walSeq;
      off += FRAME_FIXED_BYTES + payloadLen;
      continue;
    }
    frames.push({ walSeq, payload, frameHash });
    hashBySeq.set(walSeq, frameHash);
    seenHashes.add(hashKey);
    lastAccepted = walSeq;
    off += FRAME_FIXED_BYTES + payloadLen;
  }
  return { meta, frames, quarantined: null, defects, lastGoodOffset: off, lastConsumedSeq: lastAccepted };
}

/** 链级停链判据（定形）：仅 quarantine 或任一致命缺陷停链；良性 dup（同 hash 旧 seq 重放/新 seq 旧 hash）
 *  **不停链**——崩溃重试天然产生跨段重复，按「任一缺陷即停」的保守读法会把健康链误隔离。 */
const chainStoppable = (r: ScanResult): boolean => r.quarantined != null || r.defects.some((d) => d.fatal);

/** 多段前缀重建：按序扫描+expectedNextSeq 链式传递+跨段去重状态共享；仅 quarantine/致命缺陷停链（链断后不可证明连续性） */
async function rebuildPrefix(files: string[], expected: ScanExpected): Promise<{ frames: ScanFrame[]; results: ScanResult[]; stoppedAt: number | null }> {
  const frames: ScanFrame[] = [];
  const results: ScanResult[] = [];
  const dedupe: DedupeState = { hashBySeq: new Map(), seenHashes: new Set() };   // 跨段共享——段 N+1 重放段 N 的帧须判良性 dup 而非「seq 改写」
  let next: bigint | undefined;
  for (let i = 0; i < files.length; i++) {
    const r = await scanSegment(files[i], expected, {
      ...(next == null ? {} : { expectedNextSeq: next }),
      dedupe,
    });
    results.push(r);
    if (chainStoppable(r)) return { frames, results, stoppedAt: i };
    frames.push(...r.frames);
    if (r.lastConsumedSeq != null) next = r.lastConsumedSeq + 1n;
  }
  return { frames, results, stoppedAt: null };
}

// ── 装置 ─────────────────────────────────────────────────────────────────────
describe('Y1c T0-S4(b)：WAL 段格式+恢复扫描原型（纯 fs+真 fsync，temp dir）', () => {
  let dir: string;
  const n = (): string => join(dir, `seg-${Math.random().toString(36).slice(2, 8)}.wal`);

  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'y1c-s4-wal-')); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  /** 确定性伪随机载荷（非全零——CRC/SHA 区分度） */
  const payload = (size: number, seed: number): Buffer => {
    const b = Buffer.alloc(size);
    for (let i = 0; i < size; i++) b[i] = (seed * 31 + i * 7 + 0x5b) & 0xff;
    return b;
  };
  const HISTORY = 'h-2026-10-24-a';
  const metaOf = (over: Partial<SegmentMeta> = {}): SegmentMeta => ({
    projectId: 'proj-1', generation: 3, historyId: HISTORY, createdAtMs: Date.now(), lastWriteAtMs: Date.now(), ...over,
  });
  const expectOf = (over: Partial<ScanExpected> = {}): ScanExpected => ({ historyId: HISTORY, epochStartedAtMs: Date.now() + 3_600_000, ...over });
  const writeFrames = async (path: string, meta: SegmentMeta, frames: FrameRec[]): Promise<void> => {
    const w = await SpikeSegmentWriter.create(path, meta);
    if (frames.length > 0) await w.appendBatch(frames, Date.now());
    await w.close();
  };

  it('双段完好 roundtrip：完整重建（walSeq 连续+payload 逐字节等+frameHash 对）', async () => {
    const f1 = [1n, 2n, 3n].map((s, i) => ({ walSeq: s, payload: payload([1024, 4096, 16384][i], 11 + i) }));
    const f2 = [4n, 5n, 6n].map((s, i) => ({ walSeq: s, payload: payload([2048, 8192, 1024][i], 21 + i) }));
    const s0 = n(); const s1 = n();
    await writeFrames(s0, metaOf(), f1);
    await writeFrames(s1, metaOf({ generation: 4 }), f2);   // 换代新段（namespace 切代——帧带新 generation）
    const rebuilt = await rebuildPrefix([s0, s1], expectOf());
    expect(rebuilt.stoppedAt).toBeNull();
    expect(rebuilt.frames.map((f) => f.walSeq)).toEqual([1n, 2n, 3n, 4n, 5n, 6n]);
    const all = [...f1, ...f2];
    for (let i = 0; i < all.length; i++) {
      expect(Buffer.compare(rebuilt.frames[i].payload, Buffer.from(all[i].payload))).toBe(0);
      expect(rebuilt.frames[i].frameHash.equals(frameHashOf(all[i].payload))).toBe(true);
    }
    for (const r of rebuilt.results) expect(r.defects).toHaveLength(0);
  });

  it('①坏 CRC 尾 → 截断到 last-good：前缀=恰完整有效前缀；截断后重扫零缺陷', async () => {
    const frames = [1n, 2n, 3n].map((s) => ({ walSeq: s, payload: payload(4096, Number(s)) }));
    const path = n();
    await writeFrames(path, metaOf(), frames);
    const raw = await readFile(path);
    raw[raw.length - 3] ^= 0xff;   // 帧 3 载荷末段单字节翻转
    await writeFile(path, raw);
    const r = await scanSegment(path, expectOf());
    expect(r.quarantined).toBeNull();
    expect(r.frames.map((f) => f.walSeq)).toEqual([1n, 2n]);   // 帧 3 撕裂=不入前缀
    expect(r.defects.map((d) => d.kind)).toEqual(['bad-crc']);
    expect(r.frames.map((f) => Buffer.from(f.payload))).toEqual([Buffer.from(frames[0].payload), Buffer.from(frames[1].payload)]);
    // 截断到 last-good（停点=帧 3 记录起点）→ 重扫零缺陷（恢复动作=truncate(prefix)+续写）
    await truncate(path, r.lastGoodOffset);
    const r2 = await scanSegment(path, expectOf());
    expect(r2.defects).toHaveLength(0);
    expect(r2.frames.map((f) => f.walSeq)).toEqual([1n, 2n]);
    expect(r2.lastGoodOffset).toBe(raw.length - (4096 + FRAME_FIXED_BYTES));
  });

  it('①′撕裂尾（帧记录半写）→ truncated 隔离；截断后重扫零缺陷', async () => {
    const frames = [1n, 2n, 3n].map((s) => ({ walSeq: s, payload: payload(2048, Number(s)) }));
    const path = n();
    await writeFrames(path, metaOf(), frames);
    const raw = await readFile(path);
    const torn = encodeFrame({ walSeq: 4n, payload: payload(1024, 44) }, 3).subarray(0, 30);   // 半写帧记录
    await writeFile(path, Buffer.concat([raw, torn]));
    const r = await scanSegment(path, expectOf());
    expect(r.frames.map((f) => f.walSeq)).toEqual([1n, 2n, 3n]);
    expect(r.defects.map((d) => d.kind)).toEqual(['truncated']);
    await truncate(path, r.lastGoodOffset);
    const r2 = await scanSegment(path, expectOf());
    expect(r2.defects).toHaveLength(0);
    expect(r2.frames.map((f) => f.walSeq)).toEqual([1n, 2n, 3n]);
  });

  it('②缺号（gap）→隔离：前缀止于 gap 前帧，gap 后的帧不进前缀', async () => {
    const frames = [1n, 2n, 3n, 5n, 6n].map((s) => ({ walSeq: s, payload: payload(2048, Number(s)) }));
    const path = n();
    await writeFrames(path, metaOf(), frames);
    const r = await scanSegment(path, expectOf());
    expect(r.frames.map((f) => f.walSeq)).toEqual([1n, 2n, 3n]);
    expect(r.defects.map((d) => d.kind)).toEqual(['gap']);
    expect(r.defects[0].walSeq).toBe(5n);
  });

  it('③重复帧去重：旧 seq 同 hash 跳过不挡后续；新 seq 旧 hash 跳过并消费 seq', async () => {
    const p2 = payload(2048, 2);
    const pathA = n();
    await writeFrames(pathA, metaOf(), [
      { walSeq: 1n, payload: payload(1024, 1) }, { walSeq: 2n, payload: p2 }, { walSeq: 3n, payload: payload(1024, 3) },
    ]);
    {   // 追加重放帧（旧 seq 2 同 hash）+ 新帧 4（续开既有段——create 会截断重写）
      const w = await SpikeSegmentWriter.openExisting(pathA);
      await w.appendBatch([{ walSeq: 2n, payload: p2 }, { walSeq: 4n, payload: payload(1024, 4) }], Date.now());
      await w.close();
    }
    const ra = await scanSegment(pathA, expectOf());
    expect(ra.frames.map((f) => f.walSeq)).toEqual([1n, 2n, 3n, 4n]);
    expect(ra.defects.map((d) => d.kind)).toEqual(['dup-seq']);

    const pathB = n();
    await writeFrames(pathB, metaOf(), [
      { walSeq: 1n, payload: payload(1024, 1) }, { walSeq: 2n, payload: p2 }, { walSeq: 3n, payload: payload(1024, 3) },
      { walSeq: 4n, payload: p2 },                    // 新 seq 承载已见 hash
      { walSeq: 5n, payload: payload(1024, 5) },
    ]);
    const rb = await scanSegment(pathB, expectOf());
    expect(rb.frames.map((f) => f.walSeq)).toEqual([1n, 2n, 3n, 5n]);   // 4 被去重消费、5 继续收养
    expect(rb.defects.map((d) => d.kind)).toEqual(['dup-hash']);
  });

  it('链级停链判据：跨段良性 dup 不停链——dup 后帧继续收养+后续段照常收养（崩溃重试形态）', async () => {
    // 崩溃重试天然形态：段 1 首帧=段 0 帧 2 的跨段重放（同 seq 同 hash）——须判良性 dup（保守「任一缺陷即停」会误隔离健康链）
    const s0 = n(); const s1 = n(); const s2 = n();
    await writeFrames(s0, metaOf(), [
      { walSeq: 1n, payload: payload(1024, 1) }, { walSeq: 2n, payload: payload(2048, 2) }, { walSeq: 3n, payload: payload(1024, 3) },
    ]);
    await writeFrames(s1, metaOf(), [
      { walSeq: 2n, payload: payload(2048, 2) },   // 跨段重放段 0 帧 2（确定性 payload ⇒ 同 hash）
      { walSeq: 4n, payload: payload(1024, 4) }, { walSeq: 5n, payload: payload(2048, 5) },
    ]);
    await writeFrames(s2, metaOf(), [{ walSeq: 6n, payload: payload(1024, 6) }]);
    const rebuilt = await rebuildPrefix([s0, s1, s2], expectOf());
    expect(rebuilt.stoppedAt).toBeNull();                                           // 良性 dup 不停链
    expect(rebuilt.frames.map((f) => f.walSeq)).toEqual([1n, 2n, 3n, 4n, 5n, 6n]);   // dup 后帧+后续段全收养
    const defects = rebuilt.results.flatMap((r) => r.defects);
    expect(defects.map((d) => `${d.kind}:${d.fatal ? 'fatal' : 'benign'}`)).toEqual(['dup-seq:benign']);
  });

  it('④段头 historyId≠SystemHistory → 整段 quarantine fail-closed（零帧重放，链止于此段）', async () => {
    const path = n();
    await writeFrames(path, metaOf({ historyId: 'h-old-epoch' }), [1n, 2n].map((s) => ({ walSeq: s, payload: payload(1024, Number(s)) })));
    const r = await scanSegment(path, expectOf());   // expected.historyId=HISTORY ≠ h-old-epoch
    expect(r.quarantined).toBe('history-mismatch');
    expect(r.frames).toHaveLength(0);
    const good = n();
    await writeFrames(good, metaOf(), [1n, 2n].map((s) => ({ walSeq: s, payload: payload(1024, Number(s)) })));
    const rebuilt = await rebuildPrefix([path, good], expectOf());
    expect(rebuilt.stoppedAt).toBe(0);               // 隔离段之后的段不重放（链断不可证明连续性）
    expect(rebuilt.frames).toHaveLength(0);
  });

  it('⑤时间戳栅栏：lastWriteAt>epochStartedAt（忘 bump 形态）→整段 quarantine；≤ 则正常收养', async () => {
    const epochStart = Date.now();
    const older = n(); const newer = n();
    await writeFrames(older, metaOf(), [1n].map((s) => ({ walSeq: s, payload: payload(1024, 1) })));
    await writeFrames(newer, metaOf(), [1n].map((s) => ({ walSeq: s, payload: payload(1024, 2) })));
    // 改写段头 lastWriteAt（pwrite 后重算头 CRC——writer 同纪律）：older=epochStart-1s / newer=epochStart+5s
    const setLastWriteAt = async (path: string, ms: number): Promise<void> => {
      const raw = await readFile(path);
      raw.writeBigUInt64LE(BigInt(ms), 152);
      raw.writeUInt32LE(crc32(raw.subarray(0, 160)) >>> 0, 160);
      await writeFile(path, raw);
    };
    await setLastWriteAt(older, epochStart - 1_000);
    await setLastWriteAt(newer, epochStart + 5_000);
    const expected = expectOf({ epochStartedAtMs: epochStart });
    const rOld = await scanSegment(older, expected);
    expect(rOld.quarantined).toBeNull();             // 段比 epoch 旧 → 正常收养
    expect(rOld.frames.map((f) => f.walSeq)).toEqual([1n]);
    const rNew = await scanSegment(newer, expected);
    expect(rNew.quarantined).toBe('timestamp-fence');   // 段比 epoch 新（忘 bump）→ 整段隔离零重放
    expect(rNew.frames).toHaveLength(0);
  });

  it('坏段头（magic 撕裂/短文件/头 CRC 撕裂）→ bad-header 整段 quarantine', async () => {
    const good = n();
    await writeFrames(good, metaOf(), [1n].map((s) => ({ walSeq: s, payload: payload(1024, 1) })));
    const badMagic = n();
    await copyFile(good, badMagic);
    { const raw = await readFile(badMagic); raw[3] ^= 0xff; await writeFile(badMagic, raw); }
    expect((await scanSegment(badMagic, expectOf())).quarantined).toBe('bad-header');
    const short = n();
    await writeFile(short, Buffer.alloc(100));
    expect((await scanSegment(short, expectOf())).quarantined).toBe('bad-header');
    const badHCrc = n();
    await copyFile(good, badHCrc);
    { const raw = await readFile(badHCrc); raw[160] ^= 0xff; await writeFile(badHCrc, raw); }   // 头 CRC 域单字节翻转
    expect((await scanSegment(badHCrc, expectOf())).quarantined).toBe('bad-header');
  });

  it('帧 frameHash 撕裂（CRC 修复一致但 hash≠payload）与 generation 不符 → 均隔离', async () => {
    const path = n();
    const goodFrames = [1n, 2n].map((s) => ({ walSeq: s, payload: payload(1024, Number(s)) }));
    await writeFrames(path, metaOf(), goodFrames);
    // 手工追加帧 3：frameHash 首字节翻转+重算 CRC（骗过 CRC 网——由 SHA 校验兜住）
    const tampered = encodeFrame({ walSeq: 3n, payload: payload(1024, 3) }, 3);
    tampered[20] ^= 0xff;   // frameHash[0]（帧内偏移 8+12）
    tampered.writeUInt32LE(crc32(tampered.subarray(8)) >>> 0, 4);
    // 手工追加帧 4：generation=段头+1（帧内一律携带 generation——换代混段检测）
    const wrongGen = encodeFrame({ walSeq: 3n, payload: payload(1024, 4) }, 4);
    const raw = await readFile(path);
    await writeFile(path, Buffer.concat([raw, tampered, wrongGen]));
    const r = await scanSegment(path, expectOf());
    expect(r.frames.map((f) => f.walSeq)).toEqual([1n, 2n]);
    expect(r.defects.map((d) => d.kind)).toEqual(['hash-mismatch']);   // hash 撕裂先拦——generation 帧在其后未及扫描
    // generation 帧单独验证（干净文件）
    const path2 = n();
    await writeFrames(path2, metaOf(), goodFrames);
    { const raw2 = await readFile(path2); await writeFile(path2, Buffer.concat([raw2, wrongGen])); }
    const r2 = await scanSegment(path2, expectOf());
    expect(r2.defects.map((d) => d.kind)).toEqual(['generation-mismatch']);
    expect(r2.frames.map((f) => f.walSeq)).toEqual([1n, 2n]);
  });

  it('精确性总断言：混合缺陷文件——重建前缀=恰好完整有效前缀（无漏好帧/无收坏帧）', async () => {
    const p1 = payload(1024, 1); const p2 = payload(2048, 2); const p3 = payload(4096, 3);
    const p5 = payload(1024, 5); const p6 = payload(1024, 6);
    const path = n();
    await writeFrames(path, metaOf(), [
      { walSeq: 1n, payload: p1 }, { walSeq: 2n, payload: p2 },
      { walSeq: 1n, payload: p1 },                     // dup-seq（良性重放）
      { walSeq: 3n, payload: p3 },
      { walSeq: 5n, payload: p5 }, { walSeq: 6n, payload: p6 },   // gap@4 之后全部隔离
    ]);
    const r = await scanSegment(path, expectOf());
    expect(r.frames.map((f) => f.walSeq)).toEqual([1n, 2n, 3n]);
    expect(r.frames.map((f) => Buffer.from(f.payload))).toEqual([p1, p2, p3].map((p) => Buffer.from(p)));
    expect(r.defects.map((d) => d.kind)).toEqual(['dup-seq', 'gap']);
    // 精确性两侧：gap 前的好帧零遗漏（1,2,3 全在）；坏帧/隔离帧零混入（dup 与 5,6 均不在重放集）
    const seqs = new Set(r.frames.map((f) => f.walSeq));
    for (const s of [1n, 2n, 3n]) expect(seqs.has(s)).toBe(true);
    for (const s of [5n, 6n]) expect(seqs.has(s)).toBe(false);
    // 恢复语义：截断点=首个致命缺陷（gap 帧 5）记录起点——其前恰为完整有效前缀
    expect(r.lastGoodOffset).toBe(HEADER_SIZE + (1024 + FRAME_FIXED_BYTES) * 2 + (2048 + FRAME_FIXED_BYTES) + (4096 + FRAME_FIXED_BYTES));
  });
});
