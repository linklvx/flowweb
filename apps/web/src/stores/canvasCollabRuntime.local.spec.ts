// apps/web/src/stores/canvasCollabRuntime.local.spec.ts
// Y5 T10：runtime 水合倒转（names→openYjsDoc→差分→custom 三键→local 合取→provider）+
// local 进入 + serverSV 写回 + origin 过滤 + local→ready 异常检测门。
// 装置：fakeHocuspocusProvider（t8 同源）+ fake-indexeddb/auto（真事务语义——y-indexeddb 需
// openCursor/IDBKeyRange，T4 装置同款）+ setTimeout/setInterval 假定时器（setImmediate 保真——
// y-indexeddb 装载链走真实 macro task，T4 装置同款；心跳/同步 tick 是 interval 必须一并假）。
// 断言锚（brief 九组）：
//   ①冷启动（证明 7d 内+grant read-write+库有内容）→ local+canEdit 真+canExecute 假（验收 1）；
//   ②证明过期或 grant=read → 内容可见 canEdit 假、库还在（验收 2）；
//   ③回放不置 diverged；相对 serverSV 差分才置 dirty（验收 3）；
//   ④provider 创建时 persistence.whenSynced 已 resolve（验收 4 半腿）；
//   ⑤serverSV 写回后 reload 不再标 dirty（验收 5）；
//   ⑥开库超时 → persistence destroy+服务端水合用新 doc（验收 13/8）；
//   ⑦local 期间 update → 10s 死线不置 failed（§0.2 步 2 钉）；
//   ⑧纯快进不跑异常检测、双端差分跑（验收 19）；
//   ⑨names 写失败 → 不开库改服务端水合。
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import { CANVAS_DOC_SCHEMA_VERSION } from '@flowweb/shared';
import { useCanvasStore, clearLocalPreviewAll } from './canvasStore';
import { canEdit, canExecute } from './syncStatus';
import * as runtime from './canvasCollabRuntime';
import { Origin } from './canvasUndo';
import { buildYjsDbName, isDbNameBannedThisSession, putSessionRow, type SessionRow } from '@/collab/local-yjs-store';
import { getRecentCollabDiag, _resetCollabDiagForTest } from '@/utils/collabDiagnostics';
import { _resetUnloadGuardForTest } from '@/utils/unloadGuard';

/** 装置缝（vi.hoisted：mock 工厂提升后闭包可达）：开库完成标记（④）+ names 写失败注入（⑨）
 *  + 持久层句柄捕获（§0.2 步 6 origin 过滤直测）。 */
const harness = vi.hoisted(() => ({
  openResolved: false,
  openResolvedAtProviderCreate: [] as boolean[],
  failNames: false,
  persistence: null as unknown,
}));

vi.mock('@/collab/local-yjs-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/collab/local-yjs-store')>();
  return {
    ...orig,
    putNameRow: async (...args: Parameters<typeof orig.putNameRow>) => {
      if (harness.failNames) throw new Error('names write failed (injected)');
      return orig.putNameRow(...args);
    },
    openYjsDoc: async (dbName: string) => {
      const result = await orig.openYjsDoc(dbName);
      harness.openResolved = true;
      if (result.ok) harness.persistence = result.persistence;
      return result;
    },
  };
});

vi.mock('@hocuspocus/provider', async () => {
  const { FakeHocuspocusProvider } = await import('@/test/fixtures/fakeHocuspocusProvider');
  class OrderProbeProvider extends FakeHocuspocusProvider {
    constructor(cfg: any) {
      super(cfg);
      // ④：构造时刻 openYjsDoc 是否已 resolve（provider 必须在装载之后创建）
      harness.openResolvedAtProviderCreate.push(harness.openResolved);
    }
  }
  return { HocuspocusProvider: OrderProbeProvider };
});

const lastInstance = () => (HocuspocusProvider as any).instances.at(-1) as any;
const reloadSpy = vi.fn();
const persistSpy = vi.fn(async () => true);

/** 真 setImmediate 泵（假定时器只 fake setTimeout/clearTimeout）——fake-indexeddb 的装载链
 *  经真实 macro task 前进，用真实 immediate 驱动（T4 装置同款）。 */
