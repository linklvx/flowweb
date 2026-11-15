// Y0a-2：spool 单测——真文件系统（tmp 目录），禁 mock fs（文件系统语义正是被测对象）。
// Y1c T8（v1.7 帧协议）：段文件名 `<projectId>.g<generation>.<segSeq>.spool`（默认 generation=1）
// +段头 164B+帧记录 52B 头——原 8B 帧/平铺名断言已随协议升级同步（行为面断言不变）；
// 手工坏帧一律用垃圾字节尾（<52B 残尾=truncated 档——旧 8B 头构造形态随格式退役）。
// 注①（对 plan 文本的算术修正）：段滚动用例 payload 取 2,500,000B——plan 原值 1,500,000B 时
// 3 次追加在 4MB 段上限下只产生 2 段（1.5+1.5=3.0MB 未超限），断言 3 段必红；2.5MB 每帧使
// 第 2/3 次追加均超限滚动，3 段断言与「跨段 peek」意图同时成立。
// 注②（对 plan 文本的前提修正）：崩溃语义用例若对单帧段全量 confirm，按 confirm 回收判据
// （用例 2 锁定的整段 unlink 语义）段文件已删除，重启 scan 后磁盘为空，断言必红；改为两帧中
// confirm 一帧（段保留）——confirmed 集在内存、崩溃即丢，重启后含已 confirm 帧在内全部帧重新
// 可见，正是「幂等降级」要验证的完整语义（service 头注释同款表述）。
// 注③（T8 去重语义）：append 对同字节 payload 去重（SHA-256 命中返回原 frameId 零新帧）——
// 回灌/容量用例的 payload 必须互异（空 Y.Doc 的 update 两份字节相同会被并帧）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, readFile, readdir, rm, unlink, writeFile, appendFile, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import * as Y from 'yjs';
import { CollabSpoolService } from './collab-spool.service';
import { SpoolProjectBlockedError, SpoolErasureGuardMissingError } from './collab-spool.service';
import { spoolForTest, EmptyErasureSource } from '../../test-utils/erasure-fixtures';
import { buildOwnerName } from './owner-name';
import { hostname } from 'node:os';
import type { WalSegmentHeader } from '@flowweb/shared';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { pollUntil } from '../../test-utils/poll-until';
import { createMockRepo } from '../../test-utils/mock-repo';

let dir: string; let cleanup: () => Promise<void>;
beforeEach(async () => { ({ dir, cleanup } = await makeSpoolDir()); });   // V17①：每用例独立目录
afterEach(async () => { await cleanup(); });

function svc(): CollabSpoolService { const s = spoolForTest(dir); s.setOwner('test-owner'); return s; }   // 每用例新实例=崩溃模拟（内存 index/confirmed 丢失）；R3：写/扫路径必先 setOwner（Z13）

describe('spool 骨架（帧编解码+append fsync+peek/confirm+段滚动）', () => {
  it('append→peek round-trip：payload 逐字节相等；数据真实写至文件（fsync 语义）', async () => {
    const s = svc();
    const p1 = new Uint8Array([1, 2, 3, 4, 5]);
    const p2 = new Uint8Array([9, 9]);
    const ids = await s.append('p1', p1);
    await s.append('p1', p2);
    expect(ids).toHaveLength(1);
    const frames = await s.peek('p1');
    expect(frames.map((f) => Array.from(f.payload))).toEqual([Array.from(p1), Array.from(p2)]);
    const files = await readdir(join(dir, 'test-owner'));   // R3：段在 owner 子目录
    expect(files.filter((f) => f.endsWith('.spool'))).toHaveLength(1);   // 同段追加
    // T8 v1.7：164B 段头 + 帧(52B 头+5B) + 帧(52B 头+2B)
    expect((await readFile(join(dir, 'test-owner', files[0]))).byteLength).toBe(164 + 57 + 54);
    expect(s.hasFrames('p1')).toBe(true);
  });

  it('confirm 段回收触发点①：全部帧 confirmed→段文件 unlink+键集删除；部分 confirm 保留', async () => {
    const s = svc();
    const a = await s.append('p1', new Uint8Array([1]));
    const b = await s.append('p1', new Uint8Array([2]));
    await s.confirm('p1', [a[0]]);                       // 部分：段保留
    expect((await readdir(join(dir, 'test-owner'))).some((f) => f.endsWith('.spool'))).toBe(true);
    await s.confirm('p1', b);                             // 全部：整段 unlink
    const left = await readdir(join(dir, 'test-owner'));   // TD-33 T2：写路径零 rmdir——owner 目录生命周期归进程，回收=boot GC
    expect(left.filter((f) => f.endsWith('.spool'))).toHaveLength(0);
    expect(s.hasFrames('p1')).toBe(false);
    expect(await s.peek('p1')).toEqual([]);               // 键已删
  });

  it('T2 根锚：单项目 append→全部 confirm 后 owner 目录仍在（写路径零 rmdir——TD-33 生命周期归进程）', async () => {
    const s = svc();
    const ids = await s.append('p1', new Uint8Array([1]));
    await s.confirm('p1', ids);
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(dir, 'test-owner'))).toBe(true);
  });

  it('Q-M5（T10 收口）walIoChains 链尾自摘：WAL IO 全 settle 后 per-project 链键不驻留（红=旧实现永不清理=无界 Map）；键消失后再写再 confirm 串行语义不变', async () => {
    const s = svc();
    const flushMicrotasks = () => new Promise((res) => setTimeout(res, 0));   // tail 自摘回调（微任务尾）全 flush
    const r1 = await s.appendBatch('p1', [new Uint8Array([1]), new Uint8Array([2])]);
    for (const f of r1) s.noteApplied('p1', f.walSeq);   // actor 同序（confirm 推 pgSeq 的不变量前提）
    await s.confirm('p1', r1.map((f) => f.frameId));
    await flushMicrotasks();
    expect((s as any).walIoChains.size).toBe(0);          // 红：旧实现链尾常驻（confirm 链 settle 后仍留键）
    expect(s.hasFrames('p1')).toBe(false);                // 段回收照常（index 生命周期对齐面）
    const r2 = await s.appendBatch('p1', [new Uint8Array([3])]);   // 键已摘后再写——链从 Promise.resolve() 重起
    for (const f of r2) s.noteApplied('p1', f.walSeq);
    await s.confirm('p1', r2.map((f) => f.frameId));
    await flushMicrotasks();
    expect((s as any).walIoChains.size).toBe(0);
    expect(s.hasFrames('p1')).toBe(false);
  });

  it('段滚动：累计写超 4MB 滚动新段（文件名 segSeq 递增）；跨段 peek 全量返回', async () => {
    const s = svc();
    const big = new Uint8Array(2_500_000); big.fill(7);   // 注①：每帧 2.5MB——两帧即超 4MB 段上限
    await s.append('p1', big); await s.append('p1', new Uint8Array(2_500_000).fill(8));   // T8：payload 互异（同字节会被 SHA-256 去重并帧——注③）
    await s.append('p1', new Uint8Array(2_500_000).fill(9));
    const files = (await readdir(join(dir, 'test-owner'))).filter((f) => f.endsWith('.spool')).sort();
    expect(files).toHaveLength(3);
    expect(files[0]).toBe('p1.g1.0.spool'); expect(files[2]).toBe('p1.g1.2.spool');
    const frames = await s.peek('p1');
    expect(frames).toHaveLength(3);
    expect(frames[0].frameId.endsWith('p1.g1.0.spool:0')).toBe(true);   // R3：frameId=segKey:idx（owner 前缀+g 域）
    expect(frames[2].frameId.endsWith('p1.g1.2.spool:0')).toBe(true);
  });

  it('崩溃语义（confirmed 集丢失）：新实例 scan 同目录→peek 返回全部帧（幂等降级为第二道防线）', async () => {
    const s1 = svc();
    const a = await s1.append('p1', new Uint8Array([1]));
    await s1.append('p1', new Uint8Array([2]));           // 注②：两帧段
    await s1.confirm('p1', [a[0]]);                       // 部分 confirm（段保留）——confirmed 集在内存，"崩溃"即丢
    const s2 = svc();                                     // 新实例=重启
    await s2.scan();
    expect(s2.hasFrames('p1')).toBe(true);
    expect(await s2.peek('p1')).toHaveLength(2);          // 全部帧重新可见（含已 confirm 帧——重复回灌由 CRDT 幂等吸收）
  });

  it('尾部截断：CRC 不符/长度越界→停在该帧+yjs_spool_truncated_total+1，禁静默续读', async () => {
    const count = async () => { const m = (await import('prom-client')).register.getSingleMetric('yjs_spool_truncated_total')!; return (await m.get()).values[0]?.value ?? 0; };   // V17⑥：metric.get() 公开 API（v15 为异步——须 await）
    const before = await count();
    const s = svc();
    const good = new Uint8Array([1, 2, 3]);
    await s.append('p1', good);
    // 手工追加坏尾：2B 垃圾（<52B 帧头=truncated 档——T8 v1.7 帧构造形态）
    const file = join(dir, 'test-owner', 'p1.g1.0.spool');
    await writeFile(file, Buffer.concat([await readFile(file), Buffer.from([9, 9])]));
    const s2 = svc(); await s2.scan();
    const frames = await s2.peek('p1');
    expect(frames).toHaveLength(1);                       // 只有 good 帧；坏帧停读
    const after = await count();
    expect(after - before).toBe(1);
  });

  it('V2 段封禁：段尾注入坏字节→append 守卫滚动新段→重启 scan 后坏尾前后帧全部可 peek（v1 黑洞形态必红）', async () => {
    const s = svc();
    await s.append('p1', new Uint8Array([1]));                       // 段 0 帧 0（干净：goodBytes===bytes）
    const file = join(dir, 'test-owner', 'p1.g1.0.spool');
    const junk = Buffer.alloc(2, 0x99);
    await writeFile(file, Buffer.concat([await readFile(file), junk]));   // 外部坏尾：磁盘字节≠内存记账
    await s.append('p1', new Uint8Array([3]));                       // 追加前守卫 stat.size≠bytes→封段 0 滚动段 1
    const files = (await readdir(join(dir, 'test-owner'))).filter((f) => f.endsWith('.spool')).sort();
    expect(files).toEqual(['p1.g1.0.spool', 'p1.g1.1.spool']);       // 段 0 封存+段 1 承接新帧
    const s2 = svc(); await s2.scan();
    const frames = await s2.peek('p1');
    expect(frames).toHaveLength(2);                                  // 段 0 帧 0+段 1 帧 0 全可读——v1 黑洞（继续追加坏尾段）下段 1 帧永不可读=红
  });
});

