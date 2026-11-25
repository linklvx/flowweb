// apps/web/src/pages/canvas/page.offline.binding.spec.tsx
// Y5 T10（C1）：离线路径的 meta 写点——fetchProjectMeta 成功 ⇒ putBindingRow + putNameRow。
// 本文件 **不 mock** `@/collab/local-yjs-store`（跑真实 meta 三表 + fake-indexeddb/auto），
// 因为被测行为就是「页面真的把行写进库」——`page.offline.spec.tsx` 的 mock 面覆盖不到 C1。
// 四条腿（C1 brief）：
//   ①成功路径写 binding 行（getBindingRow 可读回，六字段全对）+ names 行同点登记；
//   ②响应 uid ≠ 当前 session 行 uid ⇒ 不写（fail-closed）；
//   ③无 historyToken ⇒ 不写（离线三合取结构性失败，写行无意义）；
//   ④端到端：先成功开一次（真库被写好）→ 再以瞬态失败重开 ⇒ open-local（**不 mock getBindingRow**）。
//   ⑤names 存量 hold/tombstone 原样保留（I4/M4：成功路径不得盲写 hold:false）。
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { CanvasPage } from './page';
import { useMenuStore } from '@/stores/menuStore';
import { useNodeStore } from '@/stores/nodeStore';
import {
  getBindingRow, getSessionRows, putSessionRow, putNameRow, listNameRows,
  buildYjsDbName, type SessionRow,
} from '@/collab/local-yjs-store';

const harness = vi.hoisted(() => ({
  initCollab: vi.fn(async () => undefined),
  initCollabLocal: vi.fn(async () => undefined),
  destroyCollab: vi.fn(async () => undefined),
  setHydration: vi.fn(),
}));

vi.mock('@/stores/canvasCollabRuntime', () => ({
  initCollab: harness.initCollab,
  initCollabLocal: harness.initCollabLocal,
  destroyCollab: harness.destroyCollab,
  safeReload: vi.fn(),
  getAwareness: () => null,
  getDoc: () => null,
  getCurrentBackupHeader: () => ({ schemaVersion: 2, historyToken: '' }),
  escapeWithLocalExport: vi.fn(),
  discardLocalDiverged: vi.fn(),
  exportDivergedContent: vi.fn(() => null),
  acceptServerRestoredRecovery: vi.fn(async () => false),
  resumeFromRecovery: vi.fn(async () => undefined),
}));

vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Test', email: 'test@test.com' }, loading: false, logout: vi.fn(), refresh: vi.fn() }),
  AuthProvider: ({ children }: any) => children,
}));

const setTeamIdMock = vi.fn();
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: Object.assign(
    vi.fn((selector?: any) => {
      const state = {
        nodes: [], renderNodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
        selectedId: null, hydration: 'pending', wsAuthNotice: null, localCacheReady: false,
        onNodesChange: vi.fn(), onEdgesChange: vi.fn(), onConnect: vi.fn(),
        updateViewport: vi.fn(), addNode: vi.fn(), selectNode: vi.fn(), nodeProcessMap: {},
      };
      if (typeof selector === 'function') return selector(state);
      return state;
    }),
    {
      subscribe: vi.fn(() => vi.fn()),
      getState: vi.fn(() => ({
        nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
        hydration: 'pending',
        setHydration: harness.setHydration,
        updateViewport: vi.fn(), onNodesChange: vi.fn(), onEdgesChange: vi.fn(),
        setProjectId: vi.fn(), setTeamId: setTeamIdMock, setNodeDraggable: vi.fn(), nodeProcessMap: {},
      })),
      setState: vi.fn(),
    },
  ),
}));

vi.mock('@/stores/nodeStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/stores/nodeStore')>()),
  useNodeStore: Object.assign(
    vi.fn((selector?: any) => {
      const state = { nodes: {} };
      if (typeof selector === 'function') return selector(state);
      return state;
    }),
    {
      subscribe: vi.fn(() => vi.fn()),
      getState: vi.fn(() => ({
        nodes: {}, activeTransformNodeId: null, activeEditNodeId: null, referenceSelect: null,
        exitReferenceSelect: vi.fn(), setActiveTransformNodeId: vi.fn(), setActiveEditNodeId: vi.fn(),
      })),
      setState: vi.fn(),
    },
  ),
}));

