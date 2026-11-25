// apps/web/src/stores/canvasCollabRuntime.buckets.spec.ts
// Y5 T12（spec §0.4 四桶/§0.6 删除闸/§0.3.8 横幅位次）：版本换代桶 hold 落点 + 镜像腿改道 +
// close 4410 定时器入闸 + SyncBanner local-pending 档。
// 装置承 canvasCollabRuntime.local.spec.ts 文件头（fake-indexeddb + FakeHocuspocusProvider +
// 真 immediate 泵 + caseIds/seedSession/seedUpdates/seedCustom/dbExists）——本 spec 不 mock
// '@/collab/local-yjs-store'（要读真 names 行）；purge 面 mock 挂点调用断言（真实行为归
// local-cache-key.test）。
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import {
  CANVAS_DOC_SCHEMA_VERSION, CollabAuthReason,
  DOC_VACUUMING_TERMINAL_REASON, CLIENT_OUTDATED_REASON,
} from '@flowweb/shared';
import { useCanvasStore, clearLocalPreviewAll } from './canvasStore';
import * as runtime from './canvasCollabRuntime';
import { buildYjsDbName, listNameRows, putSessionRow, type SessionRow } from '@/collab/local-yjs-store';
import { purgePidCaches, purgeForeignCaches } from '@/collab/local-cache-key';
import { getRecentCollabDiag, _resetCollabDiagForTest } from '@/utils/collabDiagnostics';
import { _resetUnloadGuardForTest } from '@/utils/unloadGuard';
import { resolveCanvasBanner } from '@/pages/canvas/components/SyncBanner';

vi.mock('@hocuspocus/provider', async () => {
  const { FakeHocuspocusProvider } = await import('@/test/fixtures/fakeHocuspocusProvider');
  return { HocuspocusProvider: FakeHocuspocusProvider };
});

// 挂点调用断言（§三 镜像腿零 purge / §一 表收窄）——键合成保持真实实现。
vi.mock('@/collab/local-cache-key', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/collab/local-cache-key')>()),
  purgePidCaches: vi.fn().mockResolvedValue(undefined),
  purgeForeignCaches: vi.fn().mockResolvedValue(undefined),
}));

/** BroadcastChannel 假件注册表（bindReevaluateOnce 模块级一次挂——文件级可达，t25 harness 同款）。 */
const bcHarness = vi.hoisted(() => ({
  instances: [] as Array<{ onmessage: ((ev: { data: unknown }) => void) | null }>,
}));
class HarnessBroadcastChannel {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  postMessage() {}
  close() {}
  constructor() { bcHarness.instances.push(this); }
}

/** §五 M1 注入缝：指定 custom 键读抛错（serverSV 仍成功）——验「单条 custom 读失败不连带
 *  跳过投影」。默认空数组=直通（其余用例零扰动）。 */
const customHarness = vi.hoisted(() => ({ failReadKeys: [] as string[] }));
vi.mock('@/collab/local-yjs-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/collab/local-yjs-store')>();
  return {
    ...orig,
    readCustom: async (persistence: Parameters<typeof orig.readCustom>[0], key: string) => {
      if (customHarness.failReadKeys.includes(key)) throw new Error(`readCustom(${key}) failed (injected)`);
      return orig.readCustom(persistence, key);
    },
  };
});

const lastInstance = () => (HocuspocusProvider as any).instances.at(-1) as any;
const reloadSpy = vi.fn();
const persistSpy = vi.fn(async () => true);

/** 真 setImmediate 泵（假定时器只 fake setTimeout/clearTimeout/setInterval/clearInterval）。 */
const realImmediate: (cb: () => void) => unknown = (globalThis as any).setImmediate;
const nextImmediate = () => new Promise<void>((resolve) => { realImmediate(() => resolve()); });
async function pumpImmediate(turns = 1): Promise<void> {
  for (let i = 0; i < turns; i += 1) await nextImmediate();
}
/** 泵至异步谓词成立（真实时间预算——假定时器不含 Date）。 */
async function pumpUntilTrue(check: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 4_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
    await nextImmediate();
  }
}

const seedNode = (id: string): Y.Map<any> => new Y.Map<any>([
  ['type', 'textInput'],
  ['position', new Y.Map([['x', 0], ['y', 0]])],
  ['data', new Y.Map<any>([['v', id]])],
]);

function snapshotOf(build: (d: Y.Doc) => void): Uint8Array {
  const d = new Y.Doc();
  d.getMap('meta').set('schemaVersion', CANVAS_DOC_SCHEMA_VERSION);
  build(d);
  const update = Y.encodeStateAsUpdate(d);
  d.destroy();
  return update;
}

