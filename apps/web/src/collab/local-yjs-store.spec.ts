// apps/web/src/collab/local-yjs-store.spec.ts
// Y5 T3：策略模块 meta 半边——五维库名+flowweb:yjs-meta 三表（names/session/bindings）
// 单测。装置=fake-indexeddb/auto（真事务语义；仓内 src/test/fakeIndexedDb.ts 只建模旧
// 适配器子集，不承载本模块）。
// 断言锚（spec §0.1.4）：
//   ①库名五段+historyToken 字符集 [A-Za-z0-9_-]，不合抛错不净化；
//   ②session 行 put/get/delete 轮回；
//   ③单活行（验收 29）：写 uid B 后 uid A 行不在（旧多行形态写入后同样收敛到单行）；
//   ④bindings 键=uid+'\u0000'+pid；
//   ⑤names 写后 list 可见+墓碑改写 hold=false/tombstone=true（无 sealed 字段）；
//   ⑥snapshotFromUser 十字段白名单（wechatOpenid/unionid/token 不落盘）；
//   ⑦写失败 reject（fail-closed——names 写失败本会话不开库）。
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildYjsDbName, openMetaDb, putSessionRow, deleteSessionRow, getSessionRows,
  putBindingRow, getBindingRow, putNameRow, listNameRows, snapshotFromUser,
  deleteNameRow, deleteNameRowsForUid, deleteBindingRowsForUid,
  type SessionRow, type BindingRow, type NameRow, type UserSnapshot,
} from './local-yjs-store';

const META_DB_NAME = 'flowweb:yjs-meta';
const META_STORES = ['names', 'session', 'bindings'] as const;

const SNAPSHOT: UserSnapshot = {
  id: 'u-a',
  name: '用户A',
  email: 'a@example.com',
  image: null,
  emailVerified: true,
  role: 'USER',
  phoneNumber: null,
  phoneNumberVerified: false,
  createdAt: '2026-01-02T03:04:05.000Z',
  updatedAt: '2026-02-03T04:05:06.000Z',
};

function sessionRow(uid: string, localDeadline = 1_700_000_000_000): SessionRow {
  return { uid, localDeadline, userSnapshot: { ...SNAPSHOT, id: uid } };
}

function bindingRow(uid: string, generation = 1): BindingRow {
  return {
    uid,
    generation,
    schemaVersion: 1,
    historyToken: 'h-2026-10-24-a',
    name: `项目-${uid}`,
    teamId: null,
  };
}

function nameRow(uid: string, pid: string, hold = true): NameRow {
  return { uid, pid, generation: 2, schemaVersion: 1, historyToken: 'h-2026-10-24-a', hold };
}

/** 直读单 store 全部键（断言键布局用——绕 API 面）。 */
async function rawKeys(storeName: string): Promise<IDBValidKey[]> {
  const db = await openMetaDb();
  try {
    return await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAllKeys();
      let keys: IDBValidKey[] = [];
      req.onsuccess = () => { keys = req.result; };
      req.onerror = () => { reject(req.error ?? new Error('raw keys read failed')); };
      tx.oncomplete = () => { resolve(keys); };
      tx.onerror = () => { reject(tx.error ?? new Error('raw keys read failed')); };
      tx.onabort = () => { reject(tx.error ?? new Error('raw keys read aborted')); };
    });
  } finally {
    db.close();
  }
}

/** 绕 API 预置 session 行（模拟旧多行形态——单活行收敛用例的前置）。 */
async function seedSessionRowsRaw(rows: SessionRow[]): Promise<void> {
  const db = await openMetaDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('session', 'readwrite');
      const store = tx.objectStore('session');
      for (const row of rows) store.put(row, row.uid);
      tx.oncomplete = () => { resolve(); };
      tx.onerror = () => { reject(tx.error ?? new Error('seed session failed')); };
      tx.onabort = () => { reject(tx.error ?? new Error('seed session aborted')); };
    });
  } finally {
    db.close();
  }
}

beforeEach(async () => {
  const db = await openMetaDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([...META_STORES], 'readwrite');
      for (const name of META_STORES) tx.objectStore(name).clear();
      tx.oncomplete = () => { resolve(); };
      tx.onerror = () => { reject(tx.error ?? new Error('meta clear failed')); };
      tx.onabort = () => { reject(tx.error ?? new Error('meta clear aborted')); };
    });
  } finally {
    db.close();
  }
});

describe('buildYjsDbName：五维库名', () => {
  it('按 flowweb:yjs:<uid>:<pid>:g<g>:s<s>:h<token> 逐字构造', () => {
    // 'h' 是格式字面前缀，token 本体含它自己的 'h-'（现例 historyId=h-2026-10-24-a → ':hh-…'）
    expect(buildYjsDbName('clx1', 'p2', 3, 2, 'h-2026-10-24-a'))
      .toBe('flowweb:yjs:clx1:p2:g3:s2:hh-2026-10-24-a');
    expect(buildYjsDbName('u_1', 'pid', 0, 1, 'abc_DEF-123'))
      .toBe('flowweb:yjs:u_1:pid:g0:s1:habc_DEF-123');
  });

  it('historyToken 不合 [A-Za-z0-9_-] 抛错（不静默净化）', () => {
    for (const token of ['a:b', 'a b', 'a/b', 'a.b', 'token!', '历史', '']) {
      expect(() => buildYjsDbName('u', 'p', 1, 1, token)).toThrow();
    }
  });
});

