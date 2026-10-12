// apps/web/src/collab/local-collab-cache.ts
// Y0b-5 T8：本地持久化最小内核——自研 IDB 适配器（单快照覆盖形态——裁定 24⑦，零新依赖 native IndexedDB）。
// 形态：put{snapshot=encodeStateAsUpdate(doc), unsyncedDirty, diverged, at} 单键 put 原子无撕裂+
// 无压缩（每次写即压缩）+跨页 last-writer-wins（两侧皆收敛中 CRDT 态任一份可用——无需协调）。
// ★零业务逻辑（绑库/清库/容量闸——编排归 runtime）：不自建 provider、不越 setHydration 单写者、
// 无 Leader/锁/通道（E5 直写裁定）。编解码由调用方闭包提供——encode 落宏任务（去抖 timer 回调），
// 8MB 全量编码禁占交互帧。
// 失败面清单（裁定 24⑥尾）：固定布局版本+onupgradeneeded/onblocked/versionchange 处理+
// deleteDatabase 前先 close（多标签 purge——T5 purge 侧 onblocked 已 resolve，本模块持连接侧补
// versionchange 主动关）+布局版本常量（区别 docShape schemaVersion）+QuotaExceededError 之外
// InvalidStateError/UnknownError 同路径降级（任何 IDB 异常→disable 闩锁，协作主链零影响）。
// ★dirty 不可被 clean 覆盖（裁定 25⑹）：put 前同事务读旧记录——existing.unsyncedDirty ∧
// !mine.unsyncedDirty → skip（标签 A diverged 唯一副本不被标签 B pagehide 覆盖；两 dirty LWW
// 罕见边角可接受——按 clientID 分行方案登记升级路径）。
import { QUOTA_DEFAULTS } from '@flowweb/shared';
import { parseLocalCacheKey } from './local-cache-key';

/** 单 doc 尺寸闸=maxDocBytes 同源无第二系数（裁定 24⑧：编码 ≤ 闸 ⇒ 回放帧=编码+包装 ≤ 闸+ALLOWANCE
 *  恒过=E36 结构性保证；「本地已缓存」是能力承诺，超闸=「太大没缓存」诚实分支）。 */
export const LOCAL_CACHE_MAX_DOC_BYTES: number = QUOTA_DEFAULTS.maxDocBytes;

/** 适配器自身布局版本（store 布局变更才升；固定 DB version——禁用户新旧混合布局） */
const DB_LAYOUT_VERSION = 1;
const STORE_NAME = 'kv';
const RECORD_KEY = 'snapshot';
/** 写入预算（裁定 24⑦）：trailing ≥1s 去抖——编辑突发窗口只 encode 一次；结构性变更提前到期 */
const FLUSH_DEBOUNCE_MS = 1_000;
const STRUCTURAL_EXPIRE_MS = 150;
/** 总量闸滞回（estimate 占比——与配额 softEnter/softExit 同族语义）：>0.8 删最旧、降至 <0.6 停 */
const TOTAL_BUDGET_ENTER = 0.8;
const TOTAL_BUDGET_EXIT = 0.6;
const TOTAL_BUDGET_CHECK_MIN_MS = 60_000;

export interface LocalCacheRecord {
  snapshot: Uint8Array;
  /** T6 单源同值随快照存——EVICT/PURGE「只删已确认库」判据（禁第二判据） */
  unsyncedDirty: boolean;
  /** 裁定 23⑨ diverged 持久化载体（readOnly 期本地编辑）——下次会话不自动 hydrate */
  diverged: boolean;
  /** last-write 时刻（总量闸按此删最旧） */
  at: number;
}

export type LocalCacheDegradeReason = 'idb-error' | 'over-size';
export type FlushOutcome = 'put' | 'preserved' | 'disabled';

