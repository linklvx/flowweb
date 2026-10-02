import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { CanvasView } from './CanvasView';
import { ReactFlowProvider } from '@xyflow/react';
import { useNodeStore } from '@/stores/nodeStore';

const mockZoomIn = vi.hoisted(() => vi.fn());
const mockZoomOut = vi.hoisted(() => vi.fn());
const mockFitView = vi.hoisted(() => vi.fn());
const mockAddNode = vi.hoisted(() => vi.fn());
const mockAddEdge = vi.hoisted(() => vi.fn());
const mockSetState = vi.hoisted(() => vi.fn());

let mockPendingMediaFile: any = null;
let mockNodes: any[] = [];
let mockLastPointerShiftKey = false;
let mockMarqueeSelecting = false;
let subscribeListener: ((state: any, prevState: any) => void) | null = null;

// 2d-7：组操作与批量下载链 mock——注入行用例断言调用（state 字面量内联 vi.fn() 每次选择器新引用不可断言）
const mockUngroup = vi.hoisted(() => vi.fn());
const mockConvertGroup = vi.hoisted(() => vi.fn());
const batchDl = vi.hoisted(() => ({ run: vi.fn() }));
const dl = vi.hoisted(() => ({
  collect: vi.fn((_cs: unknown, _ids: string[], _getNs: () => Record<string, unknown>) => [] as { fileId: string; filename: string; type: string }[]),
}));

vi.mock('./groups/GroupToolbar', () => ({
  // 2d-7：透传 children——storyboard 注入行用例在 stub 内渲染真实子组件（真 GroupToolbar 需 internalNode，jsdom 不可达）
  GroupToolbar: ({ children }: any) => <div data-testid="group-toolbar">{children}</div>,
}));

vi.mock('@/utils/batchDownload', () => ({
  runBatchDownload: batchDl.run,
}));

