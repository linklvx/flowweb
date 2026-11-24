// apps/web/src/collab/local-session-proof.spec.ts
// Y5 T6：客户端证明模块单测——/me 单函数（epoch 快照/suppressed 复读/双时间戳硬性/
// 单活行写点）+跨标签登出 epoch+suppressed 键。
// 装置=fake-indexeddb/auto（真事务语义；与 T3 spec 同款）+ mock fetch（逐用例钉响应形态）。
// 断言锚：验收 15 时钟差腿、23/A8 在途代次、27 storage 事件、28 suppressed、29 单活行。
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getSessionRows, openMetaDb, putSessionRow,
  type SessionRow, type UserSnapshot,
} from './local-yjs-store';
import {
  bindLogoutEpochTeardown, bumpAuthEpoch, clearSessionRows, fetchMeWithProof,
  readAuthEpoch, readAuthSuppressed, setAuthSuppressed,
} from './local-session-proof';

const EPOCH_KEY = 'flowweb:auth-epoch';
const SUPPRESSED_KEY = 'flowweb:auth-suppressed';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

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

const USER_A: Record<string, unknown> = {
  ...SNAPSHOT,
  wechatOpenid: 'openid-a',   // 白名单外——断言不落盘
};
const USER_B: Record<string, unknown> = {
  ...USER_A,
  id: 'u-b',
  name: '用户B',
  email: 'b@example.com',
  wechatOpenid: 'openid-b',
};

function sessionRow(uid: string, localDeadline = 1_700_000_000_000): SessionRow {
  return { uid, localDeadline, userSnapshot: { ...SNAPSHOT, id: uid } };
}

/** 最小 Response 形状：实现只消费 status/json（不引入真实 fetch 环境依赖）。 */
function jsonResponse(body: unknown, status = 200): Response {
  return { status, json: () => Promise.resolve(body) } as unknown as Response;
}

/** 逐次响应 mock：Response 走 resolve，Error 走 reject（无 status 腿）。 */
function stubFetch(...responses: Array<Response | Error>) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    if (response instanceof Error) fetchMock.mockRejectedValueOnce(response);
    else fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** 头已到、body 迟到形态：called 在 json() 被调用（=头代次检查已过）后 resolve，
 *  resolveBody 由用例控制 body 落地时机（A8 body 窗用例）。 */
function deferredJsonResponse(status = 200) {
  let resolveBody!: (body: unknown) => void;
  let markCalled!: () => void;
  const called = new Promise<void>((resolve) => { markCalled = resolve; });
  const body = new Promise<unknown>((resolve) => { resolveBody = resolve; });
  const response = {
    status,
    json: () => { markCalled(); return body; },
  } as unknown as Response;
  return { response, called, resolveBody };
}

async function clearSessionStore(): Promise<void> {
  const db = await openMetaDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('session', 'readwrite');
      tx.objectStore('session').clear();
      tx.oncomplete = () => { resolve(); };
      tx.onerror = () => { reject(tx.error ?? new Error('session clear failed')); };
      tx.onabort = () => { reject(tx.error ?? new Error('session clear aborted')); };
    });
  } finally {
    db.close();
  }
}

/** 绕 API 直写 session 表（多行歧义形态的前置——单活行由 putSessionRow 收敛）。 */
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
  localStorage.clear();
  await clearSessionStore();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('epoch 键（localStorage flowweb:auth-epoch）', () => {
  it('缺省/非法 → 0；bump 递增并写回', () => {
    expect(readAuthEpoch()).toBe(0);
    localStorage.setItem(EPOCH_KEY, 'abc');
    expect(readAuthEpoch()).toBe(0);
    localStorage.setItem(EPOCH_KEY, '2.5');
    expect(readAuthEpoch()).toBe(0);
    localStorage.setItem(EPOCH_KEY, '7');
    expect(bumpAuthEpoch()).toBe(8);
    expect(localStorage.getItem(EPOCH_KEY)).toBe('8');
  });
});

