// apps/web/src/collab/local-collab-cache.test.ts
// Y0b-5 T8：自研 IDB 适配器单测（单快照覆盖形态——裁定 24⑦/25⑹/24⑥尾/24⑧）。
// 装置=src/test/fakeIndexedDb（jsdom 无实现——内存 stub 经 vi.stubGlobal 注入，模块调用时读全局）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { QUOTA_DEFAULTS } from '@flowweb/shared';
import { createFakeIndexedDb, type FakeIndexedDbFactory } from '@/test/fakeIndexedDb';
import {
  LocalCollabCache, LOCAL_CACHE_MAX_DOC_BYTES,
  type LocalCacheRecord,
} from './local-collab-cache';

const KEY = 'flowweb:collab:u1:p1:g3:s2';
const OTHER_KEY = 'flowweb:collab:u1:p2:g1:s2';

const REC = (over: Partial<LocalCacheRecord> = {}): LocalCacheRecord => ({
  snapshot: new Uint8Array([1, 2, 3]), unsyncedDirty: false, diverged: false, at: 1_000, ...over,
});

let kit: FakeIndexedDbFactory;

beforeEach(() => {
  kit = createFakeIndexedDb();
  vi.stubGlobal('indexedDB', kit.fake);
  vi.stubGlobal('navigator', { ...navigator, storage: { persist: vi.fn(async () => true), estimate: vi.fn(async () => ({ usage: 1, quota: 1_000_000 })) } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const drain = () => new Promise<void>((r) => queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => r()))));

async function seededCache(record: LocalCacheRecord, key = KEY) {
  kit.data.set(key, new Map([['snapshot', record]]));
  const c = new LocalCollabCache(key);
  await c.load();
  return c;
}

describe('Y0b-5 T8 适配器：尺寸闸常量同源', () => {
  it('LOCAL_CACHE_MAX_DOC_BYTES=QUOTA_DEFAULTS.maxDocBytes（同源无第二系数——裁定 24⑧；E36 结构性保证的锚）', () => {
    expect(LOCAL_CACHE_MAX_DOC_BYTES).toBe(QUOTA_DEFAULTS.maxDocBytes);
  });
});

describe('boot/load：读快照+persist() 申请+失败面', () => {
  it('load 命中→记录原样返回（含 unsyncedDirty/diverged——EVICT 判据与 diverged 会话判定同读一份）；未命中→null；persist() 每连接申请一次（Safari 可用性判据=可选链，缺 storage 不炸）', async () => {
    const rec = REC({ unsyncedDirty: true, diverged: true, at: 42 });
    await seededCache(rec);
    (navigator.storage.persist as ReturnType<typeof vi.fn>).mockClear();
    expect(await new LocalCollabCache(KEY).load()).toEqual(rec);
    expect(navigator.storage.persist).toHaveBeenCalledTimes(1);
    const c2 = new LocalCollabCache(KEY);
    expect(await c2.load()).toEqual(rec);   // 同库双连接均命中
    expect(await new LocalCollabCache(OTHER_KEY).load()).toBeNull();
  });

  it('indexedDB 全局缺失（SSR/测试默认态）→load null+降级遥测 onDegrade("idb-error")+disabled 闩锁', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const onDegrade = vi.fn();
    const c = new LocalCollabCache(KEY, { onDegrade });
    expect(await c.load()).toBeNull();
    expect(c.disabled).toBe(true);
    expect(c.disableReason).toBe('idb-error');
    expect(onDegrade).toHaveBeenCalledWith('idb-error');
  });

  it('open 抛异常/onerror→同路径降级（QuotaExceededError 之外 InvalidStateError/UnknownError 同面——禁抛出冒泡 initCollab 栈）', async () => {
    const onDegrade = vi.fn();
    const c = new LocalCollabCache(KEY, { onDegrade });
    kit.failNextOpen();
    expect(await c.load()).toBeNull();
    expect(c.disabled).toBe(true);
    expect(onDegrade).toHaveBeenCalledTimes(1);
    // 闩锁后零动作：再次 load 不再触发起 open
    expect(await c.load()).toBeNull();
    expect(onDegrade).toHaveBeenCalledTimes(1);
  });
});

