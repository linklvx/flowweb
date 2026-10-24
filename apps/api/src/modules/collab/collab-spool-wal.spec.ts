// Y1c Task 8：WAL 帧协议升级（spool 段头 v1.7+52B 帧+恢复扫描+fsync 分档）——TDD 红先行。
// 语料消费：packages/shared/src/testing/y1c-wal-fault-corpus.ts（七 fixture+两维期望——
// **声明式**：段格式实现单源=collab-spool.service.ts 编码器，本 spec 只物化字节跑恢复扫描）。
// 纪律：真文件/真 fsync（禁 mock fs——文件系统语义正是被测对象）；fsync 故障注入走
// protected seam（syncSegmentHandle——生产恒 fh.sync()，测试 subclass 注入 EIO/ENOSPC）。
// 修正 #6 铁律：时间戳栅栏=recoverySuspect 恢复怀疑态（自动扫描零重放），**永不**直接
// quarantine；historyId 不匹配才 quarantine。
// F-S4-5（ADR-01 §5 定形）：时间戳栅栏仅在恢复怀疑态求值（evaluateTimestampFence 门控）
// ——正常崩溃恢复不求值（长命 epoch 下段比 epoch 新=常态）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildWalFaultCorpus,
  WAL_FAULT_CORPUS_EPOCH_STARTED_AT_FLOOR_MS,
  type WalFaultInjection,
  type WalFrameFixtureInput,
  type WalSegmentHeader,
  type SystemHistoryState,
  type WalBadSegmentTier,
} from '@flowweb/shared';
import {
  CollabSpoolService,
  encodeWalSegmentBytes,
  walSegmentFileName,
} from './collab-spool.service';
import { makeSpoolDir } from '../../test-utils/spool-dir';

let dir: string; let cleanup: () => Promise<void>;
beforeEach(async () => { ({ dir, cleanup } = await makeSpoolDir('y1c-t8-wal-')); });
afterEach(async () => { await cleanup(); });

const OWNER = 't8-owner';
const HISTORY = 'h-t8-2026-10-24';
function svc(): CollabSpoolService {
  const s = new CollabSpoolService(dir);
  s.setOwner(OWNER);
  s.setWalHistory(HISTORY);
  return s;
}
/** 语料段文件落盘（owner 子目录+codec 单源物化）——返回 segKey 相对名 */
async function writeFixture(s: CollabSpoolService, header: WalSegmentHeader, frames: WalFrameFixtureInput[], fault?: WalFaultInjection): Promise<{ segKey: string; path: string }> {
  await mkdir(join(dir, OWNER), { recursive: true });
  const name = walSegmentFileName(header.projectId, header.generation, 0);
  const path = join(dir, OWNER, name);
  await writeFile(path, encodeWalSegmentBytes(header, frames, fault));
  return { segKey: `${OWNER}/${name}`, path };
}
const sysHistory = (over: Partial<SystemHistoryState> = {}): SystemHistoryState => ({
  historyId: HISTORY,
  epochStartedAtMs: WAL_FAULT_CORPUS_EPOCH_STARTED_AT_FLOOR_MS,
  ...over,
});

