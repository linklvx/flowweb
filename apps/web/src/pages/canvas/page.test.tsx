import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import React from 'react';
import { message } from 'antd';
import { CanvasPage } from './page';
import { useMenuStore } from '@/stores/menuStore';
import { useNodeStore } from '@/stores/nodeStore';

vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Test', email: 'test@test.com' }, loading: false, logout: vi.fn(), refresh: vi.fn() }),
  AuthProvider: ({ children }: any) => children,
}));

vi.mock('@/stores/canvasCollabRuntime', () => ({
  initCollab: vi.fn().mockResolvedValue(undefined),
  destroyCollab: vi.fn().mockResolvedValue(undefined),
  refitExpandedGroups: vi.fn(),
  getAwareness: () => null,
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// 按用例注入 canvasStore 节点（模拟"canvasStore 有节点但 nodeStore 无对应数据"的刷新竞态）
let mockCanvasNodes: any[] = [];
// 按用例注入 hydration 四态（批2-1 蒙层分型/键盘守卫）
let mockHydration: 'idle' | 'pending' | 'ready' | 'failed' = 'ready';

const { useCanvasStoreSetState, useNodeStoreSetState, setTeamIdMock, setHydrationMock } = vi.hoisted(() => ({
  useCanvasStoreSetState: vi.fn(),
  useNodeStoreSetState: vi.fn(),
  setTeamIdMock: vi.fn(),
  setHydrationMock: vi.fn(),
}));

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: Object.assign(
    vi.fn((selector?: any) => {
      const state = {
        nodes: mockCanvasNodes,
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        selectedId: null,
        hydration: mockHydration,
        onNodesChange: vi.fn(),
        onEdgesChange: vi.fn(),
        onConnect: vi.fn(),
        updateViewport: vi.fn(),
        addNode: vi.fn(),
        selectNode: vi.fn(),
        nodeProcessMap: {},
      };
      if (typeof selector === 'function') return selector(state);
      return state;
    }),
    {
      subscribe: vi.fn(() => vi.fn()),
      getState: vi.fn(() => ({
        nodes: mockCanvasNodes,
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        hydration: mockHydration,
        setHydration: setHydrationMock,
        updateViewport: vi.fn(),
        onNodesChange: vi.fn(),
        onEdgesChange: vi.fn(),
        setProjectId: vi.fn(),
        setTeamId: setTeamIdMock,
        setNodeDraggable: vi.fn(),
        nodeProcessMap: {},
        applyGroupDerivations: vi.fn(),
      })),
      setState: useCanvasStoreSetState,
    }
  ),
}));

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: Object.assign(
    vi.fn((selector?: any) => {
      const state = { nodes: {} };
      if (typeof selector === 'function') return selector(state);
      return state;
    }),
    {
      subscribe: vi.fn(() => vi.fn()),
      getState: vi.fn(() => ({
        nodes: {},
        activeTransformNodeId: null,
        activeEditNodeId: null,
        referenceSelect: null,
        exitReferenceSelect: vi.fn(),
        setActiveTransformNodeId: vi.fn(),
        setActiveEditNodeId: vi.fn(),
      })),
      setState: useNodeStoreSetState,
    }
  ),
}));

vi.mock('@/stores/materialLibraryStore', () => {
  const state = {
    isOpen: false,
    open: vi.fn(),
    close: vi.fn(),
    folders: [],
    files: [],
    loading: false,
    uploading: false,
    uploadProgress: 0,
    fileGridSize: 200,
    selectedFolderId: null,
    batchMode: false,
    selectedFileIds: new Set(),
    renameModal: { open: false, folderId: null, defaultValue: '' },
    loadFolders: vi.fn(),
    loadFiles: vi.fn(),
    setSelectedFolder: vi.fn(),
    setFileGridSize: vi.fn(),
    setRenameModal: vi.fn(),
    uploadFile: vi.fn(),
    deleteFile: vi.fn(),
    toggleFavorite: vi.fn(),
    createFolder: vi.fn(),
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
    moveFolderUp: vi.fn(),
    moveFolder: vi.fn(),
    enterBatchMode: vi.fn(),
    exitBatchMode: vi.fn(),
    selectFile: vi.fn(),
    deselectFile: vi.fn(),
    toggleFileSelection: vi.fn(),
    selectAllFiles: vi.fn(),
    batchDelete: vi.fn(),
    batchMove: vi.fn(),
  };
  const useMaterialLibraryStore = (selector: any) => selector(state);
  (useMaterialLibraryStore as any).getState = () => state;
  (useMaterialLibraryStore as any).subscribe = vi.fn(() => vi.fn());
  return { useMaterialLibraryStore };
});

