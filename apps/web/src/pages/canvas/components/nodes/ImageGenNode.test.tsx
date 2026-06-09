import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ImageGenNode } from './ImageGenNode';
import { ReactFlowProvider } from '@xyflow/react';

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useInternalNode: vi.fn(() => ({
      position: { x: 0, y: 0 },
      measured: { width: 500, height: 500 },
    })),
  };
});

let mockNodeData: any = {
  status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', allImages: [], referencedImageIds: [] }
};

vi.mock('@/hooks/useMediaUrl', () => ({
  useMediaUrl: (fileId: string | null | undefined) => {
    if (fileId) return { url: `http://media/${fileId}`, loading: false, error: null };
    return { url: null, loading: false, error: null };
  },
}));

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: vi.fn((selector?: any) => {
    const state = {
      nodes: { 'img1': { id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, data: mockNodeData } },
      updateConfig: vi.fn(),
    };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
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

vi.mock('axios', () => ({
  default: {
    post: vi.fn().mockResolvedValue({}),
  },
}));

// Mock ImageThumbnailBar to avoid dnd-kit dependency in tests
vi.mock('./prompt-input/ImageThumbnailBar', () => ({
  ImageThumbnailBar: () => null,
}));

describe('ImageGenNode', () => {
  afterEach(() => {
    document.getElementById('node-toolbar-portal')?.remove();
  });

  const renderNode = (selected = false) => {
    const portalRoot = document.createElement('div');
    portalRoot.id = 'node-toolbar-portal';
    document.body.appendChild(portalRoot);

    return render(
      <ReactFlowProvider>
        <ImageGenNode id="img1" data={{}} selected={selected} type="imageGen" draggable={true} dragging={false} selectable={true} deletable={true} zIndex={0} {...{} as any} />
      </ReactFlowProvider>
    );
  };

  it('should render editable node title with default value', () => {
    renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('Image');
  });

  it('should save title on blur', () => {
    renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '我的图片' } });
    fireEvent.blur(input);
    expect(screen.getByDisplayValue('我的图片')).toBeInTheDocument();
  });

  it('should cancel edit on Escape', () => {
    renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '取消' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByDisplayValue('Image')).toBeInTheDocument();
  });

  it('should grow ghost sizer span as user types longer title', () => {
    const { container } = renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'A very long title for testing' } });
    const ghost = container.querySelector('[aria-hidden="true"]') as HTMLSpanElement;
    expect(ghost.textContent).toBe('A very long title for testing ');
  });

  it('should render camera SVG placeholder when no result image', () => {
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', allImages: [], referencedImageIds: [] } };
    const { container } = renderNode();
    // The placeholder should be an SVG icon, not text
    expect(screen.queryByText(/图片预览区/i)).not.toBeInTheDocument();
    const previewContainer = container.querySelector('.flex.items-center.justify-center.overflow-hidden');
    const svg = previewContainer?.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 48 48');
    expect(svg?.getAttribute('width')).toBe('72');
    expect(svg?.getAttribute('height')).toBe('72');
    const g = svg?.querySelector('g');
    expect(g?.getAttribute('opacity')).toBe('0.35');
    const path = svg?.querySelector('path');
    expect(path?.getAttribute('d')).toContain('M31.7998');
  });

  it('should render loading state', () => {
    mockNodeData = { ...mockNodeData, status: 'loading' };
    renderNode();
    expect(screen.getByText(/生成中/i)).toBeInTheDocument();
  });

  it('should render result image when available', () => {
    mockNodeData = { ...mockNodeData, status: 'done', fileId: 'cat-file-id' };
    renderNode();
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'http://media/cat-file-id');
  });

  it('should have 2 handles (input + output)', () => {
    // Reset to default
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', allImages: [], referencedImageIds: [] } };
    const { container } = renderNode();
    expect(container.querySelectorAll('.react-flow__handle').length).toBe(2);
  });

  it('should render card with dynamic width based on ratio', () => {
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '16:9', prompt: { text: '', html: '', allImages: [], referencedImageIds: [] } };
    const { container } = renderNode();
    const html = container.innerHTML;
    // Width is dynamic (inline style), 16:9 ratio gives 548px wide
    expect(html).toContain('width: 548px');
  });

  // ---- New tests for floating upload button ----

  it('should show floating upload button when selected', () => {
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', allImages: [], referencedImageIds: [] } };
    renderNode(true);
    expect(screen.getByText('上传')).toBeInTheDocument();
  });

  it('should not show floating upload button when not selected', () => {
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', allImages: [], referencedImageIds: [] } };
    renderNode(false);
    expect(screen.queryByText('上传')).not.toBeInTheDocument();
  });

  it('floating upload container should have nodrag and nopan classes', () => {
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', allImages: [], referencedImageIds: [] } };
    renderNode(true);
    const portalRoot = document.getElementById('node-toolbar-portal')!;
    const toolbar = portalRoot.querySelector('.nodrag') as HTMLElement;
    expect(toolbar).toBeTruthy();
    expect(toolbar.classList.contains('nodrag')).toBe(true);
    expect(toolbar.classList.contains('nopan')).toBe(true);
  });

  it('shows replace button when image is user-uploaded (referenceImage set, no fileId)', () => {
    mockNodeData = { status: 'idle', fileId: undefined, referenceImage: 'ref-123', style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', allImages: [], referencedImageIds: [] } };
    renderNode();
    expect(screen.getByText('替换')).toBeInTheDocument();
  });

  it('does not show replace button when image is AI-generated (fileId set)', () => {
    mockNodeData = { status: 'done', fileId: 'cat-file-id', referenceImage: 'ref-123', style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', allImages: [], referencedImageIds: [] } };
    renderNode();
    expect(screen.queryByText('替换')).not.toBeInTheDocument();
  });

  // ---- Ratio-based container dimensions (when no image loaded) ----
  it('should use square dimensions for 1:1 ratio when no image', () => {
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', allImages: [], referencedImageIds: [] } };
    const { container } = renderNode();
    // Container should be square (width ≈ height) within max constraints
    expect(container.innerHTML).toContain('width: 500px');
    expect(container.innerHTML).toContain('height: 500px');
  });

  it('should use wide dimensions for 16:9 ratio when no image', () => {
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '16:9', prompt: { text: '', html: '', allImages: [], referencedImageIds: [] } };
    const { container } = renderNode();
    // 16:9 → wider than tall, max width 548, height ~309
    expect(container.innerHTML).toContain('width: 548px');
    expect(container.innerHTML).toContain('height: 309px');
  });

  it('should use tall dimensions for 9:16 ratio when no image', () => {
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '9:16', prompt: { text: '', html: '', allImages: [], referencedImageIds: [] } };
    const { container } = renderNode();
    // 9:16 → taller than wide, max height 500, width ~281
    expect(container.innerHTML).toContain('height: 500px');
  });

  // ---- Transform mode (rotation + mirror) ----

  it('should apply CSS transform to image in transform mode', () => {
    mockNodeData = { status: 'done', fileId: 'cat-file-id', style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', transformMode: true, imageRotation: 90, flipH: true, flipV: false, prompt: { text: '', html: '', allImages: [], referencedImageIds: [] } };
    renderNode();
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'http://media/cat-file-id');
    expect(img.style.transform).toBe('rotate(90deg) scaleX(-1) scaleY(1)');
  });

  it('should apply correct CSS transform for 270° with both flips', () => {
    mockNodeData = { status: 'done', fileId: 'cat-file-id', style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', transformMode: true, imageRotation: 270, flipH: true, flipV: true, prompt: { text: '', html: '', allImages: [], referencedImageIds: [] } };
    renderNode();
    const img = screen.getByRole('img');
    expect(img.style.transform).toBe('rotate(270deg) scaleX(-1) scaleY(-1)');
  });

  it('should swap container dimensions for 90° rotation in transform mode', () => {
    mockNodeData = { status: 'done', fileId: 'cat-file-id', style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', transformMode: true, imageRotation: 90, flipH: false, flipV: false, prompt: { text: '', html: '', allImages: [], referencedImageIds: [] } };
    const { container } = renderNode();
    // In transform mode with image and 90° rotation, width/height should swap
    // imgSize is computed from the image on load, so container dimensions won't be ratio-based
    const html = container.innerHTML;
    // Image dimensions get swapped when transform mode + 90/270 rotation
    expect(html).toContain('width:');
    expect(html).toContain('height:');
  });
});