// ═══ 红组 A：坏段四档分类（语料驱动——crc/truncated/missing-seq/dup-hash）═══
describe('Y1c T8 红组 A：坏段四档分类+完整有效前缀重建（语料七 fixture）', () => {
  const corpus = buildWalFaultCorpus({ historyId: HISTORY });

  it.for(corpus)('%s（语料逐条）', async (fixture) => {
    const s = svc();
    const fenceOn = fixture.expectedQuarantine === 'timestamp-fence';   // 栅栏 fixture 须开求值门（F-S4-5 作用域）
    const { path } = await writeFixture(s, fixture.header, fixture.frames, fixture.fault);
    const preSize = (await stat(path)).size;
    const report = await s.recoverScan({ systemHistory: sysHistory(), pgSeq: () => 0n, ...(fenceOn ? { evaluateTimestampFence: true } : {}) });
    const pr = report.projects.find((p) => p.projectId === fixture.header.projectId);
    expect(pr, '项目报告存在').toBeDefined();
    expect(pr!.replayPrefix, '重放前缀=语料期望（无漏好帧/无收坏帧）').toEqual(fixture.expectedReplayPrefix);
    if (fixture.expectedBadTier != null) {
      expect(pr!.defects.some((d) => d.tier === fixture.expectedBadTier), `缺陷分档含 ${fixture.expectedBadTier}`).toBe(true);
    } else {
      expect(pr!.defects, '完好段零缺陷').toHaveLength(0);
    }
    // 修正 #6 两维分派
    if (fixture.expectedQuarantine === 'history-mismatch') {
      expect(pr!.quarantined.some((q) => q.reason === 'history-mismatch')).toBe(true);
      expect(pr!.recoverySuspect).toHaveLength(0);
    }
    if (fixture.expectedQuarantine === 'timestamp-fence') {
      expect(pr!.recoverySuspect.length, '时间戳栅栏=recoverySuspect（修正 #6——非 quarantine）').toBeGreaterThan(0);
      expect(pr!.quarantined, '时间戳栅栏永不直接 quarantine').toHaveLength(0);
    }
    // 致命缺陷段=截断到 last-good（完整有效前缀截断）；良性 dup 不截断——非栅栏/非隔离段
    const hasFatal = pr!.defects.some((d) => d.fatal);
    const postSize = (await stat(path)).size;
    if (fixture.expectedQuarantine == null && hasFatal) {
      expect(postSize, '致命缺陷→文件截断到 last-good').toBeLessThan(preSize);
      const r2 = await s.recoverScan({ systemHistory: sysHistory(), pgSeq: () => 0n });
      const pr2 = r2.projects.find((p) => p.projectId === fixture.header.projectId)!;
      expect(pr2.defects.map((d) => d.kind).filter((k) => k !== 'dup-seq' && k !== 'dup-hash'), '截断后重扫零致命缺陷').toHaveLength(0);
    } else if (fixture.expectedQuarantine == null) {
      expect(postSize, '完好/良性段零截断').toBe(preSize);
    }
  });
});

// ═══ 红组 A′：WAL 损坏只允许丢 walSeq>pgSeq 的帧（PG 前缀校验）═══
describe('Y1c T8 红组 A′：PG 前缀校验（丢帧合法性=仅 walSeq>pgSeq）', () => {
  const corpus = buildWalFaultCorpus({ historyId: HISTORY });
  const badCrc = corpus.find((f) => f.expectedBadTier === 'bad-crc')!;

  it('致命缺陷丢的全是 walSeq>pgSeq 帧（lastGoodSeq=2≥pgSeq=2）→ 截断续跑零 violation', async () => {
    const s = svc();
    const { path } = await writeFixture(s, badCrc.header, badCrc.frames, badCrc.fault);
    const preSize = (await stat(path)).size;
    const report = await s.recoverScan({ systemHistory: sysHistory(), pgSeq: () => 2n });
    const pr = report.projects[0];
    expect(pr.pgPrefixViolation).toHaveLength(0);
    expect((await stat(path)).size, '已截断到 last-good').toBeLessThan(preSize);   // 丢帧全为 walSeq=3>pgSeq=2
  });

  it('lastGoodSeq=2<pgSeq=3（PG 已提交帧 WAL 无法证明）→ violation 上报+整段隔离保证据（禁截断）', async () => {
    const s = svc();
    const { path } = await writeFixture(s, badCrc.header, badCrc.frames, badCrc.fault);
    const preSize = (await stat(path)).size;
    const report = await s.recoverScan({ systemHistory: sysHistory(), pgSeq: () => 3n });
    const pr = report.projects[0];
    expect(pr.pgPrefixViolation.length, 'violation 上报').toBe(1);
    expect(pr.pgPrefixViolation[0].pgSeq).toBe(3n);
    expect((await stat(path)).size, '证据保留——violation 段不截断').toBe(preSize);
    expect(pr.replayPrefix, 'violation 段零重放').toEqual([]);
  });
});

// ═══ 红组 B：historyId 不匹配段 quarantine（bump 后旧段禁重放——跨重启）═══
describe('Y1c T8 红组 B：historyId 不匹配→整段 quarantine fail-closed', () => {
  it('historyId≠SystemHistory→quarantine+零帧重放+sidecar 跨重启禁重放', async () => {
    const corpus = buildWalFaultCorpus({ historyId: HISTORY });
    const fx = corpus.find((f) => f.expectedQuarantine === 'history-mismatch')!;
    const s = svc();
    await writeFixture(s, fx.header, fx.frames, fx.fault);
    const report = await s.recoverScan({ systemHistory: sysHistory(), pgSeq: () => 0n });
    const pr = report.projects[0];
    expect(pr.quarantined.map((q) => q.reason)).toEqual(['history-mismatch']);
    expect(pr.replayPrefix).toEqual([]);
    expect(pr.recoverySuspect).toHaveLength(0);
    // 跨重启：sidecar 整段隔离记录——旧链 scan() 不得复活旧段帧（bump 后旧段禁重放）
    const s2 = svc();
    await s2.scan();
    expect(await s2.peek(fx.header.projectId)).toHaveLength(0);
  });

  it('--adopt-wal 窄窗只救 recoverySuspect：history-mismatch 段即使 adoptSuspect=true 仍 quarantine（不自动修复）', async () => {
    const corpus = buildWalFaultCorpus({ historyId: HISTORY });
    const fx = corpus.find((f) => f.expectedQuarantine === 'history-mismatch')!;
    const s = svc();
    await writeFixture(s, fx.header, fx.frames, fx.fault);
    const report = await s.recoverScan({ systemHistory: sysHistory(), pgSeq: () => 0n, adoptSuspect: true });
    expect(report.projects[0].quarantined.map((q) => q.reason)).toEqual(['history-mismatch']);
  });
});

