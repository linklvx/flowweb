// apps/web/src/collab/local-collab-cache.test.ts
// Y0b-5 T8：自研 IDB 适配器单测（裁定 24⑦/25⑶/24⑥尾/24⑧）。
// **Y1c T18 per-tab 改形**：记录键=tabId（跨 tab 结构性隔离）+loadAll 全记录读（含 legacy
// 'snapshot' 迁移）+deleteOwnRecord 删己+deleteDivergedRecords diverged 收窄清理+族扫描。
// 装置=src/test/fakeIndexedDb（jsdom 无实现——内存 stub 经 vi.stubGlobal 注入，模块调用时读全局）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { QUOTA_DEFAULTS } from '@flowweb/shared';
import { createFakeIndexedDb, type FakeIndexedDbFactory } from '@/test/fakeIndexedDb';
import {
  LocalCollabCache, LOCAL_CACHE_MAX_DOC_BYTES, getCollabTabId, collectFamilyDirtyRecords,
  type LocalCacheRecord,
} from './local-collab-cache';

const KEY = 'flowweb:collab:u1:p1:g3:s2';
const OTHER_KEY = 'flowweb:collab:u1:p2:g1:s2';

const REC = (over: Partial<LocalCacheRecord> = {}): LocalCacheRecord => ({
  tabId: 'seed', snapshot: new Uint8Array([1, 2, 3]), stateVector: new Uint8Array([1]),
  savedSeq: 0, unsyncedDirty: false, diverged: false, at: 1_000, ...over,
});

// ★T18 离线编辑语料：独立 clientID 的 Y.Doc 各自离线写入 → 落盘 dirty 记录 → 新会话 boot 读盘
// mergeUpdates 并集回放（spec §3.4 v5-11 场景 A——两 tab 编辑必须并集存活）。
const tabCorpus = (tabKey: string): Uint8Array => {
  const d = new Y.Doc();
  d.getMap('nodes').set(tabKey, new Y.Map([['v', tabKey]]));
  return Y.encodeStateAsUpdate(d);
};

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

/** legacy 'snapshot' 键播种（迁移读面——T18 前形态的存量记录） */
async function seededCache(record: LocalCacheRecord, key = KEY) {
  kit.data.set(key, new Map([['snapshot', record]]));
  const c = new LocalCollabCache(key);
  await c.loadAll();
  return c;
}

describe('Y0b-5 T8 适配器：尺寸闸常量同源', () => {
  it('LOCAL_CACHE_MAX_DOC_BYTES=QUOTA_DEFAULTS.maxDocBytes（同源无第二系数——裁定 24⑧；E36 结构性保证的锚）', () => {
    expect(LOCAL_CACHE_MAX_DOC_BYTES).toBe(QUOTA_DEFAULTS.maxDocBytes);
  });
});

describe('T18 per-tab 身份：getCollabTabId', () => {
  it('sessionStorage 作用域=tab 级稳定（重复调用同值+落 storage）；storage 缺失回落模块级 memo 同值（Q-M-3——防孤儿键累积），禁抛（缓存禁阻断协作）', () => {
    const a = getCollabTabId();
    expect(a).toBe(getCollabTabId());   // 稳定（storage 记忆）
    expect(typeof sessionStorage.getItem('flowweb:collab-tab-id')).toBe('string');
    const ss = sessionStorage;
    vi.stubGlobal('sessionStorage', undefined);
    try {
      const fb = getCollabTabId();   // 禁写环境：模块级 memo 回落
      expect(typeof fb).toBe('string');
      expect(fb).toBe(getCollabTabId());   // Q-M-3：同值跨调用稳定（无 memo=每次新随机键→孤儿记录累积）
    } finally {
      vi.stubGlobal('sessionStorage', ss);
    }
  });
});