describe('V15 目录 fail-fast（validateDir——gateway 调用点归 Task 3/4）', () => {
  // Y0a-4 重定语义：危险=**显式配置**（COLLAB_SPOOL_DIR）相对路径——CWD 漂移会静默指向另一个空账本，
  // 与"是否生产"无关；构造参数（测试 DI）与本地默认值（恒绝对）不在此判。
  it('COLLAB_SPOOL_DIR 显式相对路径→throw（与 NODE_ENV 无关）；显式绝对/本地默认→解析后的绝对路径', () => {
    const prev = process.env.COLLAB_SPOOL_DIR;
    try {
      process.env.COLLAB_SPOOL_DIR = './relative-spool';
      expect(() => spoolForTest().validateDir()).toThrow(/绝对路径/);   // 旧实现依赖 NODE_ENV=production → 非 production 下不抛=红
      process.env.COLLAB_SPOOL_DIR = join(process.cwd(), 'abs-spool');
      expect(isAbsolute(spoolForTest().validateDir())).toBe(true);
      delete process.env.COLLAB_SPOOL_DIR;   // 本地默认值（恒绝对）——不抛
      expect(isAbsolute(spoolForTest().validateDir())).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.COLLAB_SPOOL_DIR; else process.env.COLLAB_SPOOL_DIR = prev;
    }
  });
});

// —— Y0a-2 Task 2：spool 完整语义（quarantine sidecar/两态熔断+探针/启动回灌）——