// ═══ 红组 C：lastWriteAt 时间戳栅栏→recoverySuspect（修正 #6）+F-S4-5 作用域 ═══
describe('Y1c T8 红组 C：时间戳栅栏（忘 bump 形态）——recoverySuspect 非 quarantine', () => {
  const corpus = buildWalFaultCorpus({ historyId: HISTORY });
  const fx = corpus.find((f) => f.expectedQuarantine === 'timestamp-fence')!;

  it('恢复怀疑态（开求值门）：段比 epoch 新→recoverySuspect+自动扫描零重放+不隔离不截断', async () => {
    const s = svc();
    const { path } = await writeFixture(s, fx.header, fx.frames, fx.fault);
    const preSize = (await stat(path)).size;
    const report = await s.recoverScan({ systemHistory: sysHistory(), pgSeq: () => 0n, evaluateTimestampFence: true });
    const pr = report.projects[0];
    expect(pr.recoverySuspect.length).toBe(1);
    expect(pr.recoverySuspect[0].lastWriteAtMs).toBe(fx.header.lastWriteAtMs);
    expect(pr.replayPrefix, '自动扫描零重放（重放归恢复流裁定）').toEqual([]);
    expect(pr.quarantined, '修正 #6：永不直接 quarantine').toHaveLength(0);
    expect((await stat(path)).size, '怀疑段不截断（裁定归恢复流）').toBe(preSize);
  });

  it('正常崩溃恢复（F-S4-5：不求值时间戳栅栏）：段比 epoch 新=长命 epoch 常态→正常收养', async () => {
    const s = svc();
    await writeFixture(s, fx.header, fx.frames, fx.fault);
    const report = await s.recoverScan({ systemHistory: sysHistory(), pgSeq: () => 0n });   // evaluateTimestampFence 缺省 false
    const pr = report.projects[0];
    expect(pr.recoverySuspect).toHaveLength(0);
    expect(pr.replayPrefix).toEqual(fx.frames.map((f) => f.walSeq));
  });

  it('--adopt-wal 窄窗（historyId 已匹配+operator 确认）：recoverySuspect 段收养重放', async () => {
    const s = svc();
    await writeFixture(s, fx.header, fx.frames, fx.fault);
    const report = await s.recoverScan({ systemHistory: sysHistory(), pgSeq: () => 0n, evaluateTimestampFence: true, adoptSuspect: true });
    const pr = report.projects[0];
    expect(pr.recoverySuspect).toHaveLength(0);
    expect(pr.replayPrefix).toEqual(fx.frames.map((f) => f.walSeq));
  });
});

// ═══ 红组 D：fsync 分档——EIO fail-stop（不截断不复用）/ENOSPC 截断复用 ═══
/** fsync 故障注入（protected seam syncSegmentHandle——生产恒 fh.sync()；toggle 注入一次）。 */
class FaultSpool extends CollabSpoolService {
  failNextSync: string | null = null;
  constructor(d: string) { super(d); }
  protected async syncSegmentHandle(fh: import('node:fs/promises').FileHandle): Promise<void> {
    if (this.failNextSync) {
      const code = this.failNextSync;
      this.failNextSync = null;
      throw Object.assign(new Error(`simulated ${code}`), { code });
    }
    await fh.sync();
  }
}