describe('boot/loadAll：全记录读+persist() 申请+失败面', () => {
  it('loadAll 命中→全部记录返回（legacy ' + "'snapshot'" + ' 迁移读归 tabId=' + "'legacy'" + '——EVICT/diverged 判据同读一份）；未命中→[]；persist() 每连接申请一次', async () => {
    const rec = REC({ unsyncedDirty: true, diverged: true, at: 42 });
    await seededCache(rec);
    (navigator.storage.persist as ReturnType<typeof vi.fn>).mockClear();
    expect(await new LocalCollabCache(KEY).loadAll()).toEqual([{ ...rec, tabId: 'legacy' }]);
    expect(navigator.storage.persist).toHaveBeenCalledTimes(1);
    const c2 = new LocalCollabCache(KEY);
    expect(await c2.loadAll()).toEqual([{ ...rec, tabId: 'legacy' }]);   // 同库双连接均命中
    expect(await new LocalCollabCache(OTHER_KEY).loadAll()).toEqual([]);
  });

  it('indexedDB 全局缺失（SSR/测试默认态）→loadAll []+降级遥测 onDegrade("idb-error")+disabled 闩锁', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const onDegrade = vi.fn();
    const c = new LocalCollabCache(KEY, { onDegrade });
    expect(await c.loadAll()).toEqual([]);
    expect(c.disabled).toBe(true);
    expect(c.disableReason).toBe('idb-error');
    expect(onDegrade).toHaveBeenCalledWith('idb-error');
  });

  it('open 抛异常/onerror→同路径降级（QuotaExceededError 之外 InvalidStateError/UnknownError 同面——禁抛出冒泡 initCollab 栈）', async () => {
    const onDegrade = vi.fn();
    const c = new LocalCollabCache(KEY, { onDegrade });
    kit.failNextOpen();
    expect(await c.loadAll()).toEqual([]);
    expect(c.disabled).toBe(true);
    expect(onDegrade).toHaveBeenCalledTimes(1);
    // 闩锁后零动作：再次 loadAll 不再触发起 open
    expect(await c.loadAll()).toEqual([]);
    expect(onDegrade).toHaveBeenCalledTimes(1);
  });
});

