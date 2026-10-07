// Y0a-2：spool 单测——真文件系统（tmp 目录），禁 mock fs（文件系统语义正是被测对象）。
// 注①（对 plan 文本的算术修正）：段滚动用例 payload 取 2,500,000B——plan 原值 1,500,000B 时
// 3 次追加在 4MB 段上限下只产生 2 段（1.5+1.5=3.0MB 未超限），断言 3 段必红；2.5MB 每帧使
// 第 2/3 次追加均超限滚动，3 段断言与「跨段 peek」意图同时成立。
// 注②（对 plan 文本的前提修正）：崩溃语义用例若对单帧段全量 confirm，按 confirm 回收判据
// （用例 2 锁定的整段 unlink 语义）段文件已删除，重启 scan 后磁盘为空，断言必红；改为两帧中
// confirm 一帧（段保留）——confirmed 集在内存、崩溃即丢，重启后含已 confirm 帧在内全部帧重新
// 可见，正是「幂等降级」要验证的完整语义（service 头注释同款表述）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { crc32 } from 'node:zlib';
import * as Y from 'yjs';
import { CollabSpoolService } from './collab-spool.service';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createMockRepo } from '../../test-utils/mock-repo';

let dir: string; let cleanup: () => Promise<void>;
beforeEach(async () => { ({ dir, cleanup } = await makeSpoolDir()); });   // V17①：每用例独立目录
afterEach(async () => { await cleanup(); });

function svc(): CollabSpoolService { const s = new CollabSpoolService(dir); s.setOwner('test-owner'); return s; }   // 每用例新实例=崩溃模拟（内存 index/confirmed 丢失）；R3：写/扫路径必先 setOwner（Z13）

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
    expect((await readFile(join(dir, 'test-owner', files[0]))).byteLength).toBe(8 + 5 + 8 + 2);
    expect(s.hasFrames('p1')).toBe(true);
  });

  it('confirm 段回收触发点①：全部帧 confirmed→段文件 unlink+键集删除；部分 confirm 保留', async () => {
    const s = svc();
    const a = await s.append('p1', new Uint8Array([1]));
    const b = await s.append('p1', new Uint8Array([2]));
    await s.confirm('p1', [a[0]]);                       // 部分：段保留
    expect((await readdir(join(dir, 'test-owner'))).some((f) => f.endsWith('.spool'))).toBe(true);
    await s.confirm('p1', b);                             // 全部：整段 unlink
    expect((await readdir(join(dir, 'test-owner')).catch(() => [] as string[])).filter((f) => f.endsWith('.spool'))).toHaveLength(0);   // R3：末段回收后空 owner 目录已 rmdir——ENOENT 视为空
    expect(s.hasFrames('p1')).toBe(false);
    expect(await s.peek('p1')).toEqual([]);               // 键已删
  });

  it('段滚动：累计写超 4MB 滚动新段（文件名 segSeq 递增）；跨段 peek 全量返回', async () => {
    const s = svc();
    const big = new Uint8Array(2_500_000); big.fill(7);   // 注①：每帧 2.5MB——两帧即超 4MB 段上限
    await s.append('p1', big); await s.append('p1', big); await s.append('p1', big);   // 7.5MB → 3 段
    const files = (await readdir(join(dir, 'test-owner'))).filter((f) => f.endsWith('.spool')).sort();
    expect(files).toHaveLength(3);
    expect(files[0]).toBe('p1.0.spool'); expect(files[2]).toBe('p1.2.spool');
    const frames = await s.peek('p1');
    expect(frames).toHaveLength(3);
    expect(frames[0].frameId.endsWith('p1.0.spool:0')).toBe(true);   // R3：frameId=segKey:idx（owner 前缀）
    expect(frames[2].frameId.endsWith('p1.2.spool:0')).toBe(true);
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
    // 手工追加坏帧：长度声明 100 但实际 payload 2 字节（截断形态）
    const file = join(dir, 'test-owner', 'p1.0.spool');
    const bad = Buffer.alloc(8 + 2);
    bad.writeUInt32LE(100, 0); bad.writeUInt32LE(crc32(Buffer.from([9, 9])), 4); bad[8] = 9; bad[9] = 9;
    await writeFile(file, Buffer.concat([await readFile(file), bad]));   // 默认 'w' 整写=读旧+拼新（注④：plan 的 flag:'a' 会把旧内容再追加一遍——双帧假象）
    const s2 = svc(); await s2.scan();
    const frames = await s2.peek('p1');
    expect(frames).toHaveLength(1);                       // 只有 good 帧；坏帧停读
    const after = await count();
    expect(after - before).toBe(1);
  });

  it('V2 段封禁：段尾注入坏字节→append 守卫滚动新段→重启 scan 后坏尾前后帧全部可 peek（v1 黑洞形态必红）', async () => {
    const s = svc();
    await s.append('p1', new Uint8Array([1]));                       // 段 0 帧 0（干净：goodBytes===bytes===9）
    const file = join(dir, 'test-owner', 'p1.0.spool');
    const junk = Buffer.alloc(2, 0x99);
    await writeFile(file, Buffer.concat([await readFile(file), junk]));   // 外部坏尾：磁盘 11 字节≠内存记账 9（整写同注④）
    await s.append('p1', new Uint8Array([3]));                       // 追加前守卫 stat.size(11)≠bytes(9)→封段 0 滚动段 1
    const files = (await readdir(join(dir, 'test-owner'))).filter((f) => f.endsWith('.spool')).sort();
    expect(files).toEqual(['p1.0.spool', 'p1.1.spool']);             // 段 0 封存+段 1 承接新帧
    const s2 = svc(); await s2.scan();
    const frames = await s2.peek('p1');
    expect(frames).toHaveLength(2);                                  // 段 0 帧 0+段 1 帧 0 全可读——v1 黑洞（继续追加坏尾段）下段 1 帧永不可读=红
  });
});

