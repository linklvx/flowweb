import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import React from 'react';
import { message } from 'antd';
import { CanvasPage } from './page';
import { useMenuStore } from '@/stores/menuStore';

vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Test', email: 'test@test.com' }, loading: false, logout: vi.fn(), refresh: vi.fn() }),
  AuthProvider: ({ children }: any) => children,
}));

vi.mock('@/stores/canvasHistoryRuntime', () => ({
  withHistoryPaused: (fn: () => any) => fn(),   // 直通执行（mock canvasStore 无 temporal）
  hydrateLoaded: vi.fn(),
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// 按用例注入 canvasStore 节点（模拟"canvasStore 有节点但 nodeStore 无对应数据"的刷新竞态）
let mockCanvasNodes: any[] = [];
// 按用例注入 hydrate 窗口状态（TD-4 遮罩/键盘守卫）
let mockIsHydrating = false;

const { useCanvasStoreSetState, useNodeStoreSetState } = vi.hoisted(() => ({
  useCanvasStoreSetState: vi.fn(),
  useNodeStoreSetState: vi.fn(),
}));

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: Object.assign(
    vi.fn((selector?: any) => {
      const state = {
        nodes: mockCanvasNodes,
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        selectedId: null,
        isHydrating: mockIsHydrating,
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
        isHydrating: mockIsHydrating,
        setHydrating: vi.fn(),
        updateViewport: vi.fn(),
        onNodesChange: vi.fn(),
        onEdgesChange: vi.fn(),
        setProjectId: vi.fn(),
        setNodeDraggable: vi.fn(),
        nodeProcessMap: {},
        applyGroupDerivations: vi.fn(),
        refitGroupBounds: vi.fn(),
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
    mockIsHydrating = false;
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

  describe('loadProjectIntoStore 双防护（Fix 3）', () => {
    const emptyDbResponse = {
      ok: true,
      status: 200,
      json: () => Promise.resolve({ code: 0, data: { id: 'p1', name: 'X', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } }),
    };

    it('StrictMode 下迟到的前次响应不覆盖 store（cancelled 守卫）', async () => {
      let resolveA!: (v: any) => void;
      const nodeFromA = [{ id: 'stale-node', type: 'imageGen', position: { x: 0, y: 0 }, data: {} }];
      mockFetch.mockImplementationOnce(() => new Promise((r) => { resolveA = r; })); // fetch A：慢
      mockFetch.mockImplementationOnce(() => Promise.resolve(emptyDbResponse));      // fetch B：快

      render(
        <MemoryRouter initialEntries={['/canvas?projectId=p1']}>
          <React.StrictMode><CanvasPage /></React.StrictMode>
        </MemoryRouter>,
      );
      // fetch B（有效）先完成 → 画布渲染
      await waitFor(() => {
        expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
      });

      // fetch A（已取消）迟到返回带节点的数据 → 不应写入 store
      const setStateCallsBefore = (useCanvasStoreSetState as ReturnType<typeof vi.fn>).mock.calls.length;
      resolveA({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ code: 0, data: { id: 'p1', name: 'X', nodes: nodeFromA, edges: [], viewport: { x: 0, y: 0, zoom: 1 } } }),
      });
      await new Promise((r) => setTimeout(r, 50));

      const calls = (useCanvasStoreSetState as ReturnType<typeof vi.fn>).mock.calls;
      const staleWrite = calls.slice(setStateCallsBefore).some((args: any[]) =>
        args[0]?.nodes?.some((n: any) => n.id === 'stale-node'),
      );
      expect(staleWrite).toBe(false);
    });

    it('DB 空节点且 localStorage 有数据时不覆盖 store（DB 空守卫）', async () => {
      localStorage.setItem('flowweb_canvas_v2_p1', JSON.stringify({
        version: 2,
        nodes: { n1: { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } },
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }));
      mockFetch.mockResolvedValue(emptyDbResponse);
      (useCanvasStoreSetState as ReturnType<typeof vi.fn>).mockClear();
      (useNodeStoreSetState as ReturnType<typeof vi.fn>).mockClear();

      render(<MemoryRouter initialEntries={['/canvas?projectId=p1']}><CanvasPage /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
      });

      // 全量形状（nodes+edges+viewport）写入：Fix 5 清空 1 次 + hook 快照恢复 1 次；DB 空响应未覆盖
      const fullWrites = (useCanvasStoreSetState as ReturnType<typeof vi.fn>).mock.calls
        .filter(([s]: any[]) => 'nodes' in s && 'edges' in s && 'viewport' in s);
      expect(fullWrites).toHaveLength(2);
      expect(fullWrites[0][0].nodes).toEqual([]);
      expect(fullWrites[1][0].nodes.map((n: any) => n.id)).toEqual(['n1']);
      // nodeStore 侧仅清空 1 次空对象；恢复 effect 写入的是本地非空数据，不计入
      const emptyNodeWrites = (useNodeStoreSetState as ReturnType<typeof vi.fn>).mock.calls
        .filter(([s]: any[]) => s?.nodes && Object.keys(s.nodes).length === 0);
      expect(emptyNodeWrites).toHaveLength(1);
    });

    it('DB 空节点且本地也空时正常写入空（新建首载）', async () => {
      mockFetch.mockResolvedValue(emptyDbResponse);
      (useCanvasStoreSetState as ReturnType<typeof vi.fn>).mockClear();

      render(<MemoryRouter initialEntries={['/canvas?projectId=p1']}><CanvasPage /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
      });

      // Fix 5 清空(1) + DB 空数据正常写入(1)
      const fullWrites = (useCanvasStoreSetState as ReturnType<typeof vi.fn>).mock.calls
        .filter(([s]: any[]) => 'nodes' in s && 'edges' in s && 'viewport' in s);
      expect(fullWrites).toHaveLength(2);
    });

    it('快照 key 为截断 JSON 时不抛错且脏 key 被清除', async () => {
      localStorage.setItem('flowweb_canvas_v2_p1', '{"nodes": {"n1": {"prom');
      mockFetch.mockResolvedValue(emptyDbResponse);

      let renderError: Error | null = null;
      try {
        render(<MemoryRouter initialEntries={['/canvas?projectId=p1']}><CanvasPage /></MemoryRouter>);
        await waitFor(() => {
          expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
        });
      } catch (e) {
        renderError = e as Error;
      }
      expect(renderError).toBeNull();
      expect(localStorage.getItem('flowweb_canvas_v2_p1')).toBeNull();
    });
  });

  describe('DB 加载组关系恢复（Bug F：parentId + extent + 父前子后）', () => {
    it('DB 节点带 parentId（乱序）→ 写入 store 含 parentId + extent:"parent" + 顺序父前子后', async () => {
      // DB 返回子在前父在后（服务端同步排序正常时父在前；此用例防御任意顺序）
      const dbNodes = [
        { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 0, y: 0 }, data: {} },
        { id: 'c2', type: 'imageGen', parentId: 'g1', position: { x: 0, y: 0 }, data: {} },
        { id: 'g1', type: 'group', position: { x: 100, y: 100 }, data: { groupType: 'normal' } },
      ];
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ code: 0, data: { id: 'p1', name: 'X', nodes: dbNodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } } }),
      });
      (useCanvasStoreSetState as ReturnType<typeof vi.fn>).mockClear();

      render(<MemoryRouter initialEntries={['/canvas?projectId=p1']}><CanvasPage /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
      });

      const fullWrites = (useCanvasStoreSetState as ReturnType<typeof vi.fn>).mock.calls
        .filter(([s]: any[]) => 'nodes' in s && 'edges' in s && 'viewport' in s);
      // 最后一次全量写入是 DB 加载（此前可能有清空写入）
      const loaded = fullWrites[fullWrites.length - 1][0].nodes as any[];
      expect(loaded.map((n: any) => n.id)).toEqual(['g1', 'c1', 'c2']); // 父前子后
      const c1 = loaded.find((n: any) => n.id === 'c1');
      expect(c1.parentId).toBe('g1');
      expect(c1.extent).toBe('parent');
    });
  });

  describe('DB 加载空白节点尺寸（width/height null → undefined，动态尺寸）', () => {
    it('null 宽高节点写入两 store 均为 undefined，不再兜底 300', async () => {
      const dbNodes = [
        { id: 'b1', type: 'imageGen', position: { x: 0, y: 0 }, data: {}, width: null, height: null },
      ];
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ code: 0, data: { id: 'p1', name: 'X', nodes: dbNodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } } }),
      });
      (useCanvasStoreSetState as ReturnType<typeof vi.fn>).mockClear();
      (useNodeStoreSetState as ReturnType<typeof vi.fn>).mockClear();

      render(<MemoryRouter initialEntries={['/canvas?projectId=p1']}><CanvasPage /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
      });

      // canvasStore：最后一次全量写入是 DB 加载
      const fullWrites = (useCanvasStoreSetState as ReturnType<typeof vi.fn>).mock.calls
        .filter(([s]: any[]) => 'nodes' in s && 'edges' in s && 'viewport' in s);
      const b1 = (fullWrites[fullWrites.length - 1][0].nodes as any[]).find((n: any) => n.id === 'b1');
      expect(b1.width).toBeUndefined();
      expect(b1.height).toBeUndefined();

      // nodeStore：content 写入（loadProjectIntoStore 第二处）
      const nsWrite = (useNodeStoreSetState as ReturnType<typeof vi.fn>).mock.calls
        .filter(([s]: any[]) => s?.nodes?.b1)
        .pop() as any[];
      expect(nsWrite[0].nodes.b1.width).toBeUndefined();
      expect(nsWrite[0].nodes.b1.height).toBeUndefined();
    });
  });

  describe('DB 加载写入自动保存基准（serverVersion + saveStatus）', () => {
    it('hydrate 时全量写入含 version 与 saved 态（flush 乐观锁基准）', async () => {
      const dbNodes = [
        { id: 'b1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} },
      ];
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ code: 0, data: { id: 'p1', name: 'X', version: 7, nodes: dbNodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } } }),
      });
      (useCanvasStoreSetState as ReturnType<typeof vi.fn>).mockClear();

      render(<MemoryRouter initialEntries={['/canvas?projectId=p1']}><CanvasPage /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
      });

      // 含 serverVersion 的全量写入仅 DB 加载一次（Fix 5 清空写入不含该字段）
      const hydrateWrites = (useCanvasStoreSetState as ReturnType<typeof vi.fn>).mock.calls
        .filter(([s]: any[]) => 'nodes' in s && 'edges' in s && 'viewport' in s && 'serverVersion' in s);
      expect(hydrateWrites).toHaveLength(1);
      expect(hydrateWrites[0][0].serverVersion).toBe(7);
      expect(hydrateWrites[0][0].saveStatus).toBe('saved');
    });
  });

  describe('恢复最近项目与分级降级（Fix 1）', () => {
    const dbOkResponse = (id: string) => ({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ code: 0, data: { id, name: 'DB画布', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } }),
    });
    const createOkResponse = {
      ok: true,
      status: 200,
      json: () => Promise.resolve({ code: 0, data: { templateId: 't-new', projectId: 'new-pid', name: '未命名项目4' } }),
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
      const gets = mockFetch.mock.calls.filter((c: any[]) => !c[1]);
      expect(gets.some((c: any[]) => String(c[0]).includes('/api/projects/p1'))).toBe(true);
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

    it('B-2：加载失败路径清空历史栈（hydrateLoaded 被调，防跨项目 undo 污染）', async () => {
      localStorage.setItem('flowweb_projectId', 'p1');
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

      render(<MemoryRouter><CanvasPage /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByText('重试')).toBeInTheDocument();
      });

      const { hydrateLoaded } = await import('@/stores/canvasHistoryRuntime');
      expect(hydrateLoaded).toHaveBeenCalled();
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
      json: () => Promise.resolve({ code: 0, data: { id, name: 'X', nodes: [{ id: nodeId, type: 'imageGen', position: { x: 0, y: 0 }, data: {} }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } }),
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
      fireEvent.click(screen.getByText('去P_b'));
      await waitFor(() => {
        expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
      });

      const calls = (useCanvasStoreSetState as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      // 清空（空 nodes）必须先于加载写入（node_pb）
      expect(calls[0][0]?.nodes).toEqual([]);
      expect(calls.some((c: any[]) => c[0]?.nodes?.some((n: any) => n.id === 'node_pb'))).toBe(true);
      expect(calls.some((c: any[]) => c[0]?.nodes?.some((n: any) => n.id === 'node_pa'))).toBe(false);
      expect((useNodeStoreSetState as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({ nodes: {} });
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

describe('TD-4 hydrate 遮罩', () => {
  beforeEach(() => {
    localStorage.clear();
    useMenuStore.setState({ isOpen: false });
    mockCanvasNodes = [];
    mockIsHydrating = false;
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ code: 0, data: { id: 'test-pid-123', projectId: 'test-pid-123', templateId: 't-1', name: '我的画布' } }),
    });
  });

  it('isHydrating=true 时渲染遮罩：覆盖全屏（inset-0/z-40）、不穿透指针、带 a11y 属性', async () => {
    mockIsHydrating = true;
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    const overlay = await screen.findByTestId('hydrate-overlay');
    expect(overlay).toHaveAttribute('role', 'status');
    expect(overlay.className).toContain('inset-0');
    expect(overlay.className).toContain('z-40');
    // C2：类名断言（jsdom computed style 不完整）——默认 pointer-events auto 即阻断
    expect(overlay).not.toHaveClass('pointer-events-none');
    expect(overlay).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('画布加载中')).toBeInTheDocument();
  });

  it('isHydrating=false 时无遮罩', async () => {
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('hydrate-overlay')).not.toBeInTheDocument();
  });
});

describe('TD-4 hydrate 键盘守卫', () => {
  beforeEach(() => {
    localStorage.clear();
    useMenuStore.setState({ isOpen: false });
    mockCanvasNodes = [];
    mockIsHydrating = false;
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ code: 0, data: { id: 'test-pid-123', projectId: 'test-pid-123', templateId: 't-1', name: '我的画布' } }),
    });
  });

  it('isHydrating=true 时 Tab 不开 AddNodeMenu', async () => {
    mockIsHydrating = true;
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
    });
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(useMenuStore.getState().isOpen).toBe(false);
  });

  it('isHydrating=false 时 Tab 正常开菜单', async () => {
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
    });
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(useMenuStore.getState().isOpen).toBe(true);
    useMenuStore.setState({ isOpen: false });
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
