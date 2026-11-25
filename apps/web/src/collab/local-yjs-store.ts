// apps/web/src/collab/local-yjs-store.ts
// Y5 T3：本地策略模块 meta 半边——flowweb:yjs-meta 三表（names/session/bindings）、
// 五维文档库名、session 单活行、names 墓碑字段、userSnapshot 白名单（spec §0.1.4）。
// 本文件只做本地存储策略，不做第二份文档编码；文档库半边（openYjsDoc/readCustom/
// computeDiffBytes/measureYjsDoc——T4）与 meta 半边同文件。
// 失败面：全部 promise 化，任何写失败 reject——调用方 fail-closed（names 写失败则本会话
// 不开那只文档库）。连接策略：每次调用独立 open、事务完成即 close——不缓存长持连接，
// 不会阻塞后续 deleteDatabase（多标签清理路径）。
import type { Role } from '@flowweb/shared';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

const META_DB_NAME = 'flowweb:yjs-meta';
/** meta 库布局版本（三表结构变更才升；固定版本禁新旧混合布局） */
const META_DB_VERSION = 1;
const STORE_NAMES = 'names';
const STORE_SESSION = 'session';
const STORE_BINDINGS = 'bindings';
/** 文档库名前缀（五维库名=前缀+uid:pid:gN:sN:hToken） */
const DOC_DB_PREFIX = 'flowweb:yjs:';
/** historyToken 字符集（spec §0.1.3 R1——不合即抛，禁静默净化） */
const HISTORY_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

/** /me 200 带 user 时落盘的十字段白名单（不存 wechatOpenid/wechatUnionid、不存任何 token）。 */
export interface UserSnapshot {
  id: string;
  name: string;
  email: string;
  image: string | null;
  emailVerified: boolean;
  role: Role;
  phoneNumber: string | null;
  phoneNumberVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

/** session 表行（键=uid）：离线放行凭证+7d 证明唯一载体；单活行不变量由 putSessionRow 保证。 */
export interface SessionRow {
  uid: string;
  localDeadline: number;
  userSnapshot: UserSnapshot;
}

/** bindings 表行（键=`${uid}\u0000${pid}`）：离线开库元数据载体。 */
export interface BindingRow {
  uid: string;
  generation: number;
  schemaVersion: number;
  historyToken: string;
  name: string;
  teamId: string | null;
}

/** names 表行（键=完整库名）：库名登记+hold 标记载体。
 *  hold 与 tombstone 互斥：hold=未裁定保内容的库、tombstone=已裁定待删的库（无 sealed 字段）。 */
export interface NameRow {
  uid: string;
  pid: string;
  generation: number;
  schemaVersion: number;
  historyToken: string;
  hold: boolean;
  tombstone?: boolean;
}

/** 五维文档库名合成（纯函数）：flowweb:yjs:<uid>:<pid>:g<g>:s<s>:h<token>。
 *  historyToken 只允许 [A-Za-z0-9_-]；不合抛错（本会话不开库），禁净化后拼名。 */
export function buildYjsDbName(
  uid: string,
  pid: string,
  generation: number,
  schemaVersion: number,
  historyToken: string,
): string {
  if (!HISTORY_TOKEN_PATTERN.test(historyToken)) {
    throw new Error(`非法 historyToken：${historyToken}（只允许 [A-Za-z0-9_-]）`);
  }
  return `${DOC_DB_PREFIX}${uid}:${pid}:g${String(generation)}:s${String(schemaVersion)}:h${historyToken}`;
}

/** 开 meta 库（不存在则升级建三表）。连接由调用方持有并在完成后 close；
 *  模块内 CRUD 帮手每次独立 open/close，不缓存连接。 */
export function openMetaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(META_DB_NAME, META_DB_VERSION);
    } catch (err) {
      reject(err instanceof Error ? err : new Error('open meta db failed'));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAMES)) db.createObjectStore(STORE_NAMES);
      if (!db.objectStoreNames.contains(STORE_SESSION)) db.createObjectStore(STORE_SESSION);
      if (!db.objectStoreNames.contains(STORE_BINDINGS)) db.createObjectStore(STORE_BINDINGS);
    };
    req.onsuccess = () => { resolve(req.result); };
    req.onerror = () => { reject(req.error ?? new Error('open meta db failed')); };
    // 不挂 onblocked：升级被其他标签的连接挡住时请求只挂起不失败，待其关闭后照常
    // onsuccess——此刻若已 reject 且忽略该连接，反而泄漏一条会挡住 deleteDatabase 的连接。
  });
}

