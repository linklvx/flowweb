// Y1c Task 8：WAL 帧协议升级（spool 段头 v1.7+52B 帧+恢复扫描+fsync 分档）——TDD 红先行。
// 语料消费：packages/shared/src/testing/y1c-wal-fault-corpus.ts（七 fixture+两维期望——
// **声明式**：段格式实现单源=collab-spool.service.ts 编码器，本 spec 只物化字节跑恢复扫描）。
// 纪律：真文件/真 fsync（禁 mock fs——文件系统语义正是被测对象）；fsync 故障注入走
// protected seam（syncSegmentHandle——生产恒 fh.sync()，测试 subclass 注入 EIO/ENOSPC）。
// 修正 #6 铁律：时间戳栅栏=recoverySuspect 恢复怀疑态（自动扫描零重放），**永不**直接
// quarantine；historyId 不匹配才 quarantine。
// F-S4-5（ADR-01 §5 定形）：时间戳栅栏仅在恢复怀疑态求值（evaluateTimestampFence 门控）
// ——正常崩溃恢复不求值（长命 epoch 下段比 epoch 新=常态）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildWalFaultCorpus,
  walFixturePayload,
  WAL_FAULT_CORPUS_EPOCH_STARTED_AT_FLOOR_MS,
  WAL_DEDUP_INDEX_MAX_ENTRIES,
  WAL_DEDUP_INDEX_TTL_MS,
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
  parseSegFileName,
  decodeWalSegmentHeader,
} from './collab-spool.service';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createMockRepo } from '../../test-utils/mock-repo';