const mockFitView = vi.fn();
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    ReactFlowProvider: actual.ReactFlowProvider,
    useReactFlow: () => ({
      fitView: mockFitView,
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      screenToFlowPosition: vi.fn((p: any) => ({ x: p.x, y: p.y })),
      getNodes: () => [],
      getEdges: () => [],
    }),
  };
});

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, useParams: () => ({}) };
});

describe('CanvasPage', () => {
  beforeEach(() => {
    localStorage.clear();
    useMenuStore.setState({ isOpen: false });
    mockCanvasNodes = [];
    mockHydration = 'ready';
    setHydrationMock.mockClear();
    setTeamIdMock.mockClear();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ code: 0, data: { id: 'test-pid-123', projectId: 'test-pid-123', templateId: 't-1', name: '我的画布' } }),
    });
  });

  it('should show loading state initially', () => {
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    expect(screen.getByText('加载画布...')).toBeInTheDocument();
  });

  it('should render CanvasPage after project creation', async () => {
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
    });
  });

  it('should render ReactFlow canvas after project creation', async () => {
    const { container } = render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    await waitFor(() => {
      expect(container.querySelector('.react-flow')).toBeInTheDocument();
    });
  });

  it('should not crash when canvas node has no nodeStore data (refresh restore race)', async () => {
    mockCanvasNodes = [
      { id: 'node_x1', type: 'imageGen', position: { x: 0, y: 0 }, data: {}, selected: false },
    ];
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
    });
    // ImageGenNode 渲染（nodeStore 无 node_x1 数据 → nodeData undefined）不应抛错
    expect(document.querySelector('.react-flow__node')).toBeInTheDocument();
  });

  describe('恢复最近项目与分级降级（Fix 1）', () => {
    const dbOkResponse = (id: string) => ({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ code: 0, data: { id, name: 'DB画布', teamId: 't-1', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } }),
    });
    const createOkResponse = {
      ok: true,
      status: 200,
      json: () => Promise.resolve({ code: 0, data: { templateId: 't-new', projectId: 'new-pid', name: '未命名项目4', teamId: 't-create' } }),
    };

    it('无参且 localStorage 有 projectId 时不新建，走加载路径', async () => {
      localStorage.setItem('flowweb_projectId', 'p1');
      mockFetch.mockResolvedValue(dbOkResponse('p1'));

      render(<MemoryRouter><CanvasPage /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
      });

      const posts = mockFetch.mock.calls.filter((c: any[]) => c[1]?.method === 'POST');
      expect(posts.length).toBe(0);
      // 批3-3：fetchProjectMeta 收编 apiFetch——GET 也带显式 init（method:'GET'）
      const gets = mockFetch.mock.calls.filter((c: any[]) => !c[1] || c[1]?.method === 'GET');
      expect(gets.some((c: any[]) => String(c[0]).includes('/api/projects/p1'))).toBe(true);
      // 加载路径写入画布团队上下文
      expect(setTeamIdMock).toHaveBeenCalledWith('t-1');
    });

    it('无参且 key 不存在时新建项目（统一走 canvases API）', async () => {
      mockFetch.mockResolvedValue(createOkResponse);

      render(<MemoryRouter><CanvasPage /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
      });
      const posts = mockFetch.mock.calls.filter((c: any[]) => c[1]?.method === 'POST');
      expect(posts.length).toBeGreaterThan(0);
      expect(String(posts[0][0])).toContain('/api/canvases');
      expect(localStorage.getItem('flowweb_projectId')).toBe('new-pid');
      // 新建路径写入画布团队上下文
      expect(setTeamIdMock).toHaveBeenCalledWith('t-create');
    });

    it('无参 404 时清 key 并 fallback 新建且提示', async () => {
      localStorage.setItem('flowweb_projectId', 'p1');
      const warnSpy = vi.spyOn(message, 'warning').mockImplementation(() => ({}) as never);
      // 第一次 GET 404，之后 POST 新建成功
      mockFetch.mockImplementation((url: any, init?: any) => {
        if (init?.method === 'POST') return Promise.resolve(createOkResponse);
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ code: -1 }) });
      });

      render(<MemoryRouter><CanvasPage /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
      });

      expect(localStorage.getItem('flowweb_projectId')).toBe('new-pid');
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('无参网络错误时进入错误态，保留 key 不自动新建', async () => {
      localStorage.setItem('flowweb_projectId', 'p1');
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

      render(<MemoryRouter><CanvasPage /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByText('重试')).toBeInTheDocument();
      });

      expect(localStorage.getItem('flowweb_projectId')).toBe('p1');
      const posts = mockFetch.mock.calls.filter((c: any[]) => c[1]?.method === 'POST');
      expect(posts.length).toBe(0);
      // G：失败后 loading 态消失
      expect(screen.queryByText('加载画布...')).not.toBeInTheDocument();
    });

    it('错误态点重试成功后进入画布', async () => {
      localStorage.setItem('flowweb_projectId', 'p1');
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      mockFetch.mockResolvedValue(dbOkResponse('p1'));

      render(<MemoryRouter><CanvasPage /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByText('重试')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('重试'));
      await waitFor(() => {
        expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
      });
      expect(screen.queryByText('重试')).not.toBeInTheDocument();
    });

    it('有参 404 时进入错误态且提供返回工作空间，不清 key 不新建', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({ code: -1 }) });

      render(<MemoryRouter initialEntries={['/canvas?projectId=p1']}><CanvasPage /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByText('返回工作空间')).toBeInTheDocument();
      });

      expect(screen.queryByText('加载画布...')).not.toBeInTheDocument();
      const posts = mockFetch.mock.calls.filter((c: any[]) => c[1]?.method === 'POST');
      expect(posts.length).toBe(0);
    });
  });

  describe('项目切换清空 store（Fix 5）', () => {
    const paNode = { id: 'node_pa', type: 'imageGen', position: { x: 1, y: 1 }, data: {} };
    const dbWithNode = (id: string, nodeId: string) => ({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ code: 0, data: { id, name: 'X', teamId: `t-${id}`, nodes: [{ id: nodeId, type: 'imageGen', position: { x: 0, y: 0 }, data: {} }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } }),
    });
    const isFullClear = (s: any) => Array.isArray(s?.nodes) && s.nodes.length === 0 && 'edges' in s && 'viewport' in s;

    function SwitchHarness() {
      const navigate = useNavigate();
      return (
        <div>
          <button type="button" onClick={() => navigate('/canvas?projectId=pb')}>去P_b</button>
          <CanvasPage />
        </div>
      );
    }

    it('SPA 原地切换项目时先清空 store 再加载（P_a 残留不进入 P_b）', async () => {
      mockCanvasNodes = [paNode];
      mockFetch.mockResolvedValue(dbWithNode('pb', 'node_pb'));

      render(<MemoryRouter initialEntries={['/canvas?projectId=pa']}><SwitchHarness /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
      });

      (useCanvasStoreSetState as ReturnType<typeof vi.fn>).mockClear();
      (useNodeStoreSetState as ReturnType<typeof vi.fn>).mockClear();
      setTeamIdMock.mockClear();
      fireEvent.click(screen.getByText('去P_b'));
      await waitFor(() => {
        expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
      });

      const calls = (useCanvasStoreSetState as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      // 清空（空 nodes）必须先于新项目加载（Task14：内容加载改经 initCollab）
      expect(calls[0][0]?.nodes).toEqual([]);
      // 清 store 残留同步清 teamId（防降级路径残留旧团队上下文，Task 11 交接项）
      expect(calls[0][0]?.teamId).toBeNull();
      expect(calls.some((c: any[]) => c[0]?.nodes?.some((n: any) => n.id === 'node_pa'))).toBe(false);
      expect((useNodeStoreSetState as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({ nodes: {} });
      // pb 加载完成后写入新团队上下文
      expect(setTeamIdMock).toHaveBeenCalledWith('t-pb');
      const { initCollab } = await import('@/stores/canvasCollabRuntime');
      expect(vi.mocked(initCollab)).toHaveBeenCalledWith('pb');
    });

    it('同项目网络错误重试不二次清空', async () => {
      mockCanvasNodes = [paNode];
      localStorage.setItem('flowweb_projectId', 'p1');
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      mockFetch.mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ code: 0, data: { id: 'p1', name: 'X', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } }),
      });

      render(<MemoryRouter><CanvasPage /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByText('重试')).toBeInTheDocument();
      });

      (useCanvasStoreSetState as ReturnType<typeof vi.fn>).mockClear();
      fireEvent.click(screen.getByText('重试'));
      await waitFor(() => {
        expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
      });

      const clearCalls = (useCanvasStoreSetState as ReturnType<typeof vi.fn>).mock.calls
        .filter(([s]: any[]) => isFullClear(s));
      expect(clearCalls).toHaveLength(0);
    });

    it('无参新建路径先清空残留（首页开始创作场景）', async () => {
      mockCanvasNodes = [paNode];
      (useCanvasStoreSetState as ReturnType<typeof vi.fn>).mockClear();
      // beforeEach 已清 localStorage → 无 key → 走创建路径
      render(<MemoryRouter><CanvasPage /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
      });

      const calls = (useCanvasStoreSetState as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][0]?.nodes).toEqual([]);
    });
  });

  describe('StrictMode 创建去重（Fix 9）', () => {
    const createOk = {
      ok: true,
      status: 200,
      json: () => Promise.resolve({ code: 0, data: { templateId: 't-new', projectId: 'new-pid', name: '未命名项目1' } }),
    };

    it('StrictMode 双执行 effect 仅创建一次画布', async () => {
      mockFetch.mockResolvedValue(createOk);

      render(
        <React.StrictMode>
          <MemoryRouter><CanvasPage /></MemoryRouter>
        </React.StrictMode>,
      );
      await waitFor(() => {
        expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
      });

      const posts = mockFetch.mock.calls.filter((c: any[]) => c[1]?.method === 'POST');
      expect(posts.length).toBe(1);
      expect(String(posts[0][0])).toContain('/api/canvases');
    });

    it('创建失败后重试可重新创建（共享 promise 失败即重置）', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      mockFetch.mockResolvedValue(createOk);

      render(<MemoryRouter><CanvasPage /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByText('重试')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('重试'));
      await waitFor(() => {
        expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
      });

      const posts = mockFetch.mock.calls.filter((c: any[]) => c[1]?.method === 'POST');
      expect(posts.length).toBe(2);
    });
  });

  describe('新建画布组（批0a）', () => {
    const createOkResponse = {
      ok: true,
      status: 200,
      json: () => Promise.resolve({ code: 0, data: { templateId: 't-new', projectId: 'new-pid', name: '未命名画布', teamId: 't-create' } }),
    };

    it('404 回退路径：initCollab 以新 id 被调用（R5 复发锚——今天早退不建会话）', async () => {
      localStorage.setItem('flowweb_projectId', 'p1');
      mockFetch.mockImplementation((url: any, init?: any) => {
        if (init?.method === 'POST') return Promise.resolve(createOkResponse);
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ code: -1 }) });
      });

      render(<MemoryRouter><CanvasPage /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
      });

      const { initCollab } = await import('@/stores/canvasCollabRuntime');
      expect(vi.mocked(initCollab)).toHaveBeenCalledWith('new-pid');
    });

    it('F14：5xx → unavailable 错误态 + 重试行动，initCollab 零调用、storedId 指针不变（不散射新画布）', async () => {
      localStorage.setItem('flowweb_projectId', 'p1');
      mockFetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({ code: -1 }) });
      // 文件级共享 mock——清上一用例（404 回退）的调用记录，保"零调用"断言语义纯净
      const { initCollab } = await import('@/stores/canvasCollabRuntime');
      vi.mocked(initCollab).mockClear();

      render(<MemoryRouter><CanvasPage /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByText('画布加载失败，请检查网络后重试')).toBeInTheDocument();
      });

      expect(screen.getByText('重试')).toBeInTheDocument();
      // 不散射：unavailable 错误态不提供"新建画布"入口（防覆写真实画布指针的数据入口事故）
      expect(screen.queryByText('新建画布')).not.toBeInTheDocument();
      expect(localStorage.getItem('flowweb_projectId')).toBe('p1');
      const posts = mockFetch.mock.calls.filter((c: any[]) => c[1]?.method === 'POST');
      expect(posts.length).toBe(0);
      expect(vi.mocked(initCollab)).not.toHaveBeenCalled();
    });

    it('403：不清 localStorage、不自动新建、loadError=inaccessible（与 404/5xx 三义分家锚）', async () => {
      localStorage.setItem('flowweb_projectId', 'p1');
      mockFetch.mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({ code: -1 }) });

      render(<MemoryRouter><CanvasPage /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByText('画布不存在或无权访问')).toBeInTheDocument();
      });

      expect(localStorage.getItem('flowweb_projectId')).toBe('p1');
      const posts = mockFetch.mock.calls.filter((c: any[]) => c[1]?.method === 'POST');
      expect(posts.length).toBe(0);
    });
  });

  describe('批2-1：openSession 首行置 pending（顺序锚——setHydration 先于 initCollab）', () => {
    beforeEach(() => {
      localStorage.clear();
      useMenuStore.setState({ isOpen: false });
      mockCanvasNodes = [];
      mockHydration = 'ready';
      setHydrationMock.mockClear();
      mockFetch.mockReset();
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ code: 0, data: { id: 'test-pid-123', projectId: 'test-pid-123', templateId: 't-1', name: '我的画布' } }),
      });
    });

    it('setHydration("pending") 的首次调用先于 initCollab 首调（先于任何渲染就绪）', async () => {
      const { initCollab } = await import('@/stores/canvasCollabRuntime');
      vi.mocked(initCollab).mockClear();
      render(<MemoryRouter><CanvasPage /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
      });

      const initOrder = vi.mocked(initCollab).mock.invocationCallOrder[0];
      expect(initOrder).toBeGreaterThan(0);
      const pendingOrders = setHydrationMock.mock.invocationCallOrder.filter(
        (_: number, i: number) => setHydrationMock.mock.calls[i][0] === 'pending',
      );
      expect(pendingOrders.length).toBeGreaterThan(0);
      expect(Math.min(...pendingOrders)).toBeLessThan(initOrder); // openSession 首行 pending 先于 initCollab
    });
  });

  it('should show add node menu when + button is clicked', async () => {
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('添加节点'));
    expect(screen.getByText('文本')).toBeInTheDocument();
    expect(screen.getByText('图片')).toBeInTheDocument();
  });

  it('should close add node menu on Escape', async () => {
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('添加节点'));
    expect(screen.getByText('文本')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('文本')).not.toBeInTheDocument();
  });

  it('should show shortcuts panel when shortcuts button is clicked', async () => {
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByLabelText('快捷键')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('快捷键'));
    expect(screen.getByText('创作')).toBeInTheDocument();
    expect(screen.getByText('缩放')).toBeInTheDocument();
  });

  it('should close shortcuts panel when close button is clicked', async () => {
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByLabelText('快捷键')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('快捷键'));
    expect(screen.getByText('创作')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('关闭快捷键面板'));
    await waitFor(() => {
      expect(screen.queryByText('创作')).not.toBeInTheDocument();
    });
  });
});