describe('openMetaDb：meta 库形态', () => {
  it('库名 flowweb:yjs-meta、版本 1、三表 names/session/bindings', async () => {
    const db = await openMetaDb();
    try {
      expect(db.name).toBe(META_DB_NAME);
      expect(db.version).toBe(1);
      expect(Array.from(db.objectStoreNames).sort()).toEqual(['bindings', 'names', 'session']);
    } finally {
      db.close();
    }
  });
});

describe('session 行', () => {
  it('put/get/delete 轮回', async () => {
    const row = sessionRow('u-a');
    await putSessionRow(row);
    expect(await getSessionRows()).toEqual([row]);
    await deleteSessionRow('u-a');
    expect(await getSessionRows()).toEqual([]);
  });

  it('同 uid 再写覆盖同行（键=uid）', async () => {
    await putSessionRow(sessionRow('u-a', 1));
    await putSessionRow(sessionRow('u-a', 2));
    expect(await getSessionRows()).toEqual([sessionRow('u-a', 2)]);
  });
});

describe('session 单活行（验收 29）', () => {
  it('putSessionRow(uid B) 后 uid A 行不在', async () => {
    const rowA = sessionRow('u-a');
    const rowB = sessionRow('u-b');
    await putSessionRow(rowA);
    await putSessionRow(rowB);
    expect(await getSessionRows()).toEqual([rowB]);
  });

  it('表内已有多个 uid 旧行时，写 uid C 后只剩 C（同事务清其他 uid）', async () => {
    const rowC = sessionRow('u-c');
    await seedSessionRowsRaw([sessionRow('u-a'), sessionRow('u-b')]);
    expect((await getSessionRows()).length).toBe(2);   // 前置成立
    await putSessionRow(rowC);
    expect(await getSessionRows()).toEqual([rowC]);
  });

  it('deleteSessionRow 只删指定 uid（他 uid 行不波及）', async () => {
    await seedSessionRowsRaw([sessionRow('u-a'), sessionRow('u-b')]);
    await deleteSessionRow('u-a');
    expect(await getSessionRows()).toEqual([sessionRow('u-b')]);
  });
});

describe('bindings 行', () => {
  it('键=uid\\u0000pid：同 uid 不同 pid / 同 pid 不同 uid 各自独立', async () => {
    const a1 = bindingRow('u-a');
    const a2 = bindingRow('u-a', 2);
    const b1 = bindingRow('u-b');
    await putBindingRow('u-a', 'p-1', a1);
    await putBindingRow('u-a', 'p-2', a2);
    await putBindingRow('u-b', 'p-1', b1);

    expect(await getBindingRow('u-a', 'p-1')).toEqual(a1);
    expect(await getBindingRow('u-a', 'p-2')).toEqual(a2);
    expect(await getBindingRow('u-b', 'p-1')).toEqual(b1);
    expect(await getBindingRow('u-b', 'p-2')).toBeNull();
    expect((await rawKeys('bindings')).sort()).toEqual(['u-a\u0000p-1', 'u-a\u0000p-2', 'u-b\u0000p-1']);
  });
});

describe('names 行', () => {
  it('写后 list 可见（含 dbName）；墓碑改写 hold=false/tombstone=true；无 sealed 字段', async () => {
    const dbName = buildYjsDbName('u-a', 'p-1', 2, 1, 'h-2026-10-24-a');
    const live = nameRow('u-a', 'p-1');
    await putNameRow(dbName, live);
    expect(await listNameRows()).toEqual([{ ...live, dbName }]);

    const tombstoned: NameRow = { ...live, hold: false, tombstone: true };
    await putNameRow(dbName, tombstoned);
    const listed = await listNameRows();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual({ ...tombstoned, dbName });
    expect(listed[0].hold).toBe(false);
    expect(listed[0].tombstone).toBe(true);
    expect('sealed' in listed[0]).toBe(false);
    expect((await rawKeys('names'))).toEqual([dbName]);
  });

  it('写失败 reject（fail-closed）且该次写零落盘', async () => {
    const dbName = buildYjsDbName('u-a', 'p-1', 2, 1, 'h-2026-10-24-a');
    // 函数值不可结构化克隆——store.put 同步抛 DataCloneError
    const bad = { ...nameRow('u-a', 'p-1'), hold: () => true } as unknown as NameRow;
    await expect(putNameRow(dbName, bad)).rejects.toBeTruthy();
    expect(await listNameRows()).toEqual([]);
  });
});

