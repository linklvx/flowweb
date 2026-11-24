// apps/web/src/collab/local-yjs-store.trim.spec.ts
// Y5 T2：y-indexeddb 9.0.12 storeState 补丁双腿测试（验收 24）。
// 腿一=行为锚：destroy 落在 storeState 的 fetchUpdates resolve 之后、快照 add 之前时，
//   他标签已落盘行不得被 del 吃掉，新实例能完整回放；
// 腿二=补丁缝判据：快照 add 与 del 在同一同步回调（del 触发时微任务探针未置起），
//   两请求同一 IDBTransaction 为附加不变量；
// 对照腿=未 destroy 时快照照写、旧行照删。
// 装置=fake-indexeddb/auto（真事务语义）。仓内 src/test/fakeIndexedDb.ts 只建模旧适配器
// 子集（单 kv store，无 IDBKeyRange/游标/事务回滚），跑不了真 y-indexeddb，故不改动它。
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { IndexeddbPersistence, storeState } from 'y-indexeddb';

interface StoredRow {
  key: number;
  value: Uint8Array;
}

const liveInstances: IndexeddbPersistence[] = [];
let dbSeq = 0;

afterEach(() => {
  for (const instance of liveInstances) void instance.destroy();
  liveInstances.length = 0;
});

function track(instance: IndexeddbPersistence): IndexeddbPersistence {
  liveInstances.push(instance);
  return instance;
}

function uniqueDbName(): string {
  dbSeq += 1;
  return `flowweb:test:trim:${Date.now()}:${dbSeq}`;
}

function toBytes(value: unknown): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer);
}

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('updates')) {
        db.createObjectStore('updates', { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('custom')) {
        db.createObjectStore('custom');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function addRow(db: IDBDatabase, value: Uint8Array): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('updates', 'readwrite');
    const request = tx.objectStore('updates').add(value);
    let key = -1;
    request.onsuccess = () => {
      key = request.result as number;
    };
    tx.oncomplete = () => resolve(key);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function readRows(db: IDBDatabase): Promise<StoredRow[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('updates', 'readonly');
    const store = tx.objectStore('updates');
    const keysRequest = store.getAllKeys();
    const valuesRequest = store.getAll();
    tx.oncomplete = () => {
      const keys = keysRequest.result as number[];
      const values = valuesRequest.result as unknown[];
      resolve(keys.map((key, index) => ({ key, value: toBytes(values[index]) })));
    };
    tx.onerror = () => reject(tx.error);
  });
}

function sameRows(a: StoredRow[], b: StoredRow[]): boolean {
  return a.length === b.length && a.every((row, index) => {
    const other = b[index];
    return row.key === other.key
      && row.value.length === other.value.length
      && row.value.every((byte, byteIndex) => byte === other.value[byteIndex]);
  });
}

/** 轮询至 updates store 行集稳定——storeState 内层 add/del 链不随其返回 promise 一起 resolve。 */
async function waitForQuiet(db: IDBDatabase): Promise<StoredRow[]> {
  let previous: StoredRow[] | null = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
    const current = await readRows(db);
    if (previous !== null && sameRows(previous, current)) return current;
    previous = current;
  }
  throw new Error('updates store did not settle');
}

/** 模拟「他标签已落盘」：独立 clientID 的增量 update 逐条入 updates store（每行都不可省）。 */
async function seedOtherTabRows(db: IDBDatabase, count = 6): Promise<{ doc: Y.Doc; rows: StoredRow[] }> {
  const doc = new Y.Doc();
  const map = doc.getMap<string>('other');
  const updates: Uint8Array[] = [];
  const onUpdate = (update: Uint8Array) => updates.push(update);
  doc.on('update', onUpdate);
  for (let index = 0; index < count; index += 1) {
    map.set(`k${index}`, `v${index}`);
  }
  doc.off('update', onUpdate);
  const rows: StoredRow[] = [];
  for (const update of updates) {
    const key = await addRow(db, update);
    rows.push({ key, value: update });
  }
  return { doc, rows };
}

function mapEntries(doc: Y.Doc): Array<[string, string]> {
  return [...doc.getMap<string>('other').entries()];
}

interface SyncProbe {
  addTransaction: IDBTransaction | null;
  delTransaction: IDBTransaction | null;
  probeFiredWhenDeleted: boolean | null;
  restore: () => void;
}

interface StoreProto {
  add: (this: IDBObjectStore, value: unknown, key?: IDBValidKey) => IDBRequest;
  delete: (this: IDBObjectStore, query: IDBValidKey | IDBKeyRange) => IDBRequest;
}

