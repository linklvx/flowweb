// Y0a-2（spec v2.4 §2.2）：spool=store 故障期唯一权威待落库台账（内存 unflushed Map 本批退役）。
// 帧格式 [4B len LE][4B crc32 LE][payload]；段文件 `<projectId>.<segSeq>.spool` 段满 4MB 滚动；
// putStash 语义=append 帧+同步 fsync（唯一持久动作）；confirm=按 frameId 内存记账，段内全部帧
// confirmed（或 quarantined）→整段 unlink（原子，消灭"重写文件去帧"中途崩溃=台账全丢窗口）。
// 持久化模型头注释见 collab.gateway.ts 顶部（§2.1 契约声明）。
// 崩溃语义：confirmed 集丢失→重启 scan 后全部帧重新可见→重复回灌由 CRDT 幂等吸收（幂等降级为
// 第二道防线，只承担重复行性能代价，不承担正确性）。
import { Injectable, Logger, Optional } from '@nestjs/common';
import { open, readFile, readdir, stat, unlink, mkdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { crc32 } from 'node:zlib';
import * as Y from 'yjs';
import {
  yjsSpoolTruncatedTotal,
  yjsSpoolWriteFailuresTotal,
  yjsSpoolCapacityTotal,
  yjsSpoolQuarantinedTotal,
  yjsUpdatesDiscardedDeletedTotal,
} from './store.metrics';
import { isFkGone } from './pg-error.util';
import type { CanvasDocUpdateRepository } from './canvas-doc-update.repository';

export interface SpoolFrame { frameId: string; payload: Uint8Array }

const SEGMENT_MAX_BYTES = 4 * 1024 * 1024;
const FRAME_HEADER_BYTES = 8;

/** Y0a-2 终形态（V2/V3，Y17）：frameCount=**可解析**帧数（scan 只数好帧；运行期追加恒好帧）——
 *  帧 idx 分配器与段回收判据共用；goodBytes=已证干净字节上界（追加守卫：stat().size 不符即封段滚动）；
 *  quarantinedRange=坏尾字节区间事实（Task 2 quarantineTruncatedFrames 写入——null=无坏尾）。 */
interface SegmentMeta {
  frameCount: number;
  goodBytes: number;
  bytes: number;
  confirmed: Set<number>;                        // 帧序号（内存态——崩溃丢失=幂等降级）
  confirmedCount: number;                        // confirmed 去重计数（confirm 段回收 O(1) 判据，Task 1 收口）
  sealed: boolean;                               // V2：封段后永不再追加（只置位不删字节——禁 ftruncate，R6）
  quarantinedRange: { fromOffset: number } | null;   // V3：坏帧起始偏移→EOF
  quarantinedBytes: number;
}

const segFileName = (projectId: string, segSeq: number) => `${projectId}.${segSeq}.spool`;
const parseSegFileName = (f: string): { projectId: string; segSeq: number } | null => {
  const m = /^(.+)\.(\d+)\.spool$/.exec(f);
  return m ? { projectId: m[1], segSeq: Number(m[2]) } : null;
};

@Injectable()
export class CollabSpoolService {
  private readonly logger = new Logger(CollabSpoolService.name);
  private readonly dir: string;
  /** V15：原始入参（未 resolve）——validateDir 的相对路径检查对象（this.dir 恒为绝对路径，检查它无意义）。 */
  private readonly rawDir: string;
  /** projectId → segSeq → 段元数据（scan 重建与运行期同构维护） */
  private readonly index = new Map<string, Map<number, SegmentMeta>>();

  // —— Task 2 追加（V14 两态熔断/V3 字节区间/V16 预算化回灌）——
  private static readonly WRITE_FAILURE_CIRCUIT = 5;          // 连续 5 次写失败→ioBroken
  private static readonly PROBE_INTERVAL_MS = 30_000;
  private static readonly SPOOL_CAPACITY_BYTES = 256 * 1024 * 1024;
  private static readonly REPLAY_BUDGET_MS = 5_000;           // V16：总墙钟预算（耗尽即返回，帧保留）
  private static readonly REPLAY_RETRY_MS = 200;              // V16：固定短退避（启动期不指数）
  private static readonly REPLAY_MERGE_MAX_FRAMES = 8;        // X8：合并上界（帧数）
  private static readonly REPLAY_MERGE_MAX_BYTES = 4 * 1024 * 1024;   // X8：合并上界（字节）
  private static readonly REPLAY_MAX_ATTEMPTS = 3;            // 每帧有界重试环
  private writeFailureStreak = 0;
  private ioBroken = false;                                   // V14：IO 态（探针可解）
  private overCapacityFlag = false;                           // V14：容量态（仅 depth 回落可解——探针无权关）
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  /** Y10：恢复回调 seam——gateway 注入（onModuleInit `this.spool.onRecovered = () => this.rearmQueues()`）。
   *  依赖方向 gateway→spool，spool 无反向通道是 v3 X6 链条断点（probe 成功无人唤醒 gateway）。幂等
   *  调用安全（schedulePersistRetry 对已有 timer return）。 */
  onRecovered?: () => void;

  // @Optional()：Nest DI 对原始类型参数（paramtypes=[String]）无法解析，不加会在模块实例化时
  // 让整个应用 boot 崩（本仓惯例见 collab.gateway.ts @Optional() 注入形态）。
  constructor(@Optional() dir?: string) {
    this.rawDir = dir ?? process.env.COLLAB_SPOOL_DIR ?? join(process.cwd(), '.data', 'collab-spool');
    this.dir = resolve(this.rawDir);
  }

  /** 键集（同步内存——gateway 键集缓存即此，非权威数据副本）。X8'：恒排除 `__probe__`。 */
  hasFrames(projectId: string): boolean {
    if (projectId === '__probe__') return false;
    return (this.index.get(projectId)?.size ?? 0) > 0;
  }
  keys(): string[] { return [...this.index.keys()].filter((k) => k !== '__probe__' && (this.index.get(k)?.size ?? 0) > 0); }

  /** V14 原语义：综合可写判定——无 IO 熔断、无容量超限。写失败 streak 不参与：
   *  streak 1-4 区间探针未启动（5 连败 WRITE_FAILURE_CIRCUIT 才 startProbe），若 streak 条件收窄
   *  isWritable，单次瞬时失败即令 X6 重试梯首行 return 停排+受理面只读，且无人再写 spool→streak
   *  永不清零=单败停摆窗口。持续故障由 5 连败置 ioBroken 后才收窄受理面（onRecovered seam 唤醒）。 */
  isWritable(): boolean { return !this.ioBroken && !this.overCapacityFlag; }
  /** 分型查询：容量超限态（gateway 的 reason 区分与 Task 5 白盒注入消费）。 */
  overCapacity(): boolean { return this.overCapacityFlag; }
  /** 连续写失败计数（ioBroken 熔断判定素材——观测与测试消费）。 */
  failureStreak(): number { return this.writeFailureStreak; }

  /** Y24：depth 排除 `__probe__` 键（容量口径不含探针字节）；quarantinedBytes 含坏帧头（V3）。 */
  depth(): { files: number; bytes: number; quarantinedBytes: number } {
    let files = 0, bytes = 0, quarantinedBytes = 0;
    for (const [pid, segs] of this.index) {
      if (pid === '__probe__') continue;
      for (const m of segs.values()) { files++; bytes += m.bytes; quarantinedBytes += m.quarantinedBytes; }
    }
    return { files, bytes, quarantinedBytes };
  }

  /** putStash：append 帧+fsync——入账先于一切返回（失败 throw 交调用方走 BOI 队列路径）。
   *  V14：统一包两态记账——容量判定=**总字节**（含隔离——隔离段同占盘）；容量计数不进写失败 streak；
   *  容量态解除带 10% 滞回（防抖动）；探针帧（__probe__）跳过容量判定（探针必须可写，否则熔断永不解）。 */
  async append(projectId: string, payload: Uint8Array): Promise<string[]> {
    if (projectId !== '__probe__') {
      const d = this.depth();
      if (!this.overCapacityFlag && d.bytes + payload.byteLength > CollabSpoolService.SPOOL_CAPACITY_BYTES) {
        this.overCapacityFlag = true;
        yjsSpoolCapacityTotal.inc();
        this.logger.error('spool capacity exceeded（256MB 总口径含隔离字节）——拒新编辑（不丢最旧：丢=蒸发同罪）；人工处置=collab-spool-quarantine 脚本');
      } else if (this.overCapacityFlag && d.bytes <= CollabSpoolService.SPOOL_CAPACITY_BYTES * 0.9) {
        this.overCapacityFlag = false;                        // 滞回解除（10% 余量防抖动）
        this.logger.log('spool capacity recovered');
      }
      if (this.overCapacityFlag) throw new Error('spool capacity exceeded');
    }
    try {
      const ids = await this.appendRaw(projectId, payload);
      this.noteWriteSuccess();
      return ids;
    } catch (e) {
      this.noteWriteFailure();
      throw e;
    }
  }

  // —— V14 两态熔断（ioBroken 探针可解 / overCapacity 仅 depth 回落可解）——
  private noteWriteFailure(): void {
    this.writeFailureStreak += 1;
    yjsSpoolWriteFailuresTotal.inc();
    if (this.writeFailureStreak >= CollabSpoolService.WRITE_FAILURE_CIRCUIT && !this.ioBroken) {
      this.ioBroken = true;
      this.logger.error('spool IO circuit OPEN：连续写失败——批次留队列（BOI）；受理面由 gateway.isWritableOrDegraded 只读降级（Y24 命名）');
      this.startProbe();
    }
  }
  private noteWriteSuccess(): void {
    this.writeFailureStreak = 0;
    if (this.ioBroken) {
      this.ioBroken = false;
      this.stopProbe();
      this.logger.log('spool IO circuit CLOSED：探针帧写删成功');
      try { this.onRecovered?.(); } catch { /* 回调异常不损恢复事实 */ }   // Y10：唤醒 gateway rearm
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
  /** 探针=写 1 帧探针载荷+confirm 段回收+fsync——只解 ioBroken（noteWriteSuccess 不触碰容量态）。 */
  async probe(): Promise<void> {
    const ids = await this.appendRaw('__probe__', new Uint8Array([0]));
    await this.confirm('__probe__', ids);
    this.noteWriteSuccess();
  }

  /** 帧写入唯一实现（V2 封段守卫+X14 耐久性/权限——WAL 标准做法）。
   *  收口7 契约：同项目 append 串行调用（生产由 gateway saveMutex/串行 drain/启动期回灌保证；探针走 __probe__ 独立键）——并发调用会破坏 frameIdx 分配。 */
  private async appendRaw(projectId: string, payload: Uint8Array): Promise<string[]> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    let segSeq = -1; let meta: SegmentMeta | undefined;
    const segs = this.index.get(projectId);
    if (segs && segs.size > 0) {
      segSeq = Math.max(...segs.keys());
      meta = segs.get(segSeq);
      if (meta) {
        // stat 守卫（V2 补强——SegmentMeta.goodBytes 注记的实现形态）：文件实际大小≠内存记账=
        // 外部写入/半写残留（内存丢失窗口的磁盘侧事实核验）→ 封段，追加滚动新段。
        const st = await stat(join(this.dir, segFileName(projectId, segSeq))).catch(() => null);
        if (st && st.size !== meta.bytes) meta.sealed = true;
        // V2 追加前守卫：段已封禁（sealed）或写入失败遗留半写尾（goodBytes≠bytes）或段满 → 滚动新段
        if (meta.sealed || meta.goodBytes !== meta.bytes
          || meta.bytes + FRAME_HEADER_BYTES + payload.byteLength > SEGMENT_MAX_BYTES) {
          segSeq += 1; meta = undefined;
        }
      }
    }
    if (segSeq < 0) segSeq = 0;
    const isNewSegment = !meta;
    if (!meta) {
      meta = { frameCount: 0, goodBytes: 0, bytes: 0, confirmed: new Set(), confirmedCount: 0, sealed: false, quarantinedRange: null, quarantinedBytes: 0 };
      if (!segs) this.index.set(projectId, new Map());
      this.index.get(projectId)!.set(segSeq, meta);
    }
    const frameIdx = meta.frameCount;
    const header = Buffer.alloc(FRAME_HEADER_BYTES);
    header.writeUInt32LE(payload.byteLength, 0);
    header.writeUInt32LE(crc32(Buffer.from(payload)) >>> 0, 4);
    const path = join(this.dir, segFileName(projectId, segSeq));
    try {
      const fh = await open(path, 'a', 0o600);   // X14：台账保密性不低于 PG 侧默认
      try {
        await fh.chmod(0o600).catch(() => {});   // 已存在文件收敛权限（open 的 mode 只对新建生效）
        await fh.writeFile(Buffer.concat([header, Buffer.from(payload)]));
        await fh.sync();   // fsync 完成才返回（契约 4：入账先于一切）
      } finally {
        await fh.close();
      }
    } catch (e) {
      meta.sealed = true;   // V2：writeFile/sync/open 抛错即封段——消灭"半写后继续追加同段→后续帧永不可读"黑洞
      // 收口1：新段首帧写失败→回滚 index 插入（不留"有段无帧"的幻影元数据——hasFrames/keys 不见幽灵键）
      if (isNewSegment && meta.frameCount === 0) {
        const segsNow = this.index.get(projectId)!;
        segsNow.delete(segSeq);
        if (segsNow.size === 0) this.index.delete(projectId);
      }
      throw e;
    }
    meta.frameCount = frameIdx + 1;
    meta.bytes += FRAME_HEADER_BYTES + payload.byteLength;
    meta.goodBytes = meta.bytes;   // 追加成功则段尾干净
    // X14：**新建段文件后 fsync 父目录**（文件数据落盘≠目录项落盘——掉电后新段可能整个不存在）。
    // 顺序不可倒：写帧+fsync 文件 → fsync 父目录。
    // 收口3+5：整块 try/catch——目录 fsync 是尽力而为的加固层，open/close/sync 任一失败都不得翻转已成功的写入；
    // Windows ENOTSUP 静默跳过（无强一致语义可登记，非异常路径）。
    if (isNewSegment) {
      try {
        const dh = await open(this.dir, 'r');
        try { await dh.sync(); } catch { /* ENOTSUP（Windows）等——尽力而为，静默 */ } finally { await dh.close(); }
      } catch { /* 目录句柄打开失败同上——写已成功，忽略 */ }
    }
    return [`${segSeq}:${frameIdx}`];
  }

  /** 读全部未 confirm 好帧（以 index 的 frameCount=可解析帧数为界——坏尾的识别与隔离归 scan/
   *  quarantineTruncatedFrames；循环内解析失败=index 与文件不一致的 tripwire：计数+停读）。 */
  async peek(projectId: string): Promise<SpoolFrame[]> {
    const segs = this.index.get(projectId);
    if (!segs) return [];
    const frames: SpoolFrame[] = [];
    for (const segSeq of [...segs.keys()].sort((a, b) => a - b)) {
      const meta = segs.get(segSeq)!;
      let buf: Buffer;
      try { buf = await readFile(join(this.dir, segFileName(projectId, segSeq))); }
      catch { continue; }   // 段文件消失（已 unlink）——跳过
      let off = 0; let idx = 0;
      while (idx < meta.frameCount) {
        if (off + FRAME_HEADER_BYTES > buf.byteLength) { this.reportTruncation(projectId, segSeq); break; }
        const len = buf.readUInt32LE(off);
        if (off + FRAME_HEADER_BYTES + len > buf.byteLength) { this.reportTruncation(projectId, segSeq); break; }
        const payload = buf.subarray(off + FRAME_HEADER_BYTES, off + FRAME_HEADER_BYTES + len);
        if ((crc32(payload) >>> 0) !== buf.readUInt32LE(off + 4)) { this.reportTruncation(projectId, segSeq); break; }
        if (!meta.confirmed.has(idx)) frames.push({ frameId: `${segSeq}:${idx}`, payload: new Uint8Array(payload) });
        off += FRAME_HEADER_BYTES + len; idx += 1;
      }
    }
    return frames;
  }

  /** confirm=append 成功后的记账性动作（契约 12：删帧恒在 append 成功之后——本方法不触 DB）。
   *  段回收判据（V3）：全部**可解析**帧（[0,frameCount)）confirmed ∧ 坏尾已处置
   *  （quarantinedRange 已记 ∨ 段尾本就干净 goodBytes===bytes）。 */
  async confirm(projectId: string, frameIds: string[]): Promise<void> {
    const segs = this.index.get(projectId);
    if (!segs) return;
    for (const id of frameIds) {
      const [seg, idx] = id.split(':');
      const m = segs.get(Number(seg));
      const n = Number(idx);
      if (m && !m.confirmed.has(n)) { m.confirmed.add(n); m.confirmedCount += 1; }   // 收口4：去重+递增
    }
    for (const segSeq of [...segs.keys()]) {
      const meta = segs.get(segSeq)!;
      const allGoodConfirmed = meta.frameCount > 0 && meta.confirmedCount === meta.frameCount;   // 收口4：O(1) 判据
      const tailSettled = meta.quarantinedRange != null || meta.goodBytes === meta.bytes;
      if (!allGoodConfirmed || !tailSettled) continue;
      const file = join(this.dir, segFileName(projectId, segSeq));
      try { await unlink(file); } catch { /* 已消失 */ }
      try { await unlink(`${file}.quarantine`); } catch { /* 无 sidecar */ }
      segs.delete(segSeq);
    }
    if (segs.size === 0) this.index.delete(projectId);
  }

  /** V3：坏帧段处置=**字节区间**隔离（坏帧起始偏移→EOF）——截断是字节事实非帧号集合
   *  （v1 的帧号循环在 scan 停读后 frameCount===firstBad=恒空循环，真 bug）；sidecar 记偏移区间；
   *  quarantinedBytes = byteLength - off（**含坏帧头**——v1 的 -8 off-by-8 实错）；重复调用不重复递增计数。 */
  async quarantineTruncatedFrames(projectId: string): Promise<number> {
    const segs = this.index.get(projectId);
    if (!segs) return 0;
    let newQuarantined = 0;
    for (const f of await readdir(this.dir)) {
      const parsed = parseSegFileName(f);
      if (!parsed || parsed.projectId !== projectId) continue;
      const meta = segs.get(parsed.segSeq);
      if (!meta || meta.quarantinedRange != null) continue;             // 已隔离——不重复递增（V3）
      const buf = await readFile(join(this.dir, f));
      let off = 0;
      while (off + FRAME_HEADER_BYTES <= buf.byteLength) {
        const len = buf.readUInt32LE(off);
        if (off + FRAME_HEADER_BYTES + len > buf.byteLength || (crc32(buf.subarray(off + FRAME_HEADER_BYTES, off + FRAME_HEADER_BYTES + len)) >>> 0) !== buf.readUInt32LE(off + 4)) break;
        off += FRAME_HEADER_BYTES + len;
      }
      if (off >= buf.byteLength) continue;                     // 干净段
      meta.quarantinedRange = { fromOffset: off };             // 区间事实：坏帧起始偏移→EOF
      meta.sealed = true;                                      // V2：含坏尾的段封禁（永不再追加）
      meta.quarantinedBytes = buf.byteLength - off;
      newQuarantined += 1;
      const line = JSON.stringify({ segSeq: parsed.segSeq, quarantinedFromOffset: off, toOffset: buf.byteLength, reason: 'truncated-or-crc', firstSeenAt: new Date().toISOString() }) + '\n';
      const sc = await open(join(this.dir, `${f}.quarantine`), 'a');
      try { await sc.writeFile(line); await sc.sync(); } finally { await sc.close(); }
    }
    if (newQuarantined > 0) yjsSpoolQuarantinedTotal.inc(newQuarantined);
    return newQuarantined;
  }

  /** 启动扫描：重建 index（帧数/字节）——确认集丢失即幂等降级。返回坏帧段清单供启动隔离处置。
   *  Y17：truncated 段直接置 sealed（V2——scan 时已含坏尾，永不再追加）+goodBytes=首坏帧偏移；
   *  X8'：`__probe__*` 段崩溃残留直接 unlink（探针帧不进回灌/键集）。
   *  收口2：开头清空 index 幂等重建（二次 scan 不合并陈旧条目）；<8B 残片段（零帧零数据）直接回收；
   *  好帧循环后 off!==byteLength 即 1-7B 残尾——也进 truncated 报告（坏尾必有可观测面）。 */
  async scan(): Promise<{ truncatedSegments: string[] }> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    this.index.clear();
    const truncatedSegments: string[] = [];
    for (const f of await readdir(this.dir)) {
      const parsed = parseSegFileName(f);
      if (!parsed) continue;
      if (parsed.projectId === '__probe__') { await unlink(join(this.dir, f)).catch(() => {}); continue; }
      const buf = await readFile(join(this.dir, f));
      if (buf.byteLength < FRAME_HEADER_BYTES) {   // 收口2：<8B 残片段（0 字节/残片）——零帧零数据，直接回收
        await unlink(join(this.dir, f)).catch(() => {});
        continue;
      }
      let off = 0, frameCount = 0; let truncated = false;
      while (off + FRAME_HEADER_BYTES <= buf.byteLength) {
        const len = buf.readUInt32LE(off);
        if (off + FRAME_HEADER_BYTES + len > buf.byteLength) { truncated = true; break; }
        const payload = buf.subarray(off + FRAME_HEADER_BYTES, off + FRAME_HEADER_BYTES + len);
        if ((crc32(payload) >>> 0) !== buf.readUInt32LE(off + 4)) { truncated = true; break; }
        off += FRAME_HEADER_BYTES + len; frameCount += 1;
      }
      if (off !== buf.byteLength) truncated = true;   // 收口2：好帧后 1-7B 残尾也进报告
      if (truncated) {
        truncatedSegments.push(f);
        yjsSpoolTruncatedTotal.inc();   // scan 路径计数恰一次（peek 以 frameCount 为界不重读坏尾→无双计）
        this.logger.error(`spool truncated segment ${f} at startup scan——sealed+待隔离处置（Task 2 quarantineTruncatedFrames），计数+人工介入`);
      }
      const segs = this.index.get(parsed.projectId) ?? new Map<number, SegmentMeta>();
      segs.set(parsed.segSeq, {
        frameCount, goodBytes: off, bytes: buf.byteLength,
        confirmed: new Set(), confirmedCount: 0, sealed: truncated, quarantinedRange: null, quarantinedBytes: 0,
      });
      this.index.set(parsed.projectId, segs);
    }
    return { truncatedSegments };
  }

  /** V16+X8：启动回灌——总墙钟预算默认 5s+固定 200ms 退避+**每帧 maxAttempts=3 有界重试环**
   *  （failed 在 attempts 耗尽/预算耗尽两分支都计数，启动自检点名才不静默）+**合并上界**（≤8 帧且合计
   *  ≤4MB 才合并单次 append，超界分轮——防 PG 长故障恢复后 256MB 单行 append+同步 merge 停摆；恢复期
   *  自然有界多轮，每轮成功只 confirm 本轮 K 帧）。FK 判别=isFkGone（pg-error.util 单源，X15）。
   *  X8'：keys() 恒排除 `__probe__`；scan() 阶段直接 unlink `__probe__*` 段（探针帧崩溃残留不进回灌）。 */
  async replayAll(
    repo: Pick<CanvasDocUpdateRepository, 'append'>,
    opts?: { budgetMs?: number; retryDelayMs?: number; maxAttempts?: number; projectIds?: string[] },
  ): Promise<{ replayed: number; failed: number; discarded: number }> {
    const deadline = Date.now() + (opts?.budgetMs ?? CollabSpoolService.REPLAY_BUDGET_MS);
    const retryDelay = opts?.retryDelayMs ?? CollabSpoolService.REPLAY_RETRY_MS;
    const maxAttempts = opts?.maxAttempts ?? CollabSpoolService.REPLAY_MAX_ATTEMPTS;
    let replayed = 0, failed = 0, discarded = 0;
    for (const projectId of opts?.projectIds ?? this.keys()) {
      for (;;) {                                                 // X8：分轮合并（每轮 ≤8 帧且 ≤4MB）
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
          roundAppended = true;                                  // 本轮全落——继续下一轮（帧已 confirm 不可见）
        } catch (e) {
          if (isFkGone(e)) {                                     // V6：项目已删 DB 权威证据
            await this.confirm(projectId, frames.map((f) => f.frameId));
            discarded += frames.length; yjsUpdatesDiscardedDeletedTotal.inc({ source: 'spool' }, frames.length);
            this.logger.warn(`spool frames for ${projectId} discarded (project deleted, FK)`);
            continue;                                            // 下一轮（或该项目耗尽）
          }
          // 合并失败→退化逐帧有界重试环（隔离坏帧目的仍达成）
          for (const frame of frames) {
            for (let attempt = 1; ; attempt++) {
              if (Date.now() > deadline) { failed += 1; this.logger.error(`spool replay budget-exhausted for ${projectId}:${frame.frameId}——帧保留（运行期由退避梯自愈，X5）`); break; }
              try {
                const r2 = await repo.append(projectId, frame.payload);
                if (!r2.ok) throw new Error(`append returned no row (${r2.reason})`);
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
        if (!roundAppended) break;                               // 本轮未整体落定——该项目结束（残帧归运行期）
        if (Date.now() > deadline) break;
      }
    }
    return { replayed, failed, discarded };
  }

  /** X8 辅助：按字节上限截断帧列表（保持顺序；至少 1 帧——巨帧由装载侧 WARN 观测）。 */
  private truncateByBytes(frames: SpoolFrame[], maxBytes: number): number {
    let acc = 0, i = 0;
    while (i < frames.length && acc + frames[i].payload.byteLength <= maxBytes) { acc += frames[i].payload.byteLength; i += 1; }
    return Math.max(i, 1);
  }

  /** V15：构造后路径校验——**本方法只管路径形态**（生产环境相对路径拒绝启动：CWD 漂移=静默换账本）；
   *  目录可用性（不存在/不可写）不在此判——由 scan() 抛错经 onModuleInit 不捕获实现 fail-fast。
   *  返回解析后的绝对路径供日志。 */
  validateDir(): string {
    const abs = resolve(this.dir);
    if (process.env.NODE_ENV === 'production' && !isAbsolute(this.rawDir)) {
      throw new Error(`COLLAB_SPOOL_DIR 必须为绝对路径（当前：${this.rawDir}——CWD 漂移会静默指向另一个空账本）`);
    }
    return abs;
  }

  private reportTruncation(projectId: string, segSeq: number) {
    yjsSpoolTruncatedTotal.inc();
    this.logger.error(`spool truncated frame at ${projectId}.${segSeq}——停读该段（坏帧从未持久化或落盘不完整），计数+人工介入`);
  }
}
