// apps/web/src/components/AuthProvider.y5.spec.tsx
// Y5 T7：AuthProvider 接线——离线放行腿（C1）、登出同步段（C2）、?auth=landed 清除点、
// 他标签 storage 拆会话、探活改调证明函数、三登录入口清键。
// 装置：fake-indexeddb/auto（真事务语义，与 T6 spec 同款）+ mock fetch；证明模块用
// importOriginal 包一层 vi.fn(actual)——断言调用次序的同时仍走真实时序（验收 28/29）。
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';

// 捕获真实实现：mockReset 后 beforeEach 重新挂回（避免 Once 队列/实现泄漏到后续用例）
const proofActual = vi.hoisted(() => ({
  fetchMeWithProof: undefined as unknown as () => Promise<unknown>,
  setAuthSuppressed: undefined as unknown as (v: boolean) => void,
}));

vi.mock('@/collab/local-session-proof', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/collab/local-session-proof')>();
  proofActual.fetchMeWithProof = actual.fetchMeWithProof;
  proofActual.setAuthSuppressed = actual.setAuthSuppressed;
  return {
    ...actual,
    fetchMeWithProof: vi.fn(actual.fetchMeWithProof),
    setAuthSuppressed: vi.fn(actual.setAuthSuppressed),
  };
});

import { AuthProvider, useAuth } from './AuthProvider';
import {
  fetchMeWithProof, readAuthEpoch, readAuthSuppressed, setAuthSuppressed,
} from '@/collab/local-session-proof';
import {
  buildYjsDbName, getSessionRows, listNameRows, openMetaDb, putBindingRow, putNameRow,
  putSessionRow, type BindingRow, type NameRow, type SessionRow, type UserSnapshot,
} from '@/collab/local-yjs-store';
import { registerCollabSessionTeardown } from '@/collab/auth-teardown-registry';
import { SESSION_KEEPALIVE_MS, useSessionKeepalive } from '@/hooks/useSessionKeepalive';
import { PhoneLoginForm } from './auth/PhoneLoginForm';
import { AuthModal } from './AuthModal';

const EPOCH_KEY = 'flowweb:auth-epoch';
const SUPPRESSED_KEY = 'flowweb:auth-suppressed';
const HOUR = 60 * 60 * 1000;

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

const USER_A: Record<string, unknown> = { ...SNAPSHOT };

function sessionRow(uid: string, localDeadline = Date.now() + HOUR): SessionRow {
  return { uid, localDeadline, userSnapshot: { ...SNAPSHOT, id: uid } };
}

/** 最小 Response 形状：证明函数只消费 status/json，登录组件另消费 ok。 */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** /me 200 带 user + 双时间戳（证明可写行）。 */
function meOk(user: Record<string, unknown> = USER_A): Response {
  const serverNow = Date.now();
  return jsonResponse({ user, sessionExpiresAt: serverNow + 7 * HOUR, serverNow });
}

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function installFetch(handler: FetchHandler) {
  const fetchMock = vi.fn((input: any, init?: any) => Promise.resolve(handler(String(input), init)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

/** 绕 API 直写多行（单活行 API 不可达形态——验收 29 歧义腿前置）。 */
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

/** 清 meta 三表（跨用例隔离——登出用例会写 names/bindings 行）。 */
async function clearMetaStores(): Promise<void> {
  const db = await openMetaDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['names', 'session', 'bindings'], 'readwrite');
      for (const name of ['names', 'session', 'bindings']) tx.objectStore(name).clear();
      tx.oncomplete = () => { resolve(); };
      tx.onerror = () => { reject(tx.error ?? new Error('meta clear failed')); };
      tx.onabort = () => { reject(tx.error ?? new Error('meta clear aborted')); };
    });
  } finally {
    db.close();
  }
}