describe('meta 行删除 API（§0.6 登出三表清理）', () => {
  it('deleteNameRow 只删指定库名行', async () => {
    const dbNameA = buildYjsDbName('u-a', 'p-1', 2, 1, 'h-2026-10-24-a');
    const dbNameB = buildYjsDbName('u-a', 'p-2', 2, 1, 'h-2026-10-24-a');
    await putNameRow(dbNameA, nameRow('u-a', 'p-1'));
    await putNameRow(dbNameB, nameRow('u-a', 'p-2'));

    await deleteNameRow(dbNameA);

    expect((await listNameRows()).map((row) => row.dbName)).toEqual([dbNameB]);
  });

  it('deleteNameRowsForUid(uid a)：删 a 的两行（不同 pid）、保留他 uid 行', async () => {
    const a1 = buildYjsDbName('u-a', 'p-1', 2, 1, 'h-2026-10-24-a');
    const a2 = buildYjsDbName('u-a', 'p-2', 2, 1, 'h-2026-10-24-a');
    const b1 = buildYjsDbName('u-b', 'p-1', 2, 1, 'h-2026-10-24-a');
    await putNameRow(a1, nameRow('u-a', 'p-1'));
    await putNameRow(a2, nameRow('u-a', 'p-2'));
    await putNameRow(b1, nameRow('u-b', 'p-1'));

    await deleteNameRowsForUid('u-a');

    expect(await listNameRows()).toEqual([{ ...nameRow('u-b', 'p-1'), dbName: b1 }]);
  });

  it('deleteBindingRowsForUid(uid a)：删 a 的两行、保留 b 行（键=uid\\u0000pid）', async () => {
    await putBindingRow('u-a', 'p-1', bindingRow('u-a'));
    await putBindingRow('u-a', 'p-2', bindingRow('u-a', 2));
    await putBindingRow('u-b', 'p-1', bindingRow('u-b'));

    await deleteBindingRowsForUid('u-a');

    expect((await rawKeys('bindings'))).toEqual(['u-b\u0000p-1']);
    expect(await getBindingRow('u-b', 'p-1')).toEqual(bindingRow('u-b'));
    expect(await getBindingRow('u-a', 'p-1')).toBeNull();
    expect(await getBindingRow('u-a', 'p-2')).toBeNull();
  });

  it('deleteNameRowsForUid / deleteBindingRowsForUid 无匹配行时零动作（幂等）', async () => {
    const b1 = buildYjsDbName('u-b', 'p-1', 2, 1, 'h-2026-10-24-a');
    await putNameRow(b1, nameRow('u-b', 'p-1'));
    await putBindingRow('u-b', 'p-1', bindingRow('u-b'));

    await deleteNameRowsForUid('u-a');
    await deleteBindingRowsForUid('u-a');

    expect((await listNameRows()).map((row) => row.dbName)).toEqual([b1]);
    expect(await rawKeys('bindings')).toEqual(['u-b\u0000p-1']);
  });
});

describe('snapshotFromUser：十字段白名单', () => {
  it('输入整行 Prisma User（含 openid/unionid/token）→ 输出恰十字段、敏感字段不在场', () => {
    const prismaUser: Record<string, unknown> = {
      id: 'u-a',
      name: '用户A',
      email: 'a@example.com',
      emailVerified: true,
      role: 'USER',
      image: 'https://cdn.example.com/avatar.png',
      phoneNumber: '+8613800000000',
      phoneNumberVerified: true,
      wechatOpenid: 'openid-secret',
      wechatUnionid: 'unionid-secret',
      createdAt: '2026-01-02T03:04:05.000Z',
      updatedAt: '2026-02-03T04:05:06.000Z',
      token: 'session-token-secret',
      accounts: [{ accessToken: 'access-secret', refreshToken: 'refresh-secret' }],
    };
    const snapshot = snapshotFromUser(prismaUser);

    expect(Object.keys(snapshot).sort()).toEqual([
      'createdAt', 'email', 'emailVerified', 'id', 'image',
      'name', 'phoneNumber', 'phoneNumberVerified', 'role', 'updatedAt',
    ]);
    expect(snapshot).toEqual({
      id: 'u-a',
      name: '用户A',
      email: 'a@example.com',
      image: 'https://cdn.example.com/avatar.png',
      emailVerified: true,
      role: 'USER',
      phoneNumber: '+8613800000000',
      phoneNumberVerified: true,
      createdAt: '2026-01-02T03:04:05.000Z',
      updatedAt: '2026-02-03T04:05:06.000Z',
    });
    const persisted = JSON.stringify(snapshot);
    expect(persisted).not.toContain('openid');
    expect(persisted).not.toContain('unionid');
    expect(persisted).not.toContain('secret');
  });

  it('Prisma 可空字段缺席归一为 null（image/phoneNumber）', () => {
    const snapshot = snapshotFromUser({
      id: 'u-b',
      name: '用户B',
      email: 'b@example.com',
      emailVerified: false,
      role: 'ADMIN',
      phoneNumberVerified: false,
      createdAt: '2026-01-02T03:04:05.000Z',
      updatedAt: '2026-02-03T04:05:06.000Z',
    });
    expect(snapshot.image).toBeNull();
    expect(snapshot.phoneNumber).toBeNull();
    expect(snapshot.emailVerified).toBe(false);
    expect(snapshot.phoneNumberVerified).toBe(false);
  });
});
