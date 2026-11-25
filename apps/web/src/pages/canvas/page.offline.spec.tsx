// apps/web/src/pages/canvas/page.offline.spec.tsx
// Y5 T10（§0.2 步 1 / 验收 11/17）：画布页离线分型接线腿。
//   ①5xx + 有效证明 + binding/historyId 一致 ⇒ initCollabLocal（binding 顶 meta）+整链 hydration=local；
//   ②HTTP 401 ⇒ http-expired：不调 initCollab/initCollabLocal、零本地库 open、停「暂不可用」；
//   ③无参 404 自动新建只认确定性 404（裁定 ②）——离线/瞬态失败不新建；
//   ④（M5 已删）原「媒体预签名失败」腿是同义反复（只断言被 mock 的 setHydration 未被调用）——
//      真实保护面在 runtime（`setHydration('failed')` 全仓唯一写点=死线分支，媒体链路零写点）；
//      媒体 URL 解析本身是纯本地推导（`getMediaUrl` 零网络），无失败路径可测。
// 装置承 page.test.tsx（MemoryRouter+fetch mock+antd）；runtime/离线存储面全 mock（页面只做分型接线）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { CanvasPage } from './page';
import { useCanvasStore } from '@/stores/canvasStore';
import { useMenuStore } from '@/stores/menuStore';
import { useNodeStore } from '@/stores/nodeStore';

const harness = vi.hoisted(() => ({
  initCollab: vi.fn(async () => undefined),
  initCollabLocal: vi.fn(async () => undefined),
  destroyCollab: vi.fn(async () => undefined),
  getSessionRows: vi.fn(async (): Promise<unknown[]> => []),
  getBindingRow: vi.fn(async (): Promise<unknown> => null),
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

vi.mock('@/collab/local-yjs-store', () => ({
  getSessionRows: harness.getSessionRows,
  getBindingRow: harness.getBindingRow,
}));

vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Test', email: 'test@test.com' }, loading: false, logout: vi.fn(), refresh: vi.fn() }),
  AuthProvider: ({ children }: any) => children,
}));

/** canvasStore mock（page 消费面最小集）：hydration 由测试注入；setHydration 记录。 */
let mockHydration: 'idle' | 'pending' | 'ready' | 'failed' | 'local' = 'ready';
const setTeamIdMock = vi.fn();
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: Object.assign(
    vi.fn((selector?: any) => {
      const state = {
        nodes: [], renderNodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
        selectedId: null, hydration: mockHydration, wsAuthNotice: null, localCacheReady: false,
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
        hydration: mockHydration,
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

const VALID_ROW = (uid: string, deadline: number) => ({
  uid, localDeadline: deadline, userSnapshot: { id: uid, name: 'U' },
});
const BINDING = {
  uid: 'u1', generation: 7, schemaVersion: 2, historyToken: 'h-offline',
  name: '离线画布', teamId: 'team-offline',
};

beforeEach(() => {
  localStorage.clear();
  useMenuStore.setState({ isOpen: false });
  mockHydration = 'ready';
  harness.initCollab.mockClear();
  harness.initCollabLocal.mockClear();
  harness.destroyCollab.mockClear();
  harness.setHydration.mockClear();
  harness.getSessionRows.mockReset();
  harness.getBindingRow.mockReset();
  harness.getSessionRows.mockResolvedValue([]);
  harness.getBindingRow.mockResolvedValue(null);
  setTeamIdMock.mockClear();
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPage(entry = '/canvas') {
  return render(<MemoryRouter initialEntries={[entry]}><CanvasPage /></MemoryRouter>);
}

describe('Y5 T10 页面离线分型接线', () => {
  it('5xx+证明有效+binding/historyId 一致 ⇒ initCollabLocal（binding 三元/name/teamId 顶 meta）+setTeamId', async () => {
    localStorage.setItem('flowweb_projectId', 'p-off');
    localStorage.setItem('collab:history-id', 'h-offline');
    harness.getSessionRows.mockResolvedValue([VALID_ROW('u1', Date.now() + 3_600_000)]);
    harness.getBindingRow.mockResolvedValue(BINDING);
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({ code: -1 }) });

    renderPage();

    await waitFor(() => expect(harness.initCollabLocal).toHaveBeenCalledTimes(1));
    expect(harness.initCollabLocal).toHaveBeenCalledWith('p-off', {
      viewerUid: 'u1', collabGeneration: 7, collabSchemaVersion: 2,
      name: '离线画布', teamId: 'team-offline',
    });
    expect(harness.initCollab).not.toHaveBeenCalled();            // 在线入口零调用（离线腿唯一）
    expect(setTeamIdMock).toHaveBeenCalledWith('team-offline');   // 验收 17：teamId 来自 binding
    expect(screen.queryByText('画布加载失败，请检查网络后重试')).not.toBeInTheDocument();
  });

  it('HTTP 401 ⇒ http-expired（既有行为）：initCollab/initCollabLocal 零调用+零本地库 open+停「暂不可用」', async () => {
    localStorage.setItem('flowweb_projectId', 'p-401');
    localStorage.setItem('collab:history-id', 'h-offline');
    // 三合取全成立也不得覆盖显式否认（401 优先）
    harness.getSessionRows.mockResolvedValue([VALID_ROW('u1', Date.now() + 3_600_000)]);
    harness.getBindingRow.mockResolvedValue(BINDING);
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({ code: -1 }) });

    renderPage();

    await waitFor(() => expect(screen.getByText('画布加载失败，请检查网络后重试')).toBeInTheDocument());
    expect(harness.initCollab).not.toHaveBeenCalled();
    expect(harness.initCollabLocal).not.toHaveBeenCalled();
    // M5：denial 短路=**两张 meta 表都零读**（不是只断言 binding）
    expect(harness.getSessionRows).not.toHaveBeenCalled();
    expect(harness.getBindingRow).not.toHaveBeenCalled();
  });

  it('5xx 但 historyId 不匹配 ⇒ 不开库（不新建、停「暂不可用」）', async () => {
    localStorage.setItem('flowweb_projectId', 'p-mismatch');
    localStorage.setItem('collab:history-id', 'h-other-epoch');
    harness.getSessionRows.mockResolvedValue([VALID_ROW('u1', Date.now() + 3_600_000)]);
    harness.getBindingRow.mockResolvedValue(BINDING);
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ code: -1 }) });

    renderPage();

    await waitFor(() => expect(screen.getByText('画布加载失败，请检查网络后重试')).toBeInTheDocument());
    expect(harness.initCollabLocal).not.toHaveBeenCalled();
    const posts = mockFetch.mock.calls.filter((c: any[]) => c[1]?.method === 'POST');
    expect(posts.length).toBe(0);                                  // 禁自动新建
  });

  it('无参 404（确定性不存在）⇒ 保留在线遗留自动新建分支（裁定 ②）', async () => {
    localStorage.setItem('flowweb_projectId', 'p-404');
    mockFetch.mockImplementation((url: any, init?: any) => {
      if (init?.method === 'POST') {
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({ code: 0, data: { projectId: 'p-new', name: '新建', collabGeneration: 0, collabSchemaVersion: 2, collabViewerUid: 'u1' } }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ code: -1 }) });
    });

    renderPage();

    await waitFor(() => expect(harness.initCollab).toHaveBeenCalledTimes(1));
    expect(harness.initCollab).toHaveBeenCalledWith('p-new', expect.anything());
    expect(harness.initCollabLocal).not.toHaveBeenCalled();
  });
});