describe('put：per-tab 键原子写+dirty 守卫+尺寸闸', () => {
  it('put 写入（键=tabId）+onFlushed(bytes)+lastSnapshotBytes 记账（能力位与 docBytes 遥测数据源）', async () => {
    const c = await seededCache(REC({ snapshot: new Uint8Array([9]) }));
    const onFlushed = vi.fn();
    const c2 = new LocalCollabCache(KEY, {}, 'tab-mine');
    await c2.loadAll();
    const out = await c2.put(REC({ snapshot: new Uint8Array(50), at: 2_000 }));
    expect(out).toBe('put');
    expect(onFlushed).not.toHaveBeenCalled();   // c2 未挂 onFlushed——c 的 seeded 不计
    void onFlushed;
    expect(c2.lastSnapshotBytes).toBe(50);
    const stored = kit.data.get(KEY)!.get('tab-mine') as LocalCacheRecord;
    expect(stored.at).toBe(2_000);
    expect(stored.tabId).toBe('tab-mine');                     // 记录自带属主（归因面）
    expect(kit.data.get(KEY)!.get('snapshot')).toBeDefined();  // legacy 记录不被 per-tab 写波及
    void c;
  });

  it('★T18 跨 tab 结构性隔离（双 tab dirty 并存——先红②根修）：tab B 的 clean put 不触 tab A 的 dirty 键', async () => {
    const tabA = new LocalCollabCache(KEY, {}, 'tab-a');
    await tabA.loadAll();
    const dirtyA = REC({ snapshot: tabCorpus('node-a'), unsyncedDirty: true, at: 1_000 });
    expect(await tabA.put(dirtyA)).toBe('put');
    const tabB = new LocalCollabCache(KEY, {}, 'tab-b');
    await tabB.loadAll();
    // tab B 干净态 pagehide flush（clean put）——tab A 的 dirty 记录结构性不可达（键隔离）
    expect(await tabB.put(REC({ snapshot: tabCorpus('node-b'), unsyncedDirty: false }))).toBe('put');
    expect(kit.data.get(KEY)!.get('tab-a')).toEqual({ ...dirtyA, tabId: 'tab-a' });   // A 原样存活
  });

  it('★dirty 守卫（裁定 25⑶防线收窄到本键）：本键旧记录 dirty ∧ 新记录 clean → skip+onPreservedForeignDirty 遥测；dirty→dirty 正常覆盖', async () => {
    const dirtyRec = REC({ unsyncedDirty: true, snapshot: new Uint8Array([7, 7, 7]) });
    kit.data.set(KEY, new Map([['tab-mine', dirtyRec]]));
    const onPreserved = vi.fn();
    const mine = new LocalCollabCache(KEY, { onPreservedForeignDirty: onPreserved }, 'tab-mine');
    await mine.loadAll();
    // 干净覆盖本键 dirty → skip（本 tab diverged 唯一副本不被本 tab 干净态覆盖）
    expect(await mine.put(REC({ unsyncedDirty: false }))).toBe('preserved');
    expect(onPreserved).toHaveBeenCalledTimes(1);
    expect(kit.data.get(KEY)!.get('tab-mine')).toEqual(dirtyRec);   // 原样保留
    // dirty→dirty 正常覆盖（LWW——同键自更新）
    const dirty2 = REC({ unsyncedDirty: true, at: 3_000 });
    expect(await mine.put(dirty2)).toBe('put');
    expect(kit.data.get(KEY)!.get('tab-mine')).toEqual({ ...dirty2, tabId: 'tab-mine' });
    // clean 键被 dirty 覆盖不受守卫拦
    const cleanBase = await seededCache(REC({ unsyncedDirty: false }));
    expect(await cleanBase.put(REC({ unsyncedDirty: true }))).toBe('put');
  });

  it('★单 doc 尺寸闸：编码>闸→不缓存该 doc（disabled("over-size") 闩锁+后续 put 零动作——非写至 QuotaExceeded），已落盘旧内容保留', async () => {
    const c = await seededCache(REC({ snapshot: new Uint8Array([9]) }));
    const onDegrade = vi.fn();
    const c2 = new LocalCollabCache(KEY, { onDegrade }, 'tab-big');
    await c2.loadAll();
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
    await c.loadAll();
    expect(c.checkSizeGate(LOCAL_CACHE_MAX_DOC_BYTES - 1)).toBe('ok');
    expect(c.checkSizeGate(LOCAL_CACHE_MAX_DOC_BYTES + 1)).toBe('over');
    expect(c.disabled).toBe(true);
    expect(c.checkSizeGate(LOCAL_CACHE_MAX_DOC_BYTES + 1)).toBe('over');   // 持续超闸——边沿不重发
    expect(c.checkSizeGate(100)).toBe('ok');                                // 回落→恢复
    expect(c.disabled).toBe(false);
    const dead = new LocalCollabCache(KEY, {});
    kit.failNextOpen();
    await dead.loadAll();
    expect(dead.disableReason).toBe('idb-error');
    expect(dead.checkSizeGate(0)).toBe('ok');          // 复检不复活 idb-error 降级（disabled 仍 true）
    expect(dead.disabled).toBe(true);
  });

  it('IDB 写异常（QuotaExceededError 等）→disable("idb-error") 同路径降级', async () => {
    await seededCache(REC());
    const onDegrade = vi.fn();
    const c2 = new LocalCollabCache(KEY, { onDegrade });
    await c2.loadAll();
    c2['db']!.transaction = () => { throw new DOMException('quota', 'QuotaExceededError'); };
    expect(await c2.put(REC())).toBe('disabled');
    expect(c2.disableReason).toBe('idb-error');
    expect(onDegrade).toHaveBeenCalledTimes(1);
  });
});

