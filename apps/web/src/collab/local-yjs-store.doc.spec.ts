// apps/web/src/collab/local-yjs-store.doc.spec.ts
// Y5 T4：策略模块文档库半边——开库 10s 竞赛+废弃 doc+同库名禁重开、custom 三键、差分字节。
// 装置=fake-indexeddb/auto（真事务语义）；受控注入只发生在测试侧（indexedDB.open 延迟放行），
// 生产代码无测试钩子。
// 断言锚（spec §0.2 步 2/4、§0.1.5、验收 13/25 半边）：
//   ①开库成功=库内 update 已 apply 进 doc+whenSynced 已 resolve；
//   ②超时 → ok:false+persistence._destroyed+doc.destroyed+同库名第二次直接拒绝且不再构造
//     IndexeddbPersistence（indexedDB.open 调用数不增）；
//   ③迟到 apply：放行 pending open 后只可能落在已废弃 doc（本例因 destroy 先置 _destroyed
//     而被挡在门外），服务端水合用的新 doc 不含迟到行；
//   ④readCustom/writeCustom 轮回（serverSV=精确切片 ArrayBuffer、grant/diverged=字符串、缺键 null）；
//   ⑤computeDiffBytes 返回原始 byteLength：无 SV=全量、有 SV=差分、已同步/空文档=非零常量
//     EMPTY_DOC_ENCODE_BYTES（Yjs 空更新长度不是 0）；measureYjsDoc ok=按库内 serverSV 算差分，
//     超时=hold 语义且不写本会话禁开集合。
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import {
  EMPTY_DOC_ENCODE_BYTES,
  HYDRATION_OPEN_TIMEOUT_MS,
  computeDiffBytes,
  isDbNameBannedThisSession,
  measureYjsDoc,
  openYjsDoc,
  readCustom,
  writeCustom,
} from './local-yjs-store';

let dbSeq = 0;

function uniqueDbName(): string {
  dbSeq += 1;
  return `flowweb:yjs:test:doc:${String(Date.now())}:${String(dbSeq)}`;
}

/** 造一份含 map 内容的 doc 与其全量 update（种子行）。 */
function buildUpdate(entries: Record<string, string>): { doc: Y.Doc; update: Uint8Array } {
  const doc = new Y.Doc();
  const map = doc.getMap<string>('m');
  for (const [key, value] of Object.entries(entries)) map.set(key, value);
  return { doc, update: Y.encodeStateAsUpdate(doc) };
}

function mapEntries(doc: Y.Doc): Array<[string, string]> {
  return [...doc.getMap<string>('m').entries()];
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** 打开原始库（建 y-indexeddb 同款 updates/custom 两 store）——种子写入绕过 API 面。 */
function openRawDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('updates')) {
        db.createObjectStore('updates', { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('custom')) db.createObjectStore('custom');
    };
    request.onsuccess = () => { resolve(request.result); };
    request.onerror = () => { reject(request.error ?? new Error('raw open failed')); };
  });
}

async function withRawDb(name: string, run: (db: IDBDatabase) => Promise<void>): Promise<void> {
  const db = await openRawDb(name);
  try {
    await run(db);
  } finally {
    db.close();
  }
}

async function seedUpdates(name: string, updates: Uint8Array[]): Promise<void> {
  await withRawDb(name, (db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction('updates', 'readwrite');
    for (const update of updates) tx.objectStore('updates').add(update);
    tx.oncomplete = () => { resolve(); };
    tx.onerror = () => { reject(tx.error ?? new Error('seed updates failed')); };
    tx.onabort = () => { reject(tx.error ?? new Error('seed updates aborted')); };
  }));
}

async function seedCustom(name: string, entries: Record<string, string | ArrayBuffer>): Promise<void> {
  await withRawDb(name, (db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction('custom', 'readwrite');
    const store = tx.objectStore('custom');
    for (const [key, value] of Object.entries(entries)) store.put(value, key);
    tx.oncomplete = () => { resolve(); };
    tx.onerror = () => { reject(tx.error ?? new Error('seed custom failed')); };
    tx.onabort = () => { reject(tx.error ?? new Error('seed custom aborted')); };
  }));
}

