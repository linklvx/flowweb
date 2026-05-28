import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { CanvasPage } from './page';

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

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, useParams: () => ({}) };
});

describe('CanvasPage', () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetch.mockReset();
    // Mock: first call is project creation (POST /api/projects)
    // Second call would be GET /api/projects/:id if cached
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
      expect(screen.getByText('文本输入')).toBeInTheDocument();
    });
    expect(screen.getByText('图片生成')).toBeInTheDocument();
    expect(screen.getByText('视频生成')).toBeInTheDocument();
  });

  it('should render ReactFlow canvas after project creation', async () => {
    const { container } = render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    await waitFor(() => {
      expect(container.querySelector('.react-flow')).toBeInTheDocument();
    });
  });

  it('should render shortcuts button in NodePalette after load', async () => {
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('快捷键')).toBeInTheDocument();
    });
  });

  it('should show shortcuts panel when button is clicked', async () => {
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('快捷键')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('快捷键'));
    expect(screen.getByText('创作')).toBeInTheDocument();
    expect(screen.getByText('缩放')).toBeInTheDocument();
  });

  it('should close shortcuts panel when close button is clicked', async () => {
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('快捷键')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('快捷键'));
    expect(screen.getByText('创作')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('关闭快捷键面板'));
    await waitFor(() => {
      expect(screen.queryByText('创作')).not.toBeInTheDocument();
    });
  });
});