/** 单事务执行助手：open→run 内同步发起请求→oncomplete 后取结果并 close。
 *  任何同步抛错（如 DataCloneError）/事务 error/abort 均 reject（写失败必 reject——
 *  调用方 fail-closed）。连接每次独立 open、事务结束即 close，不缓存长持连接。 */
async function runMetaTx<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => () => T,
): Promise<T> {
  const db = await openMetaDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      let readResult: () => T;
      try {
        tx = db.transaction(storeNames, mode);
        readResult = run(tx);
      } catch (err) {
        reject(err instanceof Error ? err : new Error('meta tx failed'));
        return;
      }
      tx.oncomplete = () => {
        try {
          resolve(readResult());
        } catch (err) {
          reject(err instanceof Error ? err : new Error('meta tx result read failed'));
        }
      };
      tx.onerror = () => { reject(tx.error ?? new Error('meta tx failed')); };
      tx.onabort = () => { reject(tx.error ?? new Error('meta tx aborted')); };
    });
  } finally {
    db.close();
  }
}

/** 写 session 行（仅 /me 200 带 user 写点调用）。同一事务内清掉其他 uid 的 session 行后
 *  再写本行——单活行不变量（spec §0.1.4 v7：旧 uid 行残留会让离线冷启动跨账号放行）。
 *  put 先发：若本行不可克隆（同步抛错）则清行请求尚未发出——失败不留下「删旧未写新」半态。 */
export async function putSessionRow(row: SessionRow): Promise<void> {
  await runMetaTx(STORE_SESSION, 'readwrite', (tx) => {
    const store = tx.objectStore(STORE_SESSION);
    store.put(row, row.uid);
    const keysReq = store.getAllKeys();
    keysReq.onsuccess = () => {
      for (const key of keysReq.result) {
        if (key !== row.uid) store.delete(key);
      }
    };
    return () => undefined;
  });
}

export async function deleteSessionRow(uid: string): Promise<void> {
  await runMetaTx(STORE_SESSION, 'readwrite', (tx) => {
    tx.objectStore(STORE_SESSION).delete(uid);
    return () => undefined;
  });
}

/** 返回全表 session 行——多行歧义由调用方判 fail-closed（离线冷启动只放行恰好一行）。 */
export async function getSessionRows(): Promise<SessionRow[]> {
  return runMetaTx(STORE_SESSION, 'readonly', (tx) => {
    const req = tx.objectStore(STORE_SESSION).getAll();
    let rows: SessionRow[] = [];
    req.onsuccess = () => { rows = req.result as SessionRow[]; };
    return () => rows;
  });
}

/** 写 binding 行（键=`${uid}\u0000${pid}`——v4：裸 pid 键会让换账号打开上一用户的库）。 */
export async function putBindingRow(uid: string, pid: string, row: BindingRow): Promise<void> {
  await runMetaTx(STORE_BINDINGS, 'readwrite', (tx) => {
    tx.objectStore(STORE_BINDINGS).put(row, `${uid}\u0000${pid}`);
    return () => undefined;
  });
}

export async function getBindingRow(uid: string, pid: string): Promise<BindingRow | null> {
  return runMetaTx(STORE_BINDINGS, 'readonly', (tx) => {
    const req = tx.objectStore(STORE_BINDINGS).get(`${uid}\u0000${pid}`);
    let row: BindingRow | null = null;
    req.onsuccess = () => { row = (req.result as BindingRow | undefined) ?? null; };
    return () => row;
  });
}

/** 写 names 行（键=完整库名，值逐字落盘）。开库前先写——写失败则调用方不开该库。
 *  墓碑改写=putNameRow(name, { ..., hold: false, tombstone: true })（hold/tombstone 互斥）。
 *  Y5 T13（T3 parked Minor 收口）：互斥从注释升级为**运行时断言**——双真=调用点 bug，
 *  抛错让它在测试/开发期立刻可见，禁静默落一个语义矛盾的行。 */