/** 直读 bindings 键（断言该 uid 行已清——getBindingRow 逐键太窄）。 */
async function rawBindingKeys(): Promise<IDBValidKey[]> {
  const db = await openMetaDb();
  try {
    return await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction('bindings', 'readonly');
      const req = tx.objectStore('bindings').getAllKeys();
      let keys: IDBValidKey[] = [];
      req.onsuccess = () => { keys = req.result; };
      tx.oncomplete = () => { resolve(keys); };
      tx.onerror = () => { reject(tx.error ?? new Error('binding keys read failed')); };
      tx.onabort = () => { reject(tx.error ?? new Error('binding keys read aborted')); };
    });
  } finally {
    db.close();
  }
}

function AuthProbe({ onLogoutSettled }: { onLogoutSettled?: (outcome: 'resolved' | 'rejected') => void } = {}) {
  const { user, loading, logout } = useAuth();
  return (
    <div>
      <span data-testid="uid">{user?.id ?? 'none'}</span>
      <span data-testid="loading">{loading ? '1' : '0'}</span>
      <button
        type="button"
        onClick={() => {
          const settled = logout();
          if (onLogoutSettled) {
            void settled.then(() => onLogoutSettled('resolved'), () => onLogoutSettled('rejected'));
          }
        }}
      >
        logout
      </button>
    </div>
  );
}

function renderProvider(
  extra?: ReactNode,
  onLogoutSettled?: (outcome: 'resolved' | 'rejected') => void,
) {
  return render(
    <AuthProvider>
      <AuthProbe onLogoutSettled={onLogoutSettled} />
      {extra}
    </AuthProvider>,
  );
}

async function expectUid(id: string): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('uid')).toHaveTextContent(id));
}

function suppressedCalls(): boolean[] {
  return vi.mocked(setAuthSuppressed).mock.calls.map(([v]) => v);
}

function lastOrder(fn: { mock: { invocationCallOrder: number[] } }): number {
  return fn.mock.invocationCallOrder[fn.mock.invocationCallOrder.length - 1];
}

beforeAll(() => {
  // AntD Modal 的 useScrollLocker 在 jsdom 下带伪元素查询 getComputedStyle
  const original = window.getComputedStyle;
  window.getComputedStyle = ((elt: Element, pseudoElt?: string | null) => {
    if (pseudoElt) return { getPropertyValue: () => '', length: 0 } as unknown as CSSStyleDeclaration;
    return original.call(window, elt);
  }) as typeof window.getComputedStyle;
});

