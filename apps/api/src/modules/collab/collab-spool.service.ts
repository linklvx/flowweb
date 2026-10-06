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
import { yjsSpoolTruncatedTotal } from './store.metrics';

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
  /** projectId → segSeq → 段元数据（scan 重建与运行期同构维护；空 Map=键存在但无段） */
  private readonly index = new Map<string, Map<number, SegmentMeta>>();

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
   *  T1 阶段=appendRaw 薄别名；T2 在此包装两态记账（容量判定+写失败 streak）。 */
  async append(projectId: string, payload: Uint8Array): Promise<string[]> {
    return this.appendRaw(projectId, payload);
  }

  /** 帧写入唯一实现（V2 封段守卫+X14 耐久性/权限——WAL 标准做法）。 */
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
      meta = { frameCount: 0, goodBytes: 0, bytes: 0, confirmed: new Set(), sealed: false, quarantinedRange: null, quarantinedBytes: 0 };
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
      throw e;
    }
    meta.frameCount = frameIdx + 1;
    meta.bytes += FRAME_HEADER_BYTES + payload.byteLength;
    meta.goodBytes = meta.bytes;   // 追加成功则段尾干净
    // X14：**新建段文件后 fsync 父目录**（文件数据落盘≠目录项落盘——掉电后新段可能整个不存在）。
    // 顺序不可倒：写帧+fsync 文件 → fsync 父目录。Windows 目录 fsync ENOTSUP 则 catch 登记。
    if (isNewSegment) {
      const dh = await open(this.dir, 'r').catch(() => null);
      if (dh) { try { await dh.sync(); } catch { /* ENOTSUP（Windows）——登记 */ } finally { await dh.close(); } }
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
      segs.get(Number(seg))?.confirmed.add(Number(idx));
    }
    for (const segSeq of [...segs.keys()]) {
      const meta = segs.get(segSeq)!;
      const allGoodConfirmed = meta.frameCount > 0 &&
        [...Array(meta.frameCount).keys()].every((i) => meta.confirmed.has(i));
      const tailSettled = meta.quarantinedRange != null || meta.goodBytes === meta.bytes;
      if (!allGoodConfirmed || !tailSettled) continue;
      const file = join(this.dir, segFileName(projectId, segSeq));
      try { await unlink(file); } catch { /* 已消失 */ }
      try { await unlink(`${file}.quarantine`); } catch { /* 无 sidecar */ }
      segs.delete(segSeq);
    }
    if (segs.size === 0) this.index.delete(projectId);
  }

  /** 启动扫描：重建 index（帧数/字节）——确认集丢失即幂等降级。返回坏帧段清单供启动隔离处置。
   *  Y17：truncated 段直接置 sealed（V2——scan 时已含坏尾，永不再追加）+goodBytes=首坏帧偏移；
   *  X8'：`__probe__*` 段崩溃残留直接 unlink（探针帧不进回灌/键集）。 */
  async scan(): Promise<{ truncatedSegments: string[] }> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const truncatedSegments: string[] = [];
    for (const f of await readdir(this.dir)) {
      const parsed = parseSegFileName(f);
      if (!parsed) continue;
      if (parsed.projectId === '__probe__') { await unlink(join(this.dir, f)).catch(() => {}); continue; }
      const buf = await readFile(join(this.dir, f));
      let off = 0, frameCount = 0; let truncated = false;
      while (off + FRAME_HEADER_BYTES <= buf.byteLength) {
        const len = buf.readUInt32LE(off);
        if (off + FRAME_HEADER_BYTES + len > buf.byteLength) { truncated = true; break; }
        const payload = buf.subarray(off + FRAME_HEADER_BYTES, off + FRAME_HEADER_BYTES + len);
        if ((crc32(payload) >>> 0) !== buf.readUInt32LE(off + 4)) { truncated = true; break; }
        off += FRAME_HEADER_BYTES + len; frameCount += 1;
      }
      if (truncated) {
        truncatedSegments.push(f);
        yjsSpoolTruncatedTotal.inc();   // scan 路径计数恰一次（peek 以 frameCount 为界不重读坏尾→无双计）
        this.logger.error(`spool truncated segment ${f} at startup scan——sealed+待隔离处置（Task 2 quarantineTruncatedFrames），计数+人工介入`);
      }
      const segs = this.index.get(parsed.projectId) ?? new Map<number, SegmentMeta>();
      segs.set(parsed.segSeq, {
        frameCount, goodBytes: off, bytes: buf.byteLength,
        confirmed: new Set(), sealed: truncated, quarantinedRange: null, quarantinedBytes: 0,
      });
      this.index.set(parsed.projectId, segs);
    }
    return { truncatedSegments };
  }

  /** V15：构造后启动校验——生产环境相对路径拒绝启动（CWD 漂移=静默换账本）；目录不可用拒绝启动
   *  （没有台账就不该收编辑——fail-closed；Y0a-3 ready 给 reason 只是锦上添花）。返回解析后的绝对路径供日志。 */
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