describe('批2-1 蒙层分型（hydration 三态渲染）', () => {
  beforeEach(() => {
    localStorage.clear();
    useMenuStore.setState({ isOpen: false });
    mockCanvasNodes = [];
    mockHydration = 'ready';
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ code: 0, data: { id: 'test-pid-123', projectId: 'test-pid-123', templateId: 't-1', name: '我的画布' } }),
    });
  });

  it('pending → 非阻断骨架：pointer-events-none（不锁交互）+「正在同步」+ a11y', async () => {
    mockHydration = 'pending';
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    const overlay = await screen.findByTestId('hydrate-overlay');
    expect(overlay).toHaveAttribute('role', 'status');
    expect(overlay.className).toContain('inset-0');
    expect(overlay.className).toContain('z-40');
    // 非阻断锚（类名断言——jsdom computed style 不完整）：pending 骨架不锁交互
    expect(overlay).toHaveClass('pointer-events-none');
    expect(overlay).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('正在同步')).toBeInTheDocument();
  });

  it('idle → 蒙层「画布会话未建立」+ dev console.error（非抛错——切项目窗口为正常瞬态）', async () => {
    mockHydration = 'idle';
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    expect(await screen.findByText('画布会话未建立')).toBeInTheDocument();
    await waitFor(() => {
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('hydration=idle'));
    });
    errSpy.mockRestore();
  });

  it('failed → 全屏重试行动：「重试连接」+ role=alert（10s 超时——修D 蒙层）', async () => {
    mockHydration = 'failed';
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    const overlay = await screen.findByTestId('offline-overlay');
    expect(overlay).toHaveAttribute('role', 'alert');
    expect(screen.getByText('重试连接')).toBeInTheDocument();
  });

  it('ready → 无蒙层', async () => {
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('hydrate-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('offline-overlay')).not.toBeInTheDocument();
  });
});

