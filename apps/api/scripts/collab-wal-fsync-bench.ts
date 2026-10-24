// apps/api/scripts/collab-wal-fsync-bench.ts —— Y1c T0-C spike S4(a)（plan v1.7 Task 0/S4；spec v5.4 ⑱）：
// CollabProjectActor 原型管线（submit/drain ≤20ms/1MiB 批→一次 fsync→逐帧 apply→逐帧 resolve）
// 多项目 fsync 放大基线——10 项目×10 连接（100 并发提交者，闭路 ACK 节流），帧 1-16KiB 均匀随机，
// 拓扑对比：per-project（定形终态，每项目独立 log/writer/fsync）vs shard4（hash(projectId)%4 分片，
// 每片独立 writer/fsync）vs global（单 log 单 fsync 流——升级序末档）。
// SPIKE 工件：零生产码改动、不接生产（T9 落地 CollabProjectActor 时移植批凑窗/拓扑结论）。
// 段格式与 src/modules/collab/wal-segment-format.spike.spec.ts 同构（spike 级有意双份，T8 收敛单源）。
//
// 运行：pnpm --filter @flowweb/api exec tsx scripts/collab-wal-fsync-bench.ts
//   [--seconds 10] [--warmup 1.5] [--projects 10] [--conns 10] [--topologies=per-project,shard4,global] [--keep]
// 可选 env：UV_THREADPOOL_SIZE（fsync 走 libuv 线程池——默认 4；放大对比可 16 重跑）
//
// 平台注意（诚实记录）：本机 Windows NTFS——Node fsync=FlushFileBuffers（刷页缓存+元数据，
// 与 Linux fsync 语义/时延不同；OS/磁盘写缓存仍可能吸收部分刷盘）。生产=Linux ext4/xfs fsync
// ——本文数字为**拓扑对比性**（同机同负载三拓扑横向），非绝对时延。
import { createHash } from 'node:crypto';
import { FileHandle, mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

// ── 段格式（与 wal-segment-format.spike.spec.ts 同构） ──────────────────────────
const MAGIC = Buffer.from('FWWALS1\n', 'latin1');
const WAL_VERSION = 1;
const HEADER_SIZE = 164;
const FRAME_FIXED_BYTES = 52;

const encodeHeader = (owner: string, generation: number, historyId: string): Buffer => {
  const h = Buffer.alloc(HEADER_SIZE);
  MAGIC.copy(h, 0);
  h.writeUInt16LE(WAL_VERSION, 8);
  h.writeUInt16LE(HEADER_SIZE, 10);
  h.writeUInt32LE(generation, 12);
  h.write(owner, 16, 'utf8');
  h.write(historyId, 80, 'utf8');
  const now = Date.now();
  h.writeBigUInt64LE(BigInt(now), 144);
  h.writeBigUInt64LE(BigInt(now), 152);
  h.writeUInt32LE(crc32(h.subarray(0, 160)) >>> 0, 160);
  return h;
};

const encodeFrame = (walSeq: bigint, generation: number, payload: Buffer, frameHash: Buffer): Buffer => {
  const body = Buffer.alloc(44 + payload.length);
  body.writeBigUInt64LE(walSeq, 0);
  body.writeUInt32LE(generation, 8);
  frameHash.copy(body, 12);
  payload.copy(body, 44);
  const out = Buffer.alloc(FRAME_FIXED_BYTES + payload.length);
  out.writeUInt32LE(payload.length, 0);
  out.writeUInt32LE(crc32(body) >>> 0, 4);
  body.copy(out, 8);
  return out;
};

// ── 装置参数 ─────────────────────────────────────────────────────────────────
interface Opts { seconds: number; warmupSeconds: number; projects: number; connsPerProject: number; topologies: string[]; keep: boolean }
const argNum = (name: string, dflt: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
};
const OPTS: Opts = {
  seconds: argNum('seconds', 10),
  warmupSeconds: argNum('warmup', 1.5),
  projects: argNum('projects', 10),
  connsPerProject: argNum('conns', 10),
  topologies: (process.argv.find((a) => a.startsWith('--topologies='))?.slice('--topologies='.length) ?? 'per-project,shard4,global').split(','),
  keep: process.argv.includes('--keep'),
};
const BATCH_WINDOW_MS = 20;            // T9 批窗上界（plan v1.7 ②：≤20ms）
const BATCH_MAX_BYTES = 1024 * 1024;   // T9 批字节上界（plan v1.7 ②：≤1MiB）
const LINGER_POLL_MS = 1;              // 空闲判定：1ms 无新到帧即收批（批窗=上界非 dwell——轻载不空等 20ms）
const hrnow = (): number => performance.now();
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 确定性 PRNG（mulberry32）——同一 (project,conn) 种子恒定 ⇒ 三拓扑负载逐帧同分布（可比性） */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** 内容池：64×16KiB 随机字节（提交时 subarray 到目标尺寸——内容生成不进热路径） */
const CONTENT_POOL: Buffer[] = Array.from({ length: 64 }, (_, i) => {
  const b = Buffer.alloc(16 * 1024);
  const rnd = mulberry32(0x5eed ^ (i * 2654435761));
  for (let j = 0; j < b.length; j += 4) b.writeUInt32LE((rnd() * 4294967296) >>> 0, j);
  return b;
});

interface PendingFrame { projectId: string; idx: number; submitTs: number; payload: Buffer; hash: Buffer; measured: boolean; resolve: () => void }
interface ChannelStats { fsyncs: number; bytes: number; batches: number; frames: number }
const zeroStats = (): ChannelStats => ({ fsyncs: 0, bytes: 0, batches: 0, frames: 0 });

/** 单条 WAL 日志通道：FIFO 队列+单 drain 循环（凑批→一次 write→一次 fsync→逐帧 apply→resolve） */
class WalChannel {
  private readonly queue: PendingFrame[] = [];
  private running = true;
  private wake: (() => void) | null = null;
  private offset = HEADER_SIZE;
  private readonly stats: ChannelStats = zeroStats();
  private snap: ChannelStats | null = null;   // 首个含测量帧的批之前的水位（剥离预热）
  private readonly drainDone: Promise<void>;
  constructor(readonly name: string, private readonly fh: FileHandle,
    private readonly onApplied: (f: PendingFrame, queueWaitMs: number, durableTs: number) => void) {
    this.drainDone = this.drain();
  }
  enqueue(f: PendingFrame): void { this.queue.push(f); this.wake?.(); }
  private async drain(): Promise<void> {
    for (;;) {
      if (this.queue.length === 0) {
        if (!this.running) break;
        await new Promise<void>((r) => { this.wake = r; });
        this.wake = null;
        continue;
      }
      // 凑批：自批内最老帧起 ≤20ms / ≤1MiB / 空闲 1ms 即收（窗=上界：轻载不空等 20ms）
      const batch: PendingFrame[] = [];
      const queueWaits: number[] = [];
      let bytes = 0;
      const oldest = this.queue[0].submitTs;
      for (;;) {
        while (this.queue.length > 0 && bytes < BATCH_MAX_BYTES) {
          const it = this.queue.shift()!;
          batch.push(it);
          queueWaits.push(hrnow() - it.submitTs);
          bytes += it.payload.length + FRAME_FIXED_BYTES;
        }
        if (bytes >= BATCH_MAX_BYTES || hrnow() - oldest >= BATCH_WINDOW_MS) break;
        await sleep(LINGER_POLL_MS);
        if (this.queue.length === 0) break;
      }
      // 一次 WAL append（单 write：整批帧记录拼接）+ 段头 lastWriteAt/CRC 成对 pwrite + 一次 fsync
      const buf = Buffer.concat(batch.map((f) => encodeFrame(BigInt(f.idx + 1), 3, f.payload, f.hash)));
      await this.fh.write(buf, 0, buf.length, this.offset);
      this.offset += buf.length;
      const ts = Buffer.alloc(8);
      ts.writeBigUInt64LE(BigInt(Date.now()), 0);
      const { buffer: hdr } = await this.fh.read(Buffer.alloc(160), 0, 160, 0);
      const crc = crc32(Buffer.concat([hdr.subarray(0, 152), ts])) >>> 0;
      await this.fh.write(ts, 0, 8, 152);
      const crcBuf = Buffer.alloc(4);
      crcBuf.writeUInt32LE(crc, 0);
      await this.fh.write(crcBuf, 0, 4, 160);
      await this.fh.sync();   // 真 fsync（Windows=FlushFileBuffers）
      const durableTs = hrnow();
      if (this.snap === null && batch.some((f) => f.measured)) {
        // 水位取于本批计入前：边界批混入的预热帧污染 ≈1 批（<0.2% 测量窗——本负载 65-1240 批/s×10s 窗）
        this.snap = { ...this.stats };
      }
      this.stats.fsyncs++;
      this.stats.bytes += buf.length;
      this.stats.batches++;
      this.stats.frames += batch.length;
      for (let i = 0; i < batch.length; i++) this.onApplied(batch[i], queueWaits[i], durableTs);
    }
  }
  /** 测量窗统计（预热剥离；含收尾排干批——其帧均为测量窗内提交） */
  measuredStats(): ChannelStats {
    const s = this.snap ?? this.stats;
    return {
      fsyncs: this.stats.fsyncs - s.fsyncs, bytes: this.stats.bytes - s.bytes,
      batches: this.stats.batches - s.batches, frames: this.stats.frames - s.frames,
    };
  }
  async close(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.drainDone;
    await this.fh.close();
  }
}

// ── 拓扑运行器 ───────────────────────────────────────────────────────────────
type Topology = 'per-project' | 'shard4' | 'global';
const shardIndex = (projectId: string): number => (crc32(Buffer.from(projectId)) >>> 0) % 4;

interface RunResult {
  topology: string; channels: number; frames: number; mb: number; seconds: number;
  fsyncs: number; fsyncsPerSec: number; framesPerFsync: number; kbPerFsync: number;
  mbPerSec: number; framesPerSec: number;
  p50: number; p95: number; p99: number; maxLat: number;
  maxQueueWait: number; perProjectFramesMin: number; perProjectFramesMax: number;
  perChannelFsyncs: number[]; orderOk: boolean;
}
const percentile = (sorted: number[], p: number): number => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]);

