// apps/web/src/collab/local-yjs-store.ts
// Y5 T3：本地策略模块 meta 半边——flowweb:yjs-meta 三表（names/session/bindings）、
// 五维文档库名、session 单活行、names 墓碑字段、userSnapshot 白名单（spec §0.1.4）。
// 本文件只做本地存储策略，不做第二份文档编码；文档库半边（openYjsDoc/readCustom/
// computeDiffBytes 等）归 T4 在同一文件续写。
// 失败面：全部 promise 化，任何写失败 reject——调用方 fail-closed（names 写失败则本会话
// 不开那只文档库）。连接策略：每次调用独立 open、事务完成即 close——不缓存长持连接，
// 不会阻塞后续 deleteDatabase（多标签清理路径）。
import type { Role } from '@flowweb/shared';

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
 *  墓碑改写=putNameRow(name, { ..., hold: false, tombstone: true })（hold/tombstone 互斥）。 */
export async function putNameRow(dbName: string, row: NameRow): Promise<void> {
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