const realImmediate: (cb: () => void) => unknown = (globalThis as any).setImmediate;
const nextImmediate = () => new Promise<void>((resolve) => { realImmediate(() => resolve()); });
/** 泵至谓词成立（真实时间预算——假定时器不影响 now）。 */
async function until(pred: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 4_000;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
    await nextImmediate();
  }
}
/** 泵若干轮（`await` 一条需要真实 macro task 的 promise 前用）。 */
async function pump(turns = 24): Promise<void> {
  for (let i = 0; i < turns; i += 1) await nextImmediate();
}

// 会话态复位归 runtime 自身：startCollabSession 会话起点整组复位 + afterEach destroyCollab
// （idle 单写点）。本文件不直写 store 状态（几何 setState 静态棘轮——新增文件不升基线）。


/** 节点构造（docShape 合形——type+position+data；t8 seedNode 同款）。 */
const seedNode = (id: string, dataExtra: Array<[string, unknown]> = []): Y.Map<any> => new Y.Map<any>([
  ['type', 'textInput'],
  ['position', new Y.Map([['x', 0], ['y', 0]])],
  ['data', new Y.Map<any>([['v', id], ...dataExtra])],
]);

/** 快照构造：schemaVersion 盖戳 + 指定内容。 */
function snapshotOf(build: (d: Y.Doc) => void): Uint8Array {
  const d = new Y.Doc();
  d.getMap('meta').set('schemaVersion', CANVAS_DOC_SCHEMA_VERSION);
  build(d);
  const update = Y.encodeStateAsUpdate(d);
  d.destroy();
  return update;
}

/** 五维库名的空状态向量（无任何内容的服务端基准——差分=全量）。 */
function emptySvBuffer(): ArrayBuffer {
  const d = new Y.Doc();
  const sv = Y.encodeStateVector(d);
  d.destroy();
  return sv.buffer.slice(sv.byteOffset, sv.byteOffset + sv.byteLength);
}

/** 快照全量状态向量（ArrayBuffer 精确切片——serverSV 写域形态）。 */
function svBufferOf(update: Uint8Array): ArrayBuffer {
  const d = new Y.Doc();
  Y.applyUpdate(d, update);
  const sv = Y.encodeStateVector(d);
  d.destroy();
  return sv.buffer.slice(sv.byteOffset, sv.byteOffset + sv.byteLength);
}

/** 原始开库（y-indexeddb 同款两 store——种子写入绕过 API 面；T4 装置同款）。 */
function openRawDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('updates')) db.createObjectStore('updates', { autoIncrement: true });
      if (!db.objectStoreNames.contains('custom')) db.createObjectStore('custom');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('raw open failed'));
  });
}

async function withRawDb<T>(name: string, run: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openRawDb(name);
  try {
    return await run(db);
  } finally {
    db.close();
  }
}

async function seedUpdates(name: string, updates: Uint8Array[]): Promise<void> {
  await withRawDb(name, (db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction('updates', 'readwrite');
    for (const update of updates) tx.objectStore('updates').add(update);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('seed updates failed'));
    tx.onabort = () => reject(tx.error ?? new Error('seed updates aborted'));
  }));
}

async function seedCustom(name: string, entries: Record<string, string | ArrayBuffer>): Promise<void> {
  await withRawDb(name, (db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction('custom', 'readwrite');
    const store = tx.objectStore('custom');
    for (const [key, value] of Object.entries(entries)) store.put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('seed custom failed'));
    tx.onabort = () => reject(tx.error ?? new Error('seed custom aborted'));
  }));
}

async function readRawCustom(name: string, key: string): Promise<unknown> {
  return withRawDb(name, (db) => new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction('custom', 'readonly');
    const req = tx.objectStore('custom').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('read custom failed'));
  }));
}

async function dbExists(name: string): Promise<boolean> {
  const dbs = await indexedDB.databases();
  return dbs.some((d) => d.name === name);
}

/** session 证明行（userSnapshot 白名单十字段——值域形状由 T3 钉死）。 */
async function seedSession(uid: string, deadline: number = Date.now() + 7 * 24 * 3_600_000): Promise<void> {
  const row: SessionRow = {
    uid,
    localDeadline: deadline,
    userSnapshot: {
      id: uid, name: 'U', email: `${uid}@example.com`, image: null, emailVerified: true,
      role: 'USER', phoneNumber: null, phoneNumberVerified: false,
      createdAt: '2026-01-01', updatedAt: '2026-01-01',
    } as SessionRow['userSnapshot'],
  };
  await putSessionRow(row);
}