async function runTopology(topology: Topology, root: string): Promise<RunResult> {
  const projects = Array.from({ length: OPTS.projects }, (_, i) => String(i));
  const chCount = topology === 'per-project' ? OPTS.projects : topology === 'shard4' ? 4 : 1;
  const channelName = (i: number): string => (topology === 'per-project' ? projects[i] : topology === 'shard4' ? `shard-${i}` : 'global');
  const channelOf = (projectId: string): number => (topology === 'per-project' ? Number(projectId) : topology === 'shard4' ? shardIndex(projectId) : 0);
  const dir = join(root, topology);
  await mkdir(dir, { recursive: true });
  // apply 侧（stub）：crc32 消费字节 + per-project 顺序验证（applied idx 必须严格连号）
  const appliedIdx = new Map<string, number>();
  let orderOk = true;
  const perProjectFrames = new Map<string, number>();
  const perProjectMaxQueueWait = new Map<string, number>();
  const latencies: number[] = [];
  const channels: WalChannel[] = [];
  for (let i = 0; i < chCount; i++) {
    const name = channelName(i);
    const subdir = topology === 'per-project' ? join(dir, name) : dir;
    if (topology === 'per-project') await mkdir(subdir, { recursive: true });   // <owner>/<projectId>/ 沿 spool 目录先例
    const path = join(subdir, 'seg0.wal');
    await writeFile(path, encodeHeader(name, 3, 'h-2026-10-24-a'));   // 新建段（头先行）。目录 fsync=T8 Linux 义务（doc §5 新建段纪律）——Windows 不可对目录句柄 fsync，原型未做（一次性成本不在稳态测量面）
    const fh: FileHandle = await open(path, 'r+');
    channels.push(new WalChannel(name, fh, (f, queueWaitMs) => {
      if (f.idx !== (appliedIdx.get(f.projectId) ?? 0)) orderOk = false;   // per-frame apply 顺序=per-project 提交顺序
      appliedIdx.set(f.projectId, f.idx + 1);
      crc32(f.payload);   // stub apply：消费字节（本 spike 测 I/O 拓扑——Yjs apply 成本不在测量面）
      perProjectFrames.set(f.projectId, (perProjectFrames.get(f.projectId) ?? 0) + 1);
      perProjectMaxQueueWait.set(f.projectId, Math.max(perProjectMaxQueueWait.get(f.projectId) ?? 0, queueWaitMs));
      f.resolve();
    }));
  }
  // 提交者：100 闭路循环（submit→await resolve→再 submit——ACK 节流客户端形态；无 think-time=持续满载）
  const submitCounts = new Map<string, number>();
  const startTs = hrnow();
  const measureStartTs = startTs + OPTS.warmupSeconds * 1000;
  const endTs = startTs + (OPTS.warmupSeconds + OPTS.seconds) * 1000;
  const runSubmitter = async (projectId: string, conn: number): Promise<void> => {
    const rnd = mulberry32((Number(projectId) + 1) * 7919 + conn * 104729 + 1);
    for (;;) {
      const now = hrnow();
      if (now >= endTs) break;
      const size = 1024 + Math.floor(rnd() * 15 * 1024);   // 1..16KiB 均匀
      const content = CONTENT_POOL[Math.floor(rnd() * CONTENT_POOL.length)].subarray(0, size);
      const idx = submitCounts.get(projectId) ?? 0;
      submitCounts.set(projectId, idx + 1);
      const submitTs = hrnow();
      const measured = submitTs >= measureStartTs;
      const ch = channels[channelOf(projectId)];
      await new Promise<void>((resolvePromise) => {
        ch.enqueue({
          projectId, idx, submitTs, payload: content, measured,
          hash: createHash('sha256').update(content).digest(),
          resolve: () => { if (measured) latencies.push(hrnow() - submitTs); resolvePromise(); },
        });
      });
    }
  };
  const submitters: Promise<void>[] = [];
  for (const p of projects) for (let c = 0; c < OPTS.connsPerProject; c++) submitters.push(runSubmitter(p, c));
  await Promise.all(submitters);
  const wallSeconds = (hrnow() - measureStartTs) / 1000;
  for (const ch of channels) await ch.close();
  const m = channels.map((c) => c.measuredStats());
  const fsyncs = m.reduce((a, c) => a + c.fsyncs, 0);
  const bytes = m.reduce((a, c) => a + c.bytes, 0);
  const frames = m.reduce((a, c) => a + c.frames, 0);
  const lat = latencies.slice().sort((a, b) => a - b);
  const perProj = projects.map((p) => perProjectFrames.get(p) ?? 0);
  return {
    topology, channels: chCount, frames, mb: bytes / 1024 / 1024, seconds: wallSeconds,
    fsyncs, fsyncsPerSec: fsyncs / wallSeconds, framesPerFsync: frames / Math.max(1, fsyncs), kbPerFsync: bytes / Math.max(1, fsyncs) / 1024,
    mbPerSec: bytes / 1024 / 1024 / wallSeconds, framesPerSec: frames / wallSeconds,
    p50: percentile(lat, 50), p95: percentile(lat, 95), p99: percentile(lat, 99), maxLat: lat.length > 0 ? lat[lat.length - 1] : 0,
    maxQueueWait: Math.max(0, ...projects.map((p) => perProjectMaxQueueWait.get(p) ?? 0)),
    perProjectFramesMin: Math.min(...perProj), perProjectFramesMax: Math.max(...perProj),
    perChannelFsyncs: m.map((c) => c.fsyncs), orderOk,
  };
}