export async function putNameRow(dbName: string, row: NameRow): Promise<void> {
  if (row.hold && row.tombstone) {
    throw new Error(`names 行 hold/tombstone 互斥：${dbName}（hold=未裁定保内容，tombstone=已裁定待删）`);
  }
  await runMetaTx(STORE_NAMES, 'readwrite', (tx) => {
    tx.objectStore(STORE_NAMES).put(row, dbName);
    return () => undefined;
  });
}

/** 全表 names 行（附 dbName 键）——清扫/删除闸的库名全集来源。 */
export async function listNameRows(): Promise<Array<NameRow & { dbName: string }>> {
  return runMetaTx(STORE_NAMES, 'readonly', (tx) => {
    const store = tx.objectStore(STORE_NAMES);
    const keysReq = store.getAllKeys();
    const valuesReq = store.getAll();
    // names 键恒为完整库名字符串（putNameRow 签名钉死）——断言依据
    let keys: string[] = [];
    let values: NameRow[] = [];
    keysReq.onsuccess = () => { keys = keysReq.result as string[]; };
    valuesReq.onsuccess = () => { values = valuesReq.result as NameRow[]; };
    return () => keys.map((key, index) => ({ ...values[index], dbName: key }));
  });
}

/** Y5 T13（§0.6 v8 跨会话 hold 读点）：该 uid+pid 下**任一**库 hold===true 即返回该行——
 *  含当前会话未打开的旧代库。spec 原文「横幅读 names.hold，不读『当前这一只库』」：旧代库被
 *  hold 时当前会话即使开的是新库也要亮横幅，否则 hold 只是写进 IndexedDB 的旗、用户无出口。
 *  无 hold 返回 null；读失败由调用方 fail-soft（不置横幅，不阻断水合）。 */
export async function findHeldNameRow(uid: string, pid: string): Promise<(NameRow & { dbName: string }) | null> {
  const rows = await listNameRows();
  return rows.find((r) => r.uid === uid && r.pid === pid && r.hold === true) ?? null;
}

/** 删单个 names 行（键=完整库名）——登出三表清理（§0.6）与删除闸共用。 */
export async function deleteNameRow(dbName: string): Promise<void> {
  await runMetaTx(STORE_NAMES, 'readwrite', (tx) => {
    tx.objectStore(STORE_NAMES).delete(dbName);
    return () => undefined;
  });
}

/** 删该 uid 全部 names 行（§0.6 登出行）：同事务内扫值按 row.uid 匹配再删——
 *  键是库名（含 pid/generation/token），无法按 uid 前缀直删。 */
export async function deleteNameRowsForUid(uid: string): Promise<void> {
  await runMetaTx(STORE_NAMES, 'readwrite', (tx) => {
    const store = tx.objectStore(STORE_NAMES);
    const keysReq = store.getAllKeys();
    const valuesReq = store.getAll();
    valuesReq.onsuccess = () => {
      const keys = keysReq.result as string[];
      const values = valuesReq.result as NameRow[];
      keys.forEach((key, index) => {
        if (values[index]?.uid === uid) store.delete(key);
      });
    };
    return () => undefined;
  });
}

/** 删该 uid 全部 bindings 行（§0.6 登出行）：键=`uid\u0000pid`，同事务内按键前缀匹配再删。
 *  副作用：值被写坏（行 uid 与键不符）时仍按键删——登出以「账号隔离」为准，键才是查找载体。 */
export async function deleteBindingRowsForUid(uid: string): Promise<void> {
  await runMetaTx(STORE_BINDINGS, 'readwrite', (tx) => {
    const store = tx.objectStore(STORE_BINDINGS);
    const keysReq = store.getAllKeys();
    keysReq.onsuccess = () => {
      const prefix = `${uid}\u0000`;
      for (const key of keysReq.result as string[]) {
        if (key.startsWith(prefix)) store.delete(key);
      }
    };
    return () => undefined;
  });
}

/** 整行 Prisma User→十字段快照白名单裁剪（/me 返回整行含 openid/unionid；落盘不得带敏感字段）。 */
export function snapshotFromUser(user: Record<string, unknown>): UserSnapshot {
  return {
    id: user.id as string,
    name: user.name as string,
    email: user.email as string,
    image: (user.image as string | null | undefined) ?? null,
    emailVerified: user.emailVerified as boolean,
    role: user.role as Role,
    phoneNumber: (user.phoneNumber as string | null | undefined) ?? null,
    phoneNumberVerified: user.phoneNumberVerified as boolean,
    createdAt: user.createdAt as string,
    updatedAt: user.updatedAt as string,
  };
}

