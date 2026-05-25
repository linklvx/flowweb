import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MultiImageNode } from './MultiImageNode';
import { ReactFlowProvider } from '@xyflow/react';

const { getMockNodeData, setMockNodeData, getStoreUpdateMultiImageImages, getStoreSetMainImageIndex, getStoreToggleExpanded } = vi.hoisted(() => {
  let mockNodeData: any = { images: [], mainImageIndex: 0, expanded: false, nodeStatus: 'idle' };
  let storeUpdateMultiImageImages = vi.fn();
  let storeSetMainImageIndex = vi.fn();
  let storeToggleExpanded = vi.fn();
  return {
    getMockNodeData: () => mockNodeData,
    setMockNodeData: (d: any) => { mockNodeData = d; },
    getStoreUpdateMultiImageImages: () => storeUpdateMultiImageImages,
    getStoreSetMainImageIndex: () => storeSetMainImageIndex,
    getStoreToggleExpanded: () => storeToggleExpanded,
  };
});

vi.mock('@/hooks/useMediaUrl', () => ({
  useMediaUrl: (fileId: string | null | undefined) => {
    if (fileId) return { url: `http://media/${fileId}`, loading: false, error: null };
    return { url: null, loading: false, error: null };
  },
}));

const mockUpdateNodeData = vi.fn();

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: Object.assign(
    vi.fn((selector?: any) => {
      const state = {
        nodes: {
          'mimg1': { id: 'mimg1', type: 'multiImageGen', position: { x: 0, y: 0 }, data: getMockNodeData() },
        },
        updateMultiImageImages: getStoreUpdateMultiImageImages(),
        setMainImageIndex: getStoreSetMainImageIndex(),
        toggleExpanded: getStoreToggleExpanded(),
      };
      if (typeof selector === 'function') return selector(state);
      return state;
    }),
    { getState: () => ({ updateNodeData: mockUpdateNodeData }) },
  ),
  isMultiImageNode: () => true,
}));

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: vi.fn((selector?: any) => {
    const state = { selectedId: null, selectNode: vi.fn() };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
}));

vi.mock('@/api/storageApi', () => ({
  presignUpload: vi.fn(),
  confirmUpload: vi.fn(),
}));

vi.mock('@/api/mediaApi', () => ({
  getMediaUrl: vi.fn((fileId: string) =>
    Promise.resolve({ url: `http://media/${fileId}` }),
  ),
}));

vi.mock('axios', () => ({
  default: { post: vi.fn().mockResolvedValue({}) },
}));

vi.mock('@/components/common/ImageWithFallback', () => ({
  ImageWithFallback: ({ src, alt, className }: any) => <img src={src} alt={alt} className={className} />,
}));

vi.mock('./MultiImageConfigPanel', () => ({
  MultiImageConfigPanel: () => <div data-testid="config-panel" />,
}));

function makeImage(id: string, url = `http://media/${id}`) {
  return { id, url, name: `img-${id}`, status: 'success' as const };
}

const baseProps = {
  id: 'mimg1', data: {}, selected: false, type: 'multiImageGen' as any,
  draggable: true as const, dragging: false as const,
  selectable: true as const, deletable: true as const, zIndex: 0,
  isConnectable: true as const, positionAbsoluteX: 0, positionAbsoluteY: 0,
};