/** 快照全量状态向量（serverSV 写域形态——差分=空的构造源）。 */
function svBufferOf(update: Uint8Array): ArrayBuffer {
  const d = new Y.Doc();
  Y.applyUpdate(d, update);
  const sv = Y.encodeStateVector(d);
  d.destroy();
  return sv.buffer.slice(sv.byteOffset, sv.byteOffset + sv.byteLength);
}

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

async function dbExists(name: string): Promise<boolean> {
  const dbs = await indexedDB.databases();
  return dbs.some((d) => d.name === name);
}

/** names 行读取（hold 断言面——真 meta 表读）。 */
async function readNameRow(dbName: string) {
  const rows = await listNameRows();
  return rows.find((r) => r.dbName === dbName) ?? null;
}

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

function caseIds(uid: string, pid: string, token: string, generation = 3, schemaVersion = 2) {
  return {
    uid, pid, token, generation, schemaVersion,
    dbName: buildYjsDbName(uid, pid, generation, schemaVersion, token),
    meta: { viewerUid: uid, collabGeneration: generation, collabSchemaVersion: schemaVersion },
  };
}

/** 进 local：库有内容（默认差分非空；withDiff=false 时 serverSV 覆盖库内容⇒差分空）。 */
async function enterLocal(ids: ReturnType<typeof caseIds>, opts: { withDiff?: boolean } = {}): Promise<void> {
  localStorage.setItem('collab:history-id', ids.token);
  await seedSession(ids.uid);
  const update = snapshotOf((d) => { d.getMap('nodes').set(`n-${ids.token}`, seedNode(ids.token)); });
  await seedUpdates(ids.dbName, [update]);
  await seedCustom(ids.dbName, opts.withDiff === false
    ? { writeGrant: 'read-write', serverSV: svBufferOf(update) }
    : { writeGrant: 'read-write' });
  await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
}

const diagReasons = () => getRecentCollabDiag()
  .filter((e: any) => e.type === 'ws_status')
  .map((e: any) => e.detail?.reason);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  (HocuspocusProvider as any).instances.length = 0;
  _resetCollabDiagForTest();
  _resetUnloadGuardForTest();
  clearLocalPreviewAll();
  persistSpy.mockClear();
  reloadSpy.mockClear();
  vi.mocked(purgePidCaches).mockClear();
  vi.mocked(purgeForeignCaches).mockClear();
  localStorage.clear();
  vi.stubGlobal('navigator', {
    ...navigator,
    onLine: true,
    storage: { persist: persistSpy, estimate: vi.fn(async () => ({ usage: 1, quota: 1_000_000 })) },
  });
  vi.stubGlobal('location', { search: '', hostname: 'localhost', protocol: 'http:', reload: reloadSpy });
  vi.stubGlobal('BroadcastChannel', HarnessBroadcastChannel);
  // /api/ready 兜底（handleVersionTerminal 探测面——每例唯一 csv 防 sessionStorage 键跨例残留）
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => ({ collabProtocolVersion: `t12-${Math.random()}`, reason: '' }),
  })));
});