// ───────────────────────────── 文档库半边（T4） ─────────────────────────────

/** 开库竞赛死线（= runtime HYDRATION_DEADLINE_BASE_MS :591 同值；纯客户端量纲不进 shared）。 */
export const HYDRATION_OPEN_TIMEOUT_MS = 10_000;

/** 本会话「禁再开同库名」集合（§0.2 步 2）：只由水合路径 openYjsDoc 写入，measureYjsDoc 不写。
 *  值保留首次失败原因——重开到同一库名时如实返回，不把 open-reject 谎报成 timeout。
 *  模型例：一次超时后迟到 apply 只能留在已废弃 doc 上，重开同一库名会让新 doc 吃旧日志。 */
const bannedDbNames = new Map<string, 'timeout' | 'open-reject'>();

export type OpenDocResult =
  | { ok: true; doc: Y.Doc; persistence: IndexeddbPersistence }
  | { ok: false; reason: 'timeout' | 'open-reject' };

export type MeasureYjsDocResult =
  | { status: 'ok'; diffBytes: number; diverged: boolean }
  | { status: 'timeout' }
  | { status: 'open-reject' };

/** 空 Y.Doc 的编码长度（模块加载时一次性测得）——Yjs 空更新**不是 0**（13.6.32 实测 2 字节）。
 *  「有未上行内容」判据=差分字节数 > 本常量；删除闸 acked 判据=差分 == 本常量（禁 `=== 0`）。 */
export const EMPTY_DOC_ENCODE_BYTES: number = (() => {
  const doc = new Y.Doc();
  try {
    return Y.encodeStateAsUpdate(doc).byteLength;
  } finally {
    doc.destroy();
  }
})();

/** 同库名本会话是否已被水合路径判死（§0.2 步 2——Task 10 的重开闸读点）。 */
export function isDbNameBannedThisSession(dbName: string): boolean {
  return bannedDbNames.has(dbName);
}

/** 装载竞态内核：whenSynced / 10s 超时 / `_db` 拒绝三腿竞赛。
 *  超时或打开失败：persistence.destroy()+doc.destroy()（不删数据），返回失败原因；
 *  失败分支**不**写 bannedDbNames——是否禁开由调用方语义决定（水合禁开、测量不禁）。
 *  环境能力前置（Y5 T10）：y-indexeddb 内部用 IDBKeyRange/lib0 游标（getLastKey→openKeyCursor）；
 *  IDBKeyRange 缺席的环境（jsdom/受限容器）会在装载链里同步抛进一个无人接的 promise——whenSynced
 *  永悬。能力缺失直接判 open-reject（fail-fast，与「库不可用」同档：调用方走纯服务端水合）。 */
async function attemptOpen(dbName: string): Promise<OpenDocResult> {
  if (typeof IDBKeyRange === 'undefined') return { ok: false, reason: 'open-reject' };
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(dbName, doc);
  const outcome = await new Promise<'synced' | 'timeout' | 'open-reject'>((resolve) => {
    const timer = setTimeout(() => { settle('timeout'); }, HYDRATION_OPEN_TIMEOUT_MS);
    let settled = false;
    function settle(value: 'synced' | 'timeout' | 'open-reject'): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }
    persistence.whenSynced.then(() => { settle('synced'); }, () => { settle('open-reject'); });
    persistence._db.then(() => undefined, () => { settle('open-reject'); });
  });
  if (outcome === 'synced') return { ok: true, doc, persistence };
  // destroy() 内部 await this._db：超时分支恰是 _db 未落地，await 会把 10s 竞赛变成无限等待。
  // _destroyed 在调用瞬间同步置位（迟到 apply 被挡在门外），连接待 open 最终落地时由该链 close。
  void persistence.destroy().catch(() => undefined);
  doc.destroy();
  return { ok: false, reason: outcome };
}

/** 水合开库（§0.2 步 2）：成功=库内 update 已 apply 进 doc 且 whenSynced 已 resolve。
 *  超时/打开失败=废弃 doc+persistence，并把库名记入本会话禁开集合——迟到的 whenSynced
 *  只能落在已废弃 doc 上，随后的服务端水合必须用新 doc（调用方）；同库名再调直接拒绝，
 *  不再构造 IndexeddbPersistence。 */