describe('suppressed 键（localStorage flowweb:auth-suppressed）', () => {
  it('缺省 false；true/false 往返', () => {
    expect(readAuthSuppressed()).toBe(false);
    setAuthSuppressed(true);
    expect(readAuthSuppressed()).toBe(true);
    expect(localStorage.getItem(SUPPRESSED_KEY)).toBe('1');
    setAuthSuppressed(false);
    expect(readAuthSuppressed()).toBe(false);
    expect(localStorage.getItem(SUPPRESSED_KEY)).not.toBe('1');
  });
});

describe('fetchMeWithProof：200 带 user 的证明写点', () => {
  it('双时间戳齐全 → localDeadline=now+(sessionExpiresAt−serverNow)，2h 时钟差不影响剩余寿命（验收 15）', async () => {
    const serverNow = Date.now() - 2 * HOUR;          // 服务器钟落后本机 2h（客户端/服务器偏差）
    const sessionExpiresAt = serverNow + 7 * DAY;     // 服务器侧剩余寿命恰 7d
    const fetchMock = stubFetch(jsonResponse({ user: USER_A, sessionExpiresAt, serverNow }));
    const before = Date.now();
    const result = await fetchMeWithProof();
    const after = Date.now();

    expect(result).toEqual({ ok: true, user: USER_A });
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', { credentials: 'include' });
    const rows = await getSessionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].uid).toBe('u-a');
    // 证明长度=服务器剩余寿命，与时钟差无关（禁存服务器绝对时间）
    expect(rows[0].localDeadline).toBeGreaterThanOrEqual(before + 7 * DAY);
    expect(rows[0].localDeadline).toBeLessThanOrEqual(after + 7 * DAY);
    // 落盘=十字段白名单快照，openid 不入库
    expect(rows[0].userSnapshot).toMatchObject({
      id: 'u-a', name: '用户A', email: 'a@example.com', role: 'USER',
    });
    expect(rows[0].userSnapshot).not.toHaveProperty('wechatOpenid');
  });

  it('预置 uid A 行后写 uid B 行 → 只剩 B（单活行，验收 29）', async () => {
    await putSessionRow(sessionRow('u-a'));
    const serverNow = Date.now();
    stubFetch(jsonResponse({ user: USER_B, sessionExpiresAt: serverNow + 7 * DAY, serverNow }));
    expect(await fetchMeWithProof()).toEqual({ ok: true, user: USER_B });
    expect((await getSessionRows()).map((row) => row.uid)).toEqual(['u-b']);
  });

  it('缺 serverNow / 缺 sessionExpiresAt / 非数字 → 不改证明（行集不变）', async () => {
    await putSessionRow(sessionRow('u-a'));
    const serverNow = Date.now();
    const sessionExpiresAt = serverNow + 7 * DAY;
    stubFetch(
      jsonResponse({ user: USER_B, sessionExpiresAt }),
      jsonResponse({ user: USER_B, serverNow }),
      jsonResponse({ user: USER_B, sessionExpiresAt: String(sessionExpiresAt), serverNow }),
    );
    for (let i = 0; i < 3; i += 1) {
      expect(await fetchMeWithProof()).toEqual({ ok: true, user: USER_B });
    }
    expect(await getSessionRows()).toEqual([sessionRow('u-a')]);
  });

  it('差值 ≤ 0 → 删全表行（他 uid 旧行一并清），返回 ok', async () => {
    await seedSessionRowsRaw([sessionRow('u-a'), sessionRow('u-b')]);
    const serverNow = Date.now();
    stubFetch(jsonResponse({ user: USER_A, sessionExpiresAt: serverNow, serverNow }));
    expect(await fetchMeWithProof()).toEqual({ ok: true, user: USER_A });
    expect(await getSessionRows()).toEqual([]);
  });
});

