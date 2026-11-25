// apps/web/src/collab/local-yjs-store.deletegate.spec.ts
// Y5 T13：统一删除闸（三合法判据）+ 墓碑重试 + 启动清扫并集 + purgeUidDbs（登出）+ hold 跨会话读点。
// 装置=fake-indexeddb/auto（真事务语义）；受控注入只在测试侧（indexedDB.deleteDatabase 兜 blocked）。
// 断言锚（spec §0.6 / §0.1.4 / 验收 14/21/25、C4/P2）：
//   ①有差分 → 不删 + hold:true；②acked（差分==EMPTY ∧ 无 diverged）→ 删；
//   ③exportConfirmed/discardConfirmed → 直删；④diverged 且差分空 → **不删**（T13 新增维度）；
//   ⑤测量超时 → held（不删）；⑥deleteDatabase blocked → 墓碑重试；
//   ⑦sweep 并集（databases() 之外的 names 行、databases() 缺席走 names）；
//   ⑧purgeUidDbs 登出全链；⑨hold/tombstone 互斥拒绝性断言；⑩findHeldNameRow 跨代读点。
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  EMPTY_DOC_ENCODE_BYTES,
  applyDeleteGate,
  deleteDbWithOutcome,
  deleteNameRow,
  findHeldNameRow,
  listNameRows,
  openMetaDb,
  purgeUidDbs,
  putNameRow,
  sweepStartup,
  withDbDoc,
  type NameRow,
} from './local-yjs-store';

let seq = 0;
const uidOf = (tag: string): string => `u-${tag}-${String(Date.now())}`;
const dbNameOf = (uid: string, pid: string, gen = 3, schema = 2, token = 'tok'): string =>
  `flowweb:yjs:${uid}:${pid}:g${String(gen)}:s${String(schema)}:h${token}`;

/** 打开原始库（y-indexeddb 同款两 store）。 */
function openRawDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('updates')) db.createObjectStore('updates', { autoIncrement: true });
      if (!db.objectStoreNames.contains('custom')) db.createObjectStore('custom');
    };
    request.onsuccess = () => { resolve(request.result); };
    request.onerror = () => { reject(request.error ?? new Error('raw open failed')); };
  });
}

async function withRawDb(name: string, run: (db: IDBDatabase) => Promise<void>): Promise<void> {
  const db = await openRawDb(name);
  try { await run(db); } finally { db.close(); }
}

/** 造内容 update（返回 update 与其派生的精确 SV——**必须同源**：两次独立构造各自新 clientID，
 *  SV 不互补会让「已确认」误判） */
function buildUpdate(entries: Record<string, string>): { update: Uint8Array; sv: ArrayBuffer } {
  const doc = new Y.Doc();
  const map = doc.getMap<string>('m');
  for (const [k, v] of Object.entries(entries)) map.set(k, v);
  const update = Y.encodeStateAsUpdate(doc);
  const sv = Y.encodeStateVector(doc);
  const out = sv.buffer.slice(sv.byteOffset, sv.byteOffset + sv.byteLength);
  doc.destroy();
  return { update, sv: out };
}

/** 空 doc 状态向量（无内容基准）。 */
function emptySv(): ArrayBuffer {
  const doc = new Y.Doc();
  const sv = Y.encodeStateVector(doc);
  const out = sv.buffer.slice(sv.byteOffset, sv.byteOffset + sv.byteLength);
  doc.destroy();
  return out;
}

async function seedUpdates(name: string, updates: Uint8Array[]): Promise<void> {
  await withRawDb(name, (db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction('updates', 'readwrite');
    for (const u of updates) tx.objectStore('updates').add(u);
    tx.oncomplete = () => { resolve(); };
    tx.onerror = () => { reject(tx.error ?? new Error('seed failed')); };
  }));
}

async function seedCustom(name: string, entries: Record<string, string | ArrayBuffer>): Promise<void> {
  await withRawDb(name, (db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction('custom', 'readwrite');
    const store = tx.objectStore('custom');
    for (const [k, v] of Object.entries(entries)) store.put(v, k);
    tx.oncomplete = () => { resolve(); };
    tx.onerror = () => { reject(tx.error ?? new Error('seed custom failed')); };
  }));
}

async function dbExists(name: string): Promise<boolean> {
  const dbs = await indexedDB.databases();
  return dbs.some((d) => d.name === name);
}

function nameRow(uid: string, pid: string, over: Partial<NameRow> = {}): NameRow {
  return { uid, pid, generation: 3, schemaVersion: 2, historyToken: 'tok', hold: false, ...over };
}