/**
 * C4 缝判据：add 触发时挂微任务探针；del 触发时读探针是否已跑。
 * 原版 addAutoKey(...).then(() => del(...)) 跨 then ⇒ del 时探针已置起（红）；
 * 补丁版 add/del 同一同步回调 ⇒ 探针未置起（绿）。
 */
function installSyncProbe(db: IDBDatabase): SyncProbe {
  const tx = db.transaction('updates', 'readonly');
  const proto = Object.getPrototypeOf(tx.objectStore('updates')) as StoreProto;
  const originalAdd = proto.add;
  const originalDelete = proto.delete;
  let probeFired = false;
  const probe: SyncProbe = {
    addTransaction: null,
    delTransaction: null,
    probeFiredWhenDeleted: null,
    restore: () => {
      proto.add = originalAdd;
      proto.delete = originalDelete;
    },
  };
  proto.add = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    if (this.name === 'updates' && probe.addTransaction === null) {
      probe.addTransaction = this.transaction;
      queueMicrotask(() => {
        probeFired = true;
      });
    }
    return originalAdd.call(this, value, key);
  };
  proto.delete = function (this: IDBObjectStore, query: IDBValidKey | IDBKeyRange) {
    if (this.name === 'updates' && probe.addTransaction !== null && probe.delTransaction === null) {
      probe.delTransaction = this.transaction;
      probe.probeFiredWhenDeleted = probeFired;
    }
    return originalDelete.call(this, query);
  };
  return probe;
}

describe('Y5 T2 y-indexeddb storeState 补丁', () => {
  it('腿一（验收 24 行为锚）：destroy 撞在途 trim 不删他标签已落盘行，新实例完整回放', async () => {
    const name = uniqueDbName();
    const db = await openDb(name);
    const seeded = await seedOtherTabRows(db);

    const persistence = track(new IndexeddbPersistence(name, new Y.Doc()));
    // 等构造期 _db 就绪（其初始 fetchUpdates 已在同一微任务轮次内启动）——此时 db 已可
    // 供 storeState 使用，而 getAll 尚未 resolve。
    await persistence._db;
    const pending = storeState(persistence, true);
    void persistence.destroy();
    await pending;

    const rows = await waitForQuiet(db);
    const stored = new Map(rows.map((row) => [row.key, row.value]));
    for (const row of seeded.rows) {
      expect(stored.get(row.key)).toEqual(row.value);
    }

    // 原地回放：剩下的行必须能重建他标签全部内容与 state vector。
    const replayed = new Y.Doc();
    for (const row of rows) Y.applyUpdate(replayed, row.value);
    expect(mapEntries(replayed)).toEqual(mapEntries(seeded.doc));
    expect(Y.encodeStateVector(replayed)).toEqual(Y.encodeStateVector(seeded.doc));

    // 新实例（构造期自身会写一条快照行）也能回放全部内容。
    const fresh = track(new IndexeddbPersistence(name, new Y.Doc()));
    await fresh.whenSynced;
    expect(mapEntries(fresh.doc)).toEqual(mapEntries(seeded.doc));
  });

  it('腿二（C4 同步段）：快照 add 与 del 同一同步回调，两请求同一事务', async () => {
    const name = uniqueDbName();
    const db = await openDb(name);
    await seedOtherTabRows(db);

    const persistence = track(new IndexeddbPersistence(name, new Y.Doc()));
    await persistence.whenSynced;
    await waitForQuiet(db);

    const probe = installSyncProbe(db);
    try {
      await storeState(persistence, true);
      await waitForQuiet(db);
    } finally {
      probe.restore();
    }

    expect(probe.addTransaction).not.toBeNull();
    expect(probe.delTransaction).not.toBeNull();
    expect(probe.delTransaction).toBe(probe.addTransaction);
    expect(probe.probeFiredWhenDeleted).toBe(false);
  });

  it('对照腿：未 destroy 时 storeState 照常写快照并修剪旧行', async () => {
    const name = uniqueDbName();
    const db = await openDb(name);
    const seeded = await seedOtherTabRows(db);

    const persistence = track(new IndexeddbPersistence(name, new Y.Doc()));
    await persistence.whenSynced;
    const before = await waitForQuiet(db);

    await storeState(persistence, true);
    const after = await waitForQuiet(db);

    expect(after.length).toBeLessThan(before.length);
    const replayed = new Y.Doc();
    for (const row of after) Y.applyUpdate(replayed, row.value);
    expect(mapEntries(replayed)).toEqual(mapEntries(seeded.doc));
    expect(Y.encodeStateVector(replayed)).toEqual(Y.encodeStateVector(seeded.doc));
  });
});