// ── main ─────────────────────────────────────────────────────────────────────
const ALL_TOPOLOGIES: readonly Topology[] = ['per-project', 'shard4', 'global'];
const fmt = (n: number, d = 1): string => n.toFixed(d);
async function main(): Promise<void> {
  // 拓扑 allowlist：拼错须响亮报错（否则经 `t as Topology` 落进 global 分支静默测错对象）
  for (const t of OPTS.topologies) {
    if (!(ALL_TOPOLOGIES as readonly string[]).includes(t)) throw new Error(`未知拓扑: ${t}（可选 ${ALL_TOPOLOGIES.join('/')}）`);
  }
  const root = await mkdtemp(join(tmpdir(), 'y1c-s4-bench-'));
  console.log(`# Y1c T0-C S4(a) WAL fsync 放大基线（actor 原型管线）
# 平台: ${process.platform} ${process.arch} | node ${process.version} | UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE ?? '4(默认)'}
# fsync 语义: ${process.platform === 'win32' ? 'FlushFileBuffers(NTFS)——与 Linux fsync 不同；数字为拓扑对比性非绝对' : 'fsync'}
# 负载: ${OPTS.projects} 项目×${OPTS.connsPerProject} 连接（闭路 ACK 节流）| 帧 1-16KiB 均匀随机 | 批窗 ≤${BATCH_WINDOW_MS}ms/≤${BATCH_MAX_BYTES / 1024}KiB | 测量窗 ${OPTS.seconds}s（预热 ${OPTS.warmupSeconds}s 剥离）
# 数据目录: ${root}`);
  try {
    const results: RunResult[] = [];
    for (const t of OPTS.topologies) {
      const r = await runTopology(t as Topology, root);
      results.push(r);
      console.log(`
=== ${r.topology}（${r.channels} 通道=独立 writer/fsync） ===
  吞吐      : ${fmt(r.frames, 0)} 帧 | ${fmt(r.mb, 2)} MiB | ${fmt(r.framesPerSec, 0)} 帧/s | ${fmt(r.mbPerSec, 2)} MiB/s
  fsync 放大 : ${fmt(r.fsyncs, 0)} 次 | ${fmt(r.fsyncsPerSec, 1)} 次/s | ${fmt(r.framesPerFsync, 1)} 帧/fsync | ${fmt(r.kbPerFsync, 1)} KiB/fsync
  延迟 ms   : P50=${fmt(r.p50, 2)} P95=${fmt(r.p95, 2)} P99=${fmt(r.p99, 2)} max=${fmt(r.maxLat, 2)}（submit→resolve，测量窗）
  公平/饥饿 : per-project 帧 min/max=${r.perProjectFramesMin}/${r.perProjectFramesMax} | 最大排队等待=${fmt(r.maxQueueWait, 2)} ms
  通道 fsync : [${r.perChannelFsyncs.join(', ')}]
  顺序验证  : ${r.orderOk ? 'OK（每项目 applied idx 严格连号）' : 'FAIL'}`);
    }
    console.log(`
## 汇总（p95≤20ms 判据——升级序触发线）
| 拓扑 | 通道 | fsync/s | 帧/fsync | KiB/fsync | MiB/s | P50ms | P95ms | P99ms | max ms | 最大排队 ms | 顺序 |
|---|---|---|---|---|---|---|---|---|---|---|---|`);
    for (const r of results) {
      console.log(`| ${r.topology} | ${r.channels} | ${fmt(r.fsyncsPerSec, 1)} | ${fmt(r.framesPerFsync, 1)} | ${fmt(r.kbPerFsync, 1)} | ${fmt(r.mbPerSec, 2)} | ${fmt(r.p50, 2)} | ${fmt(r.p95, 2)} | ${fmt(r.p99, 2)} | ${fmt(r.maxLat, 2)} | ${fmt(r.maxQueueWait, 2)} | ${r.orderOk ? 'OK' : 'FAIL'} |`);
    }
  } finally {
    if (!OPTS.keep) await rm(root, { recursive: true, force: true });   // 失败路径同样清理临时目录
    else console.log(`\n# --keep：数据目录保留 ${root}`);
  }
}

void main();