describe('fetchMeWithProof：会话死亡信号删行', () => {
  it('200 + user:null → 删行返回 null-user', async () => {
    await putSessionRow(sessionRow('u-a'));
    stubFetch(jsonResponse({ user: null }));
    expect(await fetchMeWithProof()).toEqual({ ok: false, reason: 'null-user' });
    expect(await getSessionRows()).toEqual([]);
  });

  it('HTTP 401 → 删行返回 http-401', async () => {
    await putSessionRow(sessionRow('u-a'));
    stubFetch(jsonResponse({}, 401));
    expect(await fetchMeWithProof()).toEqual({ ok: false, reason: 'http-401' });
    expect(await getSessionRows()).toEqual([]);
  });

  it('401 头检查之后、删除之前 epoch 变化 → 不删行，返回 transient（A8 统一判据）', async () => {
    await putSessionRow(sessionRow('u-a'));
    // 驱动器：首次读 status（进入 401 分支判断）即 bump epoch——模拟他标签登出/登录落在
    // 头检查与删除动作之间（删除前复验必须看见它）
    let statusReads = 0;
    const response = {
      get status() {
        statusReads += 1;
        if (statusReads === 1) bumpAuthEpoch();
        return 401;
      },
      json: () => Promise.resolve({}),
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    expect(await fetchMeWithProof()).toEqual({ ok: false, reason: 'transient' });
    expect(await getSessionRows()).toEqual([sessionRow('u-a')]);
  });
});

describe('fetchMeWithProof：transient 不动行（Task 7 离线放行判据）', () => {
  it.each([408, 429, 500, 503])('HTTP %i → 行不动，返回 transient', async (status) => {
    await putSessionRow(sessionRow('u-a'));
    stubFetch(jsonResponse({}, status));
    expect(await fetchMeWithProof()).toEqual({ ok: false, reason: 'transient' });
    expect(await getSessionRows()).toEqual([sessionRow('u-a')]);
  });

  it('fetch 抛错（无 status）→ 行不动，返回 transient', async () => {
    await putSessionRow(sessionRow('u-a'));
    stubFetch(new TypeError('Failed to fetch'));
    expect(await fetchMeWithProof()).toEqual({ ok: false, reason: 'transient' });
    expect(await getSessionRows()).toEqual([sessionRow('u-a')]);
  });

  it.each([403, 404])('HTTP %i → 行不动，返回 transient（项目级路由归 T9）', async (status) => {
    await putSessionRow(sessionRow('u-a'));
    stubFetch(jsonResponse({}, status));
    expect(await fetchMeWithProof()).toEqual({ ok: false, reason: 'transient' });
    expect(await getSessionRows()).toEqual([sessionRow('u-a')]);
  });
});

describe('fetchMeWithProof：在途代次竞态（验收 23 / A8）', () => {
  it('发出后 bump epoch 再响应 → 响应整体丢弃（不写不删），返回 transient', async () => {
    localStorage.setItem(EPOCH_KEY, '1');
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchMeWithProof();
    expect(fetchMock).toHaveBeenCalledTimes(1);   // 发出即取 epoch 快照（同步段）
    expect(bumpAuthEpoch()).toBe(2);

    const serverNow = Date.now();
    resolveFetch(jsonResponse({ user: USER_A, sessionExpiresAt: serverNow + 7 * DAY, serverNow }));
    expect(await pending).toEqual({ ok: false, reason: 'transient' });
    expect(await getSessionRows()).toEqual([]);
  });

  it('body 迟到窗：头到后 bump epoch、body 才落地 200+user → 不写行，返回 transient', async () => {
    localStorage.setItem(EPOCH_KEY, '1');
    const deferred = deferredJsonResponse();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(deferred.response));

    const pending = fetchMeWithProof();
    await deferred.called;                       // 头代次检查已过，json() 挂起
    expect(bumpAuthEpoch()).toBe(2);

    const serverNow = Date.now();
    deferred.resolveBody({ user: USER_A, sessionExpiresAt: serverNow + 7 * DAY, serverNow });
    expect(await pending).toEqual({ ok: false, reason: 'transient' });
    expect(await getSessionRows()).toEqual([]);
  });

  it('body 迟到窗：头到后 bump epoch、body 才落地 200+null → 不删已有行，返回 transient', async () => {
    localStorage.setItem(EPOCH_KEY, '1');
    await putSessionRow(sessionRow('u-a'));
    const deferred = deferredJsonResponse();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(deferred.response));

    const pending = fetchMeWithProof();
    await deferred.called;
    expect(bumpAuthEpoch()).toBe(2);

    deferred.resolveBody({ user: null });
    expect(await pending).toEqual({ ok: false, reason: 'transient' });
    expect(await getSessionRows()).toEqual([sessionRow('u-a')]);
  });
});