describe('put：单键原子+dirty 守卫+尺寸闸', () => {
  it('put 写入+onFlushed(bytes)+lastSnapshotBytes 记账（能力位与 docBytes 遥测数据源）', async () => {
    const c = await seededCache(REC({ snapshot: new Uint8Array([9]) }));
    const onFlushed = vi.fn();
    const c2 = new LocalCollabCache(KEY, { onFlushed });
    await c2.load();
    const out = await c2.put(REC({ snapshot: new Uint8Array(50), at: 2_000 }));
    expect(out).toBe('put');
    expect(onFlushed).toHaveBeenCalledWith(50);
    expect(c2.lastSnapshotBytes).toBe(50);
    expect((kit.data.get(KEY)!.get('snapshot') as LocalCacheRecord).at).toBe(2_000);
    void c;
  });

  it('★dirty 不可被 clean 覆盖（裁定 25⑹ 多标签防线）：旧记录 unsyncedDirty=true ∧ 新记录 clean → skip 不写+onPreservedForeignDirty 遥测；两 dirty / clean→dirty 正常覆盖', async () => {
    const dirtyRec = REC({ unsyncedDirty: true, snapshot: new Uint8Array([7, 7, 7]) });
    const foreign = await seededCache(dirtyRec);
    const onPreserved = vi.fn();
    const mine = new LocalCollabCache(KEY, { onPreservedForeignDirty: onPreserved });
    await mine.load();
    // 干净覆盖 dirty → skip（A 标签 diverged 唯一副本不被 B 标签 pagehide 覆盖）
    expect(await mine.put(REC({ unsyncedDirty: false }))).toBe('preserved');
    expect(onPreserved).toHaveBeenCalledTimes(1);
    expect(kit.data.get(KEY)!.get('snapshot')).toEqual(dirtyRec);   // 原样保留
    // dirty→dirty 正常覆盖（LWW——罕见边角可接受）
    const dirty2 = REC({ unsyncedDirty: true, at: 3_000 });
    expect(await mine.put(dirty2)).toBe('put');
    expect(kit.data.get(KEY)!.get('snapshot')).toEqual(dirty2);
    // foreign 侧再验证：clean 库被 dirty 覆盖不受守卫拦
    const cleanBase = await seededCache(REC({ unsyncedDirty: false }));
    expect(await cleanBase.put(REC({ unsyncedDirty: true }))).toBe('put');
    void foreign;
  });

  it('★单 doc 尺寸闸：编码>闸→不缓存该 doc（disabled("over-size") 闩锁+后续 put 零动作——非写至 QuotaExceeded），已落盘旧内容保留', async () => {
    const c = await seededCache(REC({ snapshot: new Uint8Array([9]) }));
    const onDegrade = vi.fn();
    const c2 = new LocalCollabCache(KEY, { onDegrade });
    await c2.load();
    const big = new Uint8Array(LOCAL_CACHE_MAX_DOC_BYTES + 1);
    expect(await c2.put(REC({ snapshot: big }))).toBe('disabled');
    expect(c2.disableReason).toBe('over-size');
    expect(onDegrade).toHaveBeenCalledWith('over-size');
    expect((kit.data.get(KEY)!.get('snapshot') as LocalCacheRecord).snapshot).toEqual(new Uint8Array([9]));   // 旧内容保留
    expect(await c2.put(REC({ snapshot: new Uint8Array(10) }))).toBe('disabled');   // 闩锁——后续零动作
    expect(onDegrade).toHaveBeenCalledTimes(1);
    void c;
  });

  it('周期复检 checkSizeGate：复用外供测量值（零新增 encode）——超闸→停（保已有内容）/回落→恢复更新；idb-error 降级不受复检复活', async () => {
    const c = new LocalCollabCache(KEY);
    await c.load();
    expect(c.checkSizeGate(LOCAL_CACHE_MAX_DOC_BYTES - 1)).toBe('ok');
    expect(c.checkSizeGate(LOCAL_CACHE_MAX_DOC_BYTES + 1)).toBe('over');
    expect(c.disabled).toBe(true);
    expect(c.checkSizeGate(LOCAL_CACHE_MAX_DOC_BYTES + 1)).toBe('over');   // 持续超闸——边沿不重发
    expect(c.checkSizeGate(100)).toBe('ok');                                // 回落→恢复
    expect(c.disabled).toBe(false);
    const dead = new LocalCollabCache(KEY, {});
    kit.failNextOpen();
    await dead.load();
    expect(dead.disableReason).toBe('idb-error');
    expect(dead.checkSizeGate(0)).toBe('ok');          // 复检不复活 idb-error 降级（disabled 仍 true）
    expect(dead.disabled).toBe(true);
  });

  it('IDB 写异常（QuotaExceededError 等）→disable("idb-error") 同路径降级', async () => {
    await seededCache(REC());
    const onDegrade = vi.fn();
    const c2 = new LocalCollabCache(KEY, { onDegrade });
    await c2.load();
    c2['db']!.transaction = () => { throw new DOMException('quota', 'QuotaExceededError'); };
    expect(await c2.put(REC())).toBe('disabled');
    expect(c2.disableReason).toBe('idb-error');
    expect(onDegrade).toHaveBeenCalledTimes(1);
  });
});