afterEach(async () => {
  await runtime.destroyCollab();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ══════════ ①授权中断桶（验收 12）：session-expired 留库不置 diverged 不删库 ══════════
describe('T12 四桶：授权中断桶', () => {
  it('session-expired → 库在 + names.hold 仍 false + canvasDiverged false + purgePidCaches 零调用', async () => {
    const ids = caseIds('u-b1', 'p-b1', 'h-b1');
    await enterLocal(ids);
    expect(useCanvasStore.getState().hydration).toBe('local');   // 前置锚
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(true);       // 有差分（hold 判据另一半）

    lastInstance().emit('authenticationFailed', { reason: CollabAuthReason.SESSION_EXPIRED });
    await pumpImmediate(6);

    expect(await dbExists(ids.dbName)).toBe(true);
    expect((await readNameRow(ids.dbName))?.hold).toBe(false);
    expect(useCanvasStore.getState().canvasDiverged).toBe(false);
    expect(vi.mocked(purgePidCaches)).not.toHaveBeenCalled();
  });
});

// ══════════ ②版本换代桶（authFailed 面，验收 21）：hold + 横幅 ══════════
describe('T12 四桶：版本换代桶（authFailed 面）', () => {
  it('schema-outdated + 有差分 → 库在 + hold true + canvasDiverged true + diag local-hold', async () => {
    const ids = caseIds('u-b2', 'p-b2', 'h-b2');
    await enterLocal(ids);

    lastInstance().emit('authenticationFailed', { reason: CollabAuthReason.SCHEMA_OUTDATED });
    await pumpUntilTrue(async () => (await readNameRow(ids.dbName))?.hold === true, 'hold 行未写入');

    expect(await dbExists(ids.dbName)).toBe(true);
    expect(useCanvasStore.getState().canvasDiverged).toBe(true);
    expect(diagReasons()).toContain('local-hold');
    expect(vi.mocked(purgePidCaches)).not.toHaveBeenCalled();
  });
});

// ══════════ ③版本换代桶（close 4406 面，验收 25）══════════
describe('T12 四桶：版本换代桶（close 4406 面）', () => {
  it('close 4406 client-outdated + 有差分 → 旧纪元库在 + hold true + 零 purge', async () => {
    const ids = caseIds('u-b3', 'p-b3', 'h-b3');
    await enterLocal(ids);
    expect(localStorage.getItem('collab:history-id')).toBe(ids.token);

    lastInstance().emit('close', { event: { code: 4406, reason: CLIENT_OUTDATED_REASON } });
    await pumpUntilTrue(async () => (await readNameRow(ids.dbName))?.hold === true, '4406 hold 行未写入');

    expect(await dbExists(ids.dbName)).toBe(true);
    expect(vi.mocked(purgePidCaches)).not.toHaveBeenCalled();
    expect(localStorage.getItem('collab:history-id')).toBeNull();   // ②清 h 仍做（防全项目锁死）
  });
});

// ══════════ ④4410 + discardLocalCache 不构成删除许可 ══════════
describe('T12 四桶：4410 close 定时器入闸', () => {
  it('close 4410 doc-vacuuming（载荷 discardLocalCache:true）+ 有差分 → 延时到点仍库在 + hold + 零 reload', async () => {
    const ids = caseIds('u-b4', 'p-b4', 'h-b4');
    await enterLocal(ids);
    const p = lastInstance();
    p.emit('stateless', { payload: JSON.stringify({ code: 4410, reason: DOC_VACUUMING_TERMINAL_REASON, discardLocalCache: true, generation: 4 }) });
    p.emit('close', { event: { code: 4410, reason: DOC_VACUUMING_TERMINAL_REASON } });

    await vi.advanceTimersByTimeAsync(1_600);   // GENERATION_RELOAD_DELAY_MS=1500
    await pumpUntilTrue(async () => (await readNameRow(ids.dbName))?.hold === true, '4410 hold 行未写入');

    expect(await dbExists(ids.dbName)).toBe(true);      // discardLocalCache 不当删除许可
    expect(reloadSpy).not.toHaveBeenCalled();           // hold→k 库留、横幅亮、不 reload
  });
});

// ══════════ ⑤resyncFull 写 hold（被拒字节不挂回连接 doc 归 T13）══════════
describe('T12 四桶：resyncFull hold', () => {
  it('close 4411 + 有差分 → hold true + 库在 + 不重建 provider', async () => {
    const ids = caseIds('u-b5', 'p-b5', 'h-b5');
    await enterLocal(ids);
    const p = lastInstance();

    p.emit('close', { event: { code: 4411, reason: 'frame-malformed' } });
    await pumpUntilTrue(async () => (await readNameRow(ids.dbName))?.hold === true, 'resync hold 行未写入');

    expect(await dbExists(ids.dbName)).toBe(true);
    expect(lastInstance()).toBe(p);   // hold 即返——不 initCollab 重建
  });
});

// ══════════ ⑥镜像腿零 purge（§0.4 镜像腿表：删除权单源发起标签）══════════
describe('T12 镜像腿：只拆会话不删库', () => {
  it('history-bump → 清 localStorage h + purge 零调用；recovery-accepted → purge 零调用', async () => {
    const ids = caseIds('u-b6', 'p-b6', 'h-b6');
    await enterLocal(ids);
    const recv = bcHarness.instances[0];   // bindReevaluateOnce 首挂接收实例（模块级一次）
    expect(typeof recv?.onmessage).toBe('function');

    recv.onmessage!({ data: { type: 'collab-recovery', pid: ids.pid, kind: 'history-bump' } });
    await pumpImmediate(8);
    expect(localStorage.getItem('collab:history-id')).toBeNull();
    expect(vi.mocked(purgePidCaches)).not.toHaveBeenCalled();

    recv.onmessage!({ data: { type: 'collab-recovery', pid: ids.pid, kind: 'recovery-accepted' } });
    await pumpImmediate(8);
    expect(vi.mocked(purgePidCaches)).not.toHaveBeenCalled();
    expect(await dbExists(ids.dbName)).toBe(true);
  });
});

// ══════════ ⑦acceptServerRestored：导出为 0（构包 null）→ 不 purge、库在 ══════════
describe('T12 acceptServerRestoredRecovery 导出闸', () => {
  it('buildDraftEnvelope=null（零节点）⇒ exported=0 ⇒ purgePidCaches 零调用 + 库在', async () => {
    const ids = caseIds('u-b7', 'p-b7', 'h-b7');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    // 库有内容（meta 键）但零节点——serializeCanvas 空 ⇒ buildDraftEnvelope=null ⇒ exported=0
    await seedUpdates(ids.dbName, [snapshotOf((d) => { d.getMap('meta').set('note', 'x'); })]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write' });
    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });
    expect(useCanvasStore.getState().hydration).toBe('local');

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ code: 0, data: { accepted: true, generation: 3 } }),
    })));
    const ok = await runtime.acceptServerRestoredRecovery(ids.pid);
    await pumpImmediate(6);

    expect(ok).toBe(true);
    expect(vi.mocked(purgePidCaches)).not.toHaveBeenCalled();   // 导出文件未生成 ⇒ 不删
    expect(await dbExists(ids.dbName)).toBe(true);
  });
});