export async function openYjsDoc(dbName: string): Promise<OpenDocResult> {
  const banned = bannedDbNames.get(dbName);
  if (banned !== undefined) return { ok: false, reason: banned };
  const outcome = await attemptOpen(dbName);
  if (!outcome.ok) bannedDbNames.set(dbName, outcome.reason);
  return outcome;
}

/** custom store 单通道读（约束⑩：只走 persistence.get，禁第二只 indexedDB.open）。
 *  缺键→null；值域由唯一写者 writeCustom 钉死为 string | ArrayBuffer（§0.1.5 v7 P1）。 */
export async function readCustom(
  persistence: IndexeddbPersistence,
  key: string,
): Promise<string | ArrayBuffer | null> {
  const value: unknown = await persistence.get(key);
  if (value === undefined || value === null) return null;
  return value as string | ArrayBuffer;
}

/** custom store 单通道写（§0.1.5 v7 P1）：serverSV=精确切片后的 ArrayBuffer 直传（零 Base64
 *  膨胀）、writeGrant/diverged=字符串。写失败 reject——调用方 fail-closed。 */
export async function writeCustom(
  persistence: IndexeddbPersistence,
  key: string,
  value: string | ArrayBuffer,
): Promise<void> {
  await persistence.set(key, value);
}

/** custom store 单通道删（显式状态键出边——healthy-sync 删 diverged）。与 get/set 同走
 *  IndexeddbPersistence 实例（约束⑩：禁对同一库名再 indexedDB.open）。 */
export async function deleteCustom(persistence: IndexeddbPersistence, key: string): Promise<void> {
  await persistence.del(key);
}

/** 相对服务端状态向量的差分字节数（§0.2 步 4）：**原始 byteLength**，不做任何减法。
 *  无 serverSV=全量编码。编码本身同步——保持 Promise 形态只为调用点统一 await。
 *  Y5 T13：**零长度 SV 归一成「无 SV」**（`Y.encodeStateAsUpdate(doc, new Uint8Array(0))` 会抛
 *  `Unexpected end of array`——空 ArrayBuffer 是坏记录/未写形态）。归一后按全量编码=非 acked=不删
 *  （安全侧）。解码失败（真损坏）仍抛出，由调用方按 fail-soft 处理（本函数保持单点编码，
 *  禁增第二调用点——census ④ 白名单计数）。 */
export function computeDiffBytes(doc: Y.Doc, serverSV: Uint8Array | null): Promise<number> {
  const usableSv = serverSV !== null && serverSV.byteLength > 0 ? serverSV : undefined;
  return Promise.resolve(Y.encodeStateAsUpdate(doc, usableSv).byteLength);
}

/** serverSV 精确切片（§0.1.5）：encodeStateVector 返回视图，IDB 只收独立 ArrayBuffer。 */
export function encodeExactStateVector(d: Y.Doc): ArrayBuffer {
  const sv = Y.encodeStateVector(d);
  return sv.buffer.slice(sv.byteOffset, sv.byteOffset + sv.byteLength);
}

/** 删除闸/清扫测量（§0.2 步 2 尾、§0.6）：装载→读库内 serverSV+diverged→算差分字节→立即销毁
 *  doc 与 persistence。超时=hold 语义（调用方不删）且**不写 bannedDbNames**（一次清扫超时不得
 *  锁死本会话开项目）。测完的 doc 只用于计算，绝不移交 provider（本函数不连任何连接）。
 *  Y5 T13：**必须同时读 diverged**——acked 判据是「差分空 ∧ 无 diverged」，只读差分会把
 *  「内容已上行但标记为未裁定」的库误判 acked 并删除=数据丢失。 */
export async function measureYjsDoc(dbName: string): Promise<MeasureYjsDocResult> {
  const opened = await attemptOpen(dbName);
  if (!opened.ok) {
    return opened.reason === 'timeout' ? { status: 'timeout' } : { status: 'open-reject' };
  }
  const { doc, persistence } = opened;
  try {
    const serverSV = await readCustom(persistence, 'serverSV');
    // 跨 realm 的 ArrayBuffer 仍可进 Uint8Array（判定用 typeof 而非 instanceof）。
    const svBytes = serverSV === null || typeof serverSV === 'string' ? null : new Uint8Array(serverSV);
    const divergedRaw = await readCustom(persistence, 'diverged');
    return {
      status: 'ok',
      diffBytes: await computeDiffBytes(doc, svBytes),
      diverged: divergedRaw === '1',
    };
  } finally {
    doc.destroy();
    await persistence.destroy().catch(() => undefined);
  }
}