describe('TD-4 hydrate 键盘守卫（批2-1：hydration 非 ready 禁快捷键）', () => {
  beforeEach(() => {
    localStorage.clear();
    useMenuStore.setState({ isOpen: false });
    mockCanvasNodes = [];
    mockHydration = 'ready';
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ code: 0, data: { id: 'test-pid-123', projectId: 'test-pid-123', templateId: 't-1', name: '我的画布' } }),
    });
  });

  it('hydration=pending 时 Tab 不开 AddNodeMenu（会话建立/水合窗口封键盘路径）', async () => {
    mockHydration = 'pending';
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
    });
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(useMenuStore.getState().isOpen).toBe(false);
  });

  it('hydration=ready 时 Tab 正常开菜单', async () => {
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
    });
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(useMenuStore.getState().isOpen).toBe(true);
    useMenuStore.setState({ isOpen: false });
  });

  it('参考选择模式期 Tab 不弹 AddNodeMenu（spec §3.1 gate）', async () => {
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
    });
    // 一次 Tab 有两次 getState 消费：useGroupKeyboard.isGroupEditContext 先注册先触发吃一次，page Tab gate 吃一次——链两个 once
    const refState = {
      nodes: {},
      activeTransformNodeId: null,
      activeEditNodeId: null,
      referenceSelect: { sourceNodeId: 'img1', notice: null },
      exitReferenceSelect: vi.fn(),
      setActiveTransformNodeId: vi.fn(),
      setActiveEditNodeId: vi.fn(),
    } as any;
    vi.mocked(useNodeStore.getState).mockReturnValueOnce(refState).mockReturnValueOnce(refState);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(useMenuStore.getState().isOpen).toBe(false);
  });

  describe('folderPath 面包屑', () => {
    const projectResponse = {
      ok: true,
      status: 200,
      json: () => Promise.resolve({ code: 0, data: { id: 'p1', name: '我的画布', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } }),
    };

    function mockByUrl({ folder, folders }: { folder?: { folderId: string | null }; folders?: { id: string; name: string; parentId: string | null }[] } = {}) {
      mockFetch.mockImplementation((url: string) => {
        // 注意用 endsWith：'/api/folders'.includes('/folder') 为 true，会误拦截
        if (url.endsWith('/folder')) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ code: 0, data: folder ?? { folderId: null } }) });
        }
        if (url === '/api/folders') {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ code: 0, data: { folders: folders ?? [] } }) });
        }
        return Promise.resolve(projectResponse);
      });
    }

    it('folderId 非空：请求 folders 并渲染嵌套层级路径', async () => {
      mockByUrl({
        folder: { folderId: 'f2' },
        folders: [
          { id: 'f1', name: '设计稿', parentId: null },
          { id: 'f2', name: '子文件夹', parentId: 'f1' },
        ],
      });
      render(<MemoryRouter initialEntries={['/canvas?projectId=p1']}><CanvasPage /></MemoryRouter>);

      expect(await screen.findByText('设计稿/子文件夹/')).toBeInTheDocument();
      expect(mockFetch.mock.calls.some((c: any[]) => c[0] === '/api/folders')).toBe(true);
    });

    it('folderId 为空：显示 主目录/ 且不请求 /api/folders', async () => {
      mockByUrl({ folder: { folderId: null } });
      render(<MemoryRouter initialEntries={['/canvas?projectId=p1']}><CanvasPage /></MemoryRouter>);

      expect(await screen.findByText('主目录/')).toBeInTheDocument();
      expect(mockFetch.mock.calls.every((c: any[]) => c[0] !== '/api/folders')).toBe(true);
    });

    it('folderId 指向的文件夹已删除（不在列表）：回退主目录', async () => {
      mockByUrl({ folder: { folderId: 'ghost' }, folders: [{ id: 'f1', name: '设计稿', parentId: null }] });
      render(<MemoryRouter initialEntries={['/canvas?projectId=p1']}><CanvasPage /></MemoryRouter>);

      expect(await screen.findByText('主目录/')).toBeInTheDocument();
    });

    it('StrictMode 下迟到的 folder 响应不覆盖新一轮结果', async () => {
      let resolveStale!: (v: any) => void;
      let firstFolderCall = true;
      const foldersData = [
        { id: 'f1', name: '设计稿', parentId: null },
        { id: 'f2', name: '子文件夹', parentId: 'f1' },
      ];
      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith('/folder') && firstFolderCall) {
          firstFolderCall = false;
          return new Promise((r) => { resolveStale = r; }); // 第一轮：慢，将被取消
        }
        if (url.endsWith('/folder')) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ code: 0, data: { folderId: 'f2' } }) });
        }
        if (url === '/api/folders') {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ code: 0, data: { folders: foldersData } }) });
        }
        return Promise.resolve(projectResponse);
      });

      render(
        <MemoryRouter initialEntries={['/canvas?projectId=p1']}>
          <React.StrictMode><CanvasPage /></React.StrictMode>
        </MemoryRouter>,
      );

      // 第二轮（有效）完成 → 嵌套路径渲染
      expect(await screen.findByText('设计稿/子文件夹/')).toBeInTheDocument();

      // 第一轮（已取消）迟到返回 folderId 指向 f1 链 —— 若实现未做 cancelled 守卫，前缀会被覆盖为 设计稿/
      resolveStale({ ok: true, status: 200, json: () => Promise.resolve({ code: 0, data: { folderId: 'f1' } }) });
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.getByText('设计稿/子文件夹/')).toBeInTheDocument();
    });

    it('切换 projectId 后旧路径清除，回退主目录', async () => {
      function SwitchHarness() {
        const navigate = useNavigate();
        return (
          <div>
            <button type="button" onClick={() => navigate('/canvas?projectId=p2')}>切P2</button>
            <CanvasPage />
          </div>
        );
      }

      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith('/folder') && url.includes('/p1')) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ code: 0, data: { folderId: 'f2' } }) });
        }
        if (url.endsWith('/folder') && url.includes('/p2')) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ code: 0, data: { folderId: null } }) });
        }
        if (url === '/api/folders') {
          return Promise.resolve({
            ok: true, status: 200,
            json: () => Promise.resolve({ code: 0, data: { folders: [
              { id: 'f1', name: '设计稿', parentId: null },
              { id: 'f2', name: '子文件夹', parentId: 'f1' },
            ] } }),
          });
        }
        if (url.includes('/p1')) {
          return Promise.resolve({
            ok: true, status: 200,
            json: () => Promise.resolve({ code: 0, data: { id: 'p1', name: 'P1', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } }),
          });
        }
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ code: 0, data: { id: 'p2', name: 'P2', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } }),
        });
      });

      render(
        <MemoryRouter initialEntries={['/canvas?projectId=p1']}>
          <SwitchHarness />
        </MemoryRouter>,
      );

      // p1：嵌套路径渲染
      expect(await screen.findByText('设计稿/子文件夹/')).toBeInTheDocument();

      // 切到 p2（根目录画布）
      fireEvent.click(screen.getByText('切P2'));

      // 旧路径必须清除，回退主目录
      expect(await screen.findByText('主目录/')).toBeInTheDocument();
      expect(screen.queryByText('设计稿/子文件夹/')).not.toBeInTheDocument();
    });
  });
});