vi.mock('@/stores/materialLibraryStore', () => {
  const state = {
    isOpen: false, open: vi.fn(), close: vi.fn(), folders: [], files: [], loading: false,
    uploading: false, uploadProgress: 0, fileGridSize: 200, selectedFolderId: null, batchMode: false,
    selectedFileIds: new Set(), renameModal: { open: false, folderId: null, defaultValue: '' },
    loadFolders: vi.fn(), loadFiles: vi.fn(), setSelectedFolder: vi.fn(), setFileGridSize: vi.fn(),
    setRenameModal: vi.fn(), uploadFile: vi.fn(), deleteFile: vi.fn(), toggleFavorite: vi.fn(),
    createFolder: vi.fn(), renameFolder: vi.fn(), deleteFolder: vi.fn(), moveFolderUp: vi.fn(),
    moveFolder: vi.fn(), enterBatchMode: vi.fn(), exitBatchMode: vi.fn(), selectFile: vi.fn(),
    deselectFile: vi.fn(), toggleFileSelection: vi.fn(), selectAllFiles: vi.fn(),
    batchDelete: vi.fn(), batchMove: vi.fn(),
  };
  const useMaterialLibraryStore = (selector: any) => selector(state);
  (useMaterialLibraryStore as any).getState = () => state;
  (useMaterialLibraryStore as any).subscribe = vi.fn(() => vi.fn());
  return { useMaterialLibraryStore };
});

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    ReactFlowProvider: actual.ReactFlowProvider,
    useReactFlow: () => ({
      fitView: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn(),
      screenToFlowPosition: (p: any) => ({ x: p.x, y: p.y }),
      getNodes: () => [], getEdges: () => [],
    }),
  };
});

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, useParams: () => ({}) };
});

const mockFetch = vi.fn();
globalThis.fetch = ((...args: any[]) =>
  Promise.resolve(mockFetch(...(args as [any]))).then((r: any) =>
    (r && typeof r === 'object' && !r.headers ? { ...r, headers: { get: () => null } } : r))) as any;

const HISTORY_TOKEN = 'h-bind';

async function seedSession(uid: string, deadline = Date.now() + 3_600_000): Promise<void> {
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

const projectOk = (over: Record<string, unknown> = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({
    code: 0,
    data: {
      id: 'p-bind', name: '绑定画布', teamId: 'team-bind',
      collabGeneration: 7, collabSchemaVersion: 2, collabViewerUid: 'u1',
      ...over,
    },
  }),
});

// fake-indexeddb 的库跨用例存活（模块级工厂）——每个用例前清空 meta/文档库（零串扰）。
async function wipeLocalDbs(): Promise<void> {
  const dbs = await indexedDB.databases();
  await Promise.all(dbs.map((d) => d.name ? new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(d.name as string);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  }) : Promise.resolve()));
}