describe('fetchMeWithProof：suppressed 键挡写（验收 28）', () => {
  it('suppressed=1 时 200+user 不写行也不删已有行，返回 ok:user', async () => {
    await putSessionRow(sessionRow('u-a'));
    setAuthSuppressed(true);
    const serverNow = Date.now();
    stubFetch(jsonResponse({ user: USER_B, sessionExpiresAt: serverNow + 7 * DAY, serverNow }));
    expect(await fetchMeWithProof()).toEqual({ ok: true, user: USER_B });
    expect(await getSessionRows()).toEqual([sessionRow('u-a')]);
  });
});

describe('fetchMeWithProof：证明写失败不降级为登出（T7 评审 I3a）', () => {
  it('putSessionRow reject ⇒ 返回 {ok:true,user} 不抛；不写行', async () => {
    // 写失败形态：session 表对象 store 不存在 → runMetaTx 同步抛错（等价 quota/IDB 不可用）
    const realTransaction = IDBDatabase.prototype.transaction;
    const spy = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
      this: IDBDatabase, storeNames: string | string[], mode?: IDBTransactionMode,
    ) {
      if (String(storeNames) === 'session') throw new Error('idb unavailable');
      return realTransaction.call(this, storeNames, mode);
    } as typeof IDBDatabase.prototype.transaction);

    try {
      const serverNow = Date.now();
      stubFetch(jsonResponse({ user: USER_A, sessionExpiresAt: serverNow + 7 * DAY, serverNow }));
      // 服务器已确认用户 ⇒ 本地写失败不得把用户判成未登录
      expect(await fetchMeWithProof()).toEqual({ ok: true, user: USER_A });
    } finally {
      spy.mockRestore();
    }
    expect(await getSessionRows()).toEqual([]);
  });
});

describe('clearSessionRows：登出清整张 session 表（T7 评审 I5）', () => {
  it('两行（不同 uid）→ 全清；无行时幂等', async () => {
    await seedSessionRowsRaw([sessionRow('u-a'), sessionRow('u-b')]);
    expect((await getSessionRows()).length).toBe(2);

    await clearSessionRows();
    expect(await getSessionRows()).toEqual([]);

    await clearSessionRows();
    expect(await getSessionRows()).toEqual([]);
  });
});

describe('bindLogoutEpochTeardown：storage 事件（验收 27）', () => {
  it('key=flowweb:auth-epoch 触发回调；其他 key 忽略；解绑后不再回调', () => {
    const onChange = vi.fn();
    const unbind = bindLogoutEpochTeardown(onChange);

    window.dispatchEvent(new StorageEvent('storage', { key: 'other-key' }));
    expect(onChange).not.toHaveBeenCalled();

    window.dispatchEvent(new StorageEvent('storage', { key: EPOCH_KEY, newValue: '2' }));
    expect(onChange).toHaveBeenCalledTimes(1);

    unbind();
    window.dispatchEvent(new StorageEvent('storage', { key: EPOCH_KEY, newValue: '3' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('session 表多行可达形态（T7 fail-closed 前置）', () => {
  it('绕 API 直写两行后 getSessionRows 返回 >1（本模块不做路由决定）', async () => {
    await seedSessionRowsRaw([sessionRow('u-a'), sessionRow('u-b')]);
    expect((await getSessionRows()).length).toBeGreaterThan(1);
  });
});