describe('写入预算：trailing 去抖+结构性提前+强制 flush', () => {
  it('scheduleFlush trailing ≥1s 去抖：重复 dirty 不叠加，1s 后恰一写（encode 落宏任务）', async () => {
    vi.useFakeTimers();
    try {
      const c = new LocalCollabCache(KEY);
      await c.load();
      const build = vi.fn(() => REC({ snapshot: new Uint8Array([1]), at: Date.now() }));
      c.scheduleFlush(build);
      c.scheduleFlush(build);
      c.scheduleFlush(build);
      expect(build).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(build).toHaveBeenCalledTimes(1);   // 恰一写
      expect(kit.data.get(KEY)!.has('snapshot')).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('结构性变更（增删节点）→置脏+提前到期：pending 去抖被压缩至 150ms 内到期', async () => {
    vi.useFakeTimers();
    try {
      const c = new LocalCollabCache(KEY);
      await c.load();
      const build = () => REC({ snapshot: new Uint8Array([2]) });
      c.scheduleFlush(build);
      c.expireFlushSoon(build);
      await vi.advanceTimersByTimeAsync(150);
      expect(kit.data.get(KEY)!.get('snapshot')).toEqual(build());
    } finally { vi.useRealTimers(); }
  });

  it('flushNow（pagehide/visibilitychange hidden 强制）：无需等去抖立即写+取消 pending 去抖（不双写）', async () => {
    vi.useFakeTimers();
    try {
      const c = new LocalCollabCache(KEY);
      await c.load();
      const build = () => REC({ snapshot: new Uint8Array([3]), at: 9 });
      c.scheduleFlush(build);
      c.flushNow(build);
      await drain();
      expect(kit.data.get(KEY)!.get('snapshot')).toEqual(build());
      await vi.advanceTimersByTimeAsync(2_000);   // pending 去抖已被取消——不双写
      expect(kit.data.get(KEY)!.get('snapshot')).toEqual(build());
    } finally { vi.useRealTimers(); }
  });

  it('teardown：清 timer+关连接（versionchange 处理面=他标签 purge 前先 close——裁定 24⑥尾）', async () => {
    vi.useFakeTimers();
    try {
      const c = new LocalCollabCache(KEY);
      await c.load();
      c.scheduleFlush(() => REC());
      const db = c['db'] as unknown as { closed: boolean; onversionchange: unknown };   // fake 连接面（真 IDBDatabase 无 closed——装置形态断言）
      expect(typeof db.onversionchange).toBe('function');   // 连接侧已挂 versionchange 处理
      await c.teardown();
      expect(db.closed).toBe(true);
      await vi.advanceTimersByTimeAsync(2_000);          // teardown 后 pending flush 不再写
      expect(kit.data.get(KEY)!.has('snapshot')).toBe(false);
      kit.triggerVersionChange(KEY);                     // versionchange→close（不抛）
    } finally { vi.useRealTimers(); }
  });
});

describe('discardEntry + 总量闸', () => {
  it('discardEntry：先 close 本连接再 deleteDatabase（多标签 purge 阻塞防线）→落库清空', async () => {
    const c = await seededCache(REC());
    expect(kit.data.has(KEY)).toBe(true);
    await c.discardEntry();
    expect(kit.data.has(KEY)).toBe(false);   // 连接已关→deleteDatabase 不被自持连接阻塞
  });

  it('★总量闸：estimate 超限（usage/quota>0.8）→按 at 删最旧且只删 clean 库（dirty/diverged/当前键保留）→降至 <0.6 停', async () => {
    // 三族库：oldest clean(删除)/middle dirty(保留)/diverged(保留)+当前键(保留)
    kit.data.set('flowweb:collab:u1:pA:g1:s2', new Map([['snapshot', REC({ at: 100 })]]));
    kit.data.set('flowweb:collab:u1:pB:g1:s2', new Map([['snapshot', REC({ at: 200, unsyncedDirty: true })]]));
    kit.data.set('flowweb:collab:u1:pC:g1:s2', new Map([['snapshot', REC({ at: 300, diverged: true })]]));
    kit.data.set(KEY, new Map([['snapshot', REC({ at: 400 })]]));
    // 非 flowweb 族库——purge 判据外禁碰
    kit.data.set('unrelated', new Map([['x', 1]]));
    let usage = 900;
    (navigator.storage.estimate as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ usage, quota: 1_000 }));
    const c = new LocalCollabCache(KEY);
    await c.load();
    await c.evictForTotalQuota();
    expect(kit.data.has('flowweb:collab:u1:pA:g1:s2')).toBe(false);   // 最旧 clean 删
    expect(kit.data.has('flowweb:collab:u1:pB:g1:s2')).toBe(true);    // dirty 保留
    expect(kit.data.has('flowweb:collab:u1:pC:g1:s2')).toBe(true);    // diverged 保留
    expect(kit.data.has(KEY)).toBe(true);                             // 当前键保留
    expect(kit.data.has('unrelated')).toBe(true);                     // 非本族禁碰
    // 第二轮：usage 仍高（首删未达标）→ 继续删（无 clean 可删——dirty/diverged 仍保留=只删已确认库纪律）
    usage = 950;
    await c.evictForTotalQuota();
    expect(kit.data.has('flowweb:collab:u1:pB:g1:s2')).toBe(true);
    expect(kit.data.has('flowweb:collab:u1:pC:g1:s2')).toBe(true);
  });

  it('总量闸 fail-soft：estimate 缺失/低于阈值零动作不抛（磁盘卫生层）', async () => {
    const c = new LocalCollabCache(KEY);
    await c.load();
    kit.data.set('flowweb:collab:u1:pD:g1:s2', new Map([['snapshot', REC({ at: 5 })]]));
    (navigator.storage.estimate as ReturnType<typeof vi.fn>).mockResolvedValue({ usage: 10, quota: 1_000 });
    await expect(c.evictForTotalQuota()).resolves.toBeUndefined();
    expect(kit.data.has('flowweb:collab:u1:pD:g1:s2')).toBe(true);
  });
});