/** 轮询至条件成立（真定时器；fake-indexeddb 的 queueTask 走 setImmediate 不受影响）。 */
async function waitFor(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

interface DeferredOpen {
  callCount: () => number;
  /** 放行 pending open：用真 open 重放同名库，把 lib0 挂在待定请求上的处理器转接过去。 */
  release: () => void;
}

/**
 * 控制注入（仅测试侧）：把第一次 indexedDB.open 换成一个永不触发的请求对象，让
 * IndexeddbPersistence 的 whenSynced 永远等不到；之后的 open 直接透传。release() 即
 * 「fakeIndexedDb 放行 pending open」——迟到 apply 在库连接建立后才会发生。
 */
function deferNextIndexedDbOpen(): DeferredOpen {
  const realOpen = indexedDB.open.bind(indexedDB);
  let deferredArgs: [name: string, version: number | undefined] | null = null;
  let released = false;
  const deferredRequest = {
    result: null,
    error: null,
    onupgradeneeded: null,
    onsuccess: null,
    onerror: null,
    onblocked: null,
  } as unknown as IDBOpenDBRequest;
  const openSpy = vi.spyOn(indexedDB, 'open').mockImplementation((name: string, version?: number) => {
    if (deferredArgs !== null) return realOpen(name, version);
    deferredArgs = [name, version];
    return deferredRequest;
  });
  return {
    callCount: () => openSpy.mock.calls.length,
    release: () => {
      if (deferredArgs === null || released) return;
      released = true;
      const [name, version] = deferredArgs;
      const realRequest = realOpen(name, version);
      realRequest.onupgradeneeded = (event) => { deferredRequest.onupgradeneeded?.(event); };
      realRequest.onsuccess = (event) => { deferredRequest.onsuccess?.(event); };
      realRequest.onerror = (event) => { deferredRequest.onerror?.(event); };
    },
  };
}

interface PersistenceCapture {
  persistence?: IndexeddbPersistence;
}

/** 捕获 openYjsDoc/measureYjsDoc 内部构造的 persistence 实例（测试侧观测，不引生产钩子）。 */
function capturePersistence(): PersistenceCapture {
  const capture: PersistenceCapture = {};
  // 原型方法取引用（unbound-method）只用于转调，this 由 call 显式绑定。
  const originalDestroy = IndexeddbPersistence.prototype.destroy;   // eslint-disable-line @typescript-eslint/unbound-method
  vi.spyOn(IndexeddbPersistence.prototype, 'destroy').mockImplementation(function (this: IndexeddbPersistence) {
    capture.persistence = this;
    return originalDestroy.call(this);
  });
  return capture;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('openYjsDoc：成功路径', () => {
  it('库内 update 已 apply 进 doc，whenSynced 已 resolve', async () => {
    const name = uniqueDbName();
    await seedUpdates(name, [buildUpdate({ a: '1', b: '2' }).update]);

    const result = await openYjsDoc(name);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    try {
      expect(mapEntries(result.doc)).toEqual([['a', '1'], ['b', '2']]);
      expect(result.persistence.synced).toBe(true);
      expect(result.persistence._destroyed).toBe(false);
      await result.persistence.whenSynced;   // 成功分支=whenSynced 已 resolve（不挂起）
    } finally {
      await result.persistence.destroy();
      result.doc.destroy();
    }
  });
});

describe('openYjsDoc：10s 竞赛与同库名禁重开', () => {
  it('超时 → ok:false+persistence 已 destroy+doc 已 destroy；第二次直接拒绝且不再构造 persistence', async () => {
    const name = uniqueDbName();
    const deferred = deferNextIndexedDbOpen();
    const capture = capturePersistence();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const pending = openYjsDoc(name);
      await vi.advanceTimersByTimeAsync(HYDRATION_OPEN_TIMEOUT_MS);
      const result = await pending;

      expect(result).toEqual({ ok: false, reason: 'timeout' });
      expect(capture.persistence).toBeDefined();
      const persistence = capture.persistence as IndexeddbPersistence;
      expect(persistence._destroyed).toBe(true);
      expect(persistence.doc.isDestroyed).toBe(true);
      expect(isDbNameBannedThisSession(name)).toBe(true);

      const opensBefore = deferred.callCount();
      expect(opensBefore).toBe(1);
      const again = await openYjsDoc(name);
      expect(again).toEqual({ ok: false, reason: 'timeout' });
      expect(deferred.callCount()).toBe(opensBefore);   // 禁开=零新 IndexeddbPersistence（零 indexedDB.open）
    } finally {
      vi.useRealTimers();
    }
  });

  it('迟到 apply：放行 pending open 后已废弃 doc 与新 doc 都不含迟到行', async () => {
    const name = uniqueDbName();
    const late = buildUpdate({ late: 'row' });
    await seedUpdates(name, [late.update]);
    const deferred = deferNextIndexedDbOpen();
    const capture = capturePersistence();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = openYjsDoc(name);
    await vi.advanceTimersByTimeAsync(HYDRATION_OPEN_TIMEOUT_MS);
    const result = await pending;
    vi.useRealTimers();

    expect(result).toEqual({ ok: false, reason: 'timeout' });
    const persistence = capture.persistence as IndexeddbPersistence;
    const discardedDoc = persistence.doc;
    expect(discardedDoc.isDestroyed).toBe(true);
    let lateUpdates = 0;
    discardedDoc.on('update', () => { lateUpdates += 1; });

    // 竞赛先 resolve，之后才放行 pending open——这正是「迟到 apply」窗口。
    deferred.release();
    await waitFor(() => persistence._dbsize >= 1, '废弃 persistence 的装载链跑完');

    expect(lateUpdates).toBe(0);
    expect(mapEntries(discardedDoc)).toEqual([]);
    // 随后的服务端水合使用新 doc：迟到行永远到不了这里。
    const serverDoc = new Y.Doc();
    try {
      expect(mapEntries(serverDoc)).toEqual([]);
    } finally {
      serverDoc.destroy();
    }
    // 同库名仍禁开（不再构造 persistence）。
    const opensBefore = deferred.callCount();
    expect(await openYjsDoc(name)).toEqual({ ok: false, reason: 'timeout' });
    expect(deferred.callCount()).toBe(opensBefore);
    late.doc.destroy();
  });
});

describe('readCustom/writeCustom：custom 单通道三键', () => {
  it('serverSV=精确切片 ArrayBuffer、writeGrant/diverged=字符串；缺键读 null', async () => {
    const name = uniqueDbName();
    const opened = await openYjsDoc(name);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    try {
      const exactSlice = new Uint8Array([9, 1, 2, 3, 9]).buffer.slice(1, 4);   // 长度 3 的精确切片
      await writeCustom(opened.persistence, 'serverSV', exactSlice);
      await writeCustom(opened.persistence, 'writeGrant', 'read-write');
      await writeCustom(opened.persistence, 'diverged', '1');

      const storedSv = await readCustom(opened.persistence, 'serverSV');
      // 跨 realm 的 ArrayBuffer 不是本 realm 构造器实例（jsdom 测试装置+fake-indexeddb 的
      // structuredClone 会在另一 realm 里造对象）——按内部标签判定，生产路径同款判定。
      expect(Object.prototype.toString.call(storedSv)).toBe('[object ArrayBuffer]');
      expect((storedSv as ArrayBuffer).byteLength).toBe(3);
      expect(Array.from(new Uint8Array(storedSv as ArrayBuffer))).toEqual([1, 2, 3]);
      expect(await readCustom(opened.persistence, 'writeGrant')).toBe('read-write');
      expect(await readCustom(opened.persistence, 'diverged')).toBe('1');
      expect(await readCustom(opened.persistence, 'missing-key')).toBeNull();
    } finally {
      await opened.persistence.destroy();
      opened.doc.destroy();
    }
  });
});

describe('computeDiffBytes/EMPTY_DOC_ENCODE_BYTES：原始差分字节', () => {
  it('空更新长度是非零常量（Yjs 空编码不是 0）；空文档差分等于它', async () => {
    expect(EMPTY_DOC_ENCODE_BYTES).toBe(Y.encodeStateAsUpdate(new Y.Doc()).byteLength);
    expect(EMPTY_DOC_ENCODE_BYTES).toBeGreaterThan(0);
    const empty = new Y.Doc();
    try {
      expect(await computeDiffBytes(empty, null)).toBe(EMPTY_DOC_ENCODE_BYTES);
    } finally {
      empty.destroy();
    }
  });

  it('无 SV=全量原始字节数；有 SV=差分原始字节数；已同步文档=空编码', async () => {
    const doc = new Y.Doc();
    try {
      doc.getMap<string>('m').set('a', '1');
      const fullBytes = Y.encodeStateAsUpdate(doc).byteLength;
      expect(await computeDiffBytes(doc, null)).toBe(fullBytes);
      expect(fullBytes).toBeGreaterThan(EMPTY_DOC_ENCODE_BYTES);

      const svBefore = Y.encodeStateVector(doc);
      doc.getMap<string>('m').set('b', '2');
      const expectedDiff = Y.encodeStateAsUpdate(doc, svBefore).byteLength;
      expect(await computeDiffBytes(doc, svBefore)).toBe(expectedDiff);   // 原始值，不做任何减法
      expect(expectedDiff).toBeGreaterThan(EMPTY_DOC_ENCODE_BYTES);

      const svAfter = Y.encodeStateVector(doc);
      expect(await computeDiffBytes(doc, svAfter)).toBe(EMPTY_DOC_ENCODE_BYTES);   // 已同步=空编码
    } finally {
      doc.destroy();
    }
  });
});

describe('measureYjsDoc：删除闸测量（超时不写禁开集合）', () => {
  it('ok：按库内 serverSV 算差分，测完立即 destroy doc 与 persistence', async () => {
    const name = uniqueDbName();
    const seeded = buildUpdate({ a: '1' });
    await seedUpdates(name, [seeded.update]);
    await seedCustom(name, { serverSV: toArrayBuffer(Y.encodeStateVector(seeded.doc)) });
    const capture = capturePersistence();

    const result = await measureYjsDoc(name);
    // Y5 T13：measure 结果增 diverged 维度——acked 判据=「差分空 ∧ 无 diverged」，只读差分会误删
    expect(result).toEqual({ status: 'ok', diffBytes: EMPTY_DOC_ENCODE_BYTES, diverged: false });
    expect(capture.persistence).toBeDefined();
    expect(capture.persistence?._destroyed).toBe(true);
    expect(capture.persistence?.doc.isDestroyed).toBe(true);
    expect(isDbNameBannedThisSession(name)).toBe(false);
    seeded.doc.destroy();
  });

  it('ok：无 serverSV 时返回全量原始字节数（有内容 > 空编码）', async () => {
    const name = uniqueDbName();
    const seeded = buildUpdate({ a: '1', b: '2' });
    await seedUpdates(name, [seeded.update]);

    const result = await measureYjsDoc(name);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.diffBytes).toBe(Y.encodeStateAsUpdate(seeded.doc).byteLength);
    expect(result.diffBytes).toBeGreaterThan(EMPTY_DOC_ENCODE_BYTES);
    seeded.doc.destroy();
  });

  it('超时 → status timeout（hold 语义），且不把库名写入本会话禁开集合', async () => {
    const name = uniqueDbName();
    await seedUpdates(name, [buildUpdate({ a: '1' }).update]);
    const deferred = deferNextIndexedDbOpen();
    const capture = capturePersistence();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const pending = measureYjsDoc(name);
      await vi.advanceTimersByTimeAsync(HYDRATION_OPEN_TIMEOUT_MS);
      expect(await pending).toEqual({ status: 'timeout' });
      expect(isDbNameBannedThisSession(name)).toBe(false);   // 测量不锁死水合路径
      expect(capture.persistence?._destroyed).toBe(true);
      expect(capture.persistence?.doc.isDestroyed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    deferred.release();
    // 放行后装载链收尾（废弃 persistence 跳过 apply，只跑计数/关连接）——测试期内清算，免跨用例噪声。
    await waitFor(() => (capture.persistence?._dbsize ?? 0) >= 1, '废弃 persistence 的装载链收尾');
  });
});