describe('Y1c T8 红组 D：fsync 分档（EIO fail-stop / ENOSPC 截断回 last-good+复用 seq）', () => {
  it('EIO=fail-stop：walHealthy=false+停收+段不截断+seq 不复用（不进复用路径）+wal_fsync_error_total{device,tier=EIO}', async () => {
    const metric = async () => {
      const reg = (await import('prom-client')).register;
      const m = reg.getSingleMetric('wal_fsync_error_total')!;
      const v = (await m.get()).values;
      return v.filter((x) => (x.labels as Record<string, string>).tier === 'EIO').reduce((a, b) => a + (b.value ?? 0), 0);
    };
    const before = await metric();
    const s = new FaultSpool(dir);
    s.setOwner(OWNER); s.setWalHistory(HISTORY);
    await s.append('p1', new Uint8Array([1, 2, 3]));                       // 好
    expect(s.walHealthy()).toBe(true);
    const segPath = join(dir, OWNER, walSegmentFileName('p1', 1, 0));
    const sizeAfterGood = (await stat(segPath)).size;
    const nextSeqBefore = s.peekNextWalSeq('p1');
    s.failNextSync = 'EIO';
    await expect(s.append('p1', new Uint8Array([4, 5, 6]))).rejects.toThrow(/EIO/);
    expect(s.walHealthy(), 'EIO→walHealthy=false（fail-stop）').toBe(false);
    expect(s.isWritable(), '停收').toBe(false);
    const nextSeqAfter = s.peekNextWalSeq('p1');
    expect(nextSeqAfter, 'seq 不复用（fail-stop 不进复用路径——烧号防 dup-seq）').toBe(nextSeqBefore + 1n);
    expect((await stat(segPath)).size, '段不截断（证据保留——重启+磁盘检查后恢复扫描裁定）').toBeGreaterThan(sizeAfterGood);
    await expect(s.append('p1', new Uint8Array([7]))).rejects.toThrow(/wal.*(unhealthy|fail-stop)|EIO/i);
    expect((await metric()) - before, 'wal_fsync_error_total{device,tier=EIO} 递增').toBe(1);
  });

  it('ENOSPC=可恢复档：截断回 last-good+复用已分配 seq（不留洞）+恢复后续写成功', async () => {
    const s = new FaultSpool(dir);
    s.setOwner(OWNER); s.setWalHistory(HISTORY);
    await s.append('p1', new Uint8Array([1, 2, 3]));
    const segPath = join(dir, OWNER, walSegmentFileName('p1', 1, 0));
    const sizeAfterGood = (await stat(segPath)).size;
    const nextSeqBefore = s.peekNextWalSeq('p1');
    s.failNextSync = 'ENOSPC';
    await expect(s.append('p1', new Uint8Array([4, 5, 6]))).rejects.toThrow(/ENOSPC/);
    expect(s.walHealthy(), 'ENOSPC 可恢复档——walHealthy 仍 true').toBe(true);
    expect((await stat(segPath)).size, '截断回 last-good（半写尾清除）').toBe(sizeAfterGood);
    expect(s.peekNextWalSeq('p1'), '复用已分配未落盘 seq（不留洞）').toBe(nextSeqBefore);
    const ids = await s.append('p1', new Uint8Array([4, 5, 6]));           // 无注入→成功（复用 seq）
    expect(ids).toHaveLength(1);
    const frames = await s.peek('p1');
    expect(frames.map((f) => Array.from(f.payload))).toEqual([[1, 2, 3], [4, 5, 6]]);
  });
});