describe('★T18 per-tab 双 tab 离线编辑 boot 并集（先红②——现状单键 LWW 丢一方）', () => {
  it('双 tab dirty 记录并存+boot 读全部记录 Y.mergeUpdates 并集回放', async () => {
    // 两 tab（两连接）各自离线编辑+落盘 dirty 记录（独立 tabId=独立 clientID 语料）
    const tabA = new LocalCollabCache(KEY, {}, 'tab-a');
    await tabA.loadAll();
    expect(await tabA.put(REC({ snapshot: tabCorpus('node-a'), unsyncedDirty: true, at: 1_000 }))).toBe('put');
    const tabB = new LocalCollabCache(KEY, {}, 'tab-b');
    await tabB.loadAll();
    expect(await tabB.put(REC({ snapshot: tabCorpus('node-b'), unsyncedDirty: true, at: 2_000 }))).toBe('put');
    // boot：新会话读同键全部记录 → mergeUpdates 并集 → 回放进新 doc
    const boot = new LocalCollabCache(KEY, {}, 'tab-boot');
    await boot.loadAll();
    const records = await boot.loadAll();
    expect(records.length).toBe(2);   // 两 tab 记录并存（现状单键：1 条=后写者——红锚）
    const merged = Y.mergeUpdates(records.map((r) => r.snapshot));
    const doc = new Y.Doc();
    Y.applyUpdate(doc, merged);
    expect(doc.getMap('nodes').get('node-a')).toBeDefined();   // tab A 编辑存活
    expect(doc.getMap('nodes').get('node-b')).toBeDefined();   // tab B 编辑存活（现状 LWW 丢失=红锚）
  });

  it('legacy ' + "'snapshot'" + ' 迁移读：单键存量记录并入 boot 并集（升级零撕裂——旧离线草稿不静默丢）', async () => {
    await seededCache(REC({ snapshot: tabCorpus('node-legacy'), unsyncedDirty: true }));
    const tabNew = new LocalCollabCache(KEY, {}, 'tab-new');
    await tabNew.loadAll();
    await tabNew.put(REC({ snapshot: tabCorpus('node-new'), unsyncedDirty: true }));
    const records = await new LocalCollabCache(KEY, {}, 'tab-boot').loadAll();
    expect(records.length).toBe(2);   // legacy+per-tab 并存
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.mergeUpdates(records.map((r) => r.snapshot)));
    expect(doc.getMap('nodes').get('node-legacy')).toBeDefined();
    expect(doc.getMap('nodes').get('node-new')).toBeDefined();
  });

  it('同步成功删己：仅删本 tab 记录+legacy 迁移清——他 tab dirty 记录不受波及（删己≠删族）', async () => {
    await seededCache(REC({ snapshot: tabCorpus('node-legacy') }));   // legacy clean
    const tabA = new LocalCollabCache(KEY, {}, 'tab-a');
    await tabA.loadAll();
    await tabA.put(REC({ snapshot: tabCorpus('node-a'), unsyncedDirty: true }));
    const tabB = new LocalCollabCache(KEY, {}, 'tab-b');
    await tabB.loadAll();
    await tabB.put(REC({ snapshot: tabCorpus('node-b'), unsyncedDirty: true }));
    await tabB.deleteOwnRecord();   // tab B 同步成功删己
    const records = await new LocalCollabCache(KEY, {}, 'tab-c').loadAll();
    expect(records.length).toBe(1);
    expect(records[0]!.tabId).toBe('tab-a');   // A 的 dirty 记录原样存活；legacy 已随删己迁移清
  });
});