describe('V15 目录 fail-fast（validateDir——gateway 调用点归 Task 3/4）', () => {
  it('production+相对路径→throw；非 production 返回解析后的绝对路径', () => {
    const prev = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      expect(() => new CollabSpoolService('./relative-spool').validateDir()).toThrow(/绝对路径/);
      process.env.NODE_ENV = 'development';
      expect(isAbsolute(new CollabSpoolService('./relative-spool').validateDir())).toBe(true);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

// —— Y0a-2 Task 2：spool 完整语义（quarantine sidecar/两态熔断+探针/启动回灌）——

describe('spool quarantine sidecar（v2.4：标记不搬字节——追加-only 段内移帧物理不可行）', () => {
  it('坏帧段：非隔离帧全 confirm→段可回收（unlink 条件≠全部帧 confirmed）+sidecar 保留记录', async () => {
    const s = svc();
    const ids = await s.append('p1', new Uint8Array([1]));               // 好帧 0:0
    // 追加坏帧（CRC 错）——真实故障形态：落盘不完整
    const file = join(dir, 'test-owner', 'p1.0.spool');
    const bad = Buffer.alloc(8 + 2);
    bad.writeUInt32LE(2, 0); bad.writeUInt32LE(0xdeadbeef, 4); bad[8] = 1; bad[9] = 2;
    await writeFile(file, Buffer.concat([await readFile(file), bad]));   // 勘误：无 flag 整写
    const s2 = svc();
    const report = await s2.scan();
    expect(report.truncatedSegments).toEqual(['p1.0.spool']);
    const quarantined = await s2.quarantineTruncatedFrames('p1');       // 坏帧段处置：非隔离帧重新可见
    expect(quarantined).toBeGreaterThan(0);                              // 隔离帧数（0:1）
    expect(await s2.peek('p1')).toHaveLength(1);                         // 好帧 0:0 仍可回灌
    const sidecar = join(dir, 'test-owner', 'p1.0.spool.quarantine');
    const sidecarLines = (await readFile(sidecar, 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(sidecarLines.at(-1)).toMatchObject({ segSeq: 0, quarantinedFromOffset: 9 });   // V3 字节区间形态
    await s2.confirm('p1', ids);                                          // 唯一非隔离帧 confirm→段回收（R3：frameId=segKey:idx——capture 后跨实例同 owner 同键）
    const after = await readdir(join(dir, 'test-owner')).catch(() => [] as string[]);   // R3：末段回收后空 owner 目录已 rmdir
    expect(after.filter((f) => f.endsWith('.spool'))).toHaveLength(0);
    expect(after.filter((f) => f.endsWith('.quarantine'))).toHaveLength(0);   // sidecar 随段清理
  });

  it('V3/E5 容量核算含隔离字节+隔离区间=字节偏移口径：quarantinedBytes=坏帧起始偏移→EOF（含坏帧头）', async () => {
    const s = svc();
    await s.append('p1', new Uint8Array(1024));                       // 好帧=8+1024=1032
    const bad = Buffer.alloc(8 + 512);
    bad.writeUInt32LE(512, 0); bad.writeUInt32LE(0, 4);   // CRC 恒不匹配
    await writeFile(join(dir, 'test-owner', 'p1.0.spool'), Buffer.concat([await readFile(join(dir, 'test-owner', 'p1.0.spool')), bad]));   // 勘误：无 flag
    const s2 = svc(); await s2.scan();
    await s2.quarantineTruncatedFrames('p1');
    const d = s2.depth();
    expect(d.quarantinedBytes).toBe(520);                             // 1552-1032=520（v1 的 -8 off-by-8 必红）
    expect(d.ownBytes + d.strandedBytes).toBe(1552);                  // V14：容量核算=总字节（R3 五元组=own+stranded 磁盘真值）
  });

  it('sidecar 写失败→异常上抛且 meta 未动（quarantinedRange 仍 null）——段与坏尾证据保留可重试（ENOSPC 同型：先记账后落盘=证据销毁必红）', async () => {
    const s = svc();
    await s.append('p1', new Uint8Array([1]));                          // 好帧 0:0（9B）
    const bad = Buffer.alloc(8 + 2);                                    // 坏尾（CRC 错）
    bad.writeUInt32LE(2, 0); bad.writeUInt32LE(0xdeadbeef, 4); bad[8] = 1; bad[9] = 2;
    await writeFile(join(dir, 'test-owner', 'p1.0.spool'), Buffer.concat([await readFile(join(dir, 'test-owner', 'p1.0.spool')), bad]));
    const s2 = svc(); await s2.scan();
    await mkdir(join(dir, 'test-owner', 'p1.0.spool.quarantine'));      // 目录占位 sidecar 路径→open('a') throw（同幻影 meta 用例 EISDIR 形态）
    await expect(s2.quarantineTruncatedFrames('p1')).rejects.toBeInstanceOf(Error);
    expect((s2 as any).index.get('p1').get('test-owner/p1.0.spool').quarantinedRange).toBeNull();   // 白盒：sidecar 未落盘则 meta 三字段不改（R3：内键=segKey）（现状先改 meta 必红）
    await rm(join(dir, 'test-owner', 'p1.0.spool.quarantine'), { recursive: true });   // 清占位目录（重试路径——重算 offset 保守正确）
    expect(await s2.quarantineTruncatedFrames('p1')).toBe(1);            // 重试成功（现状 meta 已改→重试跳段返回 0 同红）
    expect(await readFile(join(dir, 'test-owner', 'p1.0.spool.quarantine'), 'utf8')).toContain('"quarantinedFromOffset":9');
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
      const s = new CollabSpoolService(file);
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
    // 合法 Y update（实测 Y.mergeUpdates 对任意字节 throw——plan 文本 payload 需合法形态，逐帧退化路径另由 FK/PG 用例覆盖）
    await s1.append('p1', Y.encodeStateAsUpdate(new Y.Doc()));
    await s1.append('p1', Y.encodeStateAsUpdate(new Y.Doc()));
    const repo = createMockRepo();
    const s2 = svc(); await s2.scan();
    const report = await s2.replayAll(repo as any);
    expect(report.replayed).toBe(2); expect(report.failed).toBe(0);
    expect(repo.append).toHaveBeenCalledTimes(1);                // V16：合并单次（v1 逐帧=2 次必红）
    expect((await readdir(join(dir, 'test-owner')).catch(() => [] as string[])).filter((f) => f.endsWith('.spool'))).toHaveLength(0);   // 段 unlink 触发点②（R3：空 owner 目录已 rmdir）
  });

  it('FK 失败（真库形状 P2010+meta 23503——mock 形状 V6 标注无效，此用例仅测分支逻辑）→帧按终态丢弃+段收割', async () => {
    const s1 = svc();
    await s1.append('gone', new Uint8Array([1]));
    const repo = createMockRepo({ append: vi.fn(async () => { throw Object.assign(new Error('Raw query failed'), { code: 'P2010', meta: { code: '23503' } }); }) });
    const s2 = svc(); await s2.scan();
    const report = await s2.replayAll(repo as any);
    expect(report.discarded).toBe(1);
    expect((await readdir(join(dir, 'test-owner')).catch(() => [] as string[])).filter((f) => f.endsWith('.spool'))).toHaveLength(0);   // R3：空 owner 目录已 rmdir
  });

  it('PG 未起（P1001）→总预算耗尽返回 failed（不阻塞 listen；固定 200ms 重试非指数）', async () => {
    const s1 = svc();
    await s1.append('p1', new Uint8Array([1]));
    const repo = createMockRepo({ append: vi.fn(async () => { throw Object.assign(new Error("Can't reach database server"), { code: 'P1001' }); }) });
    const s2 = svc(); await s2.scan();
    const t0 = Date.now();
    const report = await s2.replayAll(repo as any, { budgetMs: 500, retryDelayMs: 50 });   // 测试缝收紧
    expect(report.failed).toBe(1);
    expect(repo.append.mock.calls.length).toBeGreaterThanOrEqual(2);   // 预算内重试
    expect(Date.now() - t0).toBeLessThan(1_500);                        // V16：总预算有界（v1 最坏 15s/帧）
    expect((await readdir(join(dir, 'test-owner'))).filter((f) => f.endsWith('.spool'))).toHaveLength(1);   // 帧保留（未丢弃）
  });
});

describe('Task 1 收口（幻影 meta/scan 幂等/残尾可观测——质量审查行为面）', () => {
  it('appendRaw 失败不残留幻影段元数据（新段首帧写失败→回滚 index 插入）', async () => {
    const s = svc();
    await mkdir(join(dir, 'test-owner', 'p1.0.spool'), { recursive: true });   // 段文件位置被目录占位：open('a') → EISDIR 必败（R3：占位在活动目录内）
    await expect(s.append('p1', new Uint8Array([1]))).rejects.toBeInstanceOf(Error);
    expect(s.hasFrames('p1')).toBe(false);   // 幻影 meta 回滚（收口 1：当前实现 index 留幽灵键必红）
  });

  it('scan：<8B 残片段（0 字节）直接 unlink——零帧零数据不进 index', async () => {
    await writeFile(join(dir, 'p1.0.spool'), Buffer.alloc(0));
    const s2 = svc();
    const report = await s2.scan();
    expect(report.truncatedSegments).toEqual([]);
    expect((await readdir(dir)).filter((f) => f.endsWith('.spool'))).toHaveLength(0);
    expect(s2.hasFrames('p1')).toBe(false);
  });

  it('scan：好帧后 <8B 残尾也进 truncated 报告（坏尾必有可观测面）', async () => {
    const s = svc();
    await s.append('p1', new Uint8Array([1, 2, 3]));    // 11B 好帧
    const f = join(dir, 'test-owner', 'p1.0.spool');
    await writeFile(f, Buffer.concat([await readFile(f), Buffer.from([0x99, 0x98, 0x97])]));   // +3B 残尾=14B
    const s2 = svc();
    const report = await s2.scan();
    expect(report.truncatedSegments).toEqual(['p1.0.spool']);
  });

  it('scan 幂等：二次 scan 不合并陈旧条目（外部删段后 index 反映磁盘事实）', async () => {
    const s = svc();
    await s.append('p1', new Uint8Array([1]));
    const s2 = svc();
    await s2.scan();
    expect(s2.hasFrames('p1')).toBe(true);
    await unlink(join(dir, 'test-owner', 'p1.0.spool'));
    await s2.scan();
    expect(s2.hasFrames('p1')).toBe(false);   // clear 重建——陈旧 meta 保留必红
  });
});

// —— Y0a-3 T4：spool 每实例子目录（R3——fenced 前任并发写防护+P18 boot 收养）——

describe('Y0a-3 R3：每实例子目录（fenced 前任并发写防护+P18 boot 收养）', () => {
  it('双 service 实例同根目录：各写各的 owner 子目录——段名不冲突+scan 后 peek 跨 owner 聚合', async () => {
    const { dir: d, cleanup } = await makeSpoolDir('y0a3-r3-');
    try {
      const a = new CollabSpoolService(d); a.setOwner('owner-A');
      const b = new CollabSpoolService(d); b.setOwner('owner-B');
      await a.append('p1', new Uint8Array([1]));
      await b.append('p1', new Uint8Array([2]));
      const fa = await a.peek('p1');   // a 未重扫——scan 前只见自己（写路径 activeDir）
      expect(fa).toHaveLength(1);
      await b.scan();                  // b 启动扫描=双 owner 全量重建（外来段 boot 收养——P18）
      const fb = await b.peek('p1');
      expect(fb).toHaveLength(2);      // A 残留+B 自有——跨 owner 聚合（前任帧回灌面）
    } finally { await cleanup(); }
  });

  it('跨 owner 回收：B 的 replayAll confirm 后——B 段 unlink+A 段同判据回收+空 owner 目录 rmdir', async () => {
    const { dir: d, cleanup } = await makeSpoolDir('y0a3-r3-');
    try {
      const a = new CollabSpoolService(d); a.setOwner('owner-A');
      await a.append('p1', new Uint8Array([1]));
      const b = new CollabSpoolService(d); b.setOwner('owner-B');
      await b.scan();
      const repo = { append: vi.fn(async () => ({ ok: true as const, seq: 1n })) };
      const r = await b.replayAll(repo as any);
      expect(r.replayed).toBe(1);
      expect(b.hasFrames('p1')).toBe(false);           // 全段回收（含 A 的段——unlink 在 A 的子目录内）
      const { existsSync } = await import('node:fs');
      expect(existsSync(join(d, 'owner-A'))).toBe(false);   // 空目录已 rmdir
    } finally { await cleanup(); }
  });

  it('外来段坏尾：静默截断到最后完整帧（sealed=true，不进 truncatedSegments——前任半写=常态）', async () => {
    const { dir: d, cleanup } = await makeSpoolDir('y0a3-r3-foreign-');
    try {
      const a = new CollabSpoolService(d); a.setOwner('owner-A');
      await a.append('p1', new Uint8Array([1]));
      // 造坏尾：直接 append 半个头（不经 service——模拟前任 kill 瞬间）
      const { appendFile } = await import('node:fs/promises');
      await appendFile(join(d, 'owner-A', 'p1.0.spool'), Buffer.alloc(3));
      const b = new CollabSpoolService(d); b.setOwner('owner-B');
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
      const a = new CollabSpoolService(d); a.setOwner('owner-A');
      const b = new CollabSpoolService(d); b.setOwner('owner-B');
      // 各自写超过半量（b 视角：own(p2)+stranded(p1) 合计越限）
      for (let i = 0; i < 7; i++) await a.append('p1', new Uint8Array(64));   // 7×(8+64)=504B
      await b.scan();                                                          // p1 → stranded 504B
      let threw = false;
      for (let i = 0; i < 100; i++) {
        try { await b.append('p2', new Uint8Array(64)); } catch { threw = true; break; }   // 1008+72=1080>1024 处抛
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
      const a = new CollabSpoolService(d); a.setOwner('owner-A');
      await a.append('p1', new Uint8Array([1]));
      const b = new CollabSpoolService(d); b.setOwner('owner-B');
      await b.append('p2', new Uint8Array([2]));
      await b.scan();
      expect(b.hasForeignSegments()).toBe(true);
      const dd = b.depth();
      expect(dd.ownFiles).toBe(1);          // p2（own 口径——部署门）
      expect(dd.strandedFiles).toBe(1);     // p1（外来——磁盘真值部分）
    } finally { await cleanup(); }
  });

  it('adoptSilentForeignSegments（W21）：mtime 静默后收养——foreign=false 纳入 own 口径', async () => {
    const { dir: d, cleanup } = await makeSpoolDir('y0a3-r3-adopt-');
    try {
      const a = new CollabSpoolService(d); a.setOwner('owner-A');
      await a.append('p1', new Uint8Array([1]));
      const b = new CollabSpoolService(d); b.setOwner('owner-B');
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
      const s = new CollabSpoolService(d);          // 不 setOwner
      await expect(s.append('p1', new Uint8Array([1]))).rejects.toThrow(/owner not set/);
      await expect(s.scan()).rejects.toThrow(/owner not set/);
    } finally { await cleanup(); }
  });

  it('setOwner 断言文件系统安全名（W4 配套）：含 ":" → throw', async () => {
    const { dir: d, cleanup } = await makeSpoolDir('y0a3-r3-fs-');
    try {
      const s = new CollabSpoolService(d);
      expect(() => s.setOwner('host:123:abc')).toThrow(/文件系统安全/);
    } finally { await cleanup(); }
  });

  it('replayAll 定向回灌（Z11 复用单源）：opts.projectIds 过滤', async () => {
    const { dir: d, cleanup } = await makeSpoolDir('y0a3-r3-replay-');
    try {
      const s = new CollabSpoolService(d); s.setOwner('owner-A');
      await s.append('p1', new Uint8Array([1]));
      await s.append('p2', new Uint8Array([2]));
      const repo = { append: vi.fn(async () => ({ ok: true as const, seq: 1n })) };
      await s.replayAll(repo as any, { projectIds: ['p1'] });
      expect(s.hasFrames('p1')).toBe(false);
      expect(s.hasFrames('p2')).toBe(true);   // 未点名不回灌
    } finally { await cleanup(); }
  });
});