// ═══ 红组 E：帧协议本体（walSeq 去重/换带 generation/水位/换代切段/启动重建）═══
describe('Y1c T8 红组 E：帧协议本体——SHA-256 去重+per-project walSeq+generation+换代切段', () => {
  it('同 payload 去重：第二次 append 返回原 frameId+零新帧+零新 seq；不同 payload 序号连续', async () => {
    const s = svc();
    const p = new Uint8Array([1, 2, 3, 4]);
    const id1 = await s.append('p1', p);
    const id2 = await s.append('p1', new Uint8Array(p));                   // 同字节（共享 buffer 防线归 T9 字节 copy——此处同内容）
    expect(id2, '去重命中=原 frameId').toEqual(id1);
    const files = (await readdir(join(dir, OWNER))).filter((f) => f.endsWith('.spool'));
    const buf = await readFile(join(dir, OWNER, files[0]));
    expect(files).toHaveLength(1);
    expect(buf.subarray(0, 8).toString('latin1')).toBe('FWWALS1\n');       // 段头 magic（v1.7 布局）
    const frames = await s.peek('p1');
    expect(frames).toHaveLength(1);                                        // 零新帧
    const q = new Uint8Array([9]);
    await s.append('p1', q);
    expect(await s.peek('p1')).toHaveLength(2);
    expect(s.peekNextWalSeq('p1')).toBe(3n);                               // seq 1,2 连续（去重不烧号）
  });

  it('启动重建：scan 重建 walSeq 续号+有界去重索引（跨重启零重复 walSeq）', async () => {
    const s1 = svc();
    const p = new Uint8Array([5, 5, 5]);
    const id1 = await s1.append('p1', p);
    await s1.append('p1', new Uint8Array([6]));
    const s2 = svc();
    await s2.scan();
    expect(s2.peekNextWalSeq('p1'), '续号=maxWalSeq+1').toBe(3n);
    const id2 = await s2.append('p1', new Uint8Array(p));                  // 重启后同 payload
    expect(id2, '跨重启去重命中原 frameId').toEqual(id1);
    expect(await s2.peek('p1')).toHaveLength(2);                           // 零新帧
    expect(s2.peekNextWalSeq('p1')).toBe(3n);
  });

  it('换代切段：switchGeneration→旧段禁重放（跨重启）+新段 namespace g2+水位与去重重置', async () => {
    const s1 = svc();
    const p = new Uint8Array([7, 7]);
    await s1.append('p1', p);
    await s1.switchGeneration('p1', 2);
    expect(await s1.peek('p1'), '切代后旧段零重放').toHaveLength(0);
    expect(s1.peekNextWalSeq('p1'), '水位重置——新代自 1 起').toBe(1n);
    await s1.append('p1', new Uint8Array(p));                             // 同 payload 但新代——去重索引已清
    const files = (await readdir(join(dir, OWNER))).filter((f) => f.endsWith('.spool')).sort();
    expect(files.some((f) => f === walSegmentFileName('p1', 2, 0)), '新段 namespace g2').toBe(true);
    const s2 = svc();
    await s2.scan();
    const frames = await s2.peek('p1');
    expect(frames, '跨重启：g1 段 sidecar 禁重放+g2 段帧可回灌').toHaveLength(1);
    expect(frames[0].payload).toEqual(new Uint8Array(p));
    const w = s2.watermark('p1');
    expect(w, '水位三元在位').toBeDefined();
  });

  it('帧内携带 generation（段头≠帧 generation=隔离档 bad-crc）', async () => {
    const corpus = buildWalFaultCorpus({ historyId: HISTORY });
    const good = corpus[0];
    const header: WalSegmentHeader = { ...good.header };
    // 物化一个帧 generation=段头+1 的段（帧内一律携带 generation——换代混段检测）
    const frames: WalFrameFixtureInput[] = good.frames.map((f) => ({ ...f, generation: header.generation + 1 }));
    const s = svc();
    await writeFixture(s, header, frames);
    const report = await s.recoverScan({ systemHistory: sysHistory(), pgSeq: () => 0n });
    const pr = report.projects[0];
    expect(pr.defects.map((d) => d.kind)).toContain('generation-mismatch');
    expect(pr.replayPrefix).toEqual([]);
    expect(pr.defects.every((d) => (d.tier as WalBadSegmentTier) === 'bad-crc'), 'generation-mismatch 归 bad-crc 档（骗过 CRC 网的校验失败）').toBe(true);
  });

  it('坏段头（magic 撕裂/短文件/头 CRC 撕裂）→ bad-header 整段 quarantine', async () => {
    const corpus = buildWalFaultCorpus({ historyId: HISTORY });
    const good = corpus[0];
    for (const mutate of [
      (b: Buffer) => { b[3] ^= 0xff; return 'magic 撕裂'; },
      (b: Buffer) => { b[160] ^= 0xff; return '头 CRC 撕裂'; },
    ] as const) {
      const s = svc();
      const bytes = encodeWalSegmentBytes(good.header, good.frames);
      const label = mutate(bytes);
      const name = walSegmentFileName(good.header.projectId, good.header.generation, 0);
      await mkdir(join(dir, OWNER), { recursive: true });
      await writeFile(join(dir, OWNER, name), bytes);
      const report = await s.recoverScan({ systemHistory: sysHistory(), pgSeq: () => 0n });
      const pr = report.projects[0];
      expect(pr.quarantined.map((q) => q.reason), `${label}→bad-header`).toContain('bad-header');
      expect(pr.replayPrefix).toEqual([]);
    }
    const s3 = svc();
    await writeFile(join(dir, OWNER, walSegmentFileName(good.header.projectId, good.header.generation, 0)), Buffer.alloc(100));   // 短文件
    const r3 = await s3.recoverScan({ systemHistory: sysHistory(), pgSeq: () => 0n });
    expect(r3.projects[0].quarantined.map((q) => q.reason)).toContain('bad-header');
  });
});