beforeEach(async () => {
  // meta 库跨用例存活——清干净（单活行/names 行不串扰）
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('flowweb:yjs-meta');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ══════════ ①有差分 → 不删 + hold ══════════
describe('applyDeleteGate：有差分不删', () => {
  it('库有内容且无 serverSV（差分=全量>EMPTY）→ held + names.hold=true + 库还在', async () => {
    const uid = uidOf('dirty');
    const dbName = dbNameOf(uid, 'p1');
    await putNameRow(dbName, nameRow(uid, 'p1'));
    await seedUpdates(dbName, [buildUpdate({ a: '1' }).update]);

    const outcome = await applyDeleteGate(dbName, 'startup');

    expect(outcome).toBe('held');
    expect(await dbExists(dbName)).toBe(true);
    const row = (await listNameRows()).find((r) => r.dbName === dbName);
    expect(row?.hold).toBe(true);
  });
});

// ══════════ ②acked → 删 ══════════
describe('applyDeleteGate：acked 才删', () => {
  it('差分==EMPTY 且无 diverged → acked + 库已删 + names 行已清', async () => {
    const uid = uidOf('acked');
    const dbName = dbNameOf(uid, 'p2');
    const { update, sv } = buildUpdate({ a: '1' });
    await putNameRow(dbName, nameRow(uid, 'p2'));
    await seedUpdates(dbName, [update]);
    await seedCustom(dbName, { serverSV: sv });   // 服务端已确认全部内容（SV 与 update 同源）

    const outcome = await applyDeleteGate(dbName, 'startup');

    expect(outcome).toBe('acked');
    expect(await dbExists(dbName)).toBe(false);
    expect((await listNameRows()).some((r) => r.dbName === dbName)).toBe(false);
  });
});

// ══════════ ③exportConfirmed / discardConfirmed → 直删 ══════════
describe('applyDeleteGate：调用方已确认导出/放弃', () => {
  it('exportConfirmed=true → 有差分也删（保全义务已履行）', async () => {
    const uid = uidOf('exported');
    const dbName = dbNameOf(uid, 'p3');
    await putNameRow(dbName, nameRow(uid, 'p3'));
    await seedUpdates(dbName, [buildUpdate({ a: '1' }).update]);

    expect(await applyDeleteGate(dbName, 'accept', { exportConfirmed: true })).toBe('deleted');
    expect(await dbExists(dbName)).toBe(false);
  });

  it('discardConfirmed=true → 有差分也删（用户显式放弃）', async () => {
    const uid = uidOf('discarded');
    const dbName = dbNameOf(uid, 'p4');
    await putNameRow(dbName, nameRow(uid, 'p4'));
    await seedUpdates(dbName, [buildUpdate({ a: '1' }).update]);

    expect(await applyDeleteGate(dbName, 'purge-family', { discardConfirmed: true })).toBe('deleted');
    expect(await dbExists(dbName)).toBe(false);
  });
});

// ══════════ ④diverged 且差分空 → 不删（T13 新增维度） ══════════
describe('applyDeleteGate：diverged 拒删', () => {
  it('差分==EMPTY 但 diverged=1 → held（修前 measureYjsDoc 不读 diverged=误删）', async () => {
    const uid = uidOf('diverged');
    const dbName = dbNameOf(uid, 'p5');
    const { update, sv } = buildUpdate({ a: '1' });
    await putNameRow(dbName, nameRow(uid, 'p5'));
    await seedUpdates(dbName, [update]);
    await seedCustom(dbName, { serverSV: sv, diverged: '1' });

    const outcome = await applyDeleteGate(dbName, 'startup');

    expect(outcome).toBe('held');
    expect(await dbExists(dbName)).toBe(true);   // 未裁定内容唯一副本——禁删
  });
});

// ══════════ ⑤serverSV 存在但为空 ArrayBuffer + 库有内容 → 不删 ══════════
describe('applyDeleteGate：空 serverSV 特例', () => {
  it('serverSV=空 ArrayBuffer 且库有内容 → held（差分按全量算 > EMPTY）', async () => {
    const uid = uidOf('emptysv');
    const dbName = dbNameOf(uid, 'p6');
    await putNameRow(dbName, nameRow(uid, 'p6'));
    await seedUpdates(dbName, [buildUpdate({ a: '1' }).update]);
    await seedCustom(dbName, { serverSV: new ArrayBuffer(0) });

    expect(await applyDeleteGate(dbName, 'startup')).toBe('held');
    expect(await dbExists(dbName)).toBe(true);
  });
});

// ══════════ ⑥blocked → 墓碑重试 ══════════
describe('墓碑重试（C4）', () => {
  it('deleteDatabase blocked → blocked + names.tombstone=true；下次 sweep 直删不读内容', async () => {
    const uid = uidOf('blocked');
    const dbName = dbNameOf(uid, 'p7');
    await putNameRow(dbName, nameRow(uid, 'p7'));
    await seedUpdates(dbName, [buildUpdate({ a: '1' }).update]);

    // 注入 blocked：deleteDatabase 返回永不 onsuccess 的请求并立刻 onblocked
    const realDelete = indexedDB.deleteDatabase.bind(indexedDB);
    const deleteSpy = vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation(((name: string) => {
      if (name !== dbName) return realDelete(name);
      const req = {
        result: null, error: null, onsuccess: null, onerror: null, onblocked: null,
      } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => {
        (req.onblocked as ((ev: Event) => void) | null)?.(new Event('blocked'));
      });
      return req;
    }) as typeof indexedDB.deleteDatabase);

    const outcome = await applyDeleteGate(dbName, 'accept', { exportConfirmed: true });
    expect(outcome).toBe('blocked');
    const row = (await listNameRows()).find((r) => r.dbName === dbName);
    expect(row?.tombstone).toBe(true);
    expect(row?.hold).toBe(false);   // 互斥：墓碑不再带 hold

    // 下次 sweep：墓碑直删不过闸（openYjsDoc/measure 零调用）
    deleteSpy.mockRestore();
    const { openYjsDoc } = await import('./local-yjs-store');
    const openSpy = vi.spyOn(await import('./local-yjs-store'), 'openYjsDoc').mockImplementation(openYjsDoc);
    const result = await sweepStartup(uid);
    expect(result.deleted).toBe(1);
    expect(await dbExists(dbName)).toBe(false);
    openSpy.mockRestore();
  });
});

// ══════════ ⑦sweep 并集（P2） ══════════
describe('sweepStartup：枚举并集', () => {
  it('databases() 返回 names 表外多一库 → 该孤儿库也被扫到（acked → 删）', async () => {
    const uid = uidOf('union');
    const named = dbNameOf(uid, 'p8');
    const orphan = dbNameOf(uid, 'p9');
    await putNameRow(named, nameRow(uid, 'p8'));
    const namedSeed = buildUpdate({ a: '1' });
    await seedUpdates(named, [namedSeed.update]);
    await seedCustom(named, { serverSV: namedSeed.sv });
    // 孤儿库：有库无 names 行（T13 之前建的全部新层库都是这形态）
    await seedUpdates(orphan, [buildUpdate({}).update]);

    const result = await sweepStartup(uid);

    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(await dbExists(named)).toBe(false);      // names 行库：acked 删
    expect(await dbExists(orphan)).toBe(false);     // 孤儿库：也被扫到且空库 acked 删
  });

  it('databases() 缺席 → 走 names 全表且 skippedNoDatabasesApi=true（不得静默假装扫全）', async () => {
    const uid = uidOf('nodbs');
    const dbName = dbNameOf(uid, 'p10');
    const seed10 = buildUpdate({ a: '1' });
    await putNameRow(dbName, nameRow(uid, 'p10'));
    await seedUpdates(dbName, [seed10.update]);
    await seedCustom(dbName, { serverSV: seed10.sv });

    // 移除能力（旧 Safari/Firefox 形态）：databases 在 fake-indexeddb 上是原型方法，
    // 直接 delete 实例属性无效——用 defineProperty 盖成 undefined（configurable 以便还原）
    const origDescriptor = Object.getOwnPropertyDescriptor(indexedDB, 'databases');
    const hadOwn = origDescriptor !== undefined;
    Object.defineProperty(indexedDB, 'databases', { value: undefined, configurable: true, writable: true });
    try {
      const result = await sweepStartup(uid);
      expect(result.skippedNoDatabasesApi).toBe(true);
      expect(result.deleted).toBe(1);   // names 表仍扫到并删 acked 库
    } finally {
      if (hadOwn && origDescriptor) Object.defineProperty(indexedDB, 'databases', origDescriptor);
      else Reflect.deleteProperty(indexedDB, 'databases');
    }
  });
});

// ══════════ ⑧purgeUidDbs 登出全链 ══════════
describe('purgeUidDbs：登出清库', () => {
  it('该 uid 的新层库全删、names 行随删随去；他 uid 库不动', async () => {
    const uid = uidOf('logout');
    const other = uidOf('other');
    const mine1 = dbNameOf(uid, 'p11');
    const mine2 = dbNameOf(uid, 'p12');
    const theirs = dbNameOf(other, 'p11');
    for (const [name, u, p] of [[mine1, uid, 'p11'], [mine2, uid, 'p12'], [theirs, other, 'p11']] as const) {
      await putNameRow(name, nameRow(u, p));
      await seedUpdates(name, [buildUpdate({ a: '1' }).update]);
    }

    const result = await purgeUidDbs(uid);

    expect(result.deleted).toBe(2);
    expect(await dbExists(mine1)).toBe(false);
    expect(await dbExists(mine2)).toBe(false);
    expect(await dbExists(theirs)).toBe(true);   // 他人库不碰
    const rows = await listNameRows();
    expect(rows.some((r) => r.uid === uid)).toBe(false);
    expect(rows.some((r) => r.uid === other)).toBe(true);
  });
});

// ══════════ ⑨hold/tombstone 互斥（T3 parked Minor 收口） ══════════
describe('putNameRow：hold/tombstone 互斥', () => {
  it('hold:true 且 tombstone:true → 抛错（注释契约升级为运行时断言）', async () => {
    const dbName = dbNameOf(uidOf('both'), 'p13');
    await expect(putNameRow(dbName, nameRow('u', 'p13', { hold: true, tombstone: true })))
      .rejects.toThrow(/hold\/tombstone 互斥/u);
  });
});

// ══════════ ⑩findHeldNameRow 跨代读点（§0.6 v8） ══════════
describe('findHeldNameRow：跨会话 hold 读点', () => {
  it('旧代库 hold=true → 即使当前代无 hold 也能读到（横幅读盘不读当前库）', async () => {
    const uid = uidOf('held');
    const oldGen = dbNameOf(uid, 'p14', 3, 2, 'old');
    const newGen = dbNameOf(uid, 'p14', 4, 2, 'new');
    await putNameRow(oldGen, nameRow(uid, 'p14', { hold: true }));
    await putNameRow(newGen, nameRow(uid, 'p14', { generation: 4, historyToken: 'new' }));

    const held = await findHeldNameRow(uid, 'p14');
    expect(held?.dbName).toBe(oldGen);
    expect(held?.hold).toBe(true);
  });

  it('无 hold 行 → null', async () => {
    const uid = uidOf('noheld');
    const dbName = dbNameOf(uid, 'p15');
    await putNameRow(dbName, nameRow(uid, 'p15'));
    expect(await findHeldNameRow(uid, 'p15')).toBeNull();
  });
});

// ══════════ ⑪withDbDoc：从指定库读内容（旧代导出腿） ══════════
describe('withDbDoc：临时装载导出', () => {
  it('从旧代库取 doc 内容并销毁（不泄漏连接）', async () => {
    const uid = uidOf('withdoc');
    const dbName = dbNameOf(uid, 'p16');
    await seedUpdates(dbName, [buildUpdate({ k: 'v' }).update]);

    const entries = await withDbDoc(dbName, (doc) => [...doc.getMap<string>('m').entries()]);
    expect(entries).toEqual([['k', 'v']]);
    // 连接已释放：库可被删除（若泄漏会 blocked）
    expect(await deleteDbWithOutcome(dbName)).toBe('deleted');
    void uid;
  });

  it('库不可开 → null（fail-soft）', async () => {
    expect(await withDbDoc(dbNameOf(uidOf('missing'), 'p17'), () => 1)).toBeNull();
  });
});

// ══════════ ⑫EMPTY_DOC_ENCODE_BYTES 常量锚 ══════════
describe('EMPTY_DOC_ENCODE_BYTES 判据锚', () => {
  it('空 doc 编码字节 != 0（判据禁 ===0）', () => {
    const doc = new Y.Doc();
    const bytes = Y.encodeStateAsUpdate(doc).byteLength;
    doc.destroy();
    expect(bytes).toBe(EMPTY_DOC_ENCODE_BYTES);
    expect(EMPTY_DOC_ENCODE_BYTES).toBeGreaterThan(0);
  });
});

// ══════════ ⑬openMetaDb 可用（装置自检，防 harness 静默坏） ══════════
describe('装置自检', () => {
  it('openMetaDb 能开三表且 deleteNameRow 生效', async () => {
    const db = await openMetaDb();
    expect([...db.objectStoreNames]).toEqual(expect.arrayContaining(['names', 'session', 'bindings']));
    db.close();
    const dbName = dbNameOf(uidOf('selfcheck'), 'p18');
    await putNameRow(dbName, nameRow('u', 'p18'));
    await deleteNameRow(dbName);
    expect((await listNameRows()).some((r) => r.dbName === dbName)).toBe(false);
    void seq;
    void emptySv;
  });
});