// ══════════ ⑧无差分零动作（T12 不写 hold；删除权归 T13 删除闸）══════════
describe('T12 四桶：无差分零动作', () => {
  it('差分空 + schema-outdated → hold 仍 false + purgePidCaches 零调用', async () => {
    const ids = caseIds('u-b8', 'p-b8', 'h-b8');
    await enterLocal(ids, { withDiff: false });
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(false);   // 前置锚：差分空

    lastInstance().emit('authenticationFailed', { reason: CollabAuthReason.SCHEMA_OUTDATED });
    await pumpImmediate(10);

    expect((await readNameRow(ids.dbName))?.hold).toBe(false);   // T12 无差分零动作
    expect(vi.mocked(purgePidCaches)).not.toHaveBeenCalled();
  });
});

// ══════════ ⑨SyncBanner local-pending（§0.3.8 位次）══════════
describe('T12 SyncBanner：local-pending 档', () => {
  const baseInput = {
    connUi: 'ok' as const, wsAuthNotice: null, wsQuotaTerminal: null, canvasDiverged: false,
    canvasOversized: false, canvasDegraded: false, persistUnhealthy: false, writeFrozen: false,
    syncLagOver60s: false, pendingBacklog: false, localCacheReady: false, collabEscapePending: false,
    readyProbeHint: null, recoveryPending: null, draftMergeAnomalies: null,
  };

  it('hydration=local 且无 diverged → local-pending；diverged 同真时 diverged 优先', () => {
    const branch = resolveCanvasBanner({ ...baseInput, hydration: 'local' });
    expect(branch?.kind).toBe('local-pending');
    expect(branch && 'text' in branch ? branch.text : '').toContain('离线编辑中');

    expect(resolveCanvasBanner({ ...baseInput, hydration: 'local', canvasDiverged: true })?.kind).toBe('diverged');
  });

  it('hydration=ready → 不出现 local-pending（其他态一律不出）', () => {
    expect(resolveCanvasBanner({ ...baseInput, hydration: 'ready' })).toBeNull();
  });
});

// ══════════ ⑩T10 遗留 M1（§五）：单条 custom 读失败不连带跳过投影 ══════════
describe('T12 M1：custom 单键读失败不吞投影', () => {
  it('serverSV 读成功、writeGrant 读抛错 → 内容仍投影（localSnapshotApplied 已置——修前整块 catch 跳过投影）', async () => {
    const ids = caseIds('u-m1', 'p-m1', 'h-m1');
    localStorage.setItem('collab:history-id', ids.token);
    await seedSession(ids.uid);
    const update = snapshotOf((d) => { d.getMap('nodes').set('n-m1', seedNode('m1')); });
    await seedUpdates(ids.dbName, [update]);
    await seedCustom(ids.dbName, { writeGrant: 'read-write' });
    customHarness.failReadKeys = ['writeGrant'];

    await runtime.initCollabLocal(ids.pid, { ...ids.meta, name: 'X', teamId: null });

    // 无 grant ⇒ 进不了 local（只读副本），但库内容必须已投影（修前：store 空）
    expect(useCanvasStore.getState().hydration).toBe('failed');
    expect(useCanvasStore.getState().nodes.map((n: any) => n.id)).toContain('n-m1');
    expect(useCanvasStore.getState().collabReadOnly).toBe(true);
  });
});