/** 单用例的库名（uid/pid 唯一——fake-indexeddb 库跨用例存活，唯一名=零串扰）。 */
function caseIds(uid: string, pid: string, token: string, generation = 3, schemaVersion = 2) {
  return {
    uid, pid, token, generation, schemaVersion,
    dbName: buildYjsDbName(uid, pid, generation, schemaVersion, token),
    meta: { viewerUid: uid, collabGeneration: generation, collabSchemaVersion: schemaVersion },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  (HocuspocusProvider as any).instances.length = 0;
  harness.openResolved = false;
  harness.openResolvedAtProviderCreate.length = 0;
  harness.failNames = false;
  _resetCollabDiagForTest();
  _resetUnloadGuardForTest();
  clearLocalPreviewAll();
  persistSpy.mockClear();
  reloadSpy.mockClear();
  localStorage.clear();
  vi.stubGlobal('navigator', {
    ...navigator,
    onLine: true,
    storage: { persist: persistSpy, estimate: vi.fn(async () => ({ usage: 1, quota: 1_000_000 })) },
  });
  vi.stubGlobal('location', { search: '', hostname: 'localhost', protocol: 'http:', reload: reloadSpy });
});

afterEach(async () => {
  await runtime.destroyCollab();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ══════════ ①冷启动：证明 7d 内+grant read-write+库有内容 → local（验收 1） ══════════
describe('T10 ①冷启动进入 local', () => {
  it('证明未过期+grant=read-write+库有内容 → hydration=local+canEdit 真+canExecute 假+内容投影+persist()', async () => {
    const ids = caseIds('u-cold', 'p-cold', 'h-cold');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    const update = snapshotOf((d) => { d.getMap('nodes').set('n-cold', seedNode('cold')); });
    await seedUpdates(ids.dbName, [update]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write', serverSV: emptySvBuffer() });

    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: '离线画布', teamId: 'team-cold' });

    const s = useCanvasStore.getState();
    expect(s.hydration).toBe('local');
    expect(canEdit(s)).toBe(true);
    expect(canExecute(s)).toBe(false);                       // 执行权只在 ready（§0.3.2）
    expect(s.nodes.map((n: any) => n.id)).toContain('n-cold');   // 投影已落地
    expect(s.teamId).toBe('team-cold');                      // binding teamId 播种（验收 17）
    expect(persistSpy).toHaveBeenCalledTimes(1);             // 约束⑪：首次进 local 申请持久化
    expect(lastInstance()).toBeTruthy();                     // provider 已在装载后创建（步 5）
  });
});

// ══════════ ②证明过期/grant=read → 内容可见、canEdit 假、库还在（验收 2） ══════════
describe('T10 ②进不了 local 的可看不可编', () => {
  it('grant=read：内容可见+canEdit 假+hydration=failed（死线后）+库未被删', async () => {
    const ids = caseIds('u-grant-read', 'p-grant-read', 'h-grant-read');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    const update = snapshotOf((d) => { d.getMap('nodes').set('n-readonly', seedNode('ro')); });
    await seedUpdates(ids.dbName, [update]);
    await seedCustom(ids.dbName, { writeGrant: 'read' });

    const done = runtime.initCollabLocal(ids.pid, { ...ids.meta, name: '只读画布', teamId: null });
    await until(() => lastInstance() !== undefined, 'provider 未创建');
    await vi.advanceTimersByTimeAsync(10_000);   // 未 synced → pending 死线到点
    await done;

    const s = useCanvasStore.getState();
    expect(s.hydration).toBe('failed');
    expect(s.nodes.map((n: any) => n.id)).toContain('n-readonly');   // 内容可见（只读副本）
    expect(canEdit(s)).toBe(false);
    expect(await dbExists(ids.dbName)).toBe(true);                  // 库还在（不删库）
    expect(await readRawCustom(ids.dbName, 'writeGrant')).toBe('read');
  });

  it('证明过期：同款可看不可编+库还在（localDeadline <= now 判据）', async () => {
    const ids = caseIds('u-expired', 'p-expired', 'h-expired');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid, Date.now() - 1);
    const update = snapshotOf((d) => { d.getMap('nodes').set('n-exp', seedNode('exp')); });
    await seedUpdates(ids.dbName, [update]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write' });

    const done = runtime.initCollabLocal(ids.pid, { ...ids.meta, name: '过期画布', teamId: null });
    await until(() => lastInstance() !== undefined, 'provider 未创建');
    await vi.advanceTimersByTimeAsync(10_000);
    await done;

    const s = useCanvasStore.getState();
    expect(s.hydration).toBe('failed');
    expect(s.nodes.map((n: any) => n.id)).toContain('n-exp');
    expect(canEdit(s)).toBe(false);
    expect(await dbExists(ids.dbName)).toBe(true);
  });
});

// ══════════ ③回放不置 diverged；相对 serverSV 差分才置 dirty（验收 3） ══════════
describe('T10 ③回放语义与差分口径', () => {
  it('回放不置 diverged；无 serverSV=全量差分 > 空编码 → 置 dirty（相对 serverSV 而非全历史累计）', async () => {
    const ids = caseIds('u-dirty', 'p-dirty', 'h-dirty');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    const update = snapshotOf((d) => { d.getMap('nodes').set('n-dirty', seedNode('d')); });
    await seedUpdates(ids.dbName, [update]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write' });   // 无 serverSV

    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    expect(useCanvasStore.getState().hydration).toBe('local');
    expect(useCanvasStore.getState().canvasDiverged).toBe(false);   // 回放≠diverged
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(true);          // 差分非空 → 未上行
  });

  it('serverSV 已覆盖库内容（差分=空编码）→ 不置 dirty（差分只相对 serverSV）', async () => {
    const ids = caseIds('u-clean', 'p-clean', 'h-clean');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    const update = snapshotOf((d) => { d.getMap('nodes').set('n-clean', seedNode('c')); });
    await seedUpdates(ids.dbName, [update]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write', serverSV: svBufferOf(update) });

    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(false);
    expect(useCanvasStore.getState().canvasDiverged).toBe(false);
  });

  it('§0.2 步 6 origin 过滤：origin=persistence 的 update 不置 dirty/不置 diverged/不计 Σpending', async () => {
    const ids = caseIds('u-origin', 'p-origin', 'h-origin');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    // 已同步内容（差分=空）：任何额外置 dirty 都只能来自被过滤的 origin
    // （serverSV 必须由同一份 update 派生——两次 snapshotOf 各自新 clientID，SV 不互补）
    const update = snapshotOf((d) => { d.getMap('nodes').set('n-origin', seedNode('o')); });
    await seedUpdates(ids.dbName, [update]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write', serverSV: svBufferOf(update) });

    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(false);   // 前置锚：干净
    const d = runtime.getDoc()!;
    d.transact(() => { d.getMap('nodes').set('n-replay', seedNode('r')); }, harness.persistence);
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(false);   // persistence origin=装载回放，非用户编辑
    expect(useCanvasStore.getState().canvasDiverged).toBe(false);
  });

  it('§0.2 步 6 origin 过滤：origin=provider 的 update 同样不置 dirty（远端 apply 非本地编辑）', async () => {
    const ids = caseIds('u-provider-origin', 'p-provider-origin', 'h-provider-origin');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    const update = snapshotOf((d) => { d.getMap('nodes').set('n-po', seedNode('p')); });
    await seedUpdates(ids.dbName, [update]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write', serverSV: svBufferOf(update) });

    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    const d = runtime.getDoc()!;
    d.transact(() => { d.getMap('nodes').set('n-remote', seedNode('rm')); }, lastInstance());
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(false);
    expect(useCanvasStore.getState().canvasDiverged).toBe(false);
  });
});

// ══════════ ④provider 创建时装载已 resolve（验收 4 半腿） ══════════
describe('T10 ④水合次序：先装载后 provider', () => {
  it('createProvider 构造时刻 openYjsDoc 已 resolve（persistence.whenSynced 已完成）', async () => {
    const ids = caseIds('u-order', 'p-order', 'h-order');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    await seedUpdates(ids.dbName, [snapshotOf((d) => { d.getMap('nodes').set('n-order', seedNode('o')); })]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write' });

    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    expect(harness.openResolvedAtProviderCreate.length).toBeGreaterThan(0);
    expect(harness.openResolvedAtProviderCreate.every(Boolean)).toBe(true);
  });
});

// ══════════ ⑤serverSV 写回后 reload 不再标 dirty（验收 5） ══════════
describe('T10 ⑤serverSV 写回', () => {
  it('健康同步（isSynced∧无未确认上行）→ serverSV 精确切片写回；同一库 reload 差分=空 → 不置 dirty', async () => {
    const ids = caseIds('u-writeback', 'p-writeback', 'h-writeback');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    const update = snapshotOf((d) => { d.getMap('nodes').set('n-sv', seedNode('sv')); });
    await seedUpdates(ids.dbName, [update]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write' });   // 无 serverSV → boot 置 dirty

    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(true);          // 前置锚：写回前 dirty

    const p = lastInstance();
    p.isSynced = true;
    p.unsyncedChanges = 0;
    p.emit('synced', {});                                            // local→ready 健康同步
    // 写回是异步 fire-and-forget（3s 健康 tick 段触发）——推进 tick 并泵到盘上 serverSV 出现
    const deadline = Date.now() + 4_000;
    let stored: unknown = null;
    while (stored == null && Date.now() < deadline) {
      await vi.advanceTimersByTimeAsync(3_100);
      for (let i = 0; i < 12; i += 1) await nextImmediate();
      stored = await readRawCustom(ids.dbName, 'serverSV');
    }
    expect(stored).not.toBeNull();
    expect(Object.prototype.toString.call(stored)).toBe('[object ArrayBuffer]');
    // 盘上向量 = 当前 doc 的 state vector（写回值真值）
    const expectedSv = Y.encodeStateVector(runtime.getDoc()!);
    expect(Array.from(new Uint8Array(stored as ArrayBuffer))).toEqual(Array.from(expectedSv));
    expect((stored as ArrayBuffer).byteLength).toBe(expectedSv.byteLength);   // 精确切片（非底层 buffer 全量）

    await runtime.destroyCollab();

    // reload（同库同证明同 grant）→ 差分对 serverSV = 空编码 → 不再 dirty
      await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    expect(useCanvasStore.getState().hydration).toBe('local');
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(false);
  });
});

// ══════════ ⑥开库超时 → persistence destroy+服务端水合用新 doc（验收 13/8） ══════════
describe('T10 ⑥开库超时', () => {
  it('document 库 open 挂起 10s → persistence 已 destroy、doc 已废弃、provider 用新 doc（迟到 apply 无家可归）', async () => {
    const ids = caseIds('u-timeout', 'p-timeout', 'h-timeout');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);

    // 只挂起 document 库 open（meta 库照常——names 写要落地）
    const realOpen = indexedDB.open.bind(indexedDB);
    const deferred = {
      result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null,
    } as any;
    let deferredName: string | null = null;
    vi.spyOn(indexedDB, 'open').mockImplementation(((name: string, version?: number) => {
      if (deferredName === null && name.startsWith('flowweb:yjs:')) {
        deferredName = name;
        return deferred;
      }
      return realOpen(name, version);
    }) as any);

    let discarded: IndexeddbPersistence | null = null;
    const originalDestroy = IndexeddbPersistence.prototype.destroy;   // eslint-disable-line @typescript-eslint/unbound-method
    vi.spyOn(IndexeddbPersistence.prototype, 'destroy').mockImplementation(function (this: IndexeddbPersistence) {
      if (discarded === null) discarded = this;
      return originalDestroy.call(this);
    });

    const done = runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    await until(() => deferredName === ids.dbName, 'document 库 open 未发起');
    await vi.advanceTimersByTimeAsync(10_000);   // openYjsDoc 10s 竞赛到点
    await until(() => lastInstance() !== undefined, '服务端水合 provider 未创建');

    expect(discarded).not.toBeNull();
    expect(discarded!._destroyed).toBe(true);
    expect(discarded!.doc.isDestroyed).toBe(true);
    expect(isDbNameBannedThisSession(ids.dbName)).toBe(true);
    const served = lastInstance().cfg.document as Y.Doc;
    expect(served).not.toBe(discarded!.doc);                       // 服务端水合=新 doc（B4）
    expect(served.getMap('nodes').size).toBe(0);

    await vi.advanceTimersByTimeAsync(10_000);   // hydration 死线（pending→failed）收尾
    await done;
    expect(useCanvasStore.getState().hydration).toBe('failed');
  });
});

// ══════════ ⑦local 期间 update 不触发 10s 死线置 failed（§0.2 步 2） ══════════
describe('T10 ⑦local 死线守卫', () => {
  it('local 态本地编辑后越过 10s → hydration 仍 local（死线只对 pending 生效）', async () => {
    const ids = caseIds('u-deadline', 'p-deadline', 'h-deadline');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    await seedUpdates(ids.dbName, [snapshotOf((d) => { d.getMap('nodes').set('n-dl', seedNode('dl')); })]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write' });

    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    expect(useCanvasStore.getState().hydration).toBe('local');
    runtime.getDoc()!.transact(() => { runtime.getDoc()!.getMap('m').set('after-local', 1); }, Origin.LocalUser);

    await vi.advanceTimersByTimeAsync(10_500);
    const s = useCanvasStore.getState();
    expect(s.hydration).toBe('local');   // 修前：超时分支置 failed（红）
    expect(canEdit(s)).toBe(true);
  });
});

// ══════════ ⑧纯快进不跑异常检测、双端差分跑（验收 19） ══════════
describe('T10 ⑧local→ready 异常检测门', () => {
  it('只有本端差分（服务端无新更新）→ 纯快进，不跑检测不提示', async () => {
    const ids = caseIds('u-ff', 'p-ff', 'h-ff');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    await seedUpdates(ids.dbName, [snapshotOf((d) => {
      d.getMap('nodes').set('n-ff-a', seedNode('a', [['order', 'o1']]));
      d.getMap('nodes').set('n-ff-b', seedNode('b', [['order', 'o1']]));
    })]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write' });   // 差分非空（本端独有）

    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    expect(useCanvasStore.getState().hydration).toBe('local');
    const p = lastInstance();
    p.isSynced = true;
    p.unsyncedChanges = 0;
    p.emit('synced', {});   // 无 provider origin 更新（服务端零新内容）→ 纯快进
    await vi.advanceTimersByTimeAsync(3_500);   // 3s 健康同步 tick=local→ready 唯一出口

    expect(useCanvasStore.getState().hydration).toBe('ready');
    expect(useCanvasStore.getState().draftMergeAnomalies).toBeNull();   // 不提示（不误伤既存异常）
  });

  it('双端差分（SS1 带来服务端更新∧本端差分非空）→ 跑一次检测并提示（不阻断）', async () => {
    const ids = caseIds('u-merge', 'p-merge', 'h-merge');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    await seedUpdates(ids.dbName, [snapshotOf((d) => {
      d.getMap('nodes').set('n-local', seedNode('local', [['order', 'o1']]));
    })]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write' });

    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    expect(useCanvasStore.getState().hydration).toBe('local');
    const p = lastInstance();
    // 服务端更新（origin=provider——SS2 差分应用语义）：同层同 order → 合并异常
    runtime.getDoc()!.transact(() => {
      runtime.getDoc()!.getMap('nodes').set('n-server', seedNode('server', [['order', 'o1']]));
    }, p);
    p.isSynced = true;
    p.unsyncedChanges = 0;
    p.emit('synced', {});
    await vi.advanceTimersByTimeAsync(3_500);   // 3s 健康同步 tick=local→ready 唯一出口

    const st = useCanvasStore.getState();
    expect(st.hydration).toBe('ready');
    expect(st.draftMergeAnomalies).toMatchObject({ 'duplicate-order': 2 });   // 不阻断（投影仍含两端节点）
    expect(st.nodes.map((n: any) => n.id)).toEqual(expect.arrayContaining(['n-local', 'n-server']));
  });
});

// ══════════ ⑨names 写失败 → 不开库改服务端水合 ══════════
describe('T10 ⑨names 写失败 fail-closed', () => {
  it('names 写失败 → document 库零 open（本会话不开库）+local-cache-degraded 遥测+服务端水合正常到 ready', async () => {
    const ids = caseIds('u-names', 'p-names', 'h-names');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    harness.failNames = true;

    const realOpen = indexedDB.open.bind(indexedDB);
    const docOpenNames: string[] = [];
    vi.spyOn(indexedDB, 'open').mockImplementation(((name: string, version?: number) => {
      if (name.startsWith('flowweb:yjs:')) docOpenNames.push(name);
      return realOpen(name, version);
    }) as any);

    const done = runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    await until(() => lastInstance() !== undefined, '服务端水合 provider 未创建');
    const p = lastInstance();
    p.isSynced = true;
    p.unsyncedChanges = 0;
    p.emit('synced', {});
    await done;

    expect(docOpenNames).toEqual([]);   // 不开库（写失败 fail-closed）
    expect(getRecentCollabDiag().some((e) => e.type === 'ws_status' && (e.detail as any)?.reason === 'local-cache-degraded')).toBe(true);
    expect(useCanvasStore.getState().hydration).toBe('ready');
  });
});