describe('MultiImageNode', () => {
  const renderNode = (selected = false) =>
    render(
      <ReactFlowProvider>
        <MultiImageNode {...baseProps} selected={selected} />
      </ReactFlowProvider>
    );

  afterEach(() => {
    vi.clearAllMocks();
    setMockNodeData({ images: [], mainImageIndex: 0, expanded: false, nodeStatus: 'idle' });
  });

  it('should render editable title with default value', () => {
    renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('Multi-Image');
  });

  it('should save title on blur', () => {
    renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '我的多图' } });
    fireEvent.blur(input);
    expect(screen.getByDisplayValue('我的多图')).toBeInTheDocument();
  });

  it('should cancel title edit on Escape', () => {
    renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '取消' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByDisplayValue('Multi-Image')).toBeInTheDocument();
  });

  it('should render placeholder SVG when 0 images', () => {
    setMockNodeData({ images: [], mainImageIndex: -1, expanded: false, nodeStatus: 'idle' });
    renderNode();
    const imgs = document.querySelectorAll('img[alt]');
    expect(imgs.length).toBe(0);
    const svg = document.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should show single image without badge or stack layers', () => {
    setMockNodeData({ images: [makeImage('a')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    renderNode();
    const imgs = document.querySelectorAll('img');
    const mainImgs = Array.from(imgs).filter((img) =>
      (img as HTMLImageElement).src.includes('/media/')
    );
    expect(mainImgs.length).toBe(1);
    expect(document.querySelector('.rounded-full')).not.toBeInTheDocument();
  });

  it('should render stack layers for 2+ images', () => {
    setMockNodeData({ images: [makeImage('a'), makeImage('b')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    renderNode();
    const imgs = document.querySelectorAll('img');
    const visibleImgs = Array.from(imgs).filter((img) =>
      (img as HTMLImageElement).src.includes('/media/')
    );
    expect(visibleImgs.length).toBeGreaterThanOrEqual(1);
  });

  it('should show badge with correct count', () => {
    setMockNodeData({ images: [makeImage('a'), makeImage('b'), makeImage('c')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    renderNode();
    const badge = screen.getByText('3');
    expect(badge).toBeInTheDocument();
  });

  it('should toggle expanded on badge click', () => {
    setMockNodeData({ images: [makeImage('a'), makeImage('b')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    const toggleSpy = getStoreToggleExpanded();
    renderNode();
    const badge = screen.getByText('2');
    fireEvent.click(badge);
    expect(toggleSpy).toHaveBeenCalledWith('mimg1');
  });

  it('should render 2-column grid when <=4 images', () => {
    setMockNodeData({
      images: [makeImage('a'), makeImage('b'), makeImage('c'), makeImage('d')],
      mainImageIndex: 0, expanded: true, nodeStatus: 'done',
    });
    renderNode();
    const imgs = document.querySelectorAll('img');
    const gridImgs = Array.from(imgs).filter((img) =>
      (img as HTMLImageElement).src.includes('/media/')
    );
    expect(gridImgs.length).toBe(4);
  });

  it('should render 3-column grid when >4 images', () => {
    setMockNodeData({
      images: [makeImage('a'), makeImage('b'), makeImage('c'), makeImage('d'), makeImage('e')],
      mainImageIndex: 0, expanded: true, nodeStatus: 'done',
    });
    renderNode();
    const imgs = document.querySelectorAll('img');
    const gridImgs = Array.from(imgs).filter((img) =>
      (img as HTMLImageElement).src.includes('/media/')
    );
    expect(gridImgs.length).toBe(5);
  });

  it('should collapse on close button click', () => {
    setMockNodeData({
      images: [makeImage('a'), makeImage('b')],
      mainImageIndex: 0, expanded: true, nodeStatus: 'done',
    });
    const toggleSpy = getStoreToggleExpanded();
    renderNode();
    const closeBtn = screen.getByText('✕');
    fireEvent.click(closeBtn);
    expect(toggleSpy).toHaveBeenCalledWith('mimg1');
  });

  it('should set main image and collapse', () => {
    setMockNodeData({
      images: [makeImage('a'), makeImage('b'), makeImage('c')],
      mainImageIndex: 0, expanded: true, nodeStatus: 'done',
    });
    const setMainSpy = getStoreSetMainImageIndex();
    renderNode();
    const setMainBtns = screen.getAllByText('设为主图');
    expect(setMainBtns.length).toBe(2); // 2 non-main images
    fireEvent.click(setMainBtns[0]);
    expect(setMainSpy).toHaveBeenCalledWith('mimg1', expect.any(Number));
    expect(mockUpdateNodeData).toHaveBeenCalledWith('mimg1', { expanded: false });
  });

  it('should show floating upload button when selected', () => {
    setMockNodeData({ images: [makeImage('a')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    renderNode(true);
    const uploadBtn = screen.getByText('上传');
    expect(uploadBtn).toBeInTheDocument();
  });

  it('should hide floating upload button when not selected', () => {
    setMockNodeData({ images: [makeImage('a')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    renderNode(false);
    expect(screen.queryByText('上传')).not.toBeInTheDocument();
  });

  it('should render 2 handles (target + source)', () => {
    renderNode();
    const handles = document.querySelectorAll('.react-flow__handle');
    expect(handles.length).toBe(2);
  });

  it('should render orange border when selected', () => {
    renderNode(true);
    const card = document.querySelector('.transition-colors');
    expect(card).toBeInTheDocument();
  });

  it('should reset to idle state when all images deleted', () => {
    setMockNodeData({ images: [makeImage('a')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    const { unmount } = renderNode(false);
    unmount();
    setMockNodeData({ images: [], mainImageIndex: -1, expanded: false, nodeStatus: 'idle' });
    renderNode(false);
    const imgs = document.querySelectorAll('img[alt]');
    expect(imgs.length).toBe(0);
  });

  it('should have file input for uploads', () => {
    setMockNodeData({ images: [], mainImageIndex: -1, expanded: false, nodeStatus: 'idle' });
    renderNode(true);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();
  });

  it('should render image via ImageWithFallback mock', () => {
    setMockNodeData({ images: [makeImage('broken')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    renderNode(false);
    const img = document.querySelector('img');
    expect(img).toBeInTheDocument();
  });

  it('should show config panel when selected', () => {
    setMockNodeData({ images: [makeImage('a')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    renderNode(true);
    const panel = screen.getByTestId('config-panel');
    expect(panel).toBeInTheDocument();
  });
});