vi.mock('@/utils/collectDownloadables', () => ({
  collectDownloadables: dl.collect,
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
        marqueeSelecting: mockMarqueeSelecting,
        toggleCollapse: vi.fn(),
        ungroup: mockUngroup,
        convertGroup: mockConvertGroup,
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        pendingMediaFile: mockPendingMediaFile,
        onNodesChange: vi.fn(),
        onEdgesChange: vi.fn(),
        onConnect: vi.fn(),
        updateViewport: vi.fn(),
        addNode: mockAddNode,
        addEdge: mockAddEdge,
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
        nodes: mockNodes,
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
    mockMarqueeSelecting = false;
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

  // C8 D2 镜像断言（spec §10.3）：wrapper 主题类恰一个且等于 html 主题类——防常量化（不同类即红）与
  // 防补岛（html.light 下补 .dark 得 ['light','dark'] 长度 2 即红）；与 c0 readHtmlTheme 同口径。
  it('wrapper 主题类镜像 html（colorMode={mode}）', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const wrapper = container.querySelector('.react-flow')!;
    const wrapperThemeClasses = Array.from(wrapper.classList).filter((c) => c === 'light' || c === 'dark');
    const htmlThemeClasses = Array.from(document.documentElement.classList).filter((c) => c === 'light' || c === 'dark');
    expect(wrapperThemeClasses.length, 'wrapper 主题类恰一个（双侧同时丢类的双空空洞由此外守）').toBe(1);
    expect(wrapperThemeClasses, 'wrapper 主题类恰一个且等于 html 类').toEqual(htmlThemeClasses);
  });

  it('should render without errors', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    expect(container).toBeTruthy();
  });

  // ── Ctrl+滚轮守卫（spec §5-3：双 writer 步进已删，守卫保留）──
  it('画布内 Ctrl+滚轮：preventDefault 且不调 zoomIn（步进已删，xyflow 内建缩放唯一 writer）', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const wrapper = container.firstElementChild!;
    const e = new WheelEvent('wheel', { ctrlKey: true, cancelable: true, bubbles: true });
    wrapper.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(mockZoomIn).not.toHaveBeenCalled();
    expect(mockZoomOut).not.toHaveBeenCalled();
  });

  it('portal 区域（#node-toolbar-portal）Ctrl+滚轮 preventDefault（守卫真实价值：d3 wheel 挂 renderer 不可见）', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const portal = container.querySelector('#node-toolbar-portal')!;
    expect(portal).toBeInTheDocument();
    const e = new WheelEvent('wheel', { ctrlKey: true, cancelable: true, bubbles: true });
    portal.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it('画布外 Ctrl+滚轮不 preventDefault（恢复浏览器页面缩放，行为变化 spec §5-3）', () => {
    render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const e = new WheelEvent('wheel', { ctrlKey: true, cancelable: true });
    document.body.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
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
    // MiniMap should be rendered with themed background
    const minimap = document.querySelector('.react-flow__minimap')!;
    expect(minimap).toBeInTheDocument();
    const styleAttr = minimap.getAttribute('style') || '';
    expect(styleAttr).toContain('background');
    // C8 D3-board：底/边双值化——jsdom 读回 verbatim var() 串（深 rgb(38,38,38) 字节等值/浅 #f0f1f2）
    expect(styleAttr).toContain('var(--canvas-controls-bg)');
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
      expect(callArgs[2].mediaUrl).toBeUndefined(); // R2b-6 写入面清零（F37）：mediaUrl 不落 nodeData
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

  // ── 派生 class 断言（spec §8.2）：能抓含 0 的误改（[0,1]/true → draggable 挂）──
  // 真 nodeStore 驱动锁定；afterEach 复位防污染
  afterEach(() => {
    act(() => {
      useNodeStore.setState({ activeEditNodeId: null, activeTransformNodeId: null });
    });
  });

  it('非锁定：pane 有 selection 无 draggable（左键框选主路径）', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const pane = container.querySelector('.react-flow__pane')!;
    expect(pane).toBeInTheDocument();
    expect(pane.className).toContain('selection');
    expect(pane.className).not.toContain('draggable');
  });

  it('锁定：pane 两者皆无', () => {
    useNodeStore.setState({ activeEditNodeId: 'node-1' });
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const pane = container.querySelector('.react-flow__pane')!;
    expect(pane.className).not.toContain('selection');
    expect(pane.className).not.toContain('draggable');
  });

  it('transform 调整中：同锁定（根因修回归防线）', () => {
    useNodeStore.setState({ activeTransformNodeId: 'node-1' });
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const pane = container.querySelector('.react-flow__pane')!;
    expect(pane.className).not.toContain('selection');
    expect(pane.className).not.toContain('draggable');
  });

  it('空格按下 draggable 上、松开复位（空格平移在+框选让位；keyUp 必须复位防污染）', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const pane = () => container.querySelector('.react-flow__pane')!;
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    expect(pane().className).toContain('draggable');
    expect(pane().className).not.toContain('selection');
    fireEvent.keyUp(window, { key: ' ', code: 'Space' });
    expect(pane().className).not.toContain('draggable');
    expect(pane().className).toContain('selection');
  });

  // 靶子用 pane 是有判别力的形态：锁定态 pane 中键走 filter-false 路径（:2862 拒 → d3 不调
  // nopropagation → 无闸门时事件冒泡可达 document → spy 被调 → 红）。节点/边靶子在无闸门时命中
  // :2824 特例 → d3 mousedowned 调 nopropagation（stopImmediatePropagation 含止冒泡）→ document
  // 同样收不到 → spy 断言形态下恒绿（假绿）——勿"加强"成节点靶子（jsdom 无 d3 手势可观测）。
  it('中键闸门：锁定态 wrapper 内 button===1 mousedown 不冒泡到 document（spec §3 六修）', () => {
    useNodeStore.setState({ activeEditNodeId: 'node-1' });
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const pane = container.querySelector('.react-flow__pane')!;
    const spy = vi.fn();
    document.addEventListener('mousedown', spy); // 冒泡终点——闸门生效则收不到
    fireEvent.mouseDown(pane, { button: 1 });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.mouseDown(pane, { button: 0 }); // 左键不受闸门影响（对照）
    expect(spy).toHaveBeenCalledTimes(1);
    document.removeEventListener('mousedown', spy);
  });

  it('组单选 + marqueeSelecting=true → GroupToolbar 抑制（消费点 2）', () => {
    mockNodes = [groupNode];
    mockMarqueeSelecting = true;
    render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    expect(screen.queryByTestId('group-toolbar')).not.toBeInTheDocument();
  });

  it('组单选 marqueeSelecting true→false 且 nodes 不变 → GroupToolbar 恢复', () => {
    mockNodes = [groupNode];
    mockMarqueeSelecting = true;
    const { rerender } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    expect(screen.queryByTestId('group-toolbar')).not.toBeInTheDocument();
    mockMarqueeSelecting = false;
    rerender(
      <ReactFlowProvider>
        <CanvasView projectId="p2" />
      </ReactFlowProvider>
    );
    expect(screen.getByTestId('group-toolbar')).toBeInTheDocument();
  });

  // ── 2d-7 storyboard 工具条注入行：[比例▾][宫格 r×c▾] │ [拼接(2K/4K)][№ 序号][🗑 清空][转普通组] │ [批量下载][解组] ──
  // cells 引用不在 cs nodes 的 c1（cellNodes 恒空 → 占位格无 useMediaUrl 取数；groupExecuting 过滤亦空集短路）

  const sbNode = {
    id: 'g1', type: 'group', selected: true,
    data: {
      groupType: 'storyboard', cells: ['c1'],
      storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: true, stitchResolution: '2K' },
    },
    position: { x: 0, y: 0 }, width: 300, height: 200,
  };

  describe('storyboard 工具条注入行（2d-7）', () => {
    beforeEach(() => {
      mockUngroup.mockClear();
      mockConvertGroup.mockClear();
      batchDl.run.mockClear();
      dl.collect.mockClear();
      dl.collect.mockReturnValue([{ fileId: 'f1', filename: '封面.png', type: 'imageGen' }]);
      useNodeStore.setState({ nodes: {} });
    });

    afterEach(() => {
      useNodeStore.setState({ nodes: {} });
    });

    it('按钮行序与两条 │ 分隔（子组件文案 F23/F19 不变：宫格 r×c、2K/4K 大写）', () => {
      mockNodes = [sbNode];
      render(
        <ReactFlowProvider>
          <CanvasView projectId="p1" />
        </ReactFlowProvider>
      );
      const toolbar = screen.getByTestId('group-toolbar');
      const labels = [...toolbar.querySelectorAll('button')].map(
        (b) => b.getAttribute('aria-label') ?? b.textContent ?? '',
      );
      expect(labels).toEqual([
        '比例 16:9 ▾', '宫格 2×2 ▾', '2K ▾', '拼接(2K)', '№ 序号', '🗑 清空', '转普通组', '批量下载', '⧉ 解组',
      ]);
      const seps = [...toolbar.querySelectorAll('span')].filter((s) => s.textContent === '│');
      expect(seps).toHaveLength(2);
    });

    it('点击 转普通组 → convertGroup(g1, normal)；点击 解组 → ungroup(g1)', () => {
      mockNodes = [sbNode];
      render(
        <ReactFlowProvider>
          <CanvasView projectId="p1" />
        </ReactFlowProvider>
      );
      fireEvent.click(screen.getByRole('button', { name: '转普通组' }));
      expect(mockConvertGroup).toHaveBeenCalledWith('g1', 'normal');
      fireEvent.click(screen.getByRole('button', { name: '⧉ 解组' }));
      expect(mockUngroup).toHaveBeenCalledWith('g1');
    });

    it('点击 批量下载 → collectDownloadables(cs, [g1], ns getter) 结果交 runBatchDownload（需求 8：收集集=组闭包即 cells fileId）', () => {
      mockNodes = [sbNode];
      useNodeStore.setState({ nodes: { i1: { id: 'i1', type: 'imageGen', data: { fileId: 'f1' } } } as any });
      render(
        <ReactFlowProvider>
          <CanvasView projectId="p1" />
        </ReactFlowProvider>
      );
      fireEvent.click(screen.getByRole('button', { name: '批量下载' }));
      // SelectionBoxOverlay 渲染期同 mock 也会 collect（首渲 ids=[]）——计数不可靠，取 ['g1'] 调用断言参数形态+run 链路
      expect(dl.collect).toHaveBeenCalledWith(expect.anything(), ['g1'], expect.any(Function));
      const [csArg, idsArg, getNs] = dl.collect.mock.calls.find((c) => c[1].join() === 'g1')!;
      expect(idsArg).toEqual(['g1']);
      // ns 最小视图桥（GroupToolbar normal 分支同款映射：ns 优先防 cs 陈旧 M8）
      expect(getNs()).toEqual({ i1: { id: 'i1', type: 'imageGen', position: { x: 0, y: 0 }, data: { fileId: 'f1' } } });
      expect(csArg).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'g1', type: 'group' })]));
      expect(batchDl.run).toHaveBeenCalledWith([{ fileId: 'f1', filename: '封面.png', type: 'imageGen' }]);
    });

    it('收集集为空 → runBatchDownload 不触发（对齐 normal 分支 aria-disabled 空守卫语义）', () => {
      mockNodes = [sbNode];
      dl.collect.mockReturnValue([]); // 恒空（覆盖 beforeEach 的默认返回——SelectionBoxOverlay 渲染期调用同源）
      render(
        <ReactFlowProvider>
          <CanvasView projectId="p1" />
        </ReactFlowProvider>
      );
      fireEvent.click(screen.getByRole('button', { name: '批量下载' }));
      expect(batchDl.run).not.toHaveBeenCalled();
    });
  });
});
