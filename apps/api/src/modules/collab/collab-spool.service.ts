// Y0a-2（spec v2.4 §2.2）：spool=store 故障期唯一权威待落库台账（内存 unflushed Map 本批退役）。
// 帧格式 [4B len LE][4B crc32 LE][payload]；段文件 `<owner>/<projectId>.<segSeq>.spool`（R3 每实例
// owner 子目录——fenced 前任各写各目录物理不撞名）段满 4MB 滚动；
// putStash 语义=append 帧+同步 fsync（唯一持久动作）；confirm=按 frameId 内存记账，段内全部帧
// confirmed（或 quarantined）→整段 unlink（原子，消灭"重写文件去帧"中途崩溃=台账全丢窗口）。
// 持久化模型头注释见 collab.gateway.ts 顶部（§2.1 契约声明）。
// 崩溃语义：confirmed 集丢失→重启 scan 后全部帧重新可见→重复回灌由 CRDT 幂等吸收（幂等降级为
// 第二道防线，只承担重复行性能代价，不承担正确性）。
import { Injectable, Logger, Optional } from '@nestjs/common';
import { open, readFile, readdir, rmdir, stat, unlink, mkdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
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
 *  quarantinedRange=坏尾字节区间事实（Task 2 quarantineTruncatedFrames 写入——null=无坏尾）。
 *  Y0a-3 R3：dir=段所在绝对目录（scan 重建/appendRaw 新建/跨 owner unlink 定位）；seq=段号
 *  （appendRaw 滚段判定的 max 计算）；foreign=P18 外来段标记（depth stranded 分区+reconciler 收养对象）。 */
interface SegmentMeta {
  frameCount: number;
  goodBytes: number;
  bytes: number;
  confirmed: Set<number>;                        // 帧序号（内存态——崩溃丢失=幂等降级）
  confirmedCount: number;                        // confirmed 去重计数（confirm 段回收 O(1) 判据，Task 1 收口）
  sealed: boolean;                               // V2：封段后永不再追加（只置位不删字节——禁 ftruncate，R6）
  quarantinedRange: { fromOffset: number } | null;   // V3：坏帧起始偏移→EOF
  quarantinedBytes: number;
  dir: string;                                   // R3：段所在绝对目录
  seq: number;                                   // R3：段号
  foreign: boolean;                              // R3/P18：外来段标记
}

const segFileName = (projectId: string, segSeq: number) => `${projectId}.${segSeq}.spool`;
const parseSegFileName = (f: string): { projectId: string; segSeq: number } | null => {
  const m = /^(.+)\.(\d+)\.spool$/.exec(f);
  return m ? { projectId: m[1], segSeq: Number(m[2]) } : null;
};

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

@Injectable()
export class CollabSpoolService {
  private readonly logger = new Logger(CollabSpoolService.name);
  private readonly dir: string;
  /** V15：原始入参（未 resolve）——validateDir 的相对路径检查对象（this.dir 恒为绝对路径，检查它无意义）。 */
  private readonly rawDir: string;
  /** projectId → segKey → 段元数据（scan 重建与运行期同构维护）。R3：内键=段键（root 段=文件名；
   *  子目录段='<ownerDir>/<文件名>'——原为 segSeq 数字）；scan 的 V3 临时 map 整体 swap（非 readonly）。 */
  private index = new Map<string, Map<string, SegmentMeta>>();

  // —— Task 2 追加（V14 两态熔断/V3 字节区间/V16 预算化回灌）——
  private static readonly WRITE_FAILURE_CIRCUIT = 5;          // 连续 5 次写失败→ioBroken
  private static readonly PROBE_INTERVAL_MS = 30_000;
  private static readonly SPOOL_CAPACITY_BYTES = 256 * 1024 * 1024;   // 默认容量（R3 测试缝：COLLAB_SPOOL_CAPACITY_BYTES 构造期覆写——与 COLLAB_SPOOL_DIR 同族 env 读）
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

  /** Y0a-3 T2 最小缝（R3 前置）：lease owner=spool 子目录名——fs 安全形态校验（V4，构造期同规则）。
   *  R3 落地子目录机制本体（activeDir——写/扫路径唯一入口，未设即 throw=Z13 fail-closed）。 */
  private owner: string | null = null;
  setOwner(owner: string): void {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(owner)) throw new Error(`spool owner 非文件系统安全名: ${owner}`);
    this.owner = owner;
  }
  private activeDir(): string {
    if (!this.owner) throw new Error('spool owner not set——lease service 唯一写者必先 setOwner（契约 16 同族）');
    return join(this.dir, this.owner);
  }
  /** R3 段键：root 段=文件名；子目录段='<ownerDir>/<文件名>'（含 '/' 无 ':'——frameId lastIndexOf(':') 解析安全）。 */
  private segKeyOf(dir: string, name: string): string {
    return dir === this.dir ? name : `${relative(this.dir, dir).split(sep).join('/')}/${name}`;
  }

  // @Optional()：Nest DI 对原始类型参数（paramtypes=[String]）无法解析，不加会在模块实例化时
  // 让整个应用 boot 崩（本仓惯例见 collab.gateway.ts @Optional() 注入形态）。
  private readonly capacityBytes: number;
  constructor(@Optional() dir?: string) {
    this.rawDir = dir ?? process.env.COLLAB_SPOOL_DIR ?? join(process.cwd(), '.data', 'collab-spool');
    this.dir = resolve(this.rawDir);
    // R3 容量测试缝（env 读模式构造期已存在——COLLAB_SPOOL_DIR 同族）：缺省/NaN/非正数回落默认 256MB
    //（负值真值会 || 短路通过=永久写锁——显式 >0 判）。
    const capEnv = Number(process.env.COLLAB_SPOOL_CAPACITY_BYTES);
    this.capacityBytes = capEnv > 0 ? capEnv : CollabSpoolService.SPOOL_CAPACITY_BYTES;
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

  /** Y24：depth 排除 `__probe__` 键（容量口径不含探针字节）；quarantinedBytes 含坏帧头（V3）。
   *  R3/P16 双口径：own=本实例 owner 子目录（部署门 /api/ready.pending）；stranded=外来段
   *  （前任进程残留——磁盘真值部分）；容量核算取 total（depthTotalBytes）。 */
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
  /** V14 语义不变：容量判定=磁盘真值 total——外来段同占盘不得排除（I8/V2）。 */
  private depthTotalBytes(d: ReturnType<CollabSpoolService['depth']>): number { return d.ownBytes + d.strandedBytes; }
  totalFiles(d: ReturnType<CollabSpoolService['depth']> = this.depth()): number { return d.ownFiles + d.strandedFiles; }

  hasForeignSegments(): boolean {
    for (const segs of this.index.values()) for (const m of segs.values()) if (m.foreign) return true;
    return false;
  }

  /** R3 隔离段清单（诊断/运维面——sidecar 审计的内存投影：quarantinedRange 已记者）。 */
  quarantinedSegments(): { projectId: string; segKey: string; quarantinedBytes: number }[] {
    const out: { projectId: string; segKey: string; quarantinedBytes: number }[] = [];
    for (const [pid, segs] of this.index) {
      for (const [key, m] of segs.entries()) if (m.quarantinedRange != null) out.push({ projectId: pid, segKey: key, quarantinedBytes: m.quarantinedBytes });
    }
    return out;
  }

  /** W21/Z11（SV4）：收养静默外来段（boot 后新出现者；mtime ≥silentMs 无写入=其进程已死/已让位）。
   *  完整重扫（parseSegmentFrames 单源）；收养后 foreign=false 纳入 own 口径；坏尾按本 owner 档处理
   *  （sealed 截断）。返回收养清单（reconciler 回灌对象）。 */
  async adoptSilentForeignSegments(silentMs: number): Promise<{ projectId: string; dir: string; name: string }[]> {
    const now = Date.now();
    const adopted: { projectId: string; dir: string; name: string }[] = [];
    for (const [pid, segs] of [...this.index.entries()]) {
      for (const [key, m] of [...segs.entries()]) {
        if (!m.foreign) continue;
        const path = join(m.dir, segFileName(pid, m.seq));
        const st = await stat(path).catch(() => null);
        if (!st || now - st.mtimeMs < silentMs) continue;
        const buf = await readFile(path).catch(() => null);
        if (!buf) continue;
        const { frameCount, goodBytes, truncated } = this.parseSegmentFrames(buf);
        segs.set(key, { frameCount, goodBytes, bytes: buf.byteLength, confirmed: new Set(), confirmedCount: 0,
          sealed: truncated, quarantinedRange: null, quarantinedBytes: 0, dir: m.dir, seq: m.seq, foreign: false });
        adopted.push({ projectId: pid, dir: m.dir, name: segFileName(pid, m.seq) });
      }
    }
    return adopted;
  }

  /** putStash：append 帧+fsync——入账先于一切返回（失败 throw 交调用方走 BOI 队列路径）。
   *  V14：统一包两态记账——容量判定=**总字节**（R3=own+stranded 磁盘真值，外来段同占盘不得排除）；
   *  容量计数不进写失败 streak；容量态解除带 10% 滞回（防抖动）；探针帧（__probe__）跳过容量判定
   *  （探针必须可写，否则熔断永不解）。 */
  async append(projectId: string, payload: Uint8Array): Promise<string[]> {
    if (projectId !== '__probe__') {
      const total = this.depthTotalBytes(this.depth());
      if (!this.overCapacityFlag && total + payload.byteLength > this.capacityBytes) {
        this.overCapacityFlag = true;
        yjsSpoolCapacityTotal.inc();
        this.logger.error('spool capacity exceeded（总口径含隔离/外来字节）——拒新编辑（不丢最旧：丢=蒸发同罪）；人工处置=collab-spool-quarantine 脚本');
      } else if (this.overCapacityFlag && total <= this.capacityBytes * 0.9) {
        this.overCapacityFlag = false;                        // 滞回解除（10% 余量防抖动）
        this.logger.log('spool capacity recovered');
        try { this.onRecovered?.(); } catch { /* I-3：容量恢复缝与 confirm 自评对称——唤醒 gateway rearm */ }
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
   *  R3：写路径只落 activeDir（owner 子目录）——fenced 前任写它自己的子目录，物理不撞名；
   *  滚段计算只看同活动目录内的段（外来段不参与——seq 域按目录隔离）。
   *  收口7 契约：同项目 append 串行调用（生产由 gateway saveMutex/串行 drain/启动期回灌保证；探针走 __probe__ 独立键）——并发调用会破坏 frameIdx 分配。 */
  private async appendRaw(projectId: string, payload: Uint8Array): Promise<string[]> {
    const adir = this.activeDir();   // Z13：owner 必填断点（未设即 throw）
    await mkdir(adir, { recursive: true, mode: 0o700 });
    let segSeq = -1; let meta: SegmentMeta | undefined;
    const segs = this.index.get(projectId);
    if (segs && segs.size > 0) {
      let maxSeq = -1;
      for (const m of segs.values()) if (m.dir === adir && m.seq > maxSeq) maxSeq = m.seq;
      if (maxSeq >= 0) {
        segSeq = maxSeq;
        meta = segs.get(this.segKeyOf(adir, segFileName(projectId, segSeq)));
        if (meta) {
          // stat 守卫（V2 补强——SegmentMeta.goodBytes 注记的实现形态）：文件实际大小≠内存记账=
          // 外部写入/半写残留（内存丢失窗口的磁盘侧事实核验）→ 封段，追加滚动新段。
          const st = await stat(join(adir, segFileName(projectId, segSeq))).catch(() => null);
          if (st && st.size !== meta.bytes) meta.sealed = true;
          // V2 追加前守卫：段已封禁（sealed）或写入失败遗留半写尾（goodBytes≠bytes）或段满 → 滚动新段
          if (meta.sealed || meta.goodBytes !== meta.bytes
            || meta.bytes + FRAME_HEADER_BYTES + payload.byteLength > SEGMENT_MAX_BYTES) {
            segSeq += 1; meta = undefined;
          }
        }
      }
    }
    if (segSeq < 0) segSeq = 0;
    const isNewSegment = !meta;
    if (!meta) {
      meta = { frameCount: 0, goodBytes: 0, bytes: 0, confirmed: new Set(), confirmedCount: 0, sealed: false, quarantinedRange: null, quarantinedBytes: 0, dir: adir, seq: segSeq, foreign: false };
      if (!segs) this.index.set(projectId, new Map());
      this.index.get(projectId)!.set(this.segKeyOf(adir, segFileName(projectId, segSeq)), meta);
    }
    const frameIdx = meta.frameCount;
    const header = Buffer.alloc(FRAME_HEADER_BYTES);
    header.writeUInt32LE(payload.byteLength, 0);
    header.writeUInt32LE(crc32(Buffer.from(payload)) >>> 0, 4);
    const path = join(adir, segFileName(projectId, segSeq));
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
        segsNow.delete(this.segKeyOf(adir, segFileName(projectId, segSeq)));
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
        const dh = await open(adir, 'r');
        try { await dh.sync(); } catch { /* ENOTSUP（Windows）等——尽力而为，静默 */ } finally { await dh.close(); }
      } catch { /* 目录句柄打开失败同上——写已成功，忽略 */ }
    }
    return [`${this.segKeyOf(adir, segFileName(projectId, segSeq))}:${frameIdx}`];
  }

  /** 读全部未 confirm 好帧（以 index 的 frameCount=可解析帧数为界——坏尾的识别与隔离归 scan/
   *  quarantineTruncatedFrames；循环内解析失败=index 与文件不一致的 tripwire：计数+停读）。
   *  R3：段按 (seq 数字升序, dir 字典序) 确定性排序（跨 owner 顺序无语义——CRDT 幂等，排序只为测试稳定）；
   *  frameId=segKey:idx（跨 owner 段含目录前缀）。 */
  async peek(projectId: string): Promise<SpoolFrame[]> {
    const segs = this.index.get(projectId);
    if (!segs) return [];
    const frames: SpoolFrame[] = [];
    const ordered = [...segs.entries()].sort(([, a], [, b]) => a.seq - b.seq || (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
    for (const [, meta] of ordered) {
      let buf: Buffer;
      try { buf = await readFile(join(meta.dir, segFileName(projectId, meta.seq))); }
      catch { continue; }   // 段文件消失（已 unlink）——跳过
      const segKey = this.segKeyOf(meta.dir, segFileName(projectId, meta.seq));
      let off = 0; let idx = 0;
      while (idx < meta.frameCount) {
        if (off + FRAME_HEADER_BYTES > buf.byteLength) { this.reportTruncation(projectId, meta.seq); break; }
        const len = buf.readUInt32LE(off);
        if (off + FRAME_HEADER_BYTES + len > buf.byteLength) { this.reportTruncation(projectId, meta.seq); break; }
        const payload = buf.subarray(off + FRAME_HEADER_BYTES, off + FRAME_HEADER_BYTES + len);
        if ((crc32(payload) >>> 0) !== buf.readUInt32LE(off + 4)) { this.reportTruncation(projectId, meta.seq); break; }
        if (!meta.confirmed.has(idx)) frames.push({ frameId: `${segKey}:${idx}`, payload: new Uint8Array(payload) });
        off += FRAME_HEADER_BYTES + len; idx += 1;
      }
    }
    return frames;
  }

  /** confirm=append 成功后的记账性动作（契约 12：删帧恒在 append 成功之后——本方法不触 DB）。
   *  段回收判据（V3）：全部**可解析**帧（[0,frameCount)）confirmed ∧ 坏尾已处置
   *  （quarantinedRange 已记 ∨ 段尾本就干净 goodBytes===bytes）。
   *  R3：frameId 按 lastIndexOf(':') 解析 segKey+idx（segKey 含 '/' 无 ':'——跨 owner 段安全）；
   *  unlink 定位 meta.dir（跨 owner 段在前任子目录内）；空 owner 目录 rmdir（ENOTEMPTY 静默——
   *  下轮回收再试）。 */
  async confirm(projectId: string, frameIds: string[]): Promise<void> {
    const segs = this.index.get(projectId);
    if (!segs) return;
    for (const id of frameIds) {
      const c = id.lastIndexOf(':');
      const segKey = c < 0 ? id : id.slice(0, c);
      const n = Number(id.slice(c + 1));
      const m = segs.get(segKey);
      if (m && !m.confirmed.has(n)) { m.confirmed.add(n); m.confirmedCount += 1; }   // 收口4：去重+递增
    }
    for (const [segKey, meta] of [...segs.entries()]) {
      const allGoodConfirmed = meta.frameCount > 0 && meta.confirmedCount === meta.frameCount;   // 收口4：O(1) 判据
      const tailSettled = meta.quarantinedRange != null || meta.goodBytes === meta.bytes;
      if (!allGoodConfirmed || !tailSettled) continue;
      const file = join(meta.dir, segFileName(projectId, meta.seq));
      try { await unlink(file); } catch { /* 已消失 */ }
      try { await unlink(`${file}.quarantine`); } catch { /* 无 sidecar */ }
      if (meta.dir !== this.dir) await rmdir(meta.dir).catch(() => {});   // R3：空 owner 目录回收（ENOTEMPTY=还有段，静默）
      segs.delete(segKey);
    }
    if (segs.size === 0) this.index.delete(projectId);
    // I-3：容量滞回自评——confirm 是 depth 回落的观测点（段回收时）。解除时唤醒 onRecovered
    //（rearm 退避梯+受理面恢复——容量态下 X6 停排+X9 readOnly 在 PG 完全健康时也会死锁，需要显式
    // 恢复缝；与 ioBroken 探针闭合对称）。探针键排除——V14 裁定"探针无权关容量态"（probe 只证 IO，
    // 不因探针路径误关容量；真实段回收带来的 depth 回落才解除）。
    if (projectId !== '__probe__' && this.overCapacityFlag) {
      if (this.depthTotalBytes(this.depth()) <= this.capacityBytes * 0.9) {
        this.overCapacityFlag = false;
        this.logger.log('spool capacity recovered（confirm 时点自评）');
        try { this.onRecovered?.(); } catch { /* 同 noteWriteSuccess seam 形态：回调异常不损恢复事实 */ }
      }
    }
  }

  /** V3：坏帧段处置=**字节区间**隔离（坏帧起始偏移→EOF）——截断是字节事实非帧号集合
   *  （v1 的帧号循环在 scan 停读后 frameCount===firstBad=恒空循环，真 bug）；sidecar 记偏移区间；
   *  quarantinedBytes = byteLength - off（**含坏帧头**——v1 的 -8 off-by-8 实错）；重复调用不重复递增计数。
   *  R3：枚举走 listSpoolFiles 单源（root+owner 子目录），sidecar 与段同目录。 */
  async quarantineTruncatedFrames(projectId: string): Promise<number> {
    const segs = this.index.get(projectId);
    if (!segs) return 0;
    let newQuarantined = 0;
    for (const { dir, name: f } of await listSpoolFiles(this.dir)) {
      const parsed = parseSegFileName(f);
      if (!parsed || parsed.projectId !== projectId) continue;
      const meta = segs.get(this.segKeyOf(dir, f));
      if (!meta || meta.quarantinedRange != null) continue;             // 已隔离——不重复递增（V3）
      const buf = await readFile(join(dir, f));
      let off = 0;
      while (off + FRAME_HEADER_BYTES <= buf.byteLength) {
        const len = buf.readUInt32LE(off);
        if (off + FRAME_HEADER_BYTES + len > buf.byteLength || (crc32(buf.subarray(off + FRAME_HEADER_BYTES, off + FRAME_HEADER_BYTES + len)) >>> 0) !== buf.readUInt32LE(off + 4)) break;
        off += FRAME_HEADER_BYTES + len;
      }
      if (off >= buf.byteLength) continue;                     // 干净段
      // I1（质量审查 Important 1）：sidecar 先落盘后记账——写失败即异常上抛且 meta 三字段未动
      // （quarantinedRange 仍 null）：段保留、坏尾字节保留、下次调用重算 offset 重试（保守正确）。
      // 反序（先记账后落盘）在 ENOSPC 下内存已隔离而证据无持久记录→后续 confirm 判 tailSettled
      // 整段 unlink=取证事实销毁。close 失败不掩盖 write/sync 原因（吞掉——close 无增量信息）。
      const line = JSON.stringify({ segSeq: parsed.segSeq, quarantinedFromOffset: off, toOffset: buf.byteLength, reason: 'truncated-or-crc', firstSeenAt: new Date().toISOString() }) + '\n';
      const sc = await open(join(dir, `${f}.quarantine`), 'a');
      try {
        await sc.writeFile(line);
        await sc.sync();
      } finally {
        await sc.close().catch(() => {});
      }
      meta.quarantinedRange = { fromOffset: off };             // 区间事实：坏帧起始偏移→EOF（sidecar 落盘成功后才记）
      meta.sealed = true;                                      // V2：含坏尾的段封禁（永不再追加）
      meta.quarantinedBytes = buf.byteLength - off;
      newQuarantined += 1;
    }
    if (newQuarantined > 0) yjsSpoolQuarantinedTotal.inc(newQuarantined);
    return newQuarantined;
  }

  /** 帧循环单源（W21）：scan/adoptSilentForeignSegments 共用——返回可解析帧数/好字节/是否坏尾。
   *  好帧后 1-7B 残尾（收口2）与 len/CRC 坏帧同判 truncated。 */
  private parseSegmentFrames(buf: Buffer): { frameCount: number; goodBytes: number; truncated: boolean } {
    let off = 0, frameCount = 0;
    while (off + FRAME_HEADER_BYTES <= buf.byteLength) {
      const len = buf.readUInt32LE(off);
      if (off + FRAME_HEADER_BYTES + len > buf.byteLength) return { frameCount, goodBytes: off, truncated: true };
      const payload = buf.subarray(off + FRAME_HEADER_BYTES, off + FRAME_HEADER_BYTES + len);
      if ((crc32(payload) >>> 0) !== buf.readUInt32LE(off + 4)) return { frameCount, goodBytes: off, truncated: true };
      off += FRAME_HEADER_BYTES + len; frameCount += 1;
    }
    return { frameCount, goodBytes: off, truncated: off !== buf.byteLength };
  }

  /** 启动扫描：重建 index（帧数/字节）——确认集丢失即幂等降级。返回坏帧段清单供启动隔离处置。
   *  Y17：truncated 段直接置 sealed（V2——scan 时已含坏尾，永不再追加）+goodBytes=首坏帧偏移；
   *  X8'：`__probe__*` 段崩溃残留直接 unlink（探针帧不进回灌/键集）。
   *  收口2：<8B 残片段（零帧零数据）直接回收；好帧循环后 off!==byteLength 即 1-7B 残尾——也进
   *  truncated 报告（坏尾必有可观测面）。
   *  R3：枚举走 listSpoolFiles（root+一级 owner 子目录）；Z13 owner 必填（activeDir 断点）；
   *  V3 临时 map 末尾整体 swap——中途抛错不留半截索引（P19 幂等重建不变量保持）；
   *  P18 截尾分档：本 owner 段坏尾=truncated 报告+计数；外来段坏尾=静默截断（sealed=true 不报告
   *  ——前任半写=常态，报告面只归本实例的故障）；外来段 boot 收养（scan 全量建账含 foreign）。 */
  async scan(): Promise<{ truncatedSegments: string[] }> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const adir = this.activeDir();   // Z13：owner 必填断点
    const next = new Map<string, Map<string, SegmentMeta>>();   // V3：临时 map 末尾整体 swap
    const truncatedSegments: string[] = [];
    for (const { dir, name: f } of await listSpoolFiles(this.dir)) {
      const parsed = parseSegFileName(f);
      if (!parsed) continue;
      if (parsed.projectId === '__probe__') { await unlink(join(dir, f)).catch(() => {}); continue; }
      const isForeign = dir !== adir;
      const buf = await readFile(join(dir, f));
      if (buf.byteLength < FRAME_HEADER_BYTES) {   // 收口2：<8B 残片段（0 字节/残片）——零帧零数据，直接回收
        await unlink(join(dir, f)).catch(() => {});
        continue;
      }
      const { frameCount, goodBytes, truncated } = this.parseSegmentFrames(buf);
      // P18 截尾分档：本 owner 段坏尾=报告+计数；外来段坏尾=静默截断（sealed 置位即够）
      if (truncated && !isForeign) {
        truncatedSegments.push(f);
        yjsSpoolTruncatedTotal.inc();   // scan 路径计数恰一次（peek 以 frameCount 为界不重读坏尾→无双计）
        this.logger.error(`spool truncated segment ${f} at startup scan——sealed+待隔离处置（Task 2 quarantineTruncatedFrames），计数+人工介入`);
      }
      const segs = next.get(parsed.projectId) ?? new Map<string, SegmentMeta>();
      segs.set(this.segKeyOf(dir, f), {
        frameCount, goodBytes, bytes: buf.byteLength,
        confirmed: new Set(), confirmedCount: 0, sealed: truncated, quarantinedRange: null, quarantinedBytes: 0,
        dir, seq: parsed.segSeq, foreign: isForeign,
      });
      next.set(parsed.projectId, segs);
    }
    this.index = next;   // P19 幂等重建不变量保持
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
      if (Date.now() > deadline) return { replayed, failed, discarded };   // I2：项目间守预算（PG 挂起下逐项目挂起 append 串行累加=稀释 5s 总预算）
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

  /** V15：构造后路径校验——**本方法只管路径形态**（Y0a-4 重定语义：危险=**显式配置**（COLLAB_SPOOL_DIR）
   *  相对路径，与"是否生产"无关——CWD 漂移=静默换账本；构造参数（测试 DI）与本地默认值（恒绝对）不在此判）；
   *  目录可用性（不存在/不可写）不在此判——由 scan() 抛错经 onModuleInit 不捕获实现 fail-fast。
   *  返回解析后的绝对路径供日志。 */
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