describe('spool quarantine sidecar（v2.4：标记不搬字节——追加-only 段内移帧物理不可行）', () => {
  it('坏帧段：非隔离帧全 confirm→段可回收（unlink 条件≠全部帧 confirmed）+sidecar 保留记录', async () => {
    const s = svc();
    const ids = await s.append('p1', new Uint8Array([1]));               // 好帧 0:0
    // 追加坏尾（10B 垃圾——<52B 帧头=truncated 档）
    const file = join(dir, 'test-owner', 'p1.g1.0.spool');
    await writeFile(file, Buffer.concat([await readFile(file), Buffer.alloc(10, 0x99)]));
    const s2 = svc();
    const report = await s2.scan();
    expect(report.truncatedSegments).toEqual(['p1.g1.0.spool']);
    const quarantined = await s2.quarantineTruncatedFrames('p1');       // 坏帧段处置：非隔离帧重新可见
    expect(quarantined).toBeGreaterThan(0);                              // 隔离帧数（0:1）
    expect(await s2.peek('p1')).toHaveLength(1);                         // 好帧 0:0 仍可回灌
    const sidecar = join(dir, 'test-owner', 'p1.g1.0.spool.quarantine');
    const sidecarLines = (await readFile(sidecar, 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(sidecarLines.at(-1)).toMatchObject({ segSeq: 0, quarantinedFromOffset: 164 + 52 + 1 });   // V3 字节区间（T8：段头 164+好帧 53）
    await s2.confirm('p1', ids);                                          // 唯一非隔离帧 confirm→段回收（R3：frameId=segKey:idx——capture 后跨实例同 owner 同键）
    const after = await readdir(join(dir, 'test-owner'));   // TD-33 T2：目录保留（写路径零 rmdir）
    expect(after.filter((f) => f.endsWith('.spool'))).toHaveLength(0);
    expect(after.filter((f) => f.endsWith('.quarantine'))).toHaveLength(0);   // sidecar 随段清理
  });

  it('V3/E5 容量核算含隔离字节+隔离区间=字节偏移口径：quarantinedBytes=坏帧起始偏移→EOF（含坏帧头）', async () => {
    const s = svc();
    await s.append('p1', new Uint8Array(1024));                       // 好帧=164+52+1024=1240
    const file = join(dir, 'test-owner', 'p1.g1.0.spool');
    await writeFile(file, Buffer.concat([await readFile(file), Buffer.alloc(520, 0x99)]));   // 520B 垃圾坏尾
    const s2 = svc(); await s2.scan();
    await s2.quarantineTruncatedFrames('p1');
    const d = s2.depth();
    expect(d.quarantinedBytes).toBe(520);                             // 1760-1240=520
    expect(d.ownBytes + d.strandedBytes).toBe(1760);                  // V14：容量核算=总字节（R3 五元组=own+stranded 磁盘真值）
  });

  it('sidecar 写失败→异常上抛且 meta 未动（quarantinedRange 仍 null）——段与坏尾证据保留可重试（ENOSPC 同型：先记账后落盘=证据销毁必红）', async () => {
    const s = svc();
    await s.append('p1', new Uint8Array([1]));                          // 好帧 0:0（164+53=217B）
    const file = join(dir, 'test-owner', 'p1.g1.0.spool');
    await writeFile(file, Buffer.concat([await readFile(file), Buffer.alloc(2, 0x99)]));   // 坏尾
    const s2 = svc(); await s2.scan();
    await mkdir(join(dir, 'test-owner', 'p1.g1.0.spool.quarantine'));      // 目录占位 sidecar 路径→open('a') throw（同幻影 meta 用例 EISDIR 形态）
    await expect(s2.quarantineTruncatedFrames('p1')).rejects.toBeInstanceOf(Error);
    expect((s2 as any).index.get('p1').get('test-owner/p1.g1.0.spool').quarantinedRange).toBeNull();   // 白盒：sidecar 未落盘则 meta 三字段不改（R3：内键=segKey）
    await rm(join(dir, 'test-owner', 'p1.g1.0.spool.quarantine'), { recursive: true });   // 清占位目录（重试路径——重算 offset 保守正确）
    expect(await s2.quarantineTruncatedFrames('p1')).toBe(1);            // 重试成功（现状 meta 已改→重试跳段返回 0 同红）
    expect(await readFile(join(dir, 'test-owner', 'p1.g1.0.spool.quarantine'), 'utf8')).toContain('"quarantinedFromOffset":217');
  });
});

describe('spool 熔断与探针解熔断（V14 两态：ioBroken 探针可解 / overCapacity 仅 depth 回落可解）', () => {
  it('目录不可写（路径被文件占位）→连败累计→第 5 次熔断 isWritable()=false+yjs_spool_write_failures_total 递增', async () => {
    const count = async () => { const m = (await import('prom-client')).register.getSingleMetric('yjs_spool_write_failures_total')!; return (await m.get()).values[0]?.value ?? 0; };   // V17⑥：metric.get() 公开 API（须 await）
    const before = await count();
    const { dir: d2, cleanup: c2 } = await makeSpoolDir('y0a2-spool-fail-');
    try {
      const file = join(d2, 'occupied');      // spool 目录指向一个文件 → mkdir 失败 → 写必败
      await writeFile(file, 'x');
      const s = spoolForTest(file);
      s.setOwner('test-owner');
      // 前 2 次失败只累计 streak：受理面不被瞬时失败触发（防单败停摆语义锚——streak 1-4 区间探针
      // 未启动，若 isWritable 随 streak 收窄，则 X6 重试梯停排且无人再驱动 spool=永无自愈）
      await expect(s.append('p1', new Uint8Array([1]))).rejects.toBeInstanceOf(Error);
      await expect(s.append('p1', new Uint8Array([1]))).rejects.toBeInstanceOf(Error);
      expect(s.failureStreak()).toBeGreaterThanOrEqual(2);   // 连败计数（ioBroken 熔断判定素材）
      expect(s.isWritable()).toBe(true);                     // 未达 WRITE_FAILURE_CIRCUIT 不熔断
      // 目录被文件占位=持续故障，5 连败必达：置 ioBroken
      await expect(s.append('p1', new Uint8Array([1]))).rejects.toBeInstanceOf(Error);
      await expect(s.append('p1', new Uint8Array([1]))).rejects.toBeInstanceOf(Error);
      await expect(s.append('p1', new Uint8Array([1]))).rejects.toBeInstanceOf(Error);
      expect(s.isWritable()).toBe(false);                    // 连续 5 次写失败→ioBroken
      expect((await count()) - before).toBe(5);              // 逐败递增（用例名 metric 口径）
    } finally { await c2(); }
  });

  it('探针帧写删成功→isWritable 恢复 true；探针成功不误关 overCapacity（V14：probe 只解 ioBroken）', async () => {
    const s = svc();
    await s.append('p1', new Uint8Array([1]));
    expect(s.isWritable()).toBe(true);
    await s.probe();                                            // 探针=写 1 字节探针帧+confirm 段回收+fsync
    expect(s.isWritable()).toBe(true);
    (s as any).overCapacityFlag = true;                         // 白盒置容量态
    expect(s.isWritable()).toBe(false);                         // overCapacity 仍拒（裁定后 isWritable 含容量态）
    await s.probe();
    expect(s.isWritable()).toBe(false);                         // IO 探针成功≠容量恢复（v1 单态必红）
    (s as any).overCapacityFlag = false;                        // depth 回落后恢复（容量态由 append 前置判定驱动）
  });
});

describe('spool 启动回灌（V16：总预算+固定短退避+同项目帧合并；FK=真库 int 背书 V6）', () => {
  it('回灌：同项目连续帧合并为一次 append+confirm→段 unlink', async () => {
    const s1 = svc();
    // 合法 Y update 互异（注③：两份空 Doc 的 update 字节相同会被 SHA-256 去重并帧——内容互异才成两帧）
    const d1 = new Y.Doc(); d1.getMap('m').set('a', 1);
    const d2 = new Y.Doc(); d2.getMap('m').set('b', 2);
    await s1.append('p1', Y.encodeStateAsUpdate(d1));
    await s1.append('p1', Y.encodeStateAsUpdate(d2));
    const repo = createMockRepo();
    const s2 = svc(); await s2.scan();
    const report = await s2.replayAll(repo as any);
    expect(report.replayed).toBe(2); expect(report.failed).toBe(0);
    expect(repo.appendBatch).toHaveBeenCalledTimes(1);                // V16：合并单次（v1 逐帧=2 次必红）
    const left = await readdir(join(dir, 'test-owner'));                // 段 unlink 触发点②（TD-33 T2：目录保留）
    expect(left.filter((f) => f.endsWith('.spool'))).toHaveLength(0);
  });

  it('FK 失败（真库形状 P2010+meta 23503——mock 形状 V6 标注无效，此用例仅测分支逻辑）→帧按终态丢弃+段收割', async () => {
    const s1 = svc();
    await s1.append('gone', new Uint8Array([1]));
    const repo = createMockRepo({ appendBatch: vi.fn(async () => { throw Object.assign(new Error('Raw query failed'), { code: 'P2010', meta: { code: '23503' } }); }) });
    const s2 = svc(); await s2.scan();
    const report = await s2.replayAll(repo as any);
    expect(report.discarded).toBe(1);
    const left = await readdir(join(dir, 'test-owner'));                 // TD-33 T2：目录保留（写路径零 rmdir）
    expect(left.filter((f) => f.endsWith('.spool'))).toHaveLength(0);
  });

  it('PG 未起（P1001）→总预算耗尽返回 failed（不阻塞 listen；固定 200ms 重试非指数）', async () => {
    const s1 = svc();
    await s1.append('p1', new Uint8Array([1]));
    const repo = createMockRepo({ appendBatch: vi.fn(async () => { throw Object.assign(new Error("Can't reach database server"), { code: 'P1001' }); }) });
    const s2 = svc(); await s2.scan();
    const t0 = Date.now();
    const report = await s2.replayAll(repo as any, { budgetMs: 500, retryDelayMs: 50 });   // 测试缝收紧
    expect(report.failed).toBe(1);
    expect(repo.appendBatch.mock.calls.length).toBeGreaterThanOrEqual(2);   // 预算内重试
    expect(Date.now() - t0).toBeLessThan(1_500);                        // V16：总预算有界（v1 最坏 15s/帧）
    expect((await readdir(join(dir, 'test-owner'))).filter((f) => f.endsWith('.spool'))).toHaveLength(1);   // 帧保留（未丢弃）
  });
});

describe('Task 1 收口（幻影 meta/scan 幂等/残尾可观测——质量审查行为面）', () => {
  it('appendRaw 失败不残留幻影段元数据（新段首帧写失败→回滚 index 插入）', async () => {
    // T8 收口 C1 后注入形态更新：段名占位（目录/幻影文件）经 'wx' 排他建=EEXIST 段号递增
    // 不再失败（隔离段/未知段证据保全是 C1 Critical 根修——旧 EISDIR 注入随该修复退役）；
    // 新段首帧失败改经 fsync seam 注入 ENOSPC（可恢复档截断回 last-good 后回滚 index 插入
    // ——同一收口1 判据：writeFile 成功+首帧失败）。
    class FailFirstSyncSpool extends CollabSpoolService {
      private failedOnce = false;
      constructor(d: string) { super(d); this.setErasureSource(new EmptyErasureSource()); }
      protected async syncSegmentHandle(fh: import('node:fs/promises').FileHandle): Promise<void> {
        if (!this.failedOnce) { this.failedOnce = true; throw Object.assign(new Error('simulated ENOSPC'), { code: 'ENOSPC' }); }
        await fh.sync();
      }
    }
    const s = new FailFirstSyncSpool(dir);
    s.setOwner('test-owner');
    await expect(s.append('p1', new Uint8Array([1]))).rejects.toBeInstanceOf(Error);
    expect(s.hasFrames('p1')).toBe(false);   // 幻影 meta 回滚（收口 1：index 留幽灵键必红）
  });

  it('scan：<8B 残片段（0 字节）直接 unlink——零帧零数据不进 index', async () => {
    await writeFile(join(dir, 'p1.0.spool'), Buffer.alloc(0));
    const s2 = svc();
    const report = await s2.scan();
    expect(report.truncatedSegments).toEqual([]);
    expect((await readdir(dir)).filter((f) => f.endsWith('.spool'))).toHaveLength(0);
    expect(s2.hasFrames('p1')).toBe(false);
  });

  it('scan：好帧后 <52B 残尾也进 truncated 报告（坏尾必有可观测面）', async () => {
    const s = svc();
    await s.append('p1', new Uint8Array([1, 2, 3]));    // 好帧（164+55=219B）
    const f = join(dir, 'test-owner', 'p1.g1.0.spool');
    await writeFile(f, Buffer.concat([await readFile(f), Buffer.from([0x99, 0x98, 0x97])]));   // +3B 残尾=222B
    const s2 = svc();
    const report = await s2.scan();
    expect(report.truncatedSegments).toEqual(['p1.g1.0.spool']);
  });

  it('scan 幂等：二次 scan 不合并陈旧条目（外部删段后 index 反映磁盘事实）', async () => {
    const s = svc();
    await s.append('p1', new Uint8Array([1]));
    const s2 = svc();
    await s2.scan();
    expect(s2.hasFrames('p1')).toBe(true);
    await unlink(join(dir, 'test-owner', 'p1.g1.0.spool'));
    await s2.scan();
    expect(s2.hasFrames('p1')).toBe(false);   // clear 重建——陈旧 meta 保留必红
  });
});

// —— Y0a-3 T4：spool 每实例子目录（R3——fenced 前任并发写防护+P18 boot 收养）——

describe('Y0a-3 R3：每实例子目录（fenced 前任并发写防护+P18 boot 收养）', () => {
  it('双 service 实例同根目录：各写各的 owner 子目录——段名不冲突+scan 后 peek 跨 owner 聚合', async () => {
    const { dir: d, cleanup } = await makeSpoolDir('y0a3-r3-');
    try {
      const a = spoolForTest(d); a.setOwner('owner-A');
      const b = spoolForTest(d); b.setOwner('owner-B');
      await a.append('p1', new Uint8Array([1]));
      await b.append('p1', new Uint8Array([2]));
      const fa = await a.peek('p1');   // a 未重扫——scan 前只见自己（写路径 activeDir）
      expect(fa).toHaveLength(1);
      await b.scan();                  // b 启动扫描=双 owner 全量重建（外来段 boot 收养——P18）
      const fb = await b.peek('p1');
      expect(fb).toHaveLength(2);      // A 残留+B 自有——跨 owner 聚合（前任帧回灌面）
    } finally { await cleanup(); }
  });

  it('跨 owner 回收：B 的 replayAll confirm 后——B/A 段 unlink，owner 目录一律保留（生命周期归进程，回收=boot GC）', async () => {
    const { dir: d, cleanup } = await makeSpoolDir('y0a3-r3-');
    try {
      const a = spoolForTest(d); a.setOwner('owner-A');
      await a.append('p1', new Uint8Array([1]));
      const b = spoolForTest(d); b.setOwner('owner-B');
      await b.scan();
      const repo = { appendBatch: vi.fn(async () => ({ ok: true as const, seq: 1n })) };
      const r = await b.replayAll(repo as any);
      expect(r.replayed).toBe(1);
      expect(b.hasFrames('p1')).toBe(false);           // 全段回收（含 A 的段——unlink 在 A 的子目录内）
      const { existsSync } = await import('node:fs');
      expect(existsSync(join(d, 'owner-A'))).toBe(true);    // TD-33 T2：段清空≠目录删除（写路径零 rmdir）
    } finally { await cleanup(); }
  });

  it('外来段坏尾：静默截断到最后完整帧（sealed=true，不进 truncatedSegments——前任半写=常态）', async () => {
    const { dir: d, cleanup } = await makeSpoolDir('y0a3-r3-foreign-');
    try {
      const a = spoolForTest(d); a.setOwner('owner-A');
      await a.append('p1', new Uint8Array([1]));
      // 造坏尾：直接 append 半个头（不经 service——模拟前任 kill 瞬间）
      const { appendFile } = await import('node:fs/promises');
      await appendFile(join(d, 'owner-A', 'p1.g1.0.spool'), Buffer.alloc(3));
      const b = spoolForTest(d); b.setOwner('owner-B');
      const { truncatedSegments } = await b.scan();
      expect(truncatedSegments).toHaveLength(0);      // 外来坏尾不报告（P18 分档）
      const frames = await b.peek('p1');
      expect(frames.length).toBeGreaterThanOrEqual(1);   // 完整帧仍可回灌
    } finally { await cleanup(); }
  });

  it('容量含外来段（I8/V2）：own+外来合计越限 → append 抛 spool capacity exceeded（熔断不得排除 stranded）', async () => {
    // 预授权适配#1：SPOOL_CAPACITY_BYTES 原为 256MB 常量——构造期读 env 的缝已存在（COLLAB_SPOOL_DIR
    // 同族），小容量替代 ~257MB 大 IO（最轻诚实形态）。env 仅本用例窗口内有效，finally 恢复。
    const { dir: d, cleanup } = await makeSpoolDir('y0a3-r3-cap-');
    const prevCap = process.env.COLLAB_SPOOL_CAPACITY_BYTES;
    process.env.COLLAB_SPOOL_CAPACITY_BYTES = '1024';
    try {
      const a = spoolForTest(d); a.setOwner('owner-A');
      const b = spoolForTest(d); b.setOwner('owner-B');
      // 各自写超过半量（payload 互异防 SHA-256 去重并帧——注③）：b 视角 own(p2)+stranded(p1) 合计越限
      for (let i = 0; i < 7; i++) await a.append('p1', new Uint8Array(64).fill(i));   // 首帧 164+52+64 后每帧 116
      await b.scan();                                                          // p1 → stranded
      let threw = false;
      for (let i = 0; i < 100; i++) {
        try { await b.append('p2', new Uint8Array(64).fill(i + 200)); } catch { threw = true; break; }   // 互异 payload 逐帧增长越限
      }
      expect(threw).toBe(true);
      expect(b.isWritable()).toBe(false);
    } finally {
      if (prevCap === undefined) delete process.env.COLLAB_SPOOL_CAPACITY_BYTES; else process.env.COLLAB_SPOOL_CAPACITY_BYTES = prevCap;
      await cleanup();
    }
  });

  it('depth 分区（P16）：own=stranded 分离+hasForeignSegments 廉价守卫', async () => {
    const { dir: d, cleanup } = await makeSpoolDir('y0a3-r3-depth-');
    try {
      const a = spoolForTest(d); a.setOwner('owner-A');
      await a.append('p1', new Uint8Array([1]));
      const b = spoolForTest(d); b.setOwner('owner-B');
      await b.append('p2', new Uint8Array([2]));
      await b.scan();
      expect(b.hasForeignSegments()).toBe(true);
      const dd = b.depth();
      expect(dd.ownFiles).toBe(1);          // p2（own 口径——部署门）
      expect(dd.strandedFiles).toBe(1);     // p1（外来——磁盘真值部分）
    } finally { await cleanup(); }
  });

  it('adoptSilentForeignSegments（W21）：mtime 静默后收养——foreign=false 纳入 own 口径（T5：owner 目录名=合法 o- 死 owner）', async () => {
    const { dir: d, cleanup } = await makeSpoolDir('y0a3-r3-adopt-');
    try {
      const deadOwner = buildOwnerName(hostname(), 424221);
      const a = spoolForTest(d); a.setOwner(deadOwner);
      await a.append('p1', new Uint8Array([1]));
      const b = new PidSeamSpool(d); b.setOwner('owner-B');
      await b.scan();
      const fresh = await b.adoptSilentForeignSegments(60_000);
      expect(fresh).toHaveLength(0);       // 刚写——mtime 未静默
      const staled = await b.adoptSilentForeignSegments(0);   // 0ms=立即视为静默（测试形态）
      expect(staled).toHaveLength(1);
      expect(b.depth().ownFiles).toBe(1);  // 收养后 own
      expect(b.hasForeignSegments()).toBe(false);
    } finally { await cleanup(); }
  });

  it('owner 未设：activeDir throw（Z13 fail-closed——单测/运维脚本显式 setOwner）', async () => {
    const { dir: d, cleanup } = await makeSpoolDir('y0a3-r3-null-');
    try {
      const s = spoolForTest(d);          // 不 setOwner
      await expect(s.append('p1', new Uint8Array([1]))).rejects.toThrow(/owner not set/);
      await expect(s.scan()).rejects.toThrow(/owner not set/);
    } finally { await cleanup(); }
  });

  it('setOwner 断言文件系统安全名（W4 配套）：含 ":" → throw', async () => {
    const { dir: d, cleanup } = await makeSpoolDir('y0a3-r3-fs-');
    try {
      const s = spoolForTest(d);
      expect(() => s.setOwner('host:123:abc')).toThrow(/文件系统安全/);
    } finally { await cleanup(); }
  });

  it('replayAll 定向回灌（Z11 复用单源）：opts.projectIds 过滤', async () => {
    const { dir: d, cleanup } = await makeSpoolDir('y0a3-r3-replay-');
    try {
      const s = spoolForTest(d); s.setOwner('owner-A');
      await s.append('p1', new Uint8Array([1]));
      await s.append('p2', new Uint8Array([2]));
      const repo = { appendBatch: vi.fn(async () => ({ ok: true as const, seq: 1n })) };
      await s.replayAll(repo as any, { projectIds: ['p1'] });
      expect(s.hasFrames('p1')).toBe(false);
      expect(s.hasFrames('p2')).toBe(true);   // 未点名不回灌
    } finally { await cleanup(); }
  });

  // —— Y1c T8 双评审收口 M3（Q-M8）——
  it('M3：switchGeneration quarantinedBytes 下界 0——legacy <164B 段（bytes-164 为负）按段实际 headerSize 计', async () => {
    const s = svc();
    await s.append('p1', new Uint8Array([1]));   // g1 段 0（164+53=217B）建立 index/p1
    // 白盒注入 legacy 形态段（generation=null+<164B 字节——盘上 legacy 残段的 index 投影形态）
    (s as any).index.get('p1').set('test-owner/p1.0.spool', {
      frameCount: 0, goodBytes: 0, bytes: 10, confirmed: new Set(), confirmedCount: 0,
      sealed: false, quarantinedRange: null, quarantinedBytes: 0, dir: join(dir, 'test-owner'), seq: 0, foreign: false,
      generation: null, seqs: [], frameHashes: [], header: null, segQuarantined: null,
    });
    await s.switchGeneration('p1', 2);
    expect(s.depth().quarantinedBytes, 'legacy 段隔离字节下界 0（旧实现 10-164=-154 必红）').toBeGreaterThanOrEqual(0);
  });
});

/** 暂停缝=protected 单点覆写（生产路径零分支变化，与 syncSegmentHandle 同族）。 */
class PausableSpool extends CollabSpoolService {
  gate: Promise<void> = Promise.resolve();
  readonly entered: Promise<void>;
  private markEntered!: () => void;
  constructor(root: string) {
    super(root); this.setOwner('test-owner'); this.setErasureSource(new EmptyErasureSource());
    this.entered = new Promise<void>((r) => { this.markEntered = r; });
  }
  protected async writeNewSegmentFile(dir: string, projectId: string, generation: number, startSeq: number, header: WalSegmentHeader): Promise<{ seq: number; path: string }> {
    this.markEntered();
    await this.gate;
    return super.writeNewSegmentFile(dir, projectId, generation, startSeq, header);
  }
}

/** pid 存活判据注入缝（TD-33 T5：EPERM/unknown/明确死三档确定性复现）。 */
class PidSeamSpool extends CollabSpoolService {
  verdict: boolean | 'unknown' = false;
  constructor(root?: string) { super(root); this.setErasureSource(new EmptyErasureSource()); }
  protected isPidAlive(): boolean | 'unknown' { return this.verdict; }
}

describe('TD-33 T3：writeNewSegmentFile 单点（EEXIST 重试+暂停缝）', () => {
  it('暂停缝：段头写前可停——停住时盘上零段，放行后落盘且 peek 可读', async () => {
    const s = new PausableSpool(dir);
    let release!: () => void;
    s.gate = new Promise<void>((r) => { release = r; });
    const p = s.append('p1', new Uint8Array([7]));
    await s.entered;
    expect((await readdir(join(dir, 'test-owner'))).filter((f) => f.endsWith('.spool'))).toHaveLength(0);
    release();
    await p;
    expect((await readdir(join(dir, 'test-owner'))).filter((f) => f.endsWith('.spool'))).toEqual(['p1.g1.0.spool']);
    expect(await s.peek('p1')).toHaveLength(1);
  });

  it('EEXIST 重试：盘上占名 0/1 段→落到 2，frameId/meta 与文件名一致且占名段字节不动', async () => {
    await mkdir(join(dir, 'test-owner'), { recursive: true });
    await writeFile(join(dir, 'test-owner', 'p1.g1.0.spool'), Buffer.alloc(3, 0x11));
    await writeFile(join(dir, 'test-owner', 'p1.g1.1.spool'), Buffer.alloc(5, 0x22));
    const s = svc();
    const ids = await s.append('p1', new Uint8Array([1, 2]));
    expect(ids).toHaveLength(1);
    const files = (await readdir(join(dir, 'test-owner'))).filter((f) => f.endsWith('.spool')).sort();
    expect(files).toEqual(['p1.g1.0.spool', 'p1.g1.1.spool', 'p1.g1.2.spool']);
    const frames = await s.peek('p1');
    expect(frames.map((f) => Array.from(f.payload))).toEqual([[1, 2]]);
    expect(frames[0].frameId).toBe('test-owner/p1.g1.2.spool:0');
    expect([...await readFile(join(dir, 'test-owner', 'p1.g1.0.spool'))]).toEqual([0x11, 0x11, 0x11]);
    expect([...await readFile(join(dir, 'test-owner', 'p1.g1.1.spool'))]).toEqual([0x22, 0x22, 0x22, 0x22, 0x22]);
  });

  it('appendBatch 同走单点：占名 0→批量落 1（两调用点不各自实现重试）', async () => {
    await mkdir(join(dir, 'test-owner'), { recursive: true });
    await writeFile(join(dir, 'test-owner', 'p1.g1.0.spool'), Buffer.alloc(3, 0x33));
    const s = svc();
    const out = await s.appendBatch('p1', [new Uint8Array([1]), new Uint8Array([2])]);
    expect(out).toHaveLength(2);
    expect(out.every((f) => f.frameId.startsWith('test-owner/p1.g1.1.spool:'))).toBe(true);
  });
});

describe('TD-33 T4：switchGeneration/quarantineTruncatedFrames 入 per-project WAL 链', () => {
  class ReadPausableSpool extends CollabSpoolService {
    gate: Promise<void> = Promise.resolve();
    readonly entered: Promise<void>;
    private markEntered!: () => void;
    constructor(root: string) {
      super(root); this.setOwner('test-owner'); this.setErasureSource(new EmptyErasureSource());
      this.entered = new Promise<void>((r) => { this.markEntered = r; });
    }
    protected async readSegmentFile(dir: string, name: string): Promise<Buffer | null> {
      this.markEntered();
      await this.gate;
      return super.readSegmentFile(dir, name);
    }
  }

  const pending = <T>(p: Promise<T>): Promise<'pending' | 'done'> =>
    Promise.race([p.then(() => 'done' as const), new Promise<'pending'>((r) => setTimeout(() => r('pending'), 50))]);

  it('switchGeneration 入链：append 持链暂停时 switch 不执行（generation 未写入），放行后按序完成', async () => {
    const s = new PausableSpool(dir);
    let release!: () => void;
    s.gate = new Promise<void>((r) => { release = r; });
    const p = s.append('p1', new Uint8Array([1]));
    await s.entered;
    const g = s.switchGeneration('p1', 2);
    expect(await pending(g)).toBe('pending');
    expect((s as any).projectGeneration.get('p1')).toBeUndefined();   // 旧实现：首行同步置代——此处已是 2
    release();
    await p; await g;
    expect((s as any).projectGeneration.get('p1')).toBe(2);
  });

  it('quarantineTruncatedFrames 入链：append 持链暂停时隔离不执行（旧实现立即跑完=done）', async () => {
    const s = new PausableSpool(dir);
    let release!: () => void;
    s.gate = new Promise<void>((r) => { release = r; });
    const p = s.append('p1', new Uint8Array([1]));
    await s.entered;
    const q = s.quarantineTruncatedFrames('p1');
    expect(await pending(q)).toBe('pending');
    release();
    await p;
    await expect(q).resolves.toBe(0);
  });

  it('readSegmentFile ENOENT 跳过：隔离暂停窗内段被外部 unlink→不抛、返回 0', async () => {
    const s = new ReadPausableSpool(dir);
    await s.append('p1', new Uint8Array([1]));
    let release!: () => void;
    s.gate = new Promise<void>((r) => { release = r; });
    const q = s.quarantineTruncatedFrames('p1');
    await s.entered;
    await unlink(join(dir, 'test-owner', 'p1.g1.0.spool'));
    release();
    await expect(q).resolves.toBe(0);
  });

  it('foreign 段零 sidecar：收养的前任段不被 quarantine 处置', async () => {
    const { dir: d, cleanup } = await makeSpoolDir('td33-t4-foreign-');
    try {
      const a = spoolForTest(d); a.setOwner('owner-A');
      await a.append('p1', new Uint8Array([1]));
      const segFile = join(d, 'owner-A', 'p1.g1.0.spool');
      await appendFile(segFile, Buffer.alloc(10, 0x99));   // 外部追加坏尾
      const b = spoolForTest(d); b.setOwner('owner-B');
      await b.scan();
      await expect(b.quarantineTruncatedFrames('p1')).resolves.toBe(0);
      const { existsSync } = await import('node:fs');
      expect(existsSync(`${segFile}.quarantine`)).toBe(false);
    } finally { await cleanup(); }
  });

  it('同项目并发 confirm×quarantine：quarantine 持链读窗内 confirm 排队→零 ENOENT 零残留（旧实现无链=unlink 先至必红）', async () => {
    const s = new ReadPausableSpool(dir);
    const ids = await s.append('p1', new Uint8Array([1]));
    let release!: () => void;
    s.gate = new Promise<void>((r) => { release = r; });
    const q = s.quarantineTruncatedFrames('p1');
    await s.entered;                       // quarantine 已持链并暂停在读口
    const c = s.confirm('p1', ids);         // 新实现排队（同链）；旧实现立即 unlink→q 读 ENOENT
    release();
    await expect(q).resolves.toBe(0);       // 干净段 no-op（读发生在 unlink 前）
    await c;
    expect(await readdir(join(dir, 'test-owner')).catch(() => [] as string[])).toHaveLength(0);
  });
});

describe('TD-33 T5：收录面三防护（adopt/recoverScan 同判+floor/dedup+擦除谓词）', () => {
  it('live foreign owner 不收养：parse 成功∧同 host∧pid 活→adopt 跳过且文件不动', async () => {
    const liveOwner = buildOwnerName(hostname(), process.pid);   // 本进程 pid=必然活
    const a = spoolForTest(dir); a.setOwner(liveOwner);
    await a.append('p1', new Uint8Array([1]));
    const b = new PidSeamSpool(dir); b.setOwner('mine'); b.verdict = true;
    await b.scan();
    await expect(b.adoptSilentForeignSegments(0)).resolves.toHaveLength(0);
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(dir, liveOwner, 'p1.g1.0.spool'))).toBe(true);
  });

  it('三档负控（unknown 承载 EPERM/parse fail/跨 host）：一律不收养不 unlink 不 sidecar', async () => {
    const cases: Array<{ label: string; dirName: string; verdict: boolean | 'unknown' }> = [
      { label: 'unknown(EPERM)', dirName: buildOwnerName(hostname(), 424201), verdict: 'unknown' },
      { label: 'parse fail', dirName: 'owner-A', verdict: false },
      { label: '跨 host', dirName: buildOwnerName('some-other-host', 424202), verdict: false },
    ];
    for (const c of cases) {
      const { dir: d, cleanup } = await makeSpoolDir('td33-t5-neg-');
      try {
        const a = spoolForTest(d); a.setOwner(c.dirName);
        await a.append('p1', new Uint8Array([1]));
        const b = new PidSeamSpool(d); b.setOwner('mine'); b.verdict = c.verdict;
        await b.scan();
        await expect(b.adoptSilentForeignSegments(0), c.label).resolves.toHaveLength(0);
        const { existsSync } = await import('node:fs');
        expect(existsSync(join(d, c.dirName, 'p1.g1.0.spool')), c.label).toBe(true);
        expect(existsSync(join(d, c.dirName, 'p1.g1.0.spool.quarantine')), c.label).toBe(false);
      } finally { await cleanup(); }
    }
  });

  it('recoverScan 收录面同判：live foreign 段不入 index、零 sidecar、报告零项目', async () => {
    const liveOwner = buildOwnerName(hostname(), process.pid);
    const a = spoolForTest(dir); a.setOwner(liveOwner);
    await a.append('p1', new Uint8Array([1]));
    const b = new PidSeamSpool(dir); b.setOwner('mine'); b.verdict = true;
    const report = await b.recoverScan({ systemHistory: { historyId: 'h', epochStartedAtMs: 0 }, pgSeq: () => 0n });
    expect(report.projects).toHaveLength(0);
    expect((b as any).index.has('p1')).toBe(false);
    expect(await b.peek('p1')).toHaveLength(0);
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(dir, liveOwner, 'p1.g1.0.spool'))).toBe(true);
    expect(existsSync(join(dir, liveOwner, 'p1.g1.0.spool.quarantine'))).toBe(false);
  });

  it('干净分支收养：抬 floor+入 dedup——新帧 seq 承接收养段尾，同字节重发命中原帧（ACK 铁律）', async () => {
    const deadOwner = buildOwnerName(hostname(), 424211);
    const a = spoolForTest(dir); a.setOwner(deadOwner);
    const p1 = new Uint8Array([11]); const p2 = new Uint8Array([22]);
    await a.append('p1', p1); await a.append('p1', p2);
    const b = new PidSeamSpool(dir); b.setOwner('mine'); b.verdict = false;
    await b.scan();
    // 模拟「重建后漂移」：换代 dedupClearProject/运行期新段不进 rebuild——收养分支必须自行抬 floor+入 dedup
    (b as any).walSeqCounters.delete('p1');
    (b as any).dedupClearProject('p1');
    const adopted = await b.adoptSilentForeignSegments(0);
    expect(adopted).toHaveLength(1);
    const resend = await b.appendTracked('p1', p1);
    expect(resend.dedup).toBe(true);
    expect(resend.frameId).toBe(`${deadOwner}/p1.g1.0.spool:0`);
    const next = await b.appendTracked('p1', new Uint8Array([33]));
    expect(next.walSeq).toBe(3n);   // 承接收养段 seq 2——旧实现干净分支不抬 floor→1（dup-seq 破口）
  });

  it('擦除过滤谓词：blocked pid 不收养（C1a 默认恒 false；C1b T9 接线 registry）', async () => {
    const deadOwner = buildOwnerName(hostname(), 424212);
    const a = spoolForTest(dir); a.setOwner(deadOwner);
    await a.append('p1', new Uint8Array([1]));
    const b = new PidSeamSpool(dir); b.setOwner('mine'); b.verdict = false;
    await b.scan();
    b.setErasureGuard({ isBlocked: (pid) => (pid === 'p1' ? 'ERASING' : undefined) });
    await expect(b.adoptSilentForeignSegments(0)).resolves.toHaveLength(0);
  });

  class AdoptPausableSpool extends PidSeamSpool {
    gate: Promise<void> = Promise.resolve();
    readonly entered: Promise<void>;
    private markEntered!: () => void;
    constructor(root: string) {
      super(root); this.setOwner('mine');
      this.entered = new Promise<void>((r) => { this.markEntered = r; });
    }
    protected async readSegmentFile(dir: string, name: string): Promise<Buffer | null> {
      this.markEntered();
      await this.gate;
      return super.readSegmentFile(dir, name);
    }
  }

  it('暂停交叉零幽灵段：adopt 读窗内段被 confirm 回收→链内复核拒收养（index 无幽灵条目）', async () => {
    const deadOwner = buildOwnerName(hostname(), 424213);
    const a = spoolForTest(dir); a.setOwner(deadOwner);
    const ids = await a.append('p1', new Uint8Array([1]));
    const b = new AdoptPausableSpool(dir);
    await b.scan();
    let release!: () => void;
    b.gate = new Promise<void>((r) => { release = r; });
    const adoptP = b.adoptSilentForeignSegments(0);
    await b.entered;
    await b.confirm('p1', ids);   // 读窗内段被回收（全帧 confirmed→unlink→index 键删）
    release();
    await expect(adoptP).resolves.toHaveLength(0);
    expect((b as any).index.has('p1')).toBe(false);   // 零幽灵段
    expect(existsSync(join(dir, deadOwner, 'p1.g1.0.spool'))).toBe(false);
  });

  it('根平铺 legacy 段（dir=root≠adir）同判：不收录零写入（report.foreignSkipped 计数，处置走 runbook 手工）', async () => {
    await writeFile(join(dir, 'p1.g1.0.spool'), Buffer.alloc(200, 0));
    const s = new PidSeamSpool(dir); s.setOwner('mine');
    const report = await s.recoverScan({ systemHistory: { historyId: 'h', epochStartedAtMs: 0 }, pgSeq: () => 0n });
    expect(report.projects).toHaveLength(0);
    expect(report.foreignSkipped).toBe(1);
    expect(existsSync(join(dir, 'p1.g1.0.spool'))).toBe(true);
    expect(existsSync(join(dir, 'p1.g1.0.spool.quarantine'))).toBe(false);
  });

  it('非 ENOENT 读失败=fail-closed：readSegmentFile 抛 EACCES→recoverScan 拒绝（不静默丢段）', async () => {
    class ReadFailSpool extends PidSeamSpool {
      protected async readSegmentFile(): Promise<Buffer | null> { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); }
    }
    const a = spoolForTest(dir); a.setOwner(buildOwnerName(hostname(), 424214));
    await a.append('p1', new Uint8Array([1]));
    const b = new ReadFailSpool(dir); b.setOwner('mine');
    await expect(b.recoverScan({ systemHistory: { historyId: 'h', epochStartedAtMs: 0 }, pgSeq: () => 0n })).rejects.toThrow(/EACCES/);
  });

  it('scan() 退役面：生产源码零 scan() 调用（含 src 全树，排除测试/测试装置；boot 唯一扫描=recoverScan）', async () => {
    const { readdir: rd, readFile: rf } = await import('node:fs/promises');
    const root = join(process.cwd(), 'src');   // vitest cwd=包根（apps/api）
    const files: string[] = [];
    const walk = async (d: string): Promise<void> => {
      for (const e of await rd(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) { if (e.name !== 'test-utils') await walk(p); continue; }
        if (e.name.endsWith('.ts') && !e.name.includes('.spec.')) files.push(p);
      }
    };
    await walk(root);
    const hits: string[] = [];
    for (const f of files) {
      const src = await rf(f, 'utf8');
      for (const line of src.split('\n')) {
        const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');   // 排注释（JSDoc/行内）
        if (/\.scan\(\)/.test(code)) hits.push(`${f}: ${line.trim()}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('TD-33 T6：reclaimStaleOwnerDirs（boot GC——空目录+明确死+年龄下限）', () => {
  const mk = async (name: string): Promise<string> => {
    const p = join(dir, name);
    await mkdir(p, { recursive: true });
    return p;
  };
  const age = async (p: string, ms: number): Promise<void> => {
    const t = new Date(Date.now() - ms);
    await utimes(p, t, t);
  };

  it('dead pid：mtime<10min 留；≥10min 删+counter delta=1', async () => {
    const reg = (await import('prom-client')).register;
    const metric = reg.getSingleMetric('yjs_spool_owner_dir_reclaimed_total')!;
    const before = (await metric.get()).values[0]?.value ?? 0;
    const s = new PidSeamSpool(dir); s.setOwner('mine');
    const fresh = await mk(buildOwnerName(hostname(), 424301));
    await age(fresh, 9 * 60_000);
    expect(await s.reclaimStaleOwnerDirs()).toBe(0);
    expect(existsSync(fresh)).toBe(true);
    const stale = await mk(buildOwnerName(hostname(), 424302));
    await age(stale, 11 * 60_000);
    expect(await s.reclaimStaleOwnerDirs()).toBe(1);
    expect(existsSync(stale)).toBe(false);
    expect(((await metric.get()).values[0]?.value ?? 0) - before).toBe(1);
  });

  it('live/unknown pid 一律留（EPERM=活语义——僵尸未 reap 前新鲜死亡天然跳过）', async () => {
    const s = new PidSeamSpool(dir); s.setOwner('mine');
    const pLive = await mk(buildOwnerName(hostname(), 424303));
    const pUnknown = await mk(buildOwnerName(hostname(), 424304));
    await age(pLive, 60 * 60_000); await age(pUnknown, 60 * 60_000);
    s.verdict = true;
    expect(await s.reclaimStaleOwnerDirs()).toBe(0);
    s.verdict = 'unknown';
    expect(await s.reclaimStaleOwnerDirs()).toBe(0);
    expect(existsSync(pLive)).toBe(true); expect(existsSync(pUnknown)).toBe(true);
  });

  it('跨 host：<24h 留、>24h 删', async () => {
    const s = new PidSeamSpool(dir); s.setOwner('mine');
    const fresh = await mk(buildOwnerName('other-host', 424305));
    const old = await mk(buildOwnerName('other-host', 424306));
    await age(fresh, 23 * 3600_000); await age(old, 25 * 3600_000);
    expect(await s.reclaimStaleOwnerDirs()).toBe(1);
    expect(existsSync(fresh)).toBe(true); expect(existsSync(old)).toBe(false);
  });

  it('非 owner 名（tmp/owner-A/格式合法无前缀/host 含 owner-like 后缀）、非空、当前 owner、幂等：一律留', async () => {
    const s = new PidSeamSpool(dir); s.setOwner('mine'); s.verdict = true;   // 当前 owner pid=本进程（活）
    const keep = [
      await mk('tmp'),
      await mk('owner-A'),
      await mk('host-12345678-1234-abc-abcdef'),
      await mk('x-o-y-z-12345678-1234-abc-abcdef'),
      await mk(buildOwnerName(hostname(), process.pid)),
    ];
    const nonEmpty = await mk(buildOwnerName(hostname(), 424307));
    await writeFile(join(nonEmpty, 'keep.txt'), 'x');
    for (const p of [...keep, nonEmpty]) await age(p, 48 * 3600_000);
    expect(await s.reclaimStaleOwnerDirs()).toBe(0);
    for (const p of [...keep, nonEmpty]) expect(existsSync(p), p).toBe(true);
    expect(await s.reclaimStaleOwnerDirs()).toBe(0);   // 幂等
  });

  it('根 ENOENT 不抛：未建根目录→0', async () => {
    const s = new PidSeamSpool(join(dir, 'nope')); s.setOwner('mine');
    await expect(s.reclaimStaleOwnerDirs()).resolves.toBe(0);
  });
});

describe('TD-33 T10：assertNotErased 双层+typed 错误+计账单源', () => {
  const guard = (state: 'ERASING' | 'ERASED' | undefined) => ({ isBlocked: () => state });

  it('三入口拒：append/appendTracked/appendBatch 抛 SpoolProjectBlockedError（state 透传）', async () => {
    const s = svc();
    s.setErasureGuard(guard('ERASING'));
    await expect(s.append('p1', new Uint8Array([1]))).rejects.toMatchObject({ name: 'SpoolProjectBlockedError', state: 'ERASING' });
    await expect(s.appendTracked('p1', new Uint8Array([1]))).rejects.toMatchObject({ state: 'ERASING' });
    await expect(s.appendBatch('p1', [new Uint8Array([1])])).rejects.toMatchObject({ state: 'ERASING' });
  });

  it('ERASED 档同拒；__probe__ 放行（探针必须真写否则熔断永不解）', async () => {
    const s = svc();
    s.setErasureGuard(guard('ERASED'));
    await expect(s.append('p1', new Uint8Array([1]))).rejects.toMatchObject({ state: 'ERASED' });
    await expect(s.append('__probe__', new Uint8Array([7]))).resolves.toHaveLength(1);
  });

  it('dedup 命中前拒：已存 payload 重发仍拒、不返回原 frameId、不烧 seq', async () => {
    const s = svc();
    const p = new Uint8Array([5]);
    await s.append('p1', p);
    const seqBefore = s.peekNextWalSeq('p1');
    s.setErasureGuard(guard('ERASING'));
    await expect(s.append('p1', p)).rejects.toBeInstanceOf(SpoolProjectBlockedError);
    expect(s.peekNextWalSeq('p1')).toBe(seqBefore);
    expect(await s.peek('p1')).toHaveLength(1);
  });

  it('链内层闭环：外层过检→持链暂停→期间 mark→链尾断言拒，磁盘零幽灵段', async () => {
    const state = { now: undefined as 'ERASING' | undefined };   // 可变态盒（外层闭包读→链中改写；let 触发 prefer-const 误报）
    const s = new PausableSpool(dir);
    s.setErasureGuard({ isBlocked: () => state.now });
    let release!: () => void;
    s.gate = new Promise<void>((r) => { release = r; });
    const p1 = s.append('p1', new Uint8Array([1]));
    await s.entered;                                   // #1 已过两层检查，暂停在新建段
    const p2 = s.append('p1', new Uint8Array([2]));    // 外层检查此刻通过；排队等链
    state.now = 'ERASING';
    release();
    await p1;
    await expect(p2).rejects.toBeInstanceOf(SpoolProjectBlockedError);   // 链内层拒（幽灵段窗闭环）
    expect(await s.peek('p1')).toHaveLength(1);
    const files = (await readdir(join(dir, 'test-owner'))).filter((f) => f.endsWith('.spool'));
    expect(files).toHaveLength(1);
  });

  it('guard 缺失→ERASURE_GUARD_MISSING typed 错误（不静默放行）', async () => {
    const s = new CollabSpoolService(dir);
    s.setOwner('o1');
    await expect(s.append('p1', new Uint8Array([1]))).rejects.toBeInstanceOf(SpoolErasureGuardMissingError);
  });

  it('append 计账：blocked 不计 IO streak；dedup 命中不计成功（薄包装仍是计账 owner）', async () => {
    const s = svc();
    s.setErasureGuard(guard('ERASING'));
    await expect(s.append('p1', new Uint8Array([9]))).rejects.toBeInstanceOf(SpoolProjectBlockedError);
    expect(s.failureStreak()).toBe(0);                 // blocked=终态拒绝，不计熔断
    expect(s.isWritable()).toBe(true);

    const s2 = svc();
    const successSpy = vi.spyOn(s2 as unknown as { noteWriteSuccess: () => void }, 'noteWriteSuccess');
    const p = new Uint8Array([3]);
    await s2.append('p1', p);
    const afterNew = successSpy.mock.calls.length;
    expect(afterNew).toBe(1);
    await s2.append('p1', p);                          // dedup 命中
    expect(successSpy.mock.calls.length).toBe(afterNew);   // 不计成功（原状早退语义）
  });
});

describe('TD-33 T14：purge 复检/sweep/recoverScan 排除', () => {
  const docsStub = () => ({ isLeaseServing: () => true, invalidateSnapshotCache: vi.fn() });
  const mkSource = (over: Partial<{ purgeable: string[]; live: (pids: string[]) => Promise<Set<string>> }> = {}) => {
    const blocked = new Map<string, 'ERASING' | 'ERASED'>();
    const mark = vi.fn((pid: string, state: 'ERASING' | 'ERASED') => { blocked.set(pid, state); });
    const src = {
      load: vi.fn(async () => {}),
      refresh: vi.fn(async () => {}),
      isBlocked: (pid: string) => blocked.get(pid),
      blockedMap: () => blocked,
      listPurgeableProjectIds: () => over.purgeable ?? [],
      listPurgeableProjectIdsLive: over.live ?? (async (pids: string[]) => new Set(pids)),
      mark,
    };
    return { blocked, mark, src };
  };

  it('purge live 复检：非 purgeable→400（带 missingProjectIds）+零删除零 mark', async () => {
    const s = svc();
    await s.append('p1', new Uint8Array([1]));
    const { src, mark } = mkSource({ live: async () => new Set<string>() });
    await expect(s.purgeErasureScope(['p1'], { docs: docsStub(), erasure: src }))
      .rejects.toMatchObject({ response: { code: 'PROJECT_NOT_PURGEABLE', missingProjectIds: ['p1'] } });
    expect(mark).not.toHaveBeenCalled();
    expect((await readdir(join(dir, 'test-owner'))).filter((f) => f.endsWith('.spool'))).toHaveLength(1);
    expect(s.hasFrames('p1')).toBe(true);
  });

  it('purge 正常：mark 先于清理+返回 markedProjectIds+段/sidecar 同清+幂等', async () => {
    const s = svc();
    await s.append('p1', new Uint8Array([1]));
    await appendFile(join(dir, 'test-owner', 'p1.g1.0.spool'), Buffer.alloc(5, 0x99));   // 坏尾→quarantine 前置
    await s.quarantineTruncatedFrames('p1');
    const { src, blocked, mark } = mkSource();
    const r = await s.purgeErasureScope(['p1'], { docs: docsStub(), erasure: src });
    expect(r.markedProjectIds).toEqual(['p1']);
    expect(blocked.get('p1')).toBe('ERASED');
    expect(mark).toHaveBeenCalledTimes(1);
    expect((await readdir(join(dir, 'test-owner'))).filter((f) => f.startsWith('p1.'))).toHaveLength(0);   // 段+sidecar 同清
    const again = await s.purgeErasureScope(['p1'], { docs: docsStub(), erasure: src });
    expect(again.purgedSegments).toBe(0);   // 幂等
  });

  it('boot sweep（load 后 purgeable 残段）：mark 先于 drop；盘上无文件=no-op', async () => {
    const s = svc();
    await s.append('p1', new Uint8Array([1]));
    const { src, blocked } = mkSource({ purgeable: ['p1', 'p-none'] });
    s.setErasureSource(src);
    await s.sweepPurgeableSpoolOnLoad();
    expect(blocked.get('p1')).toBe('ERASED');
    expect((await readdir(join(dir, 'test-owner'))).filter((f) => f.startsWith('p1.'))).toHaveLength(0);
    expect(s.hasFrames('p1')).toBe(false);
  });

  it('serving 60s live sweep：候选=盘上 pid，live 只回 p1→p1 清/p2 留+purgeable_spool_bytes gauge', async () => {
    const s = svc();
    await s.append('p1', new Uint8Array([1]));
    await s.append('p2', new Uint8Array([2]));
    const { src } = mkSource({ live: async (pids) => new Set(pids.filter((p) => p === 'p1')) });
    s.setErasureSource(src);
    await s.sweepPurgeableSpoolLive(src);
    const files = await readdir(join(dir, 'test-owner'));
    expect(files.some((f) => f.startsWith('p1.'))).toBe(false);
    expect(files.some((f) => f.startsWith('p2.'))).toBe(true);
    const reg = (await import('prom-client')).register;
    expect((await reg.getSingleMetric('purgeable_spool_bytes')!.get()).values[0]?.value ?? 0).toBeGreaterThan(0);
  });

  it('recoverScan excludeProjectIds：blocked 段不判不收不写（文件保留+计数），其余项目照常重放', async () => {
    const s = svc();
    await s.append('p1', new Uint8Array([1]));
    await s.append('p2', new Uint8Array([2]));
    const reg = (await import('prom-client')).register;
    const before = (await reg.getSingleMetric('blocked_spool_preserved_total')!.get()).values[0]?.value ?? 0;
    const s2 = svc();
    const report = await s2.recoverScan({ systemHistory: { historyId: '', epochStartedAtMs: 0 }, pgSeq: () => 0n, excludeProjectIds: ['p1'] });
    expect(report.projects.map((p) => p.projectId)).toEqual(['p2']);
    expect((s2 as any).index.has('p1')).toBe(false);
    expect((await readdir(join(dir, 'test-owner'))).some((f) => f.startsWith('p1.'))).toBe(true);
    expect(((await reg.getSingleMetric('blocked_spool_preserved_total')!.get()).values[0]?.value ?? 0) - before).toBe(1);
  });

  it('sweep 先 mark：drop 调用时屏障已生效（顺序断言）+残留段清空；boot sweep 同序', async () => {
    const s = svc();
    await s.append('p1', new Uint8Array([1]));
    const { src, blocked } = mkSource({ live: async (pids) => new Set(pids.filter((p) => p === 'p1')), purgeable: ['p1'] });
    s.setErasureSource(src);
    const seen: Array<string | undefined> = [];
    const orig = (s as any).dropSpoolProjectState.bind(s);
    (s as any).dropSpoolProjectState = async (pid: string, opts: unknown) => { seen.push(blocked.get(pid)); return orig(pid, opts); };
    await s.sweepPurgeableSpoolLive(src);
    expect(seen).toEqual(['ERASED']);                 // mark 先于 drop（in-flight append 链内层拒的判据源）
    expect(s.hasFrames('p1')).toBe(false);
    expect((await readdir(join(dir, 'test-owner'))).filter((f) => f.startsWith('p1.'))).toHaveLength(0);
  });

  it('purge 大项目后容量回落：overCapacityFlag→false+onRecovered 唤醒（其他项目 append 放行）', async () => {
    const s = svc();
    await s.append('p1', new Uint8Array([1]));
    (s as any).overCapacityFlag = true;                // 白盒置容量态（V14 同款）
    const onRecovered = vi.fn();
    s.onRecovered = onRecovered;
    const { src } = mkSource();
    await s.purgeErasureScope(['p1'], { docs: docsStub(), erasure: src });
    expect((s as any).overCapacityFlag).toBe(false);
    expect(onRecovered).toHaveBeenCalledTimes(1);
    await expect(s.append('p2', new Uint8Array([2]))).resolves.toHaveLength(1);   // 容量回落→放行
  });

  it('DB 权威非 transport 态：503/handover 后同一权威源仍拒写（新 spool 实例不复位屏障）', async () => {
    const { src, mark } = mkSource();
    mark('p1', 'ERASED');
    const a = spoolForTest(dir); a.setErasureSource(src); a.setOwner('test-owner');
    await expect(a.append('p1', new Uint8Array([1]))).rejects.toBeInstanceOf(SpoolProjectBlockedError);
    const b = spoolForTest(dir); b.setErasureSource(src); b.setOwner('test-owner');   // handover/重启形态
    await expect(b.append('p1', new Uint8Array([2]))).rejects.toBeInstanceOf(SpoolProjectBlockedError);
  });
});