// M1 红测前置：truncate 故障注入缝（globalThis 钩子缺省失活——仅 M1 用例窗口内指向段路径；
// 其余用例零行为差——展开 actual 仅包 truncate）。真文件纪律不破：截断失败注入=物理盘不可
// 确定性复现（Windows 只读属性在 open('r+') 即先败），故取模块缝。
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    truncate: (async (path: unknown, len: number) => {
      const failPath = (globalThis as { __spoolTruncateFailPath?: string }).__spoolTruncateFailPath;
      if (failPath && String(path) === failPath) {
        throw Object.assign(new Error('simulated truncate ENOSPC'), { code: 'ENOSPC' });
      }
      return actual.truncate(path as Parameters<typeof actual.truncate>[0], len);
    }) as typeof actual.truncate,
  };
});

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
/** 语料段文件落盘（owner 子目录+codec 单源物化）——返回 segKey 相对名（segSeq 缺省 0） */
async function writeFixture(s: CollabSpoolService, header: WalSegmentHeader, frames: WalFrameFixtureInput[], fault?: WalFaultInjection, segSeq = 0): Promise<{ segKey: string; path: string }> {
  await mkdir(join(dir, OWNER), { recursive: true });
  const name = walSegmentFileName(header.projectId, header.generation, segSeq);
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

  it('R2（复核 Minor）：\'wx\' 新段首帧 ENOSPC 回滚——空 164B 头段文件顺手 unlink（无孤儿）+seq 复用不变', async () => {
    const s = new FaultSpool(dir);
    s.setOwner(OWNER); s.setWalHistory(HISTORY);
    await s.append('p1', new Uint8Array([1, 2, 3]));                       // 段 0 好（回滚基准）
    const nextSeqBefore = s.peekNextWalSeq('p1');
    s.failNextSync = 'ENOSPC';
    // 4MiB payload 撑爆段滚动上限（SEGMENT_MAX_BYTES）→ 本次 append 必 'wx' 新建段 1（首帧即失败档）
    await expect(s.append('p1', new Uint8Array(4 * 1024 * 1024))).rejects.toThrow(/ENOSPC/);
    expect(s.walHealthy(), 'ENOSPC 可恢复档——walHealthy 仍 true').toBe(true);
    const segFiles = (await readdir(join(dir, OWNER))).filter((f) => f.endsWith('.spool'));
    expect(segFiles, '回滚后目录无新段文件（旧实现留 164B 空头孤儿——frameCount=0 永不满足 confirm 回收判据必红）')
      .toEqual([walSegmentFileName('p1', 1, 0)]);
    expect(s.peekNextWalSeq('p1'), 'seq 复用不变（截断档语义——空孤儿无证据价值按档分处置）').toBe(nextSeqBefore);
    expect(await s.peek('p1'), '段 0 帧无损').toHaveLength(1);
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

  it('C1① PG 播种（T11 双评审 Critical）：seedWalSeqFromPg=max(当前值, pgSeq+1)——段全回收计数器抬底/幸存段重建值更高不回拨/null 缝 no-op', async () => {
    const s = svc();
    expect(s.peekNextWalSeq('p1')).toBe(1n);          // 段全回收+scan 面零段=1n（根因链钉锚）
    s.seedWalSeqFromPg('p1', 3n);                     // pgSeq=3 → 播种 4
    expect(s.peekNextWalSeq('p1')).toBe(4n);
    s.seedWalSeqFromPg('p1', 1n);                     // 更低 PG 值不回拨（max 语义）
    expect(s.peekNextWalSeq('p1')).toBe(4n);
    s.seedWalSeqFromPg('p1', null);                   // 懒建档行缺失缝
    s.seedWalSeqFromPg('p1', undefined);
    expect(s.peekNextWalSeq('p1')).toBe(4n);
    const s2 = svc();
    await s2.append('p2', new Uint8Array([1]));
    await s2.append('p2', new Uint8Array([2]));
    const s3 = svc();
    await s3.scan();                                  // 幸存段重建=3（未落 PG 帧由段承载）
    s3.seedWalSeqFromPg('p2', 1n);                    // pgSeq 落后于段面——播种不得压顶
    expect(s3.peekNextWalSeq('p2'), 'max 语义：scan 重建值（3）> pgSeq+1（2）').toBe(3n);
  });

  it('换代切段（Y1c T12 落定=跨代连续 seq——I2/Q-I2 三对齐）：switchGeneration→旧段禁重放（含未提交帧段 sidecar 保全）+新段 namespace g2+计数器/水位保留+去重索引清族', async () => {
    const s1 = svc();
    const p = new Uint8Array([7, 7]);
    await s1.append('p1', p);
    await s1.switchGeneration('p1', 2);
    expect(await s1.peek('p1'), '切代后旧段零重放').toHaveLength(0);
    // 连续 seq：计数器不重置（与 vacuumReplace 新代快照基线=旧代 maxSeq、C1① seedWalSeqFromPg〔pgSeq+1
    // 不分代〕三方单源——旧「重置自 1」形态废止：并存=新代帧落已发布基线之下=装载尾跳过〔C1 重置链〕）
    expect(s1.peekNextWalSeq('p1'), 'T12 连续 seq：计数器承接（帧 1 已分配——下一代帧自 2）').toBe(2n);
    expect(s1.watermark('p1')?.spoolHeadSeq, '水位保留（不归零——换代重置归 T27 SWITCHING 事务单入口）').toBe(1n);
    await s1.append('p1', new Uint8Array(p));                             // 同 payload 但新代——去重索引已清（新 walSeq 新帧）
    const files = (await readdir(join(dir, OWNER))).filter((f) => f.endsWith('.spool')).sort();
    expect(files.some((f) => f === walSegmentFileName('p1', 2, 0)), '新段 namespace g2').toBe(true);
    const s2 = svc();
    await s2.scan();
    const frames = await s2.peek('p1');
    expect(frames, '跨重启：g1 段 sidecar 禁重放+g2 段帧可回灌').toHaveLength(1);
    expect(frames[0].payload).toEqual(new Uint8Array(p));
    expect(frames[0].walSeq, '连续 seq：新代帧承接旧代计数器（=2 非 1）').toBe(2n);
    const w = s2.watermark('p1');
    expect(w, '水位三元在位').toBeDefined();
  });

  it('M3（T12 双评审，T13 落地）：空段换代即删——零帧零证据价值不写 sidecar 不滞留（红=空段 sidecar 滞留多次 vacuum 无界累积）；含未提交帧段 sidecar 保留策略锁定（证据保全）', async () => {
    // 空段（零帧）落 owner 目录——新段首帧失败档（R2）真实形态的等价物
    const s1 = svc();
    await writeFixture(s1, { projectId: 'p-m3', generation: 1, historyId: HISTORY, createdAtMs: Date.now(), lastWriteAtMs: Date.now() }, [], undefined, 0);
    const s2 = svc();
    await s2.scan();   // 空段入 index（scan permissive 零帧）
    const emptySeg = join(dir, OWNER, walSegmentFileName('p-m3', 1, 0));
    expect(existsSync(emptySeg), '装置前置：空段在盘').toBe(true);
    await s2.switchGeneration('p-m3', 2);
    expect(existsSync(emptySeg), '空段换代即删（无内容无证据价值）').toBe(false);
    expect(existsSync(`${emptySeg}.quarantine`), '空段不写 sidecar（滞留=多次 vacuum 无界累积）').toBe(false);
    // 未提交帧段保留策略（锁定锚——同用例钉死不漂移）：帧 walSeq>pgSeq（从未 Durable）→sidecar 持久隔离+文件保全
    const s3 = svc();
    await s3.append('p-m3b', new Uint8Array([9]));
    await s3.switchGeneration('p-m3b', 2);
    const uncommittedSeg = join(dir, OWNER, walSegmentFileName('p-m3b', 1, 0));
    expect(existsSync(uncommittedSeg), '含未提交帧段文件保全（证据）').toBe(true);
    expect(existsSync(`${uncommittedSeg}.quarantine`), 'sidecar 持久隔离（跨重启禁重放）').toBe(true);
    const s4 = svc();
    await s4.scan();
    expect(await s4.peek('p-m3b'), '未提交段跨重启禁重放（sidecar 识别）').toHaveLength(0);
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

// ═══ 红组 F：Y1c T8 双评审收口（spec 2I+4M + quality 1C+4I+6M 合并去重——逐条红先行）═══
describe('Y1c T8 收口 C1：段号命名空间碰撞——隔离段占名不覆写', () => {
  it('隔离段占用最高段号→append 不覆写（文件字节不变）+新段名递增', async () => {
    const s1 = svc();
    await s1.append('p1', new Uint8Array([1]));                       // 段 0
    const seg0 = join(dir, OWNER, walSegmentFileName('p1', 1, 0));
    // 整段隔离裁定在位（sidecar——跨重启禁重放）：隔离段占名 p1.g1.0.spool
    await writeFile(`${seg0}.quarantine`, `${JSON.stringify({ segSeq: 0, reason: 'history-mismatch', wholeSegment: true, firstSeenAt: new Date().toISOString() })}\n`);
    const bytesBefore = await readFile(seg0);
    const s2 = svc();
    await s2.scan();                                                  // sidecar → seg 0 segQuarantined
    await s2.append('p1', new Uint8Array([2]));
    expect((await readFile(seg0)).equals(bytesBefore), '隔离段字节不变（bad-header/裁定证据保全——旧实现 writeFile"w" 覆写必红）').toBe(true);
    expect(existsSync(join(dir, OWNER, walSegmentFileName('p1', 1, 1))), '新段名递增（隔离段占名只滚动不追加）').toBe(true);
    expect(await s2.peek('p1'), '隔离段零帧+新段 1 帧').toHaveLength(1);
  });

  it('双保险：盘上幻影段（index 未记账）→"wx"排他建+EEXIST 递增（旧 writeFile"w" 覆写未知段）', async () => {
    await mkdir(join(dir, OWNER), { recursive: true });
    const phantom = join(dir, OWNER, walSegmentFileName('p1', 1, 0));
    await writeFile(phantom, Buffer.alloc(200, 0xab));                // 未知占名段（崩溃残留/外部写入）
    const before = await readFile(phantom);
    const s = svc();
    await s.append('p1', new Uint8Array([1]));
    expect((await readFile(phantom)).equals(before), '幻影段字节不变').toBe(true);
    expect(existsSync(join(dir, OWNER, walSegmentFileName('p1', 1, 1))), 'EEXIST→段号递增落新段').toBe(true);
  });
});

// ═══ Y1c T9 双评审收口 S-I1（Important）：毒帧截断×去重索引互不作废=ACK 铁律破口 ═══
describe('Y1c T9 收口 S-I1：truncateWalAfter 逐被截帧清去重索引——重发同字节按新帧处理', () => {
  it('两帧批截断后段（appliedSeq=1 保留前缀）→ 重发第二帧=新 walSeq+真 WAL 写入；保留帧 dedup 仍命中', async () => {
    const s = svc();
    const f1 = new Uint8Array([1, 1, 1]);
    const f2 = new Uint8Array([2, 2, 2]);
    const appended = await s.appendBatch('p1', [f1, f2]);
    expect(appended.map((a) => a.walSeq)).toEqual([1n, 2n]);
    const removed = await s.truncateWalAfter('p1', 1n);   // 毒帧协议形态：保留 f1（applied），截 f2
    expect(removed).toBe(1);
    // 截断帧重发：必须按新帧处理——真 WAL 写入（dedupIndex 残留红相=零写返回已截 walSeq）
    // walSeq=复用被截 2n（Y1c T10 修正：truncateWalAfter 回拨续号——WAL 密集前缀=恢复链可证性前提，
    // scanWalSegmentBuffer gap 缺号 fatal；T9 旧「跳号 3n」=每次 recoverScan 链断截尾——G2 ⑦ 红）。
    const re2 = await s.appendBatch('p1', [new Uint8Array(f2)]);
    expect(re2[0].walSeq, '复用被截 walSeq（密集前缀——appliedSeq+1 下界）').toBe(2n);
    const frames = await s.peek('p1');
    expect(frames.map((fr) => fr.walSeq), 'WAL 真写入：peek=f1+新帧（红相=仅 f1）').toEqual([1n, 2n]);
    // 保留前缀帧条目不动（WAL 帧在——dedup 命中=no-op 语义正确）
    const re1 = await s.appendBatch('p1', [new Uint8Array(f1)]);
    expect(re1[0].walSeq, '保留帧 dedup 命中原 walSeq（截断只清被截帧）').toBe(1n);
    expect(await s.peek('p1'), '命中零写——帧数不变').toHaveLength(2);
  });

  it('整段截断（appliedSeq=0）→ 两帧条目全清，重发两帧均新 walSeq+真 WAL 写入', async () => {
    const s = svc();
    const f1 = new Uint8Array([5, 5]);
    const f2 = new Uint8Array([6, 6]);
    await s.appendBatch('p1', [f1, f2]);
    expect(await s.truncateWalAfter('p1', 0n)).toBe(2);
    const re = await s.appendBatch('p1', [new Uint8Array(f1), new Uint8Array(f2)]);
    expect(re.map((a) => a.walSeq), '两帧均复用被截 walSeq（1/2——零陈旧命中+密集前缀；T10 回拨修正）').toEqual([1n, 2n]);
    expect((await s.peek('p1')).map((fr) => fr.walSeq)).toEqual([1n, 2n]);
    expect(s.watermark('p1')!.spoolHeadSeq, 'spoolHead 随真写入推进').toBe(2n);
  });
});

// ═══ Y1c T9 复核收口 N1（Important）：上轮 S-I1 附带修复引入的回归——appendBatchRaw 写循环
// mutate frameCount（fsync 前），可恢复档回滚只还原 bytes/goodBytes→计数未回滚。后果三面：
// ①peek 假报「spool truncated」ERROR+yjs_spool_truncated_total 虚增；②confirmedCount 永达不到
// 虚高 frameCount→段进程内永不可回收；③truncateWalAfter removed 计数失真。 ═══
describe('Y1c T9 收口 N1：appendBatch 批 ENOSPC 回滚——frameCount 随 bytes 同步回批前值（peek 零假告警+段可回收）', () => {
  it('现有段 1 帧+新批 2 帧注入 ENOSPC→frameCount 回滚=原值（红相=3：字节回滚计数未回滚——复核员实证 {frameCount:3, seqsLen:1, bytes:218}）', async () => {
    const count = async () => { const m = (await import('prom-client')).register.getSingleMetric('yjs_spool_truncated_total')!; return (await m.get()).values[0]?.value ?? 0; };
    const before = await count();
    const s = new FaultSpool(dir);
    s.setOwner(OWNER); s.setWalHistory(HISTORY);
    const first = await s.appendBatch('p1', [new Uint8Array([1, 1, 1])]);   // 现有段 1 帧（回滚基准）
    const segKey = `${OWNER}/${walSegmentFileName('p1', 1, 0)}`;
    const meta = () => (s as any).index.get('p1').get(segKey);              // 白盒（本 spec/服务 spec 既有先例）
    const fcBefore = meta().frameCount;                                     // =1
    const bytesBefore = meta().bytes;
    expect(meta().seqs).toHaveLength(1);
    const nextSeqBefore = s.peekNextWalSeq('p1');
    s.failNextSync = 'ENOSPC';
    await expect(s.appendBatch('p1', [new Uint8Array([2, 2]), new Uint8Array([3, 3])])).rejects.toThrow(/ENOSPC/);
    expect(s.walHealthy(), 'ENOSPC 可恢复档——walHealthy 仍 true').toBe(true);
    // 核断言：frameCount 回滚=批前值（红相=3——写循环 mutate 未随回滚还原，bytes 已回 218→peek 面三连失真）
    expect(meta().frameCount, 'frameCount 回滚=批前值（N1 红相=3）').toBe(fcBefore);
    expect(meta().seqs, 'seqs 记账归 post-fsync（成功才入账）').toHaveLength(1);
    expect(meta().bytes, 'bytes 回滚=批前 last-good').toBe(bytesBefore);
    expect(meta().goodBytes, 'goodBytes 回滚=批前 last-good').toBe(bytesBefore);
    // 后果面 1：peek 零假告警（红相：虚高 frameCount=3>盘上 1 帧→reportTruncation 假 ERROR+指标虚增）
    const frames = await s.peek('p1');
    expect(frames.map((f) => Array.from(f.payload)), 'peek=段内真帧无损零假读').toEqual([[1, 1, 1]]);
    expect(await count() - before, 'yjs_spool_truncated_total 零虚增（红相=1）').toBe(0);
    // 后果面 2：重试成功+全帧 confirm→段进程内可回收（红相：confirmedCount 恒 1<虚高 3 永不满足回收判据）
    expect(s.peekNextWalSeq('p1'), '复用批内全部已分配 seq（不留洞）').toBe(nextSeqBefore);
    const retry = await s.appendBatch('p1', [new Uint8Array([2, 2]), new Uint8Array([3, 3])]);
    for (const r of [...first, ...retry]) s.noteApplied('p1', r.walSeq);   // T9 协议：apply 后 noteApplied（confirm 推 pgSeq 前置——actor 生产同款）
    await s.confirm('p1', [...first, ...retry].map((r) => r.frameId));
    expect((s as any).index.get('p1'), '全帧 confirmed→段回收（confirm 判据 confirmedCount===frameCount 可达）').toBeUndefined();
    expect(existsSync(join(dir, OWNER, walSegmentFileName('p1', 1, 0))), '段文件已 unlink').toBe(false);
  });
});

describe('Y1c T8 收口 I1/I4：chain-stopped 前缀可重放+外来段禁物理截断', () => {
  it('I1：截断段有效前缀帧不搁浅——peek 可取回+replayAll 可达 PG（(pgSeq,lastGoodSeq] 已 fsync 帧）', async () => {
    const corpus = buildWalFaultCorpus({ historyId: HISTORY });
    const badCrc = corpus.find((f) => f.expectedBadTier === 'bad-crc')!;
    const s = svc();
    const { path } = await writeFixture(s, badCrc.header, badCrc.frames, badCrc.fault);
    const report = await s.recoverScan({ systemHistory: sysHistory(), pgSeq: () => 0n });
    const pr = report.projects[0];
    expect(pr.replayPrefix).toEqual([1n, 2n]);
    expect(pr.truncated).toHaveLength(1);
    // 旧实现：peek 过滤一切 segQuarantined → chain-stopped 截断段的有效前缀帧零 API 可取回（搁浅）
    const frames = await s.peek('proj-fixture');
    expect(frames.map((f) => Array.from(f.payload)), '前缀帧可 peek').toEqual(badCrc.frames.slice(0, 2).map((f) => Array.from(f.payload)));
    const repo = createMockRepo();
    const r = await s.replayAll(repo as any);
    expect(r.replayed, 'replayAll 送达 PG（对照旧链同形态能力）').toBe(2);
    // Y1c T9 新表形态：replayAll=per-frame 行同批单事务（一次 appendBatch 携 2 行——旧「merge 失败
    // 逐帧回退」形态随帧合并退役；replayed=2 帧语义保持）
    expect(repo.appendBatch).toHaveBeenCalledTimes(1);
    expect((repo.appendBatch.mock.calls[0] as unknown as Array<[string, unknown[]]>)[1]).toHaveLength(2);
    // R3（复核 Minor）：本用例声称「段回收」——补显式断言：全部帧 confirmed 后段文件+恢复截断
    // sidecar unlink（confirm 回收判据 V3：frameCount>0 ∧ 全 confirmed ∧ 坏尾已处置）+owner 目录零残留。
    expect(existsSync(path), '段文件已 unlink（回收）').toBe(false);
    expect(existsSync(`${path}.quarantine`), '恢复截断 sidecar 随段回收').toBe(false);
    expect((await readdir(join(dir, OWNER)).catch(() => [] as string[])).filter((f) => f.endsWith('.spool')), 'owner 目录零残留段').toHaveLength(0);
  });

  it('I4：外来段（dir≠adir）坏尾禁物理截断（P18 对称——fenced 前任可能仍在写）：仅 sealed+前缀可重放', async () => {
    const corpus = buildWalFaultCorpus({ historyId: HISTORY });
    const badCrc = corpus.find((f) => f.expectedBadTier === 'bad-crc')!;
    const s = svc();
    await mkdir(join(dir, 'predecessor'), { recursive: true });
    const name = walSegmentFileName(badCrc.header.projectId, badCrc.header.generation, 0);
    const path = join(dir, 'predecessor', name);
    await writeFile(path, encodeWalSegmentBytes(badCrc.header, badCrc.frames, badCrc.fault));
    const preSize = (await stat(path)).size;
    const report = await s.recoverScan({ systemHistory: sysHistory(), pgSeq: () => 0n });
    const pr = report.projects[0];
    expect((await stat(path)).size, '外来段字节不动（旧实现 recoverScan 物理截断必红）').toBe(preSize);
    expect(pr.replayPrefix).toEqual([1n, 2n]);                        // 前缀帧照常可证（I1 维度）
    expect(pr.truncated, '不进 truncated 报告（未动字节）').toHaveLength(0);
    expect(await s.peek('proj-fixture')).toHaveLength(2);
  });
});

// ═══ 复核收口 R1（Important）：chain-stopped 两态拆分——链断后续段（unproven-tail）禁重放 ═══
describe('Y1c T8 复核收口 R1：链断后续段=unproven-tail（未过链校验网）零重放——与截断段 chain-stopped 分档', () => {
  it('状态 B（seg0[1,2]+seg1 缺号致命+seg2[5,6]）：replayPrefix/peek 恰 [1,2]，seg2 帧不可达（旧实现两态混用 peek 泄漏 4 帧必红）', async () => {
    const corpus = buildWalFaultCorpus({ historyId: HISTORY });
    const header = corpus[0].header;   // proj-fixture / g3 / historyId=HISTORY（与 sysHistory 匹配）
    const s = svc();
    await writeFixture(s, header, corpus[0].frames.slice(0, 2));   // 完好 [1,2]——链式起点
    const seg1 = await writeFixture(s, header, [{ walSeq: 4n, payload: walFixturePayload(64, 21) }], undefined, 1);   // 首帧缺号（期望 3）→ gap 致命
    const seg2 = await writeFixture(s, header, [
      { walSeq: 5n, payload: walFixturePayload(64, 22) },
      { walSeq: 6n, payload: walFixturePayload(64, 23) },
    ], undefined, 2);   // 链断后续段：len/CRC permissive 全过、dup-seq/gap/generation/hash 链校验网零过
    const seg2BytesBefore = await readFile(seg2.path);
    const report = await s.recoverScan({ systemHistory: sysHistory(), pgSeq: () => 0n });
    const pr = report.projects[0];
    expect(pr.replayPrefix, '重放前缀恰 [1,2]（seg1 截断空前缀+seg2 不可证）').toEqual([1n, 2n]);
    expect(pr.truncated.map((t) => t.segKey), 'seg1 截断到空前缀（164B 头）').toEqual([seg1.segKey]);
    expect(pr.quarantined, 'seg2=unproven-tail 报告 quarantined 维可见（证据保全零重放）').toEqual([{ segKey: seg2.segKey, reason: 'unproven-tail' }]);
    // 旧实现：:1051 对链断后续段赋 'chain-stopped' → peek 白名单放行 → seg2 [5,6] 泄漏（4 帧）
    const frames = await s.peek('proj-fixture');
    expect(frames.map((f) => Array.from(f.payload)), 'peek 恰 seg0 前缀两帧——seg2 帧不可达').toEqual([
      Array.from(corpus[0].frames[0].payload), Array.from(corpus[0].frames[1].payload),
    ]);
    expect(s.peekNextWalSeq('proj-fixture'), 'unproven-tail seq 不计入续号（帧不可重放，防同号混淆）').toBe(3n);
    expect((await readFile(seg2.path)).equals(seg2BytesBefore), 'seg2 证据保全——不截断不覆写（下轮恢复重裁定）').toBe(true);
  });
});

describe('Y1c T8 收口 I2：lastWriteAt+headerCrc32 单次 pwrite（F-S4-6 成对原子）', () => {
  it('段头更新恰一次（offset 152 起 12B 一写）——旧实现 152/160 两次 pwrite=撕裂窗口', async () => {
    const { open } = await import('node:fs/promises');
    const probe = await open(join(dir, 'proto-probe'), 'w');
    const proto = Object.getPrototypeOf(probe);
    await probe.close();
    const origWrite = proto.write;
    const headerWrites: Array<{ position: number; bytes: number }> = [];
    proto.write = function (this: unknown, ...args: unknown[]) {
      const position = args[3] as number;
      if (typeof position === 'number' && (position === 152 || position === 160)) {
        headerWrites.push({ position, bytes: args[2] as number });
      }
      return (origWrite as (...a: unknown[]) => unknown).apply(this, args);
    };
    try {
      const s = svc();
      await s.append('p1', new Uint8Array([1]));                      // 新建段（含首帧段头更新）
      await s.append('p1', new Uint8Array([2]));                      // 既有段追加（段头更新）
      expect(headerWrites, '段头更新恰两次 append 各一次（旧实现每 append 两次=必红）').toHaveLength(2);
      for (const w of headerWrites) expect(w).toEqual({ position: 152, bytes: 12 });
      const buf = await readFile(join(dir, OWNER, walSegmentFileName('p1', 1, 0)));
      expect(decodeWalSegmentHeader(buf), '单写后头 CRC 恒成对（可解码）').not.toHaveProperty('badHeader');
    } finally {
      proto.write = origWrite;
    }
  });
});

describe('Y1c T8 收口 I3/M4：水位重建不崩 boot+violation 报告+写回注册表', () => {
  it('I3：restore+bump 形态（全段隔离+PG 残留 pgSeq>0）→pgPrefixViolation 报告不 assert 崩 boot', async () => {
    const corpus = buildWalFaultCorpus({ historyId: HISTORY });
    const fx = corpus.find((f) => f.expectedQuarantine === 'history-mismatch')!;
    const s = svc();
    const { path } = await writeFixture(s, fx.header, fx.frames, fx.fault);
    const preSize = (await stat(path)).size;
    const report = await s.recoverScan({ systemHistory: sysHistory(), pgSeq: () => 7n });   // 旧实现 assert 崩 boot 必红
    const pr = report.projects[0];
    expect(pr.quarantined.map((q) => q.reason)).toEqual(['history-mismatch']);
    expect(pr.pgPrefixViolation).toHaveLength(1);
    expect(pr.pgPrefixViolation[0].pgSeq).toBe(7n);
    expect(pr.pgPrefixViolation[0].lastGoodSeq).toBeNull();
    expect(pr.replayPrefix).toEqual([]);
    expect((await stat(path)).size, '证据保全（不截断）').toBe(preSize);
  });

  it('I3 边界：链干净但前缀尾<pgSeq（confirm 回收后 ≤pgSeq 幂等重放残帧）→水位以 pgSeq 重建非崩非 violation', async () => {
    const corpus = buildWalFaultCorpus({ historyId: HISTORY });
    const good = corpus[0];                                           // 完好段 [1,2,3]
    const s = svc();
    await writeFixture(s, good.header, good.frames);
    const report = await s.recoverScan({ systemHistory: sysHistory(), pgSeq: () => 5n });   // 旧实现 assert 崩必红
    const pr = report.projects[0];
    expect(pr.pgPrefixViolation).toHaveLength(0);
    expect(pr.watermarks).toEqual({ pgSeq: 5n, appliedSeq: 5n, spoolHeadSeq: 5n });
  });

  it('M4：recoverScan 报告水位写回 watermarks 注册表（旧实现 rebuild 落 pgSeq=0n）', async () => {
    const corpus = buildWalFaultCorpus({ historyId: HISTORY });
    const good = corpus[0];
    const s = svc();
    await writeFixture(s, good.header, good.frames);
    const report = await s.recoverScan({ systemHistory: sysHistory(), pgSeq: () => 2n });
    const pr = report.projects[0];
    expect(pr.watermarks).toEqual({ pgSeq: 2n, appliedSeq: 3n, spoolHeadSeq: 3n });
    expect(s.watermark('proj-fixture'), '写回注册表（T13 消费面）——旧实现 pgSeq 丢为 0n 必红').toEqual(pr.watermarks);
  });
});

describe('Y1c T8 收口 M1/M2/M5/M6/M7（fail-closed 停收/帧上界/诊断分维/直测补）', () => {
  it('M1：截断失败档=fail-closed 停收（isWritable=false+append 拒收）+段 quarantine sidecar', async () => {
    const s = new FaultSpool(dir);
    s.setOwner(OWNER); s.setWalHistory(HISTORY);
    await s.append('p1', new Uint8Array([1, 2, 3]));
    const segPath = join(dir, OWNER, walSegmentFileName('p1', 1, 0));
    (globalThis as { __spoolTruncateFailPath?: string }).__spoolTruncateFailPath = segPath;
    try {
      s.failNextSync = 'ENOSPC';
      await expect(s.append('p1', new Uint8Array([4, 5, 6]))).rejects.toThrow(/ENOSPC/);
      expect(s.walHealthy(), '截断失败=walHealthy=false（旧实现仍 true 必红）').toBe(false);
      expect(s.isWritable(), 'fail-closed 停收（旧实现仅 5 连败熔断=软于契约）').toBe(false);
      await expect(s.append('p1', new Uint8Array([7]))).rejects.toThrow();
      expect(existsSync(`${segPath}.quarantine`), '截断失败段整段隔离 sidecar（证据保全——旧实现无必红）').toBe(true);
    } finally {
      delete (globalThis as { __spoolTruncateFailPath?: string }).__spoolTruncateFailPath;
    }
  });

  it('M2：appendRaw 拒 >16MiB payload（先写后扫描必判 truncated=Spooled 后静默丢——准入拒绝）', async () => {
    const s = svc();
    await expect(s.append('p1', new Uint8Array(16 * 1024 * 1024 + 1))).rejects.toThrow(/16MiB/);   // 旧实现照写必红
    expect(s.hasFrames('p1')).toBe(false);
    expect((await readdir(join(dir, OWNER)).catch(() => [] as string[])).filter((f) => f.endsWith('.spool'))).toHaveLength(0);
  });

  it('M5：recoverySuspect 段不泄入 quarantinedSegments()——suspectSegments() 分维', async () => {
    const corpus = buildWalFaultCorpus({ historyId: HISTORY });
    const fx = corpus.find((f) => f.expectedQuarantine === 'timestamp-fence')!;
    const s = svc();
    await writeFixture(s, fx.header, fx.frames, fx.fault);
    await s.recoverScan({ systemHistory: sysHistory(), pgSeq: () => 0n, evaluateTimestampFence: true });
    expect(s.quarantinedSegments(), '真隔离清单不含怀疑态段（旧实现泄入必红）').toEqual([]);
    expect(s.suspectSegments(), '怀疑态分维清单').toHaveLength(1);
  });

  it('M6-直测：去重索引 24h TTL 到期驱逐（过期条目再 append=去重 miss 新帧）', async () => {
    const s = svc();
    const p = new Uint8Array([1, 2, 3]);
    const id1 = (await s.append('p1', p))[0];
    for (const v of (s as any).dedupIndex.values()) v.at = Date.now() - WAL_DEDUP_INDEX_TTL_MS - 1;   // 白盒：条目回拨过期
    const id2 = await s.append('p1', new Uint8Array(p));
    expect(id2[0], 'TTL 过期=驱逐（新帧新 frameId）').not.toBe(id1);
    expect(await s.peek('p1')).toHaveLength(2);
  });

  it('M6-直测：去重索引 100k FIFO 上界（超界驱逐最老——插入序）', () => {
    const s = svc();
    const idx = s as any;
    for (let i = 0; i < WAL_DEDUP_INDEX_MAX_ENTRIES + 2; i++) idx.dedupInsert('p1', `hash${i}`, `id${i}`);
    expect(idx.dedupIndex.size).toBe(WAL_DEDUP_INDEX_MAX_ENTRIES);
    expect(idx.dedupLookup('p1', 'hash0'), '最老条目已被 FIFO 驱逐').toBeNull();
    expect(idx.dedupLookup('p1', `hash${WAL_DEDUP_INDEX_MAX_ENTRIES + 1}`), '最新条目在界').not.toBeNull();
  });

  it('M6/M7-直测：fsync-fail-pre 缺省档（非 EIO/ENOSPC）截断复用+device 标签=稳定常量 spool-root', async () => {
    const metric = async () => {
      const reg = (await import('prom-client')).register;
      return (await reg.getSingleMetric('wal_fsync_error_total')!.get()).values
        .filter((x) => (x.labels as Record<string, string>).tier === 'fsync-fail-pre' && (x.labels as Record<string, string>).device === 'spool-root')
        .reduce((a, b) => a + (b.value ?? 0), 0);
    };
    const before = await metric();
    const s = new FaultSpool(dir);
    s.setOwner(OWNER); s.setWalHistory(HISTORY);
    await s.append('p1', new Uint8Array([1]));
    const segPath = join(dir, OWNER, walSegmentFileName('p1', 1, 0));
    const sizeAfterGood = (await stat(segPath)).size;
    s.failNextSync = 'EPERM';                                         // 非 EIO/ENOSPC → 缺省档 fsync-fail-pre
    await expect(s.append('p1', new Uint8Array([2]))).rejects.toThrow();
    expect(s.walHealthy(), '缺省档=可恢复（截断复用）').toBe(true);
    expect((await stat(segPath)).size, '截断回 last-good').toBe(sizeAfterGood);
    expect((await metric()) - before, 'wal_fsync_error_total{tier=fsync-fail-pre,device=spool-root}+1（旧 device=绝对路径必红）').toBe(1);
  });

  it('M7-直测：parseSegFileName 收紧——g 形态歧义名拒绝（防 p1.g1.0.5.spool 重释 legacy）', () => {
    expect(parseSegFileName('p1.g1.0.spool')).toEqual({ projectId: 'p1', generation: 1, segSeq: 0 });
    expect(parseSegFileName('p1.0.spool')).toEqual({ projectId: 'p1', generation: null, segSeq: 0 });
    expect(parseSegFileName('p1.g1.0.5.spool'), '歧义名拒绝（旧实现重释为 legacy projectId=p1.g1.0 必红）').toBeNull();
    expect(parseSegFileName('p1.g1.spool'), 'g 形态子串名拒绝（旧实现重释为 legacy projectId=p1.g 必红）').toBeNull();
    expect(parseSegFileName('notaspool')).toBeNull();
  });
});

// ═══ Y1c T13 双评审收口 C1/I1/M1：chain-stopped 外来段收养保链式裁定+前缀缺口计数+fsync 失败尾 ═══
describe('Y1c T13 双评审收口 C1/I1/M1：外来 chain-stopped 段收养保裁定前缀+前缀缺口计数+fsync 时延失败尾', () => {
  /** 布景：外来（predecessor 目录）gap 段 [1,2,4,5]——seq 3 缺号对链式扫描=fatal 停链、对 permissive
   *  len/CRC 网=干净假象（四帧全可解析）；recoverScan 裁定 chain-stopped 前缀 [1,2]（I4 外来禁字节处置）。 */
  async function seedForeignGapSeg(): Promise<{ path: string; name: string; segKey: string }> {
    const corpus = buildWalFaultCorpus({ historyId: HISTORY });
    const gap = corpus.find((f) => f.expectedBadTier === 'missing-seq')!;
    await mkdir(join(dir, 'predecessor'), { recursive: true });
    const name = walSegmentFileName(gap.header.projectId, gap.header.generation, 0);
    const path = join(dir, 'predecessor', name);
    await writeFile(path, encodeWalSegmentBytes(gap.header, gap.frames));
    return { path, name, segKey: `predecessor/${name}` };
  }

  it('C1①：gap 段收养后 peek=裁定前缀 [1,2]（非 [1,2,4,5]——链后未证帧不复活）+quarantineTruncatedFrames 走链缺陷档非 no-op+replayAll 仅前缀两帧+段回收闭环', async () => {
    const { path } = await seedForeignGapSeg();
    const s = svc();
    const report = await s.recoverScan({ systemHistory: sysHistory(), pgSeq: () => 0n });
    const pr = report.projects[0]!;
    expect(pr.replayPrefix, 'boot 链裁定前缀 [1,2]').toEqual([1n, 2n]);
    expect(pr.truncated, '外来段禁字节处置（I4）').toHaveLength(0);
    const adopted = await s.adoptSilentForeignSegments(0);   // 0ms=立即静默（测试形态）
    expect(adopted).toHaveLength(1);
    const frames = await s.peek('proj-fixture');
    expect(frames.map((f) => f.walSeq), 'C1：收养保裁定前缀（旧实现 permissive 重算=[1,2,4,5] 链后未证帧复活必红）').toEqual([1n, 2n]);
    // 坏尾处置闭环：permissive 干净假象下 quarantineTruncatedFrames 以 meta.goodBytes（链式裁定界）
    // 隔离——旧实现判干净段 continue=坏尾零处置+收养段 confirm tailSettled 恒 false 永不回收。
    const quarantined = await s.quarantineTruncatedFrames('proj-fixture');
    expect(quarantined, '链缺陷档隔离非 no-op').toBe(1);
    expect(await s.peek('proj-fixture'), '前缀帧处置后仍可重放').toHaveLength(2);
    const expectOff = 164 + (52 + 1024) + (52 + 1088);   // 帧 3（seq 4）起点=帧 1/2 全记录后（payload 1024/1088）
    const scLine = JSON.parse((await readFile(`${path}.quarantine`, 'utf8')).trim().split('\n').at(-1)!);
    expect(scLine).toMatchObject({ segSeq: 0, quarantinedFromOffset: expectOff, reason: 'chain-defect-tail' });
    // replay 通道：仅裁定前缀两帧（旧实现 4 帧复活进 PG 通道=密集前缀破口）+全 confirm 段回收闭环
    const repo = createMockRepo();
    const r = await s.replayAll(repo as any);
    expect(r.replayed, 'replayAll 仅前缀两帧').toBe(2);
    expect(existsSync(path), '全 confirm+坏尾已处置=段文件回收').toBe(false);
    expect(existsSync(`${path}.quarantine`), 'sidecar 随段回收').toBe(false);
  });

  it('C1②：收养推进 walSeq 计数器（max 语义不回拨）+去重索引同步——连续 append 两帧 seq 唯一无碰撞+全 peek seqs 无双重占用+同字节重发命中 dedup（ACK 铁律）', async () => {
    const corpus = buildWalFaultCorpus({ historyId: HISTORY });
    const gap = corpus.find((f) => f.expectedBadTier === 'missing-seq')!;
    const { segKey } = await seedForeignGapSeg();
    const s = svc();
    await s.recoverScan({ systemHistory: sysHistory(), pgSeq: () => 0n });
    await s.adoptSilentForeignSegments(0);
    expect(s.peekNextWalSeq('proj-fixture'), '计数器承接裁定前缀尾+1').toBe(3n);
    // 同字节重发裁定前缀帧 → dedup 命中（收养帧入索引——返回原 frameId/原 walSeq，零新帧零烧号）
    const resend = await s.appendTracked('proj-fixture', gap.frames[0]!.payload);
    expect(resend.frameId, 'ACK 铁律：同字节重发=原帧命中').toBe(`${segKey}:0`);
    expect(resend.walSeq).toBe(1n);
    // 收养后连续两帧：walSeq 承接（不与收养段 seq 碰撞）+全 peek 无双重占用
    const a = await s.appendTracked('proj-fixture', new Uint8Array([41]));
    const b = await s.appendTracked('proj-fixture', new Uint8Array([42]));
    expect([a.walSeq, b.walSeq], '新帧承接 3/4').toEqual([3n, 4n]);
    const all = (await s.peek('proj-fixture')).map((f) => f.walSeq);
    expect(all.length).toBe(4);
    expect(new Set(all.map(String)).size, '全 peek seqs 无双重占用（旧实现收养 permissive seq 4 与新帧 4 双占=PG 密集前缀破口→下次 boot dup-seq fatal 级联）').toBe(all.length);
  });

  it('I1：外来 chain-stopped fatal 分支计入 doc_prefix_gap_total（帧级致命停链=前缀缺口事件——旧实现既不 push quarantined 也不 push truncated=零观测必红）', async () => {
    const reg = (await import('prom-client')).register;
    const metric = reg.getSingleMetric('doc_prefix_gap_total')!;
    const before = (await metric.get()).values[0]?.value ?? 0;
    await seedForeignGapSeg();
    const s = svc();
    const report = await s.recoverScan({ systemHistory: sysHistory(), pgSeq: () => 0n });
    const pr = report.projects[0]!;
    expect(pr.quarantined, '外来 chain-stopped 不进 quarantined 报告维（I4 无 sidecar）').toHaveLength(0);
    expect(pr.truncated, '不进 truncated 报告维（未动字节）').toHaveLength(0);
    const after = (await metric.get()).values[0]?.value ?? 0;
    expect(after - before, '前缀缺口事件 inc（「帧级致命缺陷」档——help 语义与实现对齐，语义不缩水）').toBe(1);
  });

  it('M1：wal_fsync_latency 失败尾不进直方图（成功路径观测——失败分档归 wal_fsync_error_total；旧实现 finally observe=EIO 长尾污染 p95 观测源必红）', async () => {
    const reg = (await import('prom-client')).register;
    const histCount = async () => Number(/wal_fsync_latency_count (\d+)/.exec(await reg.metrics())?.[1] ?? 0);
    // 经 super.syncSegmentHandle 的 fh stub 注入（直测基类观测路径——FaultSpool 覆写整个 seam 绕开基类）
    class FailSyncSpool extends CollabSpoolService {
      failOnce = false;
      constructor(d: string) { super(d); }
      protected async syncSegmentHandle(fh: import('node:fs/promises').FileHandle): Promise<void> {
        if (this.failOnce) {
          this.failOnce = false;
          await super.syncSegmentHandle({
            sync: async () => { throw Object.assign(new Error('simulated EIO'), { code: 'EIO' }); },
          } as unknown as import('node:fs/promises').FileHandle);
          return;
        }
        await super.syncSegmentHandle(fh);
      }
    }
    const before = await histCount();
    const s = new FailSyncSpool(dir);
    s.setOwner(OWNER); s.setWalHistory(HISTORY);
    s.failOnce = true;
    await expect(s.append('p1', new Uint8Array([1]))).rejects.toThrow(/EIO/);
    expect(s.walHealthy(), 'EIO fail-stop 语义不变').toBe(false);
    expect(await histCount(), '失败尾零观测（旧实现 finally observe 必红）').toBe(before);
    const s2 = svc();
    await s2.append('p1', new Uint8Array([2]));
    expect(await histCount(), '成功路径照常 observe（S4/T33 p95 观测源不缺失）').toBe(before + 1);
  });
});