/** Y5 T13（§0.6 删除原语）：单库删除三态——`onblocked` 立即返回 'blocked'（他标签持连接），
 *  调用方据此写 names 墓碑；成功/失败分别 'deleted'/'failed'。与旧层
 *  旧层 makeQuiet 删除原语（onblocked 直接 resolve、分不出三态）分立——旧层已随 Y5 T14
 *  整层退役删除，本原语服务新层删除闸（三态可区分是墓碑重试判据）。 */
export function deleteDbWithOutcome(dbName: string): Promise<'deleted' | 'blocked' | 'failed'> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.deleteDatabase(dbName);
    } catch {
      resolve('failed');
      return;
    }
    req.onsuccess = () => resolve('deleted');
    req.onerror = () => resolve('failed');
    req.onblocked = () => resolve('blocked');
  });
}

/** Y5 T13（§0.6 横幅导出腿）：在指定库的活 doc 上执行回调后立即销毁（临时装载——零连接零
 *  provider，绝不把 doc 交给 provider 或会话）。库不存在/开库失败=null（调用方 fail-soft）。
 *  消费点：旧代 hold 库的「导出」动作——当前会话 doc 里没有那些内容，必须从盘上那只库取。
 *  存在性前置：`IndexeddbPersistence` 构造会**创建**空库，直接开会给不存在的库留下空壳——
 *  databases() 可用时先查；不可用（旧 Safari/Firefox）时按能力降级直接开（与 y-indexeddb 同款）。 */
export async function withDbDoc<T>(dbName: string, fn: (doc: Y.Doc) => T): Promise<T | null> {
  const idb: IDBFactory | undefined = typeof indexedDB !== 'undefined' ? indexedDB : undefined;
  if (typeof idb?.databases === 'function') {
    try {
      const dbs = await idb.databases();
      if (!dbs.some((d) => d.name === dbName)) return null;
    } catch { /* 枚举失败=按能力降级继续（下面开库自会失败或成功） */ }
  }
  const opened = await attemptOpen(dbName);
  if (!opened.ok) return null;
  try {
    return fn(opened.doc);
  } finally {
    opened.doc.destroy();
    await opened.persistence.destroy().catch(() => undefined);
  }
}

// ───────────────────────── 删除闸+清扫（Y5 T13） ─────────────────────────

export type DeleteGateTrigger =
  | 'startup' | 'generation' | 'safeReload' | 'accept' | 'resync' | 'purge-family' | 'project-delete';

export type DeleteGateOutcome = 'deleted' | 'held' | 'acked' | 'blocked';

export interface DeleteGateOptions {
  /** 调用方已确认导出文件生成（保全义务履行完毕）——直删，不测量。 */
  exportConfirmed?: boolean;
  /** 用户显式点「放弃本地副本」——直删。 */
  discardConfirmed?: boolean;
  /** 存量 names 行（省一次读；缺省时按 dbName 查表）。 */
  nameRow?: NameRow & { dbName: string };
}

/** 写 hold 标记（fail-soft：写失败返回 false，调用方按「不删」处理）。
 *  墓碑行不写 hold（互斥——tombstone=已裁定待删，再置 hold 会被 putNameRow 断言拦下）。 */
async function markHeld(dbName: string, row: (NameRow & { dbName: string }) | undefined): Promise<boolean> {
  if (!row) return false;
  if (row.tombstone === true) return false;
  try {
    await putNameRow(dbName, { ...row, hold: true });
    return true;
  } catch {
    return false;
  }
}

/** 写墓碑标记（C4：删除被 blocked——裁定已完成、只是删不掉；下次启动直删不过闸不读内容）。 */
async function markTombstone(dbName: string, row: (NameRow & { dbName: string }) | undefined): Promise<boolean> {
  if (!row) return false;
  try {
    await putNameRow(dbName, { ...row, hold: false, tombstone: true });
    return true;
  } catch {
    return false;
  }
}

