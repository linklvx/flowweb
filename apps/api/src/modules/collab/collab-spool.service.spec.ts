// Y0a-2：spool 单测——真文件系统（tmp 目录），禁 mock fs（文件系统语义正是被测对象）。
// 注①（对 plan 文本的算术修正）：段滚动用例 payload 取 2,500,000B——plan 原值 1,500,000B 时
// 3 次追加在 4MB 段上限下只产生 2 段（1.5+1.5=3.0MB 未超限），断言 3 段必红；2.5MB 每帧使
// 第 2/3 次追加均超限滚动，3 段断言与「跨段 peek」意图同时成立。
// 注②（对 plan 文本的前提修正）：崩溃语义用例若对单帧段全量 confirm，按 confirm 回收判据
// （用例 2 锁定的整段 unlink 语义）段文件已删除，重启 scan 后磁盘为空，断言必红；改为两帧中
// confirm 一帧（段保留）——confirmed 集在内存、崩溃即丢，重启后含已 confirm 帧在内全部帧重新
// 可见，正是「幂等降级」要验证的完整语义（service 头注释同款表述）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { crc32 } from 'node:zlib';
import { CollabSpoolService } from './collab-spool.service';
import { makeSpoolDir } from '../../test-utils/spool-dir';

let dir: string; let cleanup: () => Promise<void>;
beforeEach(async () => { ({ dir, cleanup } = await makeSpoolDir()); });   // V17①：每用例独立目录
afterEach(async () => { await cleanup(); });

function svc(): CollabSpoolService { return new CollabSpoolService(dir); }   // 每用例新实例=崩溃模拟（内存 index/confirmed 丢失）

describe('spool 骨架（帧编解码+append fsync+peek/confirm+段滚动）', () => {
  it('append→peek round-trip：payload 逐字节相等；帧文件真实落盘（fsync 后 size>0）', async () => {
    const s = svc();
    const p1 = new Uint8Array([1, 2, 3, 4, 5]);
    const p2 = new Uint8Array([9, 9]);
    const ids = await s.append('p1', p1);
    await s.append('p1', p2);
    expect(ids).toHaveLength(1);
    const frames = await s.peek('p1');
    expect(frames.map((f) => Array.from(f.payload))).toEqual([Array.from(p1), Array.from(p2)]);
    const files = await readdir(dir);
    expect(files.filter((f) => f.endsWith('.spool'))).toHaveLength(1);   // 同段追加
    expect((await readFile(join(dir, files[0]))).byteLength).toBe(8 + 5 + 8 + 2);
    expect(s.hasFrames('p1')).toBe(true);
  });

  it('confirm 段回收触发点①：全部帧 confirmed→段文件 unlink+键集删除；部分 confirm 保留', async () => {
    const s = svc();
    const a = await s.append('p1', new Uint8Array([1]));
    const b = await s.append('p1', new Uint8Array([2]));
    await s.confirm('p1', [a[0]]);                       // 部分：段保留
    expect((await readdir(dir)).some((f) => f.endsWith('.spool'))).toBe(true);
    await s.confirm('p1', b);                             // 全部：整段 unlink
    expect((await readdir(dir)).filter((f) => f.endsWith('.spool'))).toHaveLength(0);
    expect(s.hasFrames('p1')).toBe(false);
    expect(await s.peek('p1')).toEqual([]);               // 键已删
  });

  it('段滚动：累计写超 4MB 滚动新段（文件名 segSeq 递增）；跨段 peek 全量返回', async () => {
    const s = svc();
    const big = new Uint8Array(2_500_000); big.fill(7);   // 注①：每帧 2.5MB——两帧即超 4MB 段上限
    await s.append('p1', big); await s.append('p1', big); await s.append('p1', big);   // 7.5MB → 3 段
    const files = (await readdir(dir)).filter((f) => f.endsWith('.spool')).sort();
    expect(files).toHaveLength(3);
    expect(files[0]).toBe('p1.0.spool'); expect(files[2]).toBe('p1.2.spool');
    const frames = await s.peek('p1');
    expect(frames).toHaveLength(3);
    expect(frames[0].frameId.split(':')[0]).toBe('0');
    expect(frames[2].frameId.split(':')[0]).toBe('2');
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
    const file = join(dir, 'p1.0.spool');
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
    const file = join(dir, 'p1.0.spool');
    const junk = Buffer.alloc(2, 0x99);
    await writeFile(file, Buffer.concat([await readFile(file), junk]));   // 外部坏尾：磁盘 11 字节≠内存记账 9（整写同注④）
    await s.append('p1', new Uint8Array([3]));                       // 追加前守卫 stat.size(11)≠bytes(9)→封段 0 滚动段 1
    const files = (await readdir(dir)).filter((f) => f.endsWith('.spool')).sort();
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
