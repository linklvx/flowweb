// apps/web/src/pages/canvas/page.e2e-local.spec.tsx
// Y5 T15：验收 11 的 **AuthProvider 全链腿**（spec §2 形态约束：禁单测带 meta 的
// initCollab——必须从壳子路径进）。这条腿此前无测试：现有 page.offline.{binding.}spec
// 都把 AuthProvider 与 canvasCollabRuntime mock 掉了，覆盖不到「transient → setUser(userSnapshot)
// → 放行 → fetchProjectMeta 分型 → initCollabLocal → hydration='local'」这条真链。
//
// 装置：真 AuthProvider + 真 canvasCollabRuntime + 真 local-yjs-store + fake-indexeddb/auto
// （幂等/身份/水合次序全走真实现）；只 mock 网络面（fetch）与 HocuspocusProvider。
// 断言锚（验收 11 / 17）：
//   ①/me 网络失败（transient）+ 证明未过期 + binding 在 → AuthProvider 从证明恢复用户（不跳登录）；
//   ②项目请求 5xx → 页面分型 open-local → initCollabLocal 真跑 → hydration='local'；
//   ③teamId 来自 binding，名字来自 binding（不新建项目）；
//   ④HTTP 401 → 不进 local（http-expired 桶）。
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { AuthProvider, useAuth } from '@/components/AuthProvider';
import { CanvasPage } from './page';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  buildYjsDbName, putBindingRow, putNameRow, putSessionRow, type SessionRow,
} from '@/collab/local-yjs-store';
import * as Y from 'yjs';

/** 库内种子（y-indexeddb 同款 updates/custom 两 store）——种子写入绕过 API 面。 */
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
/** 快照构造：schemaVersion 盖戳（DEV 版本门要求）+ 一个节点。 */
function snapshotOf(build: (d: Y.Doc) => void): Uint8Array {
  const d = new Y.Doc();
  d.getMap('meta').set('schemaVersion', 2);
  build(d);
  const update = Y.encodeStateAsUpdate(d);
  d.destroy();
  return update;
}

vi.mock('@hocuspocus/provider', async () => {
  const { FakeHocuspocusProvider } = await import('@/test/fixtures/fakeHocuspocusProvider');
  return { HocuspocusProvider: FakeHocuspocusProvider };
});

const UID = 'u-e2e';
const PID = 'p-e2e';
const HISTORY_TOKEN = 'h-e2e-1';
const BINDING_NAME = '离线项目名';

/** session 证明行（/me 网络失败时 AuthProvider 的放行依据）。 */
function proofRow(deadline = Date.now() + 7 * 24 * 3_600_000): SessionRow {
  return {
    uid: UID,
    localDeadline: deadline,
    userSnapshot: {
      id: UID, name: 'E2E 用户', email: `${UID}@example.com`, image: null, emailVerified: true,
      role: 'USER', phoneNumber: null, phoneNumberVerified: false,
      createdAt: '2026-01-01', updatedAt: '2026-01-01',
    } as SessionRow['userSnapshot'],
  };
}

/** fetch 分派：/me 走网络失败（transient）、项目请求走 503。 */
function installFetch(opts: { meFails: boolean; projectStatus: number }) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input);
    if (url.includes('/auth/me') || url.endsWith('/me')) {
      if (opts.meFails) throw new TypeError('network down');
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
    }
    if (url.includes('/api/ready')) {
      return { ok: true, status: 200, json: async () => ({ collabProtocolVersion: 'e2e' }) } as unknown as Response;
    }
    // apiFetch 在 !ok 时会 res.clone().json() 解 body——mock 必须提供 clone（否则解析抛错，
    // status 不透传 ⇒ 分型退化成 transient ⇒ 401 被误放进 local）
    const body = { code: -1, message: 'e2e' };
    const res = {
      ok: false, status: opts.projectStatus, statusText: 'e2e',
      headers: { get: () => null },
      json: async () => body,
      clone: () => ({ json: async () => body }),
    };
    return res as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** 探针组件：把 AuthProvider 解出的 user 落到 DOM（全链第一腿的可见锚）。 */
function AuthProbe() {
  const { user, loading } = useAuth();
  return (
    <div>
      <span data-testid="auth-loading">{String(loading)}</span>
      <span data-testid="auth-uid">{user?.id ?? 'none'}</span>
    </div>
  );
}

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('flowweb_projectId', PID);
  localStorage.setItem('collab:history-id', HISTORY_TOKEN);
  await putSessionRow(proofRow());
  const dbName = buildYjsDbName(UID, PID, 7, 2, HISTORY_TOKEN);
  await putNameRow(dbName, { uid: UID, pid: PID, generation: 7, schemaVersion: 2, historyToken: HISTORY_TOKEN, hold: false });
  // 五合取第③腿：库内 writeGrant 必须是 'read-write'（离线可编辑的授权面）
  await seedCustom(dbName, { writeGrant: 'read-write' });
  // 库有内容（五合取①装载成立 + 投影有东西可看）
  await seedUpdates(dbName, [snapshotOf((d) => {
    d.getMap('nodes').set('n1', new Y.Map<any>([['type', 'textInput'], ['position', new Y.Map([['x', 0], ['y', 0]])], ['data', new Y.Map([['v', '1']])]]));
  })]);
  await putBindingRow(UID, PID, {
    uid: UID, generation: 7, schemaVersion: 2, historyToken: HISTORY_TOKEN,
    name: BINDING_NAME, teamId: 'team-e2e',
  });
  (HocuspocusProvider as any).instances.length = 0;
  useCanvasStore.getState().setHydration('idle');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Y5 T15 验收 11：AuthProvider 全链 → local', () => {
  it('/me 网络失败 + 证明未过期 → AuthProvider 从证明恢复用户（不跳登录、不落 none）', async () => {
    installFetch({ meFails: true, projectStatus: 503 });
    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('auth-loading').textContent).toBe('false'));
    // 修前：transient 只 setUser(null)（B1 断点——离线刷新被踢回登录）
    expect(screen.getByTestId('auth-uid').textContent).toBe(UID);
  });

  it('项目请求 5xx + 证明 + binding 齐备 → 整链进 local（真 runtime，不 mock）', async () => {
    installFetch({ meFails: true, projectStatus: 503 });
    render(
      <MemoryRouter>
        <AuthProvider>
          <CanvasPage />
        </AuthProvider>
      </MemoryRouter>,
    );
    // 整链：AuthProvider 放行 → fetchProjectMeta 503 → decideOfflineRoute=open-local →
    // initCollabLocal（真）→ 开库装载 → 五合取 → local
    await waitFor(() => expect(useCanvasStore.getState().hydration).toBe('local'), { timeout: 8_000 });
    expect(useCanvasStore.getState().teamId).toBe('team-e2e');   // 验收 17：teamId 来自 binding
  }, 20_000);

  it('HTTP 401 → 不进 local（http-expired 桶，hydration 非 local）', async () => {
    installFetch({ meFails: true, projectStatus: 401 });
    render(
      <MemoryRouter>
        <AuthProvider>
          <CanvasPage />
        </AuthProvider>
      </MemoryRouter>,
    );
    // 401=denial 短路（§0.2 步 1）：落 idle/unavailable，绝不进 local
    await waitFor(() => expect(useCanvasStore.getState().hydration).not.toBe('pending'), { timeout: 8_000 });
    expect(useCanvasStore.getState().hydration).not.toBe('local');
  }, 20_000);
});