/** Y5 T13（§0.6 统一删除闸）：三合法判据才删——①acked（差分==EMPTY_DOC_ENCODE_BYTES ∧ 无 diverged）
 *  ②调用方已确认导出文件生成 ③用户点放弃。其余一律写 hold:true 且不删（宁留勿删：任何误删都是
 *  用户数据永久丢失）。测量超时/开库失败 → 'held'（不删）且**不写 bannedDbNames**（一次清扫超时
 *  不得锁死本会话开项目）。 */
export async function applyDeleteGate(
  dbName: string,
  trigger: DeleteGateTrigger,
  opts: DeleteGateOptions = {},
): Promise<DeleteGateOutcome> {
  void trigger;   // 归因标签：调用方上报 diag 时携带（本模块不引 collabDiagnostics——P6 纯策略面）
  const row = opts.nameRow ?? (await listNameRows()).find((r) => r.dbName === dbName);
  if (opts.exportConfirmed === true || opts.discardConfirmed === true) {
    const outcome = await deleteDbWithOutcome(dbName);
    if (outcome === 'deleted') {
      await deleteNameRow(dbName).catch(() => undefined);
      return 'deleted';
    }
    // 用户已裁定（导出成功/显式放弃）但删不掉（他标签持连接）=「已裁定待删」——写墓碑
    // 让下次启动直删不过闸，禁再亮横幅逼用户重做同一个动作。
    if (outcome === 'blocked') {
      await markTombstone(dbName, row);
      return 'blocked';
    }
    await markHeld(dbName, row);   // 删除失败（非 blocked）：留库+旗，下次重试
    return 'held';
  }
  const measured = await measureYjsDoc(dbName);
  if (measured.status !== 'ok') {
    await markHeld(dbName, row);   // 超时/开库失败=不可判定 ⇒ 不删
    return 'held';
  }
  if (measured.diffBytes === EMPTY_DOC_ENCODE_BYTES && !measured.diverged) {
    const outcome = await deleteDbWithOutcome(dbName);
    if (outcome === 'deleted') {
      await deleteNameRow(dbName).catch(() => undefined);
      return 'acked';
    }
    // acked=内容已在服务端，删不掉同样是「已裁定待删」——墓碑重试
    if (outcome === 'blocked') {
      await markTombstone(dbName, row);
      return 'blocked';
    }
    await markHeld(dbName, row);
    return 'held';
  }
  await markHeld(dbName, row);
  return 'held';
}

export interface SweepResult {
  deleted: number;
  held: number;
  blocked: number;
  /** true=环境无 databases() 能力，只能按 names 表扫描（孤儿库扫不到——如实上报，禁静默）。 */
  skippedNoDatabasesApi?: boolean;
}

/** 该 uid+pid 全部新层库过删除闸（项目删除/接受恢复等场景）。
 *  `excludeDbName`=当前会话正持有连接的库——**必须排除**：删它必 blocked，而 blocked 会写墓碑，
 *  下次启动就会把一只活库直删（数据丢失）。 */
export async function purgePidDbFamily(
  uid: string,
  pid: string,
  trigger: DeleteGateTrigger,
  excludeDbName?: string,
): Promise<SweepResult> {
  const result: SweepResult = { deleted: 0, held: 0, blocked: 0 };
  let rows: Array<NameRow & { dbName: string }>;
  try {
    rows = await listNameRows();
  } catch {
    return result;   // 读不到 names=不可判定，零动作（不删）
  }
  for (const row of rows) {
    if (row.uid !== uid || row.pid !== pid) continue;
    if (excludeDbName !== undefined && row.dbName === excludeDbName) continue;
    const outcome = await applyDeleteGate(row.dbName, trigger, { nameRow: row });
    if (outcome === 'deleted' || outcome === 'acked') result.deleted += 1;
    else if (outcome === 'blocked') result.blocked += 1;
    else result.held += 1;
  }
  return result;
}

/** Y5 T13（§0.6 登出行 + C4 墓碑）：清该 uid 全部新层文档库——逐个 deleteDatabase，
 *  **blocked 的写 names 行 tombstone:true**（下次启动按墓碑直删不过闸）；未 blocked 的 names 行
 *  随删随去。三表清理（session/names/bindings）归调用方（AuthProvider 既有 Promise.all）。 */