describe('写入预算：trailing 去抖+结构性提前+强制 flush', () => {
  it('scheduleFlush trailing ≥1s 去抖：重复 dirty 不叠加，1s 后恰一写（encode 落宏任务）', async () => {
    vi.useFakeTimers();
    try {
      const c = new LocalCollabCache(KEY, {}, 'tab-flush');
      await c.loadAll();
      const build = vi.fn(() => REC({ snapshot: new Uint8Array([1]), at: Date.now() }));
      c.scheduleFlush(build);
      c.scheduleFlush(build);
      c.scheduleFlush(build);
      expect(build).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(build).toHaveBeenCalledTimes(1);   // 恰一写
      expect(kit.data.get(KEY)!.has('tab-flush')).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('结构性变更（增删节点）→置脏+提前到期：pending 去抖被压缩至 150ms 内到期', async () => {
    vi.useFakeTimers();
    try {
      const c = new LocalCollabCache(KEY, {}, 'tab-struct');
      await c.loadAll();
      const build = () => REC({ snapshot: new Uint8Array([2]) });
      c.scheduleFlush(build);
      c.expireFlushSoon(build);
      await vi.advanceTimersByTimeAsync(150);
      expect((kit.data.get(KEY)!.get('tab-struct') as LocalCacheRecord).snapshot).toEqual(build().snapshot);
    } finally { vi.useRealTimers(); }
  });

  it('flushNow（pagehide/visibilitychange hidden 强制）：无需等去抖立即写+取消 pending 去抖（不双写）', async () => {
    vi.useFakeTimers();
    try {
      const c = new LocalCollabCache(KEY, {}, 'tab-now');
      await c.loadAll();
      const build = () => REC({ snapshot: new Uint8Array([3]), at: 9 });
      c.scheduleFlush(build);
      c.flushNow(build);
      await drain();
      expect((kit.data.get(KEY)!.get('tab-now') as LocalCacheRecord).snapshot).toEqual(build().snapshot);
      await vi.advanceTimersByTimeAsync(2_000);   // pending 去抖已被取消——不双写
      expect((kit.data.get(KEY)!.get('tab-now') as LocalCacheRecord).snapshot).toEqual(build().snapshot);
    } finally { vi.useRealTimers(); }
  });

  it('teardown：清 timer+关连接（versionchange 处理面=他标签 purge 前先 close——裁定 24⑥尾）', async () => {
    vi.useFakeTimers();
    try {
      const c = new LocalCollabCache(KEY, {}, 'tab-td');
      await c.loadAll();
      c.scheduleFlush(() => REC());
      const db = c['db'] as unknown as { closed: boolean; onversionchange: unknown };   // fake 连接面（真 IDBDatabase 无 closed——装置形态断言）
      expect(typeof db.onversionchange).toBe('function');   // 连接侧已挂 versionchange 处理
      await c.teardown();
      expect(db.closed).toBe(true);
      await vi.advanceTimersByTimeAsync(2_000);          // teardown 后 pending flush 不再写
      expect(kit.data.get(KEY)!.has('tab-td')).toBe(false);
      kit.triggerVersionChange(KEY);                     // versionchange→close（不抛）
    } finally { vi.useRealTimers(); }
  });
});

describe('T18 deleteDivergedRecords+族扫描+总量闸', () => {
  it('★deleteDivergedRecords（diverged 放弃出边 T18 收窄）：只删 diverged 记录——他 tab 非 diverged 离线记录存活（整库删=静默丢防线）', async () => {
    kit.data.set(KEY, new Map<string, LocalCacheRecord>([
      ['tab-div', REC({ tabId: 'tab-div', diverged: true, unsyncedDirty: true })],
      ['tab-clean-dirty', REC({ tabId: 'tab-clean-dirty', unsyncedDirty: true })],
      ['snapshot', REC({ diverged: true })],   // legacy diverged 同清
    ]));
    const c = new LocalCollabCache(KEY, {}, 'tab-div');
    await c.loadAll();
    await c.deleteDivergedRecords();
    expect(kit.data.get(KEY)!.has('tab-div')).toBe(false);          // diverged 清
    expect(kit.data.get(KEY)!.has('snapshot')).toBe(false);         // legacy diverged 清
    expect(kit.data.get(KEY)!.has('tab-clean-dirty')).toBe(true);   // 他 tab dirty 非 diverged 存活
  });

  it('★collectFamilyDirtyRecords（换代禁静默丢族扫描）：同 uid:pid 全部代库的 dirty/diverged 记录全收集（含当前键库+legacy 键）；他 pid/非本族键禁碰；fail-soft 空集', async () => {
    const curGen = new Map<string, LocalCacheRecord>([
      ['tab-a', REC({ tabId: 'tab-a', unsyncedDirty: true })],
      ['tab-clean', REC({ tabId: 'tab-clean' })],
    ]);
    const oldGen = new Map<string, LocalCacheRecord>([
      ['snapshot', REC({ diverged: true })],   // legacy 键 dirty 族成员
      ['tab-b', REC({ tabId: 'tab-b', unsyncedDirty: true })],
    ]);
    kit.data.set(KEY, curGen);
    kit.data.set('flowweb:collab:u1:p1:g1:s2', oldGen);
    kit.data.set('flowweb:collab:u2:p1:g3:s2', new Map([['tab-x', REC({ tabId: 'tab-x', unsyncedDirty: true })]]));   // 他 uid
    kit.data.set('unrelated', new Map([['x', 1]]));
    const dirty = await collectFamilyDirtyRecords(KEY);
    expect(dirty.length).toBe(3);   // 当前代 tab-a+旧代 legacy+旧代 tab-b
    expect(dirty.every(({ cacheKey }) => cacheKey === KEY || cacheKey === 'flowweb:collab:u1:p1:g1:s2')).toBe(true);
    // 非 flowweb 族键 parse 不中——collectFamilyDirtyRecords 对无族维度键 fail-soft
    expect(await collectFamilyDirtyRecords('unrelated')).toEqual([]);
  });

  it('★总量闸：estimate 超限（usage/quota>0.8）→按 at 删最旧且只删全 clean 库（任一记录 dirty/diverged 即整库保留——T18 per-tab 判据）→降至 <0.6 停', async () => {
    // 三族库：oldest clean(删除)/middle dirty(保留)/diverged(保留)+当前键(保留)
    kit.data.set('flowweb:collab:u1:pA:g1:s2', new Map([['snapshot', REC({ at: 100 })]]));
    kit.data.set('flowweb:collab:u1:pB:g1:s2', new Map([['snapshot', REC({ at: 200, unsyncedDirty: true })]]));
    kit.data.set('flowweb:collab:u1:pC:g1:s2', new Map([['snapshot', REC({ at: 300, diverged: true })]]));
    // per-tab 混合库：dirty 记录在库=整库保留（即便同库另有 clean 记录）
    kit.data.set('flowweb:collab:u1:pD:g1:s2', new Map<string, LocalCacheRecord>([
      ['tab-clean', REC({ tabId: 'tab-clean', at: 150 })],
      ['tab-dirty', REC({ tabId: 'tab-dirty', at: 160, unsyncedDirty: true })],
    ]));
    kit.data.set(KEY, new Map([['snapshot', REC({ at: 400 })]]));
    // 非本族库——purge 判据外禁碰
    kit.data.set('unrelated', new Map([['x', 1]]));
    let usage = 900;
    (navigator.storage.estimate as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ usage, quota: 1_000 }));
    const c = new LocalCollabCache(KEY);
    await c.loadAll();
    await c.evictForTotalQuota();
    expect(kit.data.has('flowweb:collab:u1:pA:g1:s2')).toBe(false);   // 最旧全 clean 库删
    expect(kit.data.has('flowweb:collab:u1:pD:g1:s2')).toBe(true);    // 混合库含 dirty 记录=整库保留
    expect(kit.data.has('flowweb:collab:u1:pB:g1:s2')).toBe(true);    // dirty 保留
    expect(kit.data.has('flowweb:collab:u1:pC:g1:s2')).toBe(true);    // diverged 保留
    expect(kit.data.has(KEY)).toBe(true);                             // 当前键保留
    expect(kit.data.has('unrelated')).toBe(true);                     // 非本族禁碰
    // 第二轮：usage 仍高（首删未达标）→ 继续删（无全 clean 可删——dirty/diverged 仍保留=只删已确认库纪律）
    usage = 950;
    await c.evictForTotalQuota();
    expect(kit.data.has('flowweb:collab:u1:pD:g1:s2')).toBe(true);
    expect(kit.data.has('flowweb:collab:u1:pC:g1:s2')).toBe(true);
  });

  it('总量闸 fail-soft：estimate 缺失/低于阈值零动作不抛（磁盘卫生层）', async () => {
    const c = new LocalCollabCache(KEY);
    await c.loadAll();
    kit.data.set('flowweb:collab:u1:pD:g1:s2', new Map([['snapshot', REC({ at: 5 })]]));
    (navigator.storage.estimate as ReturnType<typeof vi.fn>).mockResolvedValue({ usage: 10, quota: 1_000 });
    await expect(c.evictForTotalQuota()).resolves.toBeUndefined();
    expect(kit.data.has('flowweb:collab:u1:pD:g1:s2')).toBe(true);
  });

  it('★容量监控 onQuotaHigh【spec 修复 3-2】：estimate 占比≥0.8 边沿触发一次（过 60s 节流复查仍超阈不重发）；降回 <0.6 重置后再超阈可再触发（滞回同族语义）', async () => {
    vi.useFakeTimers();
    try {
      const onQuotaHigh = vi.fn();
      let usage = 850;   // 0.85>0.8
      (navigator.storage.estimate as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ usage, quota: 1_000 }));
      const c = new LocalCollabCache(KEY, { onQuotaHigh });
      await c.loadAll();
      await c.evictForTotalQuota();   // 首查（lastEstimateCheckAt=0——节流首查即过）
      expect(onQuotaHigh).toHaveBeenCalledTimes(1);
      expect(onQuotaHigh).toHaveBeenCalledWith(850, 1_000);
      await vi.advanceTimersByTimeAsync(61_000);
      await c.evictForTotalQuota();   // 过节流复查——仍超阈但边沿已发,不重发
      expect(onQuotaHigh).toHaveBeenCalledTimes(1);
      usage = 500;                    // 0.5<0.6——滞回退出重置
      await vi.advanceTimersByTimeAsync(61_000);
      await c.evictForTotalQuota();
      expect(onQuotaHigh).toHaveBeenCalledTimes(1);
      usage = 900;                    // 再超阈——重置后边沿可再触发
      await vi.advanceTimersByTimeAsync(61_000);
      await c.evictForTotalQuota();
      expect(onQuotaHigh).toHaveBeenCalledTimes(2);
      expect(onQuotaHigh).toHaveBeenLastCalledWith(900, 1_000);
    } finally { vi.useRealTimers(); }
  });
});