beforeEach(async () => {
  await wipeLocalDbs();
  localStorage.clear();
  useMenuStore.setState({ isOpen: false });
  harness.initCollab.mockClear();
  harness.initCollabLocal.mockClear();
  harness.destroyCollab.mockClear();
  harness.setHydration.mockClear();
  setTeamIdMock.mockClear();
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const renderPage = (entry = '/canvas') =>
  render(<MemoryRouter initialEntries={[entry]}><CanvasPage /></MemoryRouter>);

describe('Y5 T10 C1：fetchProjectMeta 写 binding/names 行', () => {
  it('成功路径 ⇒ binding 行可读回（六字段）+names 行登记（hold=false）', async () => {
    localStorage.setItem('flowweb_projectId', 'p-bind');
    localStorage.setItem('collab:history-id', HISTORY_TOKEN);
    await seedSession('u1');
    mockFetch.mockResolvedValue(projectOk());

    renderPage();
    await waitFor(() => expect(harness.initCollab).toHaveBeenCalledTimes(1));

    const binding = await getBindingRow('u1', 'p-bind');
    expect(binding).toEqual({
      uid: 'u1', generation: 7, schemaVersion: 2,
      historyToken: HISTORY_TOKEN, name: '绑定画布', teamId: 'team-bind',
    });
    const dbName = buildYjsDbName('u1', 'p-bind', 7, 2, HISTORY_TOKEN);
    const names = await listNameRows();
    const row = names.find((r) => r.dbName === dbName);
    expect(row).toMatchObject({ uid: 'u1', pid: 'p-bind', generation: 7, schemaVersion: 2, hold: false });
    expect(row?.tombstone).toBeUndefined();
  });

  it('响应 uid 与 session 行 uid 不同 ⇒ 不写 binding（fail-closed——跨账号泄漏防线）', async () => {
    localStorage.setItem('flowweb_projectId', 'p-bind');
    localStorage.setItem('collab:history-id', HISTORY_TOKEN);
    await seedSession('u-other');
    mockFetch.mockResolvedValue(projectOk({ collabViewerUid: 'u1' }));   // 响应仍是 u1

    renderPage();
    await waitFor(() => expect(harness.initCollab).toHaveBeenCalledTimes(1));

    expect(await getBindingRow('u1', 'p-bind')).toBeNull();
    expect(await getBindingRow('u-other', 'p-bind')).toBeNull();
  });

  it('session 表无行/多行 ⇒ 不写 binding（歧义 fail-closed）', async () => {
    localStorage.setItem('flowweb_projectId', 'p-bind');
    localStorage.setItem('collab:history-id', HISTORY_TOKEN);
    // 无 session 行
    mockFetch.mockResolvedValue(projectOk());

    renderPage();
    await waitFor(() => expect(harness.initCollab).toHaveBeenCalledTimes(1));
    expect(await getBindingRow('u1', 'p-bind')).toBeNull();
  });

  it('无持久化 historyToken ⇒ 不写（离线三合取结构性失败）', async () => {
    localStorage.setItem('flowweb_projectId', 'p-bind');   // 不写 collab:history-id
    await seedSession('u1');
    mockFetch.mockResolvedValue(projectOk());

    renderPage();
    await waitFor(() => expect(harness.initCollab).toHaveBeenCalledTimes(1));
    expect(await getBindingRow('u1', 'p-bind')).toBeNull();
  });

  it('names 存量 hold=true / tombstone=true 原样保留（成功路径不翻案——I4/M4）', async () => {
    localStorage.setItem('flowweb_projectId', 'p-bind');
    localStorage.setItem('collab:history-id', HISTORY_TOKEN);
    await seedSession('u1');
    const dbName = buildYjsDbName('u1', 'p-bind', 7, 2, HISTORY_TOKEN);
    await putNameRow(dbName, {
      uid: 'u1', pid: 'p-bind', generation: 7, schemaVersion: 2,
      historyToken: HISTORY_TOKEN, hold: true,
    });
    mockFetch.mockResolvedValue(projectOk());

    renderPage();
    await waitFor(() => expect(harness.initCollab).toHaveBeenCalledTimes(1));

    const row = (await listNameRows()).find((r) => r.dbName === dbName);
    expect(row?.hold).toBe(true);   // 存量 hold 保留
  });

  it('★端到端：先成功开一次（真库落行）→ 瞬态失败重开 ⇒ open-local（不 mock getBindingRow）', async () => {
    const pid = 'p-bind';
    localStorage.setItem('flowweb_projectId', pid);
    localStorage.setItem('collab:history-id', HISTORY_TOKEN);
    await seedSession('u1');
    mockFetch.mockResolvedValue(projectOk({ id: pid }));

    // 第一次：在线成功——页面写 binding/names（真实 meta 库）
    const first = renderPage();
    await waitFor(() => expect(harness.initCollab).toHaveBeenCalledTimes(1));
    await waitFor(async () => expect(await getBindingRow('u1', pid)).not.toBeNull());
    first.unmount();

    // 第二次：同一 pid 的项目请求瞬态失败（5xx）——页面只能靠库里刚写的 binding 开离线腿
    harness.initCollab.mockClear();
    harness.initCollabLocal.mockClear();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({ code: -1 }) });

    renderPage();
    await waitFor(() => expect(harness.initCollabLocal).toHaveBeenCalledTimes(1));
    expect(harness.initCollabLocal).toHaveBeenCalledWith(pid, {
      viewerUid: 'u1', collabGeneration: 7, collabSchemaVersion: 2,
      name: '绑定画布', teamId: 'team-bind',
    });
    expect(harness.initCollab).not.toHaveBeenCalled();
    // 真实 getSessionRows 也被离线路由读到（恰一行、未过期）
    expect((await getSessionRows()).length).toBe(1);
  });

  it('initCollabLocal 抛错 ⇒ 页面落 failed + 「暂不可用」UI（I1b——不逸出 unhandled）', async () => {
    const pid = 'p-bind';
    localStorage.setItem('flowweb_projectId', pid);
    localStorage.setItem('collab:history-id', HISTORY_TOKEN);
    await seedSession('u1');
    await putNameRow(buildYjsDbName('u1', pid, 7, 2, HISTORY_TOKEN), {
      uid: 'u1', pid, generation: 7, schemaVersion: 2, historyToken: HISTORY_TOKEN, hold: false,
    });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { putBindingRow } = await import('@/collab/local-yjs-store');
    await putBindingRow('u1', pid, {
      uid: 'u1', generation: 7, schemaVersion: 2, historyToken: HISTORY_TOKEN, name: '绑定画布', teamId: null,
    });
    harness.initCollabLocal.mockRejectedValueOnce(new Error('idb unavailable'));
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({ code: -1 }) });

    renderPage();

    await waitFor(() => expect(screen.getByText('画布加载失败，请检查网络后重试')).toBeInTheDocument());
    expect(harness.setHydration).toHaveBeenCalledWith('failed');
  });
});
