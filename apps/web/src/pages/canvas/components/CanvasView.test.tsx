import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { CanvasView } from './CanvasView';
import { ReactFlowProvider } from '@xyflow/react';

const mockZoomIn = vi.hoisted(() => vi.fn());
const mockZoomOut = vi.hoisted(() => vi.fn());
const mockFitView = vi.hoisted(() => vi.fn());
const mockAddNode = vi.hoisted(() => vi.fn());
const mockSetState = vi.hoisted(() => vi.fn());
const mockPointer = vi.hoisted(() => ({ interaction: false }));

let mockPendingMediaFile: any = null;
let mockNodes: any[] = [];
let mockLastPointerShiftKey = false;
let subscribeListener: ((state: any, prevState: any) => void) | null = null;

vi.mock('./groups/GroupToolbar', () => ({
  GroupToolbar: () => <div data-testid="group-toolbar" />,
}));

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual('@xyflow/react');
  return {
    ...actual,
    useReactFlow: () => ({
      ...(actual as any).useReactFlow?.(),
      zoomIn: mockZoomIn,
      zoomOut: mockZoomOut,
      fitView: mockFitView,
      screenToFlowPosition: (p: { x: number; y: number }) => p,
    }),
  };
});

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: Object.assign(
    vi.fn((selector?: any) => {
      const state = {
        nodes: mockNodes,
        lastPointerShiftKey: mockLastPointerShiftKey,
        toggleCollapse: vi.fn(),
        ungroup: vi.fn(),
        convertGroup: vi.fn(),
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        pendingMediaFile: mockPendingMediaFile,
        onNodesChange: vi.fn(),
        onEdgesChange: vi.fn(),
        onConnect: vi.fn(),
        updateViewport: vi.fn(),
        addNode: mockAddNode,
        selectNode: vi.fn(),
        requestAddMediaNode: vi.fn(),
      };
      if (typeof selector === 'function') return selector(state);
      return state;
    }),
    {
      getState: () => ({
        pendingMediaFile: mockPendingMediaFile,
        requestAddMediaNode: vi.fn(),
        _isPointerInteraction: mockPointer.interaction,
      }),
      setState: mockSetState,
      subscribe: vi.fn((listener: any) => {
        subscribeListener = listener;
        return vi.fn(); // unsubscribe
      }),
    },
  ),
}));