export interface LocalCollabCacheHooks {
  /** 降级边沿（idb-error/over-size 首次置位）——runtime 接 local-cache-degraded 遥测+能力位翻转 */
  onDegrade?: (reason: LocalCacheDegradeReason) => void;
  /** dirty 守卫拦下 clean 覆盖——runtime 接 local-cache-preserved-foreign-dirty 遥测 */
  onPreservedForeignDirty?: () => void;
  /** 写成功——runtime 接能力位翻转（bytes ≤ 闸时 localCacheReady=true） */
  onFlushed?: (bytes: number) => void;
  /** 容量预警边沿（estimate 占比 ≥ENTER 首达一次,降回 <EXIT 重置可再触发——spec 修复 3-2）：
   *  runtime 接 ring-only 本地诊断记录（不入遥测批——plan T8「estimate() 监控→容量上报进本地 ring」） */
  onQuotaHigh?: (used: number, quota: number) => void;
}

export class LocalCollabCache {
  private db: IDBDatabase | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEstimateCheckAt = 0;
  /** 容量预警边沿闩锁（onQuotaHigh 滞回——spec 修复 3-2：≥ENTER 首达发一次,持续超阈不重发） */
  private quotaWarned = false;
  /** 降级闩锁（idb-error/over-size——置位后本会话全部读写零动作） */
  disabled = false;
  disableReason: LocalCacheDegradeReason | null = null;
  /** 最近一次成功快照字节（尺寸闸周期复检+docBytes 遥测数据源——零新增 encode） */
  lastSnapshotBytes = 0;

  constructor(
    readonly key: string,
    private readonly hooks: LocalCollabCacheHooks = {},
  ) {}

  /** 降级闩锁（幂等——onDegrade 只在边沿发一次） */
  private disable(reason: LocalCacheDegradeReason): void {
    if (this.disabled) return;
    this.disabled = true;
    this.disableReason = reason;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    try { this.hooks.onDegrade?.(reason); } catch { /* 遥测钩子异常不反噬主链 */ }
  }

