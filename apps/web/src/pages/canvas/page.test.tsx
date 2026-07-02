import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { CanvasPage } from './page';
import { useMenuStore } from '@/stores/menuStore';

vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Test', email: 'test@test.com' }, loading: false, logout: vi.fn(), refresh: vi.fn() }),
  AuthProvider: ({ children }: any) => children,
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: Object.assign(
    vi.fn((selector?: any) => {
      const state = {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        selectedId: null,
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
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        updateViewport: vi.fn(),
        onNodesChange: vi.fn(),
        onEdgesChange: vi.fn(),
        setProjectId: vi.fn(),
        nodeProcessMap: {},
      })),
      setState: vi.fn(),
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
      setState: vi.fn(),
    }
  ),
}));

vi.mock('@/stores/materialLibraryStore', () => ({
  useMaterialLibraryStore: (selector: any) => selector({
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
  }),
}));

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
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ code: 0, data: { id: 'test-pid-123', name: '我的画布' } }),
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