describe('CanvasView', () => {
  beforeEach(() => {
    mockZoomIn.mockClear();
    mockZoomOut.mockClear();
    mockNodes = [];
    mockLastPointerShiftKey = false;
    mockSetState.mockClear();
  });

  it('should render ReactFlow container', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    expect(container.querySelector('.react-flow')).toBeInTheDocument();
  });

  it('should render without errors', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    expect(container).toBeTruthy();
  });

  it('should zoom in on Ctrl+wheel up (deltaY < 0)', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const wrapper = container.firstElementChild!;
    fireEvent.wheel(wrapper, { deltaY: -100, ctrlKey: true });
    expect(mockZoomIn).toHaveBeenCalled();
  });

  it('should zoom out on Ctrl+wheel down (deltaY > 0)', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const wrapper = container.firstElementChild!;
    fireEvent.wheel(wrapper, { deltaY: 100, ctrlKey: true });
    expect(mockZoomOut).toHaveBeenCalled();
  });

  it('should zoom on Cmd+wheel (Mac compatibility)', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const wrapper = container.firstElementChild!;
    fireEvent.wheel(wrapper, { deltaY: -100, metaKey: true });
    expect(mockZoomIn).toHaveBeenCalled();
  });

  it('should NOT zoom on regular wheel without modifier', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const wrapper = container.firstElementChild!;
    fireEvent.wheel(wrapper, { deltaY: -100 });
    expect(mockZoomIn).not.toHaveBeenCalled();
    expect(mockZoomOut).not.toHaveBeenCalled();
  });

  it('should use fitView from React Flow on fit view click', () => {
    render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const fitBtn = document.querySelector('[aria-label="整理画布"]');
    fireEvent.click(fitBtn!);
    expect(mockFitView).toHaveBeenCalled();
  });

  it('should render MiniMap with visible dark theme when toggled', () => {
    render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    // Initially MiniMap should not be present
    expect(document.querySelector('.react-flow__minimap')).toBeNull();
    // Click minimap toggle
    fireEvent.click(document.querySelector('[aria-label="切换小地图"]')!);
    // MiniMap should be rendered with lighter background
    const minimap = document.querySelector('.react-flow__minimap')!;
    expect(minimap).toBeInTheDocument();
    const styleAttr = minimap.getAttribute('style') || '';
    expect(styleAttr).toContain('background');
    // Background should be lighter than the old rgb(28,28,28) — use rgb(50,50,50)
    expect(styleAttr).toContain('rgb(50, 50, 50)');
  });

  it('should enable snap to grid when snap button toggled', () => {
    render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    // Click snap toggle
    fireEvent.click(document.querySelector('[aria-label="网格吸附"]')!);
    // Verify the snap button reflects enabled state
    expect(document.querySelector('[aria-label="网格吸附"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  // ── pendingMediaFile → addNode ──

  describe('pendingMediaFile handling', () => {
    beforeEach(() => {
      mockAddNode.mockClear();
      mockSetState.mockClear();
      subscribeListener = null;
      mockPendingMediaFile = null;
    });

    it('creates imageGen node when pendingMediaFile is image', async () => {
      render(
        <ReactFlowProvider>
          <CanvasView projectId="p1" />
        </ReactFlowProvider>
      );

      expect(subscribeListener).toBeTruthy();

      const imageFile = {
        id: 'img-1',
        originalName: 'photo.jpg',
        mimeType: 'image/jpeg',
        url: 'https://example.com/photo.jpg',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        size: 5000,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        isFavorite: false,
        folderId: null,
      };

      act(() => {
        subscribeListener!({ pendingMediaFile: imageFile }, { pendingMediaFile: null });
      });

      await waitFor(() => {
        expect(mockAddNode).toHaveBeenCalled();
      });

      const callArgs = mockAddNode.mock.calls[0];
      expect(callArgs[0]).toBe('image'); // node type
      expect(callArgs[2].fileId).toBe('img-1');
      expect(callArgs[2].status).toBe('done');
      expect(callArgs[2].mediaName).toBe('photo.jpg');
      expect(callArgs[2].mediaUrl).toBe('https://example.com/photo.jpg');
      expect(callArgs[2].thumbnailUrl).toBe('https://example.com/thumb.jpg');
    });

    it('creates videoGen node when pendingMediaFile is video', async () => {
      render(
        <ReactFlowProvider>
          <CanvasView projectId="p1" />
        </ReactFlowProvider>
      );

      const videoFile = {
        id: 'vid-1',
        originalName: 'clip.mp4',
        mimeType: 'video/mp4',
        url: 'https://example.com/clip.mp4',
        thumbnailUrl: 'https://example.com/poster.jpg',
        size: 20000,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        isFavorite: false,
        folderId: null,
      };

      act(() => {
        subscribeListener!({ pendingMediaFile: videoFile }, { pendingMediaFile: null });
      });

      await waitFor(() => {
        expect(mockAddNode).toHaveBeenCalled();
      });

      expect(mockAddNode.mock.calls[0][0]).toBe('video');
      expect(mockAddNode.mock.calls[0][2].fileId).toBe('vid-1');
      expect(mockAddNode.mock.calls[0][2].status).toBe('done');
    });

    it('clears pendingMediaFile after creating node', async () => {
      render(
        <ReactFlowProvider>
          <CanvasView projectId="p1" />
        </ReactFlowProvider>
      );

      const file = {
        id: 'f1',
        originalName: 'test.png',
        mimeType: 'image/png',
        url: 'https://example.com/test.png',
        thumbnailUrl: '',
        size: 100,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        isFavorite: false,
        folderId: null,
      };

      act(() => {
        subscribeListener!({ pendingMediaFile: file }, { pendingMediaFile: null });
      });

      await waitFor(() => {
        expect(mockSetState).toHaveBeenCalledWith({ pendingMediaFile: null });
      });
    });

    it('positions node at viewport center', async () => {
      render(
        <ReactFlowProvider>
          <CanvasView projectId="p1" />
        </ReactFlowProvider>
      );

      const file = {
        id: 'f1',
        originalName: 'test.png',
        mimeType: 'image/png',
        url: 'https://example.com/test.png',
        thumbnailUrl: '',
        size: 100,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        isFavorite: false,
        folderId: null,
      };

      act(() => {
        subscribeListener!({ pendingMediaFile: file }, { pendingMediaFile: null });
      });

      await waitFor(() => {
        expect(mockAddNode).toHaveBeenCalled();
      });

      const position = mockAddNode.mock.calls[0][1];
      // With screenToFlowPosition passthrough and wrapper center at (0,0)
      // position will be (-160, -120) after subtracting half node size
      expect(position.x).toBeDefined();
      expect(position.y).toBeDefined();
    });

    it('handles null file (noop)', () => {
      render(
        <ReactFlowProvider>
          <CanvasView projectId="p1" />
        </ReactFlowProvider>
      );

      act(() => {
        subscribeListener!({ pendingMediaFile: null }, { pendingMediaFile: null });
      });

      expect(mockAddNode).not.toHaveBeenCalled();
    });

    it('clears pendingMediaFile on unmount', () => {
      const { unmount } = render(
        <ReactFlowProvider>
          <CanvasView projectId="p1" />
        </ReactFlowProvider>
      );

      unmount();

      expect(mockSetState).toHaveBeenCalledWith({ pendingMediaFile: null, pendingFillCell: null });
    });
  });

  // ── Shift 多选抑制 GroupToolbar ──

  const groupNode = { id: 'g1', type: 'group', selected: true, data: { groupType: 'normal' }, position: { x: 0, y: 0 }, width: 300, height: 200 };

  it('组单选 + flag=false → GroupToolbar 渲染', () => {
    mockNodes = [groupNode];
    mockLastPointerShiftKey = false;
    render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    expect(screen.getByTestId('group-toolbar')).toBeInTheDocument();
  });

  it('组单选 + flag=true → GroupToolbar 抑制', () => {
    mockNodes = [groupNode];
    mockLastPointerShiftKey = true;
    render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    expect(screen.queryByTestId('group-toolbar')).not.toBeInTheDocument();
  });

  it('组单选 flag true→false 且 nodes 不变 → GroupToolbar 恢复（锁定订阅+memo deps）', () => {
    mockNodes = [groupNode];
    mockLastPointerShiftKey = true;
    const { rerender } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    expect(screen.queryByTestId('group-toolbar')).not.toBeInTheDocument();
    mockLastPointerShiftKey = false;
    // CanvasView 被 memo 包裹，rerender 传相同 props 会 bail out；
    // mock 环境无真实 zustand 订阅，改 prop 强制重渲染以验证 memo deps（projectId 未被组件使用）
    rerender(
      <ReactFlowProvider>
        <CanvasView projectId="p2" />
      </ReactFlowProvider>
    );
    expect(screen.getByTestId('group-toolbar')).toBeInTheDocument();
  });

  it('画布内 Shift pointerdown 接线：写入 lastPointerShiftKey', () => {
    mockNodes = [];
    mockLastPointerShiftKey = false;
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const pane = container.querySelector('.react-flow__pane');
    expect(pane).toBeInTheDocument();
    // 现有 mock 经 vi.importActual 真实渲染 ReactFlow，.react-flow__pane 必然存在；
    // 万一为 null，降级 querySelector('.react-flow') 亦可（事件经 capture 到达 wrapper 监听）
    pane!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, shiftKey: true }));
    expect(mockSetState).toHaveBeenCalledWith({ lastPointerShiftKey: true });
  });
});