  /** 净化 open：固定布局版本+升级建 store+versionchange 主动关本连接+persist() 尽力申请
   *  （Safari 可用性判据=可选链——缺 storage/方法静默跳过，申请结果不阻塞主链）。 */
  private open(): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
      try { void navigator.storage?.persist?.()?.catch(() => { /* 尽力申请 */ }); } catch { /* 无 storage——跳过 */ }
      let idb: IDBFactory | undefined;
      try { idb = typeof indexedDB !== 'undefined' ? indexedDB : undefined; } catch { /* 极端环境取值失败=同降级 */ }
      if (!idb) { this.disable('idb-error'); resolve(null); return; }
      let req: IDBOpenDBRequest;
      try { req = idb.open(this.key, DB_LAYOUT_VERSION); } catch { this.disable('idb-error'); resolve(null); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      req.onerror = () => { this.disable('idb-error'); resolve(null); };
      req.onblocked = () => { this.disable('idb-error'); resolve(null); };   // 他标签旧版本连接占库——降级不悬挂
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          try { db.close(); } catch { /* 已关闭 */ }
          if (this.db === db) this.db = null;   // 他标签 purge 升级让路（下次操作重开）
        };
        this.db = db;
        resolve(db);
      };
    });
  }

  /** boot 读快照。任何失败 fail-soft 返回 null（onDegrade 已在 disable 内边沿发）。 */
  async load(): Promise<LocalCacheRecord | null> {
    if (this.disabled) return null;
    try {
      const db = this.db ?? await this.open();
      if (!db) return null;
      return await new Promise<LocalCacheRecord | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(RECORD_KEY);
        req.onsuccess = () => resolve((req.result as LocalCacheRecord | undefined) ?? null);
        req.onerror = () => reject(req.error ?? new Error('idb get failed'));
        tx.onabort = () => reject(tx.error ?? new Error('idb read aborted'));
      });
    } catch {
      this.disable('idb-error');
      return null;
    }
  }

  /** 单键 put（原子）+dirty 守卫（同事务读旧记录——clean 禁覆盖 dirty）+尺寸闸（编码>闸不缓存）。
   *  任何 IDB 异常同路径降级（闩锁+onDegrade）——永不抛出（initCollab 调用栈安全）。 */
  async put(rec: LocalCacheRecord): Promise<FlushOutcome> {
    if (this.disabled) return 'disabled';
    if (rec.snapshot.byteLength > LOCAL_CACHE_MAX_DOC_BYTES) {
      this.disable('over-size');   // 「太大没缓存」诚实分支——已落盘旧内容保留
      return 'disabled';
    }
    try {
      const db = this.db ?? await this.open();
      if (!db) return 'disabled';
      const outcome = await new Promise<'put' | 'preserved'>((resolve, reject) => {
        let preserved = false;
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const getReq = store.get(RECORD_KEY);
        getReq.onsuccess = () => {
          const existing = getReq.result as LocalCacheRecord | undefined;
          if (existing?.unsyncedDirty && !rec.unsyncedDirty) { preserved = true; return; }   // skip：不写不删
          store.put(rec, RECORD_KEY);
        };
        getReq.onerror = () => reject(getReq.error ?? new Error('idb guard get failed'));
        tx.oncomplete = () => resolve(preserved ? 'preserved' : 'put');
        tx.onerror = () => reject(tx.error ?? new Error('idb put failed'));
        tx.onabort = () => reject(tx.error ?? new Error('idb put aborted'));
      });
      if (outcome === 'preserved') {
        try { this.hooks.onPreservedForeignDirty?.(); } catch { /* 遥测钩子异常不反噬 */ }
        return 'preserved';
      }
      this.lastSnapshotBytes = rec.snapshot.byteLength;
      try { this.hooks.onFlushed?.(rec.snapshot.byteLength); } catch { /* 遥测钩子异常不反噬 */ }
      return 'put';
    } catch {
      this.disable('idb-error');
      return 'disabled';
    }
  }

  /** 尺寸闸周期复检（复用外供测量值——最近快照字节/localDocBytes，零新增 encode）：
   *  超闸→停止缓存更新（闩锁）；回落→恢复（瘦身/vacuum 路径）。idb-error 降级不受复检复活。 */
  checkSizeGate(estimateBytes: number): 'over' | 'ok' {
    if (estimateBytes > LOCAL_CACHE_MAX_DOC_BYTES) {
      this.disable('over-size');
      return 'over';
    }
    if (this.disabled && this.disableReason === 'over-size') {
      this.disabled = false;
      this.disableReason = null;
    }
    return 'ok';
  }

  // ── 写入预算三触发（编排归 runtime——本类只管 timer 与写） ──
  /** dirty→trailing ≥1s 去抖（pending 不叠加——突发窗口恰一写） */
  scheduleFlush(build: () => LocalCacheRecord): void {
    if (this.disabled || this.flushTimer) return;
    this.flushTimer = setTimeout(() => { this.flushTimer = null; void this.put(build()); }, FLUSH_DEBOUNCE_MS);
  }

  /** 结构性变更（增删节点）→置脏+提前到期（encode 在到期宏任务里——交互帧不被占用）。
   *  yjs 类型 observe 先于 doc.emit('update') 到达——孤立结构性事务（1s 窗内无前序编辑=
   *  无 pending timer）此刻到达时兜底直接排 150ms（旧 `!this.flushTimer` 早退=结构性变更
   *  实际等满 1s，「提前到期」只对 1s 内有前序编辑的形态生效=死路径）。 */
  expireFlushSoon(build: () => LocalCacheRecord): void {
    if (this.disabled) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => { this.flushTimer = null; void this.put(build()); }, STRUCTURAL_EXPIRE_MS);
  }

  /** pagehide/visibilitychange→hidden 强制一次（best-effort——浏览器不保证卸载期写完成） */
  flushNow(build: () => LocalCacheRecord): void {
    if (this.disabled) return;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    void this.put(build());
  }

  /** 会话清理：清 timer+关连接 */
  async teardown(): Promise<void> {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    const db = this.db;
    this.db = null;
    if (db) { try { db.close(); } catch { /* 已关闭 */ } }
  }

  /** 丢弃当前条目（diverged 放弃出边消费）：先 close 本连接再 deleteDatabase（多标签 purge
   *  阻塞防线——裁定 24⑥尾）；三回调均 resolve（fail-soft，失败不阻断 reload 主链）。 */
  async discardEntry(): Promise<void> {
    await this.teardown();
    await new Promise<void>((resolve) => {
      let idb: IDBFactory | undefined;
      try { idb = typeof indexedDB !== 'undefined' ? indexedDB : undefined; } catch { resolve(); return; }
      if (!idb) { resolve(); return; }
      let req: IDBOpenDBRequest;
      try { req = idb.deleteDatabase(this.key); } catch { resolve(); return; }
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  }

  /** 总量闸（estimate 占比滞回）：>0.8 → 按 at 删最旧，只删 clean 库（dirty/diverged/当前键保留
   *  ——「只删已被服务端确认的」纪律；非本族键禁碰），降至 <0.6 停。节流 60s；全程 fail-soft。 */
  async evictForTotalQuota(): Promise<void> {
    if (this.disabled) return;
    const now = Date.now();
    if (now - this.lastEstimateCheckAt < TOTAL_BUDGET_CHECK_MIN_MS) return;
    this.lastEstimateCheckAt = now;
    try {
      const estimate = navigator.storage?.estimate;
      if (typeof estimate !== 'function') return;
      const { usage, quota } = await estimate.call(navigator.storage);
      if (typeof usage !== 'number' || typeof quota !== 'number' || quota <= 0) return;
      // spec 修复 3-2：容量监控边沿（与驱逐判据同源 estimate 复查点）——占比 ≥ENTER 首达发一次
      // （降回 <EXIT 重置——总量闸滞回同族语义,持续超阈不刷 ring）。
      if (usage / quota >= TOTAL_BUDGET_ENTER) {
        if (!this.quotaWarned) {
          this.quotaWarned = true;
          try { this.hooks.onQuotaHigh?.(usage, quota); } catch { /* 钩子异常不反噬主链 */ }
        }
      } else if (usage / quota < TOTAL_BUDGET_EXIT) {
        this.quotaWarned = false;
      }
      let usageNow: number = usage;
      const ratio = () => usageNow / quota;
      if (ratio() < TOTAL_BUDGET_ENTER) return;
      let idb: IDBFactory | undefined;
      try { idb = typeof indexedDB !== 'undefined' ? indexedDB : undefined; } catch { return; }
      if (!idb || typeof idb.databases !== 'function') return;
      const dbs = await idb.databases();
      const candidates: Array<{ name: string; at: number }> = [];
      for (const { name } of dbs) {
        if (typeof name !== 'string' || name === this.key) continue;
        if (!parseLocalCacheKey(name)) continue;
        const rec = await readRecordQuietly(idb, name);
        if (rec && !rec.unsyncedDirty && !rec.diverged) candidates.push({ name, at: rec.at });
      }
      candidates.sort((a, b) => a.at - b.at);
      for (const cand of candidates) {
        if (ratio() < TOTAL_BUDGET_EXIT) break;
        await deleteDatabaseQuietly(idb, cand.name);
        const fresh = await estimate.call(navigator.storage);
        if (typeof fresh.usage === 'number') usageNow = fresh.usage;
      }
    } catch { /* fail-soft——总量闸是磁盘卫生层，失败不阻断主链 */ }
  }
}

/** 他库记录只读探针（open 同布局版本+get+close——逐库独立连接不占长持） */
async function readRecordQuietly(idb: IDBFactory, name: string): Promise<LocalCacheRecord | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try { req = idb.open(name, DB_LAYOUT_VERSION); } catch { resolve(null); return; }
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const getReq = tx.objectStore(STORE_NAME).get(RECORD_KEY);
        getReq.onsuccess = () => { db.close(); resolve((getReq.result as LocalCacheRecord | undefined) ?? null); };
        getReq.onerror = () => { db.close(); resolve(null); };
      } catch { try { db.close(); } catch { /* 已关闭 */ } resolve(null); }
    };
  });
}

async function deleteDatabaseQuietly(idb: IDBFactory, name: string): Promise<void> {
  await new Promise<void>((resolve) => {
    let req: IDBOpenDBRequest;
    try { req = idb.deleteDatabase(name); } catch { resolve(); return; }
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}