beforeEach(async () => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  await clearMetaStores();
  vi.mocked(fetchMeWithProof).mockReset();
  vi.mocked(setAuthSuppressed).mockReset();
  vi.mocked(fetchMeWithProof).mockImplementation(
    proofActual.fetchMeWithProof as unknown as typeof fetchMeWithProof,
  );
  vi.mocked(setAuthSuppressed).mockImplementation(proofActual.setAuthSuppressed);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('C1 离线放行腿（验收 11 前半）', () => {
  it('transient + 恰好一行未过期证明 → user=行快照、loading=false', async () => {
    await putSessionRow(sessionRow('u-a', Date.now() + HOUR));
    installFetch(() => Promise.reject(new TypeError('Failed to fetch')));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('0'));
    expect(screen.getByTestId('uid')).toHaveTextContent('u-a');
  });

  it.each([
    ['200+null-user', () => jsonResponse({ user: null })],
    ['HTTP 401', () => jsonResponse({}, 401)],
  ])('%s → user=null、loading=false', async (_label, response) => {
    installFetch(() => response());
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('0'));
    expect(screen.getByTestId('uid')).toHaveTextContent('none');
  });

  it('证明已过期（transient）→ user=null', async () => {
    await putSessionRow(sessionRow('u-a', Date.now() - 1_000));
    installFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('0'));
    expect(screen.getByTestId('uid')).toHaveTextContent('none');
  });

  it('多行歧义（transient）→ user=null（验收 29 歧义腿）', async () => {
    await seedSessionRowsRaw([sessionRow('u-a'), sessionRow('u-b')]);
    installFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('0'));
    expect(screen.getByTestId('uid')).toHaveTextContent('none');
  });

  it('I2：suppressed=1 + 恰好一行未过期 + transient ⇒ user=null（已观测登出的标签不得复活用户）', async () => {
    await putSessionRow(sessionRow('u-a', Date.now() + HOUR));
    localStorage.setItem(SUPPRESSED_KEY, '1');
    installFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('0'));
    expect(screen.getByTestId('uid')).toHaveTextContent('none');
  });

  it('I3b：证明函数抛错 + 无行 ⇒ user=null、无未处理拒绝', async () => {
    installFetch(() => meOk());   // 真实 fetch 不参与——证明函数被 mock 成抛错
    vi.mocked(fetchMeWithProof).mockRejectedValue(new Error('meta write exploded'));
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('0'));
    expect(screen.getByTestId('uid')).toHaveTextContent('none');
    // test-setup 的 unhandledRejection 守卫覆盖「无未处理拒绝」断言
  });

  it('I3b：证明函数抛错 + 恰好一行未过期 ⇒ 走离线放行腿（不当作 auth 否认）', async () => {
    await putSessionRow(sessionRow('u-a', Date.now() + HOUR));
    installFetch(() => meOk());
    vi.mocked(fetchMeWithProof).mockRejectedValue(new Error('meta write exploded'));
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('0'));
    expect(screen.getByTestId('uid')).toHaveTextContent('u-a');
  });
});

