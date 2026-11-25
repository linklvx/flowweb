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
import { CANVAS_DOC_SCHEMA_VERSION, QUOTA_DEFAULTS } from '@flowweb/shared';
import { useCanvasStore, clearLocalPreviewAll } from './canvasStore';
import { canEdit, canExecute } from './syncStatus';
import * as runtime from './canvasCollabRuntime';
import { Origin, getUndoManager } from './canvasUndo';
import { buildYjsDbName, isDbNameBannedThisSession, putNameRow, putSessionRow, type SessionRow } from '@/collab/local-yjs-store';
import { getRecentCollabDiag, _resetCollabDiagForTest } from '@/utils/collabDiagnostics';
import { _resetUnloadGuardForTest } from '@/utils/unloadGuard';

/** 装置缝（vi.hoisted：mock 工厂提升后闭包可达）：开库完成标记（④）+ names 写失败注入（⑨）
 *  + 持久层句柄捕获（§0.2 步 6 origin 过滤直测）。 */
const harness = vi.hoisted(() => ({
  openResolved: false,
  openResolvedAtProviderCreate: [] as boolean[],
  failNames: false,
  failServerSvEncode: false,   // Y5 T11：serverSV 编码抛错注入（⑤）
  persistence: null as unknown,
  sessionDeferred: null as null | { promise: Promise<void>; release: () => void },
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
    // I4 中点复验直测：可挂起 session 行读（发生在本续体已持有 opened persistence 之后）
    getSessionRows: async () => {
      if (harness.sessionDeferred) await harness.sessionDeferred.promise;
      return orig.getSessionRows();
    },
    // Y5 T11 E：serverSV 编码抛错注入（persistServerState try 块唯一抽取点）
    encodeExactStateVector: (d: import('yjs').Doc) => {
      if (harness.failServerSvEncode) throw new Error('serverSV encode failed (injected)');
      return orig.encodeExactStateVector(d);
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
/** 真 immediate 泵 N 轮（I4：需要真实 macro task 推进 fake-indexeddb 链）。 */
async function pumpImmediate(turns = 1): Promise<void> {
  for (let i = 0; i < turns; i += 1) await nextImmediate();
}
/** 单文档闸（= QUOTA_DEFAULTS.maxDocBytes；local spec 内做超闸语料用，Y5 T14 起直引 shared）。 */
const LOCAL_CACHE_MAX_BYTES_FOR_TEST = QUOTA_DEFAULTS.maxDocBytes;
async function until(pred: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 4_000;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
    await nextImmediate();
  }
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

/** 直写 names 行（F2 装置：模拟跨刷新后盘上 hold 标记——绕过会话起点重写）。 */
async function seedNameRowHold(
  dbName: string,
  ids: ReturnType<typeof caseIds>,
  hold: boolean,
): Promise<void> {
  await putNameRow(dbName, {
    uid: ids.uid, pid: ids.pid, generation: ids.generation, schemaVersion: ids.schemaVersion,
    historyToken: ids.token, hold,
  });
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
  harness.failServerSvEncode = false;
  harness.persistence = null;
  harness.sessionDeferred = null;
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
    // M7（§0.2 步 5）：30s 周期 forceSync——provider 构造参数真传到库
    expect(lastInstance().cfg.forceSyncInterval).toBe(30_000);
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

// ══════════ I3：boot 后撤销栈为空 + 能力位（旧 t8 覆盖的两条活行为） ══════════
describe('T10 I3：boot 后撤销栈与能力位', () => {
  it('装载非用户编辑 ⇒ undoStack 长度 0；内容 ≤ 单文档闸 ⇒ localCacheReady=true', async () => {
    const ids = caseIds('u-i3', 'p-i3', 'h-i3');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    const update = snapshotOf((d) => { d.getMap('nodes').set('n-i3', seedNode('i3')); });
    await seedUpdates(ids.dbName, [update]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write', serverSV: svBufferOf(update) });

    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    expect(useCanvasStore.getState().hydration).toBe('local');
    // 真 manager / 真 store 断言（不是 mock 面）
    const undoManager = getUndoManager();
    expect(undoManager).toBeTruthy();
    expect(undoManager!.undoStack.length).toBe(0);         // 装载不进撤销栈
    expect(useCanvasStore.getState().localCacheReady).toBe(true);
  });

  it('I3 尺寸闸：doc 编码 > QUOTA_DEFAULTS.maxDocBytes ⇒ localCacheReady=false（超闸=「太大没缓存」，与 diff 无关）', async () => {
    const ids = caseIds('u-i3-big', 'p-i3-big', 'h-i3-big');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    // 超闸内容：单节点大 blob（> QUOTA_DEFAULTS.maxDocBytes）
    const big = snapshotOf((d) => {
      d.getMap('nodes').set('big', seedNode('big', [['blob', 'x'.repeat(LOCAL_CACHE_MAX_BYTES_FOR_TEST)]]));
    });
    await seedUpdates(ids.dbName, [big]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write', serverSV: svBufferOf(big) });   // 差分=空，仅尺寸超闸

    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    expect(useCanvasStore.getState().localCacheReady).toBe(false);   // 修前（diff 判据）会误报 true
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(false);          // 差分确实为空——差异只来自尺寸
  }, 30_000);
});

// ══════════ I2：diverged 冷启动守卫（不 connect、锁 latch、只投影） ══════════
describe('T10 I2：diverged 冷启动', () => {
  it('盘上 diverged=1 ⇒ 零 provider 创建、canvasDiverged 锁、doc 已投影；健康同步不跑（无 provider）', async () => {
    const ids = caseIds('u-div-start', 'p-div-start', 'h-div-start');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    const update = snapshotOf((d) => { d.getMap('nodes').set('n-div-start', seedNode('dv')); });
    await seedUpdates(ids.dbName, [update]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write', diverged: '1' });

    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });

    expect((HocuspocusProvider as any).instances.length).toBe(0);   // 不建 provider=不 connect
    expect(useCanvasStore.getState().canvasDiverged).toBe(true);    // 闩锁
    expect(useCanvasStore.getState().hydration).toBe('failed');     // 可看不可编（离线入口落 failed）
    expect(useCanvasStore.getState().nodes.map((n: any) => n.id)).toContain('n-div-start');   // 仅投影
    // 盘上 diverged 键仍在（无健康同步可触发删除；持久层句柄已随 destroy 关闭）
    expect(await readRawCustom(ids.dbName, 'diverged')).toBe('1');
  });

  it('I2b：越过 10s 死线+多个 3s/5s tick 周期后，diverged 键仍在、serverSV 仍未写（禁健康同步误删）', async () => {
    const ids = caseIds('u-div-gate', 'p-div-gate', 'h-div-gate');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    const update = snapshotOf((d) => { d.getMap('nodes').set('n-div-gate', seedNode('dg')); });
    await seedUpdates(ids.dbName, [update]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write', diverged: '1' });

    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    // 本会话无 provider（不 connect）⇒ 无健康同步电平、无 tick 装配——即便把时间推过
    // 死线与若干个 3s/5s 节律，盘上 diverged 唯一副本也必须原样存活（误删=未裁定内容丢失）。
    await vi.advanceTimersByTimeAsync(15_500);
    expect(await readRawCustom(ids.dbName, 'diverged')).toBe('1');
    expect(await readRawCustom(ids.dbName, 'serverSV')).toBeUndefined();   // 原始 IDB 缺键=undefined
    expect(useCanvasStore.getState().canvasDiverged).toBe(true);            // 闩锁未随 tick 自解
  });
});

// ══════════ Y5 收尾 F1：bootDivergedSnapshot 死槽退役（终审钉 1）══════════
describe('Y5 收尾 F1：diverged 导出恒走当前 doc', () => {
  it('in-session diverged 会话 exportDivergedContent 直接导出内存 doc——快照槽删除后行为不变（恒 null 死槽）', async () => {
    const ids = caseIds('u-f1', 'p-f1', 'h-f1');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    const update = snapshotOf((d) => { d.getMap('nodes').set('n-f1', seedNode('f1')); });
    await seedUpdates(ids.dbName, [update]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write' });

    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    expect(useCanvasStore.getState().hydration).toBe('local');
    useCanvasStore.setState({ canvasDiverged: true });   // 横幅态（in-session diverged 形态）

    // jsdom 无 createObjectURL（导出下载面不可达）——修前快照槽恒 null ⇒ 必走当前 doc 分支，
    // 故「走当前 doc」的观测锚=TypeError 的 doc 源非空（getDoc() 非空才会走到 downloadBlob）。
    expect(runtime.getDoc()).not.toBeNull();
    expect(() => runtime.exportDivergedContent()).toThrow(TypeError);
    // 行为不变性锚（修前同红/同绿——恒 null 死槽删除后导出去向不变）
  });
});

// ══════════ Y5 收尾 F2：own 库 hold=true 冷启动不 connect（终审钉 2）══════════
describe('Y5 收尾 F2：本会话 own 库 hold 行', () => {
  it('own 库 names 行 hold=true ⇒ 不建 provider（不 connect）、canvasDiverged 亮、内容仅投影；盘上 diverged 键非第四桶形态', async () => {
    const ids = caseIds('u-f2a', 'p-f2a', 'h-f2a');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    const update = snapshotOf((d) => { d.getMap('nodes').set('n-f2a', seedNode('f2a')); });
    await seedUpdates(ids.dbName, [update]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write' });
    // names 行必须由 startCollabSession 自己写（buildYjsDbName→putNameRow 链）——盘上预写会被
    // 会话起点重写。种子改走「先正常进 local 一次」把行写盘，再作废 names 行 hold 标记模拟跨刷新。
    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    expect(useCanvasStore.getState().hydration).toBe('local');   // 前置锚：第一次会话正常进 local
    await runtime.destroyCollab();
    await seedNameRowHold(ids.dbName, ids, true);

    (HocuspocusProvider as any).instances.length = 0;   // 跨刷新=新页面生命周期（计数只看第二次会话）
    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });   // 冷启动（跨刷新形态）

    expect((HocuspocusProvider as any).instances.length).toBe(0);   // 修前：own hold 冷启动照 connect（红）
    expect(useCanvasStore.getState().canvasDiverged).toBe(true);
    expect(useCanvasStore.getState().hydration).toBe('failed');
    expect(useCanvasStore.getState().nodes.map((n: any) => n.id)).toContain('n-f2a');   // 只装载只读
    expect(await readRawCustom(ids.dbName, 'diverged')).toBeUndefined();   // 不伪造第四桶标记
  });

  it('他代 hold（own 行 hold=false）⇒ 照常建 provider——横幅亮但库照 connect（新库不因他代拒帧被扣）', async () => {
    const ids = caseIds('u-f2b', 'p-f2b', 'h-f2b');
    const other = caseIds('u-f2b', 'p-f2b', 'h-f2b-old', 2, 2);   // 同 uid:pid 旧代
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    const update = snapshotOf((d) => { d.getMap('nodes').set('n-f2b', seedNode('f2b')); });
    await seedUpdates(ids.dbName, [update]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write' });
    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    expect(useCanvasStore.getState().hydration).toBe('local');   // 前置锚
    await runtime.destroyCollab();
    await seedNameRowHold(other.dbName, other, true);   // 旧代库 hold=true（names 行直写——不走会话）

    (HocuspocusProvider as any).instances.length = 0;   // 跨刷新=新页面生命周期（计数只看第二次会话）
    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });

    expect((HocuspocusProvider as any).instances.length).toBe(1);   // own 行干净 ⇒ 照 connect（行为不变性锚）
    expect(useCanvasStore.getState().canvasDiverged).toBe(true);    // T13 findHeldNameRow 读点亮横幅
  });
});

// ══════════ I4：水合窗内会话被拆/换代 ⇒ 旧续体零点复活 ══════════
describe('T10 I4：开库窗内会话被拆/换代', () => {
  it('旧会话 open 挂起期间启动新会话 ⇒ 旧续体到达后不建 provider、不覆盖新会话、旧 persistence 已毁、零 unhandled', async () => {
    const a = caseIds('u-i4a', 'p-i4a', 'h-i4a');
    const b = caseIds('u-i4b', 'p-i4b', 'h-i4b');
    localStorage.setItem('collab:history-id', a.token);
    await seedSession(a.uid);
    await seedUpdates(a.dbName, [snapshotOf((d) => { d.getMap('nodes').set('n-i4a', seedNode('i4a')); })]);
    await seedCustom(a.dbName, { writeGrant: 'read-write' });

    // 只挂起 A 的 document 库 open（B 的库照常开）
    const realOpen = indexedDB.open.bind(indexedDB);
    const deferred = {
      result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null,
    } as any;
    let deferredName: string | null = null;
    vi.spyOn(indexedDB, 'open').mockImplementation(((name: string, version?: number) => {
      if (deferredName === null && name === a.dbName) {
        deferredName = name;
        return deferred;
      }
      return realOpen(name, version);
    }) as any);

    const pendingA = runtime.initCollabLocal(a.pid, { ...a.meta, name: 'A', teamId: null });
    await until(() => deferredName === a.dbName, 'A 的 document 库 open 未发起');

    // 新会话 B 启动（切项目/StrictMode 双挂载形态）：teardown A 的会话 + 建新 session/provider
    localStorage.setItem('collab:history-id', b.token);
    await seedSession(b.uid);
    const pendingB = runtime.initCollabLocal(b.pid, { ...b.meta, name: 'B', teamId: null });
    await until(() => lastInstance() !== undefined, 'B 的 provider 未创建');
    const providerBCount = (HocuspocusProvider as any).instances.length;
    expect(providerBCount).toBe(1);

    // 放行 A 的迟到 open —— 旧续体必须静默退出（epoch 不符），销毁自己的 persistence/doc
    const realReq = realOpen(a.dbName);
    realReq.onupgradeneeded = (ev) => { deferred.onupgradeneeded?.(ev); };
    realReq.onsuccess = (ev) => { deferred.result = realReq.result; deferred.onsuccess?.(ev); };
    realReq.onerror = (ev) => { deferred.onerror?.(ev); };
    const openDeadline = Date.now() + 4_000;
    while (deferred.result === null && Date.now() < openDeadline) await pumpImmediate(2);
    await pendingA;   // 旧调用落定——**不 reject**（epoch 判活静默 return）
    await vi.advanceTimersByTimeAsync(0);

    expect((HocuspocusProvider as any).instances.length).toBe(providerBCount);   // 零点复活
    expect(runtime.getDoc()).toBe(lastInstance().cfg.document);                  // 模块 doc 仍是 B 的
    expect(runtime.getDoc()!.getMap('nodes').get('n-i4a')).toBeUndefined();      // A 的内容没灌进 B
    void pendingB;
  });

  it('单会话在 open 窗内 destroyCollab ⇒ 旧续体 resolve（不 reject），零 provider，hydration 落 idle', async () => {
    const ids = caseIds('u-i4c', 'p-i4c', 'h-i4c');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    await seedUpdates(ids.dbName, [snapshotOf((d) => { d.getMap('nodes').set('n-i4c', seedNode('i4c')); })]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write' });

    const realOpen = indexedDB.open.bind(indexedDB);
    const deferred = {
      result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null,
    } as any;
    let deferredName: string | null = null;
    vi.spyOn(indexedDB, 'open').mockImplementation(((name: string, version?: number) => {
      if (deferredName === null && name === ids.dbName) {
        deferredName = name;
        return deferred;
      }
      return realOpen(name, version);
    }) as any);

    const pending = runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    await until(() => deferredName === ids.dbName, 'document 库 open 未发起');
    await runtime.destroyCollab();   // 此时无 provider（open 未回）——teardown 同步段即完成
    expect(useCanvasStore.getState().hydration).toBe('idle');

    // 放行迟到 open
    const realReq = realOpen(ids.dbName);
    realReq.onupgradeneeded = (ev) => { deferred.onupgradeneeded?.(ev); };
    realReq.onsuccess = (ev) => { deferred.result = realReq.result; deferred.onsuccess?.(ev); };
    realReq.onerror = (ev) => { deferred.onerror?.(ev); };
    const openDeadline = Date.now() + 4_000;
    while (deferred.result === null && Date.now() < openDeadline) await pumpImmediate(2);

    await pending;   // 必须**干净 resolve**（禁 reject——否则页面 catch 会二次误判为瞬态失败）
    expect((HocuspocusProvider as any).instances.length).toBe(0);
    expect(useCanvasStore.getState().hydration).toBe('idle');   // 未被旧续体重置
    // I4 中点复验：迟到续体不得写任何会话态（能力位是 `local-cache-degraded` 之外的可见泄漏面——
    // 旧续体若继续读 custom 就会把 localCacheReady 打真，而会话早已拆除）
    expect(useCanvasStore.getState().localCacheReady).toBe(false);
    expect(useCanvasStore.getState().canvasDiverged).toBe(false);
  });
});

// ══════════ I4 中点复验：opened 已到手、session 行读挂起时被拆 ══════════
describe('T10 I4：opened 之后的中途判活', () => {
  it('持有 opened persistence 后 destroyCollab：迟到续体不写 store、持久层已销毁、不建 provider', async () => {
    const ids = caseIds('u-i4-mid', 'p-i4-mid', 'h-i4-mid');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    await seedUpdates(ids.dbName, [snapshotOf((d) => { d.getMap('nodes').set('n-i4-mid', seedNode('mid')); })]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write' });   // 差分空 ⇒ 若续体继续会置 localCacheReady

    // 挂起 session 行读（此时 opened/localPersistence 已赋值）
    let release!: () => void;
    harness.sessionDeferred = { promise: new Promise<void>((r) => { release = r; }), release: () => release() };

    const pending = runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    await until(() => harness.persistence !== null, 'opened persistence 未就位');
    await runtime.destroyCollab();   // 会话拆除（无 provider——open 已完成但 provider 未建）
    expect(useCanvasStore.getState().hydration).toBe('idle');

    harness.sessionDeferred.release();
    harness.sessionDeferred = null;
    await pending;   // 干净返回
    await vi.advanceTimersByTimeAsync(0);

    expect((HocuspocusProvider as any).instances.length).toBe(0);   // 不同 provider
    expect(useCanvasStore.getState().hydration).toBe('idle');       // 不覆盖 teardown 的 idle
    expect(useCanvasStore.getState().localCacheReady).toBe(false);  // 中点复验拦住 store 写
  });
});

// ══════════ I1：buildYjsDbName 抛错不逸出（非法 historyToken） ══════════
describe('T10 I1：非法 historyToken', () => {
  it('非法 token（含 /）⇒ 不抛、不开文档库、降级遥测、服务端水合正常到 ready', async () => {
    // 不用 caseIds（它会调 buildYjsDbName 先行抛错）——本用例的 token 就是非法语料
    const uid = 'u-i1'; const pid = 'p-i1';
    const meta = { viewerUid: uid, collabGeneration: 3, collabSchemaVersion: 2 };
    localStorage.setItem('collab:history-id', 'bad/token');   // '/' 不在 [A-Za-z0-9_-]
    await seedSession(uid);

    const realOpen = indexedDB.open.bind(indexedDB);
    const docOpenNames: string[] = [];
    vi.spyOn(indexedDB, 'open').mockImplementation(((name: string, version?: number) => {
      if (name.startsWith('flowweb:yjs:')) docOpenNames.push(name);
      return realOpen(name, version);
    }) as any);

    // 修前：buildYjsDbName 在 try 外抛 ⇒ startCollabSession reject（本 await 直接抛）
    const done = runtime.initCollabLocal(pid, { ...meta, name: 'X', teamId: null });
    await until(() => lastInstance() !== undefined, '服务端水合 provider 未创建');
    const p = lastInstance();
    p.isSynced = true;
    p.unsyncedChanges = 0;
    p.emit('synced', {});
    await done;   // 必须 resolve（不 reject）

    expect(docOpenNames).toEqual([]);   // 非法 token=不开库
    expect(getRecentCollabDiag().some((e) => e.type === 'ws_status' && (e.detail as any)?.reason === 'local-cache-degraded')).toBe(true);
    expect(useCanvasStore.getState().hydration).toBe('ready');
  });
});

// ══════════ M3：cacheDisabled 会话只发一条 local-cache-degraded ══════════
describe('T10 M3：降级遥测只发一次', () => {
  it('meta 缺项（cacheDisabled）⇒ ws_status reason=local-cache-degraded 恰一条', async () => {
    const ids = caseIds('u-m3', 'p-m3', 'h-m3');
    const done = runtime.initCollab(ids.pid, {} as runtime.CollabSessionMeta);   // 三元缺失
    await until(() => lastInstance() !== undefined, 'provider 未创建');
    const p = lastInstance();
    p.isSynced = true;
    p.unsyncedChanges = 0;
    p.emit('synced', {});
    await done;
    const hits = getRecentCollabDiag().filter((e) => e.type === 'ws_status' && (e.detail as any)?.reason === 'local-cache-degraded');
    expect(hits.length).toBe(1);   // 修前=2（两处同文案各发一次）
  });
});

// ══════════ T11 ①local 态零发送 + pagehide 零发送（验收 22，§0.3.9） ══════════
describe('T11 ①local 态屏障零发送', () => {
  it('local 期本地编辑→800ms 屏障零发送；pagehide 腿同谓词仍零发送', async () => {
    const ids = caseIds('u-t11-local', 'p-t11-local', 'h-t11-local');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    await seedUpdates(ids.dbName, [snapshotOf((d) => { d.getMap('nodes').set('n-t11l', seedNode('l')); })]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write', serverSV: emptySvBuffer() });

    const seam = runtime.__t21BarrierTestSeam();
    const sent: Array<Record<string, unknown>> = [];
    seam.setSendChannel((payload) => { sent.push(JSON.parse(payload)); });

    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    expect(useCanvasStore.getState().hydration).toBe('local');   // 前置锚：谓词只放行 ready
    const d = runtime.getDoc()!;
    d.transact(() => { d.getMap('m').set('t11-local', 1); }, Origin.LocalUser);
    expect(seam.localEdits()).toBeGreaterThan(0);                 // clientSeq 在 local 照常增加

    await vi.advanceTimersByTimeAsync(801);   // 800ms idle 触发点
    expect(sent.length).toBe(0);              // 修前：provider 存在即发（红）
    seam.firePageHide();
    expect(sent.length).toBe(0);              // pagehide 腿同谓词
    seam.setSendChannel(null);
  });
});

// ══════════ T11 ②pending 零发送 + 进 ready 恰补发一次（验收 26，§0.3.9） ══════════
describe('T11 ②pending 零发送 + ready 补发', () => {
  it('pending 期编辑→屏障零发送；synced 抬 ready 恰补发一次且序号盖住 local 期编辑', async () => {
    const ids = caseIds('u-t11-pending', 'p-t11-pending', 'h-t11-pending');
    const seam = runtime.__t21BarrierTestSeam();
    const sent: Array<Record<string, unknown>> = [];
    seam.setSendChannel((payload) => { sent.push(JSON.parse(payload)); });

    const done = runtime.initCollab(ids.pid, ids.meta);   // 在线路径（无 historyToken=纯服务端水合）
    await until(() => lastInstance() !== undefined, 'provider 未创建');
    expect(useCanvasStore.getState().hydration).toBe('pending');
    const d = runtime.getDoc()!;
    d.transact(() => { d.getMap('m').set('t11-p-a', 1); }, Origin.LocalUser);
    d.transact(() => { d.getMap('m').set('t11-p-b', 2); }, Origin.LocalUser);

    await vi.advanceTimersByTimeAsync(801);
    expect(sent.length).toBe(0);                              // 修前：pending 即发（红）
    expect(useCanvasStore.getState().hydration).toBe('pending');

    const p = lastInstance();
    p.isSynced = true;
    p.unsyncedChanges = 0;
    p.emit('synced', {});
    await done;

    expect(useCanvasStore.getState().hydration).toBe('ready');
    expect(sent.length).toBe(1);                              // armSession 补发恰一次
    expect(sent[0]!.clientSeq).toBe(seam.localEdits());        // 序号盖住 local 期编辑
    expect(seam.localEdits()).toBe(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent.length).toBe(1);                              // 无新编辑不重发
    seam.setSendChannel(null);
  });
});

// ══════════ T11 ③local 期编辑 → 健康 tick 进 ready 补发（验收 26 local 形态） ══════════
describe('T11 ③local→ready 补发', () => {
  it('local 期编辑零发送；3s 健康同步进 ready 后补发一次（clientSeq=local 末值）', async () => {
    const ids = caseIds('u-t11-l2r', 'p-t11-l2r', 'h-t11-l2r');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    await seedUpdates(ids.dbName, [snapshotOf((d) => { d.getMap('nodes').set('n-t11-l2r', seedNode('lr')); })]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write' });   // 无 serverSV → 本端差分（纯快进不跑检测）

    const seam = runtime.__t21BarrierTestSeam();
    const sent: Array<Record<string, unknown>> = [];
    seam.setSendChannel((payload) => { sent.push(JSON.parse(payload)); });

    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    expect(useCanvasStore.getState().hydration).toBe('local');
    const d = runtime.getDoc()!;
    d.transact(() => { d.getMap('m').set('t11-l2r', 1); }, Origin.LocalUser);
    await vi.advanceTimersByTimeAsync(900);
    expect(sent.length).toBe(0);                              // 修前：800ms idle 即发（红）

    const p = lastInstance();
    p.isSynced = true;
    p.unsyncedChanges = 0;
    await vi.advanceTimersByTimeAsync(3_100);   // 3s 健康同步 tick=local→ready 唯一出口

    expect(useCanvasStore.getState().hydration).toBe('ready');
    expect(sent.length).toBe(1);
    expect(sent[0]!.clientSeq).toBe(seam.localEdits());
    expect(seam.localEdits()).toBe(1);
    seam.setSendChannel(null);
  });
});

// ══════════ T11 ④QuotaExceeded 写窗 → 降级闩锁（验收 9，§0.5.3） ══════════
describe('T11 ④QuotaExceeded 写窗降级', () => {
  it('set 拒绝 QuotaExceededError → localCacheReady=false 且降级遥测恰一次（重 tick 不重发）', async () => {
    const ids = caseIds('u-t11-quota', 'p-t11-quota', 'h-t11-quota');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    const update = snapshotOf((d) => { d.getMap('nodes').set('n-t11q', seedNode('q')); });
    await seedUpdates(ids.dbName, [update]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write', serverSV: svBufferOf(update) });

    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    expect(useCanvasStore.getState().hydration).toBe('local');
    expect(useCanvasStore.getState().localCacheReady).toBe(true);   // 前置锚：小 doc 能力位已真

    // lib0 rtop 形态：请求错误包成 new Error(event.target.error)——name 恒 'Error'，message 保留文案
    const rejectQuota = (() => Promise.reject(
      new Error(String(new DOMException('The quota has been exceeded.', 'QuotaExceededError'))),
    )) as unknown as typeof IndexeddbPersistence.prototype.set;
    vi.spyOn(IndexeddbPersistence.prototype, 'set').mockImplementation(rejectQuota);

    const p = lastInstance();
    p.isSynced = true;
    p.unsyncedChanges = 0;
    await vi.advanceTimersByTimeAsync(3_100);   // 3s 健康 tick → persistServerState 写窗
    await pumpImmediate(8);

    expect(useCanvasStore.getState().localCacheReady).toBe(false);   // 修前：write 失败只标 dirty（红）
    const hits = () => getRecentCollabDiag().filter((e) => e.type === 'ws_status' && (e.detail as any)?.reason === 'local-cache-degraded');
    expect(hits().length).toBe(1);   // 既有单次闩锁语义

    await vi.advanceTimersByTimeAsync(3_100);   // 再一 tick（写窗重试）→ 闩锁不再发
    await pumpImmediate(8);
    expect(hits().length).toBe(1);
  });
});

// ══════════ T11 ⑤serverSV 编码抛错腿（⑤ 可测化前提） ══════════
describe('T11 ⑤serverSV 编码抛错', () => {
  it('编码抛错 → 标 dirty 且盘上 serverSV 不被改写；恢复后健康 tick 清 dirty', async () => {
    const ids = caseIds('u-t11-sv', 'p-t11-sv', 'h-t11-sv');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    const update = snapshotOf((d) => { d.getMap('nodes').set('n-t11sv', seedNode('sv')); });
    await seedUpdates(ids.dbName, [update]);
    const seedSv = svBufferOf(update);
    await seedCustom(ids.dbName, { writeGrant: 'read-write', serverSV: seedSv });

    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(false);   // 前置锚：serverSV 覆盖 = 不 dirty

    const p = lastInstance();
    p.isSynced = true;
    p.unsyncedChanges = 0;
    harness.failServerSvEncode = true;
    await vi.advanceTimersByTimeAsync(3_100);
    await pumpImmediate(8);

    expect(runtime.hasUnsyncedCanvasChanges()).toBe(true);    // 修前：无注入点，编码成功（红）
    const stored = await readRawCustom(ids.dbName, 'serverSV');
    expect(Array.from(new Uint8Array(stored as ArrayBuffer))).toEqual(Array.from(new Uint8Array(seedSv)));   // 坏/未写都不许落盘

    harness.failServerSvEncode = false;
    await vi.advanceTimersByTimeAsync(3_100);   // 健康 tick：清 dirty 段
    await pumpImmediate(8);
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(false);
  });
});

// ══════════ T11 ⑥新层字节闸（§0.5.1——T14 删旧层后横幅不得静默失效） ══════════
describe('T11 ⑥新层字节闸', () => {
  it('doc 编码超闸 → canvasOversized+localCacheReady=false；删除回落 → canvasOversized=false', async () => {
    const ids = caseIds('u-t11-gate', 'p-t11-gate', 'h-t11-gate');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    const update = snapshotOf((d) => { d.getMap('nodes').set('n-t11g', seedNode('g')); });
    await seedUpdates(ids.dbName, [update]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write', serverSV: svBufferOf(update) });

    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    expect(useCanvasStore.getState().hydration).toBe('local');
    expect(useCanvasStore.getState().localCacheReady).toBe(true);

    // origin=persistence（装载回放族）：不进 dirty/flush 链——单测新层闸本身（口径=任意 origin）
    const d = runtime.getDoc()!;
    d.transact(() => { d.getMap('m').set('t11-big', 'x'.repeat(9 * 1024 * 1024)); }, harness.persistence);
    await vi.advanceTimersByTimeAsync(5_100);   // 5s syncLagTimer=测量节律（零新定时器）
    expect(useCanvasStore.getState().canvasOversized).toBe(true);    // 修前：旧块用 localDocBytes=0 估值把横幅闪关（红）
    expect(useCanvasStore.getState().localCacheReady).toBe(false);

    d.transact(() => { d.getMap('m').delete('t11-big'); }, harness.persistence);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(useCanvasStore.getState().canvasOversized).toBe(false);   // 回落恢复
    // Y5 T14：旧层 onFlushed 删除后本分支是能力位唯一恢复点——漏 localCacheReady 会让降级永久粘住
    expect(useCanvasStore.getState().localCacheReady).toBe(true);
  }, 60_000);

  it('无本地文档库的会话（cacheDisabled）不进闸：大 doc 不置 oversized、不发降级遥测', async () => {
    const ids = caseIds('u-t11-nodb', 'p-t11-nodb', 'h-t11-nodb');
    const done = runtime.initCollab(ids.pid, {} as runtime.CollabSessionMeta);   // 三元缺失=cacheDisabled
    await until(() => lastInstance() !== undefined, 'provider 未创建');
    const p = lastInstance();
    p.isSynced = true;
    p.unsyncedChanges = 0;
    p.emit('synced', {});
    await done;
    expect(useCanvasStore.getState().hydration).toBe('ready');
    expect(harness.persistence).toBeNull();   // 前置锚：本会话无文档库

    const before = getRecentCollabDiag().filter((e) => e.type === 'ws_status' && (e.detail as any)?.reason === 'local-cache-degraded').length;
    const d = runtime.getDoc()!;
    d.transact(() => { d.getMap('m').set('t11-nodb-big', 'x'.repeat(9 * 1024 * 1024)); }, Origin.LocalUser);
    await vi.advanceTimersByTimeAsync(5_100);
    // 闸语义=「能否整份装进本地单文档库」——无库可装时横幅无意义（修前：置 oversized 红）
    expect(useCanvasStore.getState().canvasOversized).toBe(false);
    expect(useCanvasStore.getState().localCacheReady).toBe(false);
    const after = getRecentCollabDiag().filter((e) => e.type === 'ws_status' && (e.detail as any)?.reason === 'local-cache-degraded').length;
    expect(after).toBe(before);   // 零新增降级遥测
  }, 60_000);
});

// ══════════ T14（自 t8.spec 迁入）：docBytes 遥测单写点=runDocSizeGate（E33 的 E26 重建触发源） ══════════
describe('T14 docBytes 遥测（runDocSizeGate）', () => {
  it('本地编辑后 5s 节律上送 ws_status.docBytes=现 doc 编码字节；无新 update 的后续 tick 不重发（字节面变化才发）', async () => {
    const ids = caseIds('u-t14-bytes', 'p-t14-bytes', 'h-t14-bytes');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    const update = snapshotOf((d) => { d.getMap('nodes').set('n-t14b', seedNode('b')); });
    await seedUpdates(ids.dbName, [update]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write', serverSV: svBufferOf(update) });

    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    expect(useCanvasStore.getState().hydration).toBe('local');

    const d = runtime.getDoc()!;
    d.transact(() => { d.getMap('m').set('t14-bytes', 'x'.repeat(1024)); }, Origin.LocalUser);
    await vi.advanceTimersByTimeAsync(5_100);   // 5s syncLagTimer=测量节律
    const events = () => getRecentCollabDiag()
      .filter((e) => e.type === 'ws_status' && typeof (e.detail as any)?.docBytes === 'number');
    expect(events().length).toBe(1);
    expect((events()[0]!.detail as any).docBytes).toBe(Y.encodeStateAsUpdate(runtime.getDoc()!).byteLength);

    await vi.advanceTimersByTimeAsync(10_200);   // 两个无新 update 的 tick——去重零重发
    expect(events().length).toBe(1);
  }, 60_000);
});