export async function purgeUidDbs(uid: string): Promise<SweepResult> {
  const result: SweepResult = { deleted: 0, held: 0, blocked: 0 };
  let rows: Array<NameRow & { dbName: string }>;
  try {
    rows = (await listNameRows()).filter((r) => r.uid === uid);
  } catch {
    return result;
  }
  for (const row of rows) {
    const outcome = await deleteDbWithOutcome(row.dbName);
    if (outcome === 'deleted') {
      await deleteNameRow(row.dbName).catch(() => undefined);
      result.deleted += 1;
    } else if (outcome === 'blocked') {
      // 墓碑：hold 清零（已裁定待删）+ tombstone 置真——下次 sweepStartup 直删不读内容
      try {
        await putNameRow(row.dbName, { ...row, hold: false, tombstone: true });
      } catch { /* 写失败=留原行（下次重试） */ }
      result.blocked += 1;
    } else {
      result.held += 1;   // 删除失败（非 blocked）=留库，不清行
    }
  }
  return result;
}

/** Y5 T13（§0.6 启动清扫）：范围=`indexedDB.databases()` ∪ names 表**并集**。
 *  - `databases()` 可用：以它为主枚举源（含 names 表外的孤儿库），names 只提供 hold/tombstone 标记；
 *  - `databases()` 缺席：只能走 names 表，如实置 `skippedNoDatabasesApi`（孤儿库扫不到）；
 *  - 墓碑库（names.tombstone===true）**直删不过闸不读内容**（§0.1.4）；
 *  - `flowweb:yjs:` 他人 uid 库**不碰**（登出 purgeUidDbs 的职责）；
 *  - 旧层 `flowweb:collab:` 前缀**本任务不删**（T14 整层退役时随删——t18 等旧层用例仍依赖）。
 *  零库=正常返回（首次启动不是错误）。 */
export async function sweepStartup(uid: string): Promise<SweepResult> {
  const result: SweepResult = { deleted: 0, held: 0, blocked: 0 };
  let namesRows: Array<NameRow & { dbName: string }> = [];
  try {
    namesRows = await listNameRows();
  } catch { /* names 不可读=下面按 databases() 尽力扫，标记归零 */ }
  const byName = new Map(namesRows.map((r) => [r.dbName, r]));

  let candidates: string[] = [];
  const idb: IDBFactory | undefined = typeof indexedDB !== 'undefined' ? indexedDB : undefined;
  if (typeof idb?.databases === 'function') {
    try {
      const dbs = await idb.databases();
      candidates = dbs.map((d) => d.name).filter((n): n is string => typeof n === 'string');
    } catch {
      candidates = [];
    }
  } else {
    result.skippedNoDatabasesApi = true;   // 如实上报：孤儿库扫不到
    candidates = namesRows.map((r) => r.dbName);
  }
  // 并集：databases() 可用时也要并入 names 表里存在但 databases() 未返回的库（删除中的库等）
  for (const row of namesRows) {
    if (!candidates.includes(row.dbName)) candidates.push(row.dbName);
  }

  for (const dbName of candidates) {
    if (!dbName.startsWith(DOC_DB_PREFIX)) continue;   // 旧层/其他前缀不在本任务范围
    const row = byName.get(dbName);
    // 墓碑库：直删不过闸不读内容（§0.1.4）
    if (row?.tombstone === true) {
      const outcome = await deleteDbWithOutcome(dbName);
      if (outcome === 'deleted') { await deleteNameRow(dbName).catch(() => undefined); result.deleted += 1; }
      else if (outcome === 'blocked') result.blocked += 1;
      else result.held += 1;
      continue;
    }
    // 他人 uid 库不碰（登出清理是 purgeUidDbs 的职责）
    if (row !== undefined && row.uid !== uid) continue;
    // 有 names 行的当前 uid 库 → 过闸
    if (row !== undefined) {
      const outcome = await applyDeleteGate(dbName, 'startup', { nameRow: row });
      if (outcome === 'deleted' || outcome === 'acked') result.deleted += 1;
      else if (outcome === 'blocked') result.blocked += 1;
      else result.held += 1;
      continue;
    }
    // 无 names 行的孤儿库：库名段含 uid——按段判归属
    const parts = dbName.slice(DOC_DB_PREFIX.length).split(':');
    if (parts[0] !== uid) continue;
    const outcome = await applyDeleteGate(dbName, 'startup');
    if (outcome === 'deleted' || outcome === 'acked') result.deleted += 1;
    else if (outcome === 'blocked') result.blocked += 1;
    else result.held += 1;
  }
  return result;
}