describe('C2 登出同步段（验收 28/29）', () => {
  it('登出 await 窗内的 /me 200+user 不得写回 session 行；登出后行不存在（I4：行内容逐字节不变）', async () => {
    const signOut = deferred<Response>();
    installFetch((url) => {
      if (url.includes('/api/auth/sign-out')) return signOut.promise;
      return meOk();
    });

    renderProvider();
    await expectUid('u-a');
    const rowsBefore = await getSessionRows();
    expect(rowsBefore).toHaveLength(1);
    // I4：证明行身份锚（deadline + 快照）——仅断 uid 无法区分「未被改写」与「被重写成新期」
    const deadlineBefore = rowsBefore[0].localDeadline;
    const snapshotBefore = JSON.stringify(rowsBefore[0].userSnapshot);

    act(() => { screen.getByText('logout').click(); });
    await waitFor(() => expect(readAuthSuppressed()).toBe(true));
    expect(readAuthEpoch()).toBeGreaterThan(0);
    // 窗内新发出的 /me（探活形态）收 200+user：suppressed=1 → 只返回 ok，不写行
    const duringWindow = await fetchMeWithProof();
    expect(duringWindow).toEqual({ ok: true, user: USER_A });
    const rowsDuring = await getSessionRows();
    expect(rowsDuring).toHaveLength(1);
    expect(rowsDuring[0].uid).toBe('u-a');
    expect(rowsDuring[0].localDeadline).toBe(deadlineBefore);
    expect(JSON.stringify(rowsDuring[0].userSnapshot)).toBe(snapshotBefore);

    await act(async () => { signOut.resolve(jsonResponse({})); });
    await expectUid('none');
    // ③ 只清用户态；④ 三表清理在其后再落——等表空（清表内部先读后删，多一拍）
    await waitFor(async () => expect(await getSessionRows()).toEqual([]));
  });

  it('I1：sign-out fetch reject ⇒ logout resolve、user 清空、三表清空、suppressed 保持 1', async () => {
    const outcomes: Array<'resolved' | 'rejected'> = [];
    installFetch((url) => {
      if (url.includes('/api/auth/sign-out')) return Promise.reject(new TypeError('Failed to fetch'));
      return meOk();
    });

    renderProvider(undefined, (outcome) => outcomes.push(outcome));
    await expectUid('u-a');

    const dbNameA = buildYjsDbName('u-a', 'p-1', 2, 1, 'h-2026-10-24-a');
    await putNameRow(dbNameA, {
      uid: 'u-a', pid: 'p-1', generation: 2, schemaVersion: 1,
      historyToken: 'h-2026-10-24-a', hold: true,
    });
    await putBindingRow('u-a', 'p-1', {
      uid: 'u-a', generation: 1, schemaVersion: 1,
      historyToken: 'h-2026-10-24-a', name: '项目-u-a', teamId: null,
    });

    await act(async () => { screen.getByText('logout').click(); });
    await expectUid('none');
    await waitFor(() => expect(outcomes).toEqual(['resolved']));

    expect(await getSessionRows()).toEqual([]);
    expect(await listNameRows()).toEqual([]);
    expect(await rawBindingKeys()).toEqual([]);
    // suppressed 保持 1 是有意行为（清键只属三登录入口）
    expect(localStorage.getItem(SUPPRESSED_KEY)).toBe('1');
  });

  it('I5：登出清空整张 session 表——他 uid 的旧行不得残留', async () => {
    installFetch((url) => (url.includes('/api/auth/sign-out') ? jsonResponse({}) : meOk()));
    renderProvider();
    await expectUid('u-a');
    // 直写两行绕过单活行不变量（模拟跨账号遗留：换号后前 uid 的旧行仍在）
    await seedSessionRowsRaw([sessionRow('u-a'), sessionRow('u-b')]);
    expect((await getSessionRows()).length).toBe(2);   // 前置：表内确有他 uid 行

    await act(async () => { screen.getByText('logout').click(); });
    await expectUid('none');

    await waitFor(async () => expect(await getSessionRows()).toEqual([]));
  });

  it('①②之间零 await：sign-out 未 resolve 前 epoch 已 +1 且 suppressed=1', async () => {
    const signOut = deferred<Response>();
    const fetchMock = installFetch((url) => {
      if (url.includes('/api/auth/sign-out')) return signOut.promise;
      return meOk();
    });

    renderProvider();
    await expectUid('u-a');
    expect(readAuthEpoch()).toBe(0);

    act(() => { screen.getByText('logout').click(); });
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/auth/sign-out'))).toBe(true);
    });
    // fetch 已发出但未 resolve——同步段状态必须已就位
    expect(readAuthEpoch()).toBe(1);
    expect(readAuthSuppressed()).toBe(true);
    // ③ 尚未执行（setUser(null) 在 await 之后）
    expect(screen.getByTestId('uid')).toHaveTextContent('u-a');

    await act(async () => { signOut.resolve(jsonResponse({})); });
    await expectUid('none');
    await waitFor(async () => expect(await getSessionRows()).toEqual([]));
  });

  it('登出清三表（§0.6）：session 行空 + 本 uid names/bindings 行全空、他 uid 行保留', async () => {
    installFetch((url) => (url.includes('/api/auth/sign-out') ? jsonResponse({}) : meOk()));
    renderProvider();
    await expectUid('u-a');

    // 预置：本 uid 两 names 行 + 两 bindings 行；他 uid 各一行（登出不得波及）
    const dbNameA1 = buildYjsDbName('u-a', 'p-1', 2, 1, 'h-2026-10-24-a');
    const dbNameA2 = buildYjsDbName('u-a', 'p-2', 2, 1, 'h-2026-10-24-a');
    const dbNameB = buildYjsDbName('u-b', 'p-1', 2, 1, 'h-2026-10-24-a');
    const nameRow = (uid: string, pid: string): NameRow => ({
      uid, pid, generation: 2, schemaVersion: 1, historyToken: 'h-2026-10-24-a', hold: true,
    });
    const bindingRow = (uid: string): BindingRow => ({
      uid, generation: 1, schemaVersion: 1, historyToken: 'h-2026-10-24-a', name: `项目-${uid}`, teamId: null,
    });
    await putNameRow(dbNameA1, nameRow('u-a', 'p-1'));
    await putNameRow(dbNameA2, nameRow('u-a', 'p-2'));
    await putNameRow(dbNameB, nameRow('u-b', 'p-1'));
    await putBindingRow('u-a', 'p-1', bindingRow('u-a'));
    await putBindingRow('u-a', 'p-2', bindingRow('u-a'));
    await putBindingRow('u-b', 'p-1', bindingRow('u-b'));
    expect((await getSessionRows()).map((row) => row.uid)).toEqual(['u-a']);

    await act(async () => { screen.getByText('logout').click(); });
    await expectUid('none');

    // 三表：session 空；names/bindings 只剩他 uid 行（清表内部先读后删，等收敛）
    await waitFor(async () => {
      expect(await getSessionRows()).toEqual([]);
      expect((await listNameRows()).map((row) => row.dbName)).toEqual([dbNameB]);
      expect(await rawBindingKeys()).toEqual(['u-b\u0000p-1']);
    });
  });

  it('他标签整页刷新在途时登出：迟到 200+user 不复活行（epoch 丢弃）', async () => {
    let meCalls = 0;
    const lateMe = deferred<Response>();
    installFetch((url) => {
      if (url.includes('/api/auth/me')) {
        meCalls += 1;
        return meCalls === 1 ? meOk() : lateMe.promise;
      }
      return jsonResponse({});
    });

    renderProvider();
    await expectUid('u-a');
    expect((await getSessionRows()).map((row) => row.uid)).toEqual(['u-a']);

    // 他标签在途 /me（本标签同源 epoch 快照）
    const otherTabRefresh = fetchMeWithProof();
    await waitFor(() => expect(meCalls).toBe(2));

    act(() => { screen.getByText('logout').click(); });
    await expectUid('none');
    await waitFor(async () => expect(await getSessionRows()).toEqual([]));

    // 他标签的 200 迟到 → 代次不符整体丢弃，不写行
    lateMe.resolve(meOk());
    expect(await otherTabRefresh).toEqual({ ok: false, reason: 'transient' });
    expect(await getSessionRows()).toEqual([]);
  });
});

describe('?auth=landed 清除点', () => {
  it('先 setAuthSuppressed(false) 再 fetchMeWithProof，并去掉查询参数', async () => {
    window.history.replaceState(null, '', '/canvas?auth=landed');
    localStorage.setItem(SUPPRESSED_KEY, '1');
    installFetch(() => meOk());

    renderProvider();
    await expectUid('u-a');
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('0'));

    expect(readAuthSuppressed()).toBe(false);
    expect(window.location.pathname).toBe('/canvas');
    expect(window.location.search).toBe('');
    expect(suppressedCalls()).toContain(false);
    // 清键先于证明调用（证明写点看到 suppressed=false → 行已落盘）
    expect(lastOrder(vi.mocked(setAuthSuppressed))).toBeLessThan(lastOrder(vi.mocked(fetchMeWithProof)));
    expect((await getSessionRows()).map((row) => row.uid)).toEqual(['u-a']);
  });

  it('普通挂载（无 auth=landed）在 suppressed=1 时不清键、不写 session 行', async () => {
    localStorage.setItem(SUPPRESSED_KEY, '1');
    installFetch(() => meOk());

    renderProvider();
    await expectUid('u-a');
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('0'));

    expect(localStorage.getItem(SUPPRESSED_KEY)).toBe('1');
    expect(suppressedCalls()).not.toContain(false);
    expect(await getSessionRows()).toEqual([]);
  });
});

describe('他标签登出：storage 监听（验收 27）', () => {
  it('epoch storage 事件 → setUser(null) 且调用画布注册的拆会话回调', async () => {
    installFetch(() => meOk());
    renderProvider();
    await expectUid('u-a');

    const teardown = vi.fn();
    const unregister = registerCollabSessionTeardown(teardown);

    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: EPOCH_KEY, newValue: '9' }));
    });

    expect(teardown).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('uid')).toHaveTextContent('none');
    unregister();
  });
});

describe('探活改调证明函数（约束⑧）', () => {
  it('15min 触发 fetchMeWithProof；reject 仍被吞（fire-and-forget）', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    vi.mocked(fetchMeWithProof).mockClear();

    const { unmount } = renderHook(() => useSessionKeepalive());

    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_MS);
    expect(vi.mocked(fetchMeWithProof)).toHaveBeenCalledTimes(1);

    vi.mocked(fetchMeWithProof).mockRejectedValueOnce(new Error('network down'));
    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_MS);
    // 到达此处且无未处理拒绝（test-setup 守卫）即通过

    unmount();
  });
});

describe('三登录入口先清 suppressed（C2 登录侧）', () => {
  function expectClearBeforeRefresh(): void {
    expect(suppressedCalls()).toContain(false);
    expect(lastOrder(vi.mocked(setAuthSuppressed))).toBeLessThan(
      lastOrder(vi.mocked(fetchMeWithProof)),
    );
  }

  it('PhoneLoginForm 成功 → setAuthSuppressed(false) 先于 refresh', async () => {
    installFetch((url) => {
      if (url.includes('/api/auth/phone-login')) return jsonResponse({ user: USER_A });
      return meOk();
    });
    const onSuccess = vi.fn();
    renderProvider(<PhoneLoginForm onLoginSuccess={onSuccess} />);
    await expectUid('u-a');

    vi.mocked(setAuthSuppressed).mockClear();
    vi.mocked(fetchMeWithProof).mockClear();
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } });
    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '123456' } });
    await act(async () => { screen.getByLabelText('登录/注册').click(); });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expectClearBeforeRefresh();
  });

  it('AuthModal 登录成功 → setAuthSuppressed(false) 先于 refresh', async () => {
    installFetch((url) => {
      if (url.includes('/api/auth/sign-in')) return jsonResponse({ user: USER_A });
      return meOk();
    });
    const onClose = vi.fn();
    renderProvider(<AuthModal onClose={onClose} />);
    await expectUid('u-a');

    vi.mocked(setAuthSuppressed).mockClear();
    vi.mocked(fetchMeWithProof).mockClear();
    fireEvent.change(screen.getByPlaceholderText('邮箱'), { target: { value: 'a@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: 'password1' } });
    await act(async () => { screen.getByRole('button', { name: '登录' }).click(); });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expectClearBeforeRefresh();
  });

  // 注：LoginModal 的成功清键语句与 PhoneLoginForm 自身那行完全同路径（LoginModal 只把
  // PhoneLoginForm 的 onLoginSuccess 再调一次），组件级断言无法区分二者——本轮按评审判定
  // 删除该空断言腿（LoginModal 的独立验证需要 mock PhoneLoginForm，会污染本文件其余用例）。

  it('注册页：location.href 跳转前先清 suppressed', async () => {
    installFetch((url) => {
      if (url.includes('/api/auth/sign-up')) return jsonResponse({ user: USER_A });
      return meOk();
    });
    const { RegisterPage } = await import('@/pages/register/page');
    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthProbe />
          <RegisterPage />
        </AuthProvider>
      </MemoryRouter>,
    );
    await expectUid('u-a');

    vi.mocked(setAuthSuppressed).mockClear();
    fireEvent.change(screen.getByPlaceholderText('用户名'), { target: { value: 'A' } });
    fireEvent.change(screen.getByPlaceholderText('邮箱'), { target: { value: 'a@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('密码（至少8位）'), { target: { value: 'password1' } });
    await act(async () => { screen.getByRole('button', { name: '注册' }).click(); });

    await waitFor(() => expect(suppressedCalls()).toContain(false));
  });
});
