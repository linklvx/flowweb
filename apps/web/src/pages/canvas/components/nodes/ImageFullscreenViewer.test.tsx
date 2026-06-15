import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageFullscreenViewer } from './ImageFullscreenViewer';
import type { ImageNodeData } from '@/stores/nodeStore';

const mockNodeData: ImageNodeData = {
  style: 'style-1',
  model: 'MJ V8.1',
  quality: '1k',
  ratio: '16:9',
  fileId: 'img-001',
  status: 'done',
  prompt: { text: '一只猫在花园里', allImages: [], referencedImageIds: [] },
};

describe('ImageFullscreenViewer', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(
      <ImageFullscreenViewer
        open={false}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders the fullscreen dialog when open', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('displays model, quality, and ratio from nodeData', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    expect(screen.getByText('MJ V8.1')).toBeInTheDocument();
    expect(screen.getByText('1k')).toBeInTheDocument();
    expect(screen.getByText('16:9')).toBeInTheDocument();
  });

  it('displays prompt text when available', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    expect(screen.getByText('一只猫在花园里')).toBeInTheDocument();
  });

  it('displays fallback when prompt is empty', () => {
    const dataWithNoPrompt = {
      ...mockNodeData,
      prompt: { text: '', allImages: [], referencedImageIds: [] },
    };
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={dataWithNoPrompt}
        triggerRef={{ current: null }}
      />,
    );
    expect(screen.getByText('暂无提示词')).toBeInTheDocument();
  });

  it('displays fallback for all missing metadata fields', () => {
    const emptyData: ImageNodeData = {
      style: '',
      model: '',
      quality: '',
      ratio: '',
      status: 'done',
      prompt: { text: '', allImages: [], referencedImageIds: [] },
    };
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={emptyData}
        triggerRef={{ current: null }}
      />,
    );
    // 模型, 质量, 宽高比, 图片尺寸 = 4 个"未知"
    const unknowns = screen.getAllByText('未知');
    expect(unknowns.length).toBe(4);
  });

  it('shows error state when displayUrl is empty', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl={undefined}
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    expect(screen.getByText('图片加载失败')).toBeInTheDocument();
  });

  it('renders close button with correct aria-label', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    expect(screen.getByLabelText('关闭全屏查看')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={onClose}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    fireEvent.click(screen.getByLabelText('关闭全屏查看'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders download <a> with href and download when displayUrl is valid', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    const downloadLink = screen.getByText('下载图片').closest('a');
    expect(downloadLink).toHaveAttribute('href', 'https://example.com/img.jpg');
    expect(downloadLink).toHaveAttribute('download');
    expect(downloadLink?.tabIndex).not.toBe(-1);
  });

  it('renders disabled download <a> (no href, tabIndex=-1, aria-disabled) when displayUrl is empty', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl={undefined}
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    const downloadLink = screen.getByText('下载图片').closest('a');
    expect(downloadLink).not.toHaveAttribute('href');
    expect(downloadLink?.tabIndex).toBe(-1);
    expect(downloadLink?.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows loading state initially when displayUrl is valid', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    // <img> is rendered but loading state visible until onLoad
    const img = screen.getByRole('img');
    expect(img).toBeInTheDocument();
  });

  it('alt uses prompt text when available', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    const img = screen.getByRole('img');
    expect(img.getAttribute('alt')).toBe('一只猫在花园里');
  });

  it('alt falls back to "生成的图片" when prompt is empty', () => {
    const noPrompt = { ...mockNodeData, prompt: { text: '', allImages: [], referencedImageIds: [] } };
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={noPrompt}
        triggerRef={{ current: null }}
      />,
    );
    const img = screen.getByRole('img');
    expect(img.getAttribute('alt')).toBe('生成的图片');
  });

  it('img has draggable=false and select-none class', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    const img = screen.getByRole('img');
    expect(img.getAttribute('draggable')).toBe('false');
    expect(img.className).toContain('select-none');
  });

  it('displays image dimensions after onLoad', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    const img = screen.getByRole('img');
    Object.defineProperty(img, 'naturalWidth', { value: 1920, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 1080, configurable: true });
    fireEvent.load(img);
    expect(screen.getByText('1920 × 1080')).toBeInTheDocument();
  });

  it('shows loading indicator when image has not yet loaded', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    expect(screen.getByText('计算中')).toBeInTheDocument();
  });

  it('handles image onError by showing failure state', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/broken.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    const img = screen.getByRole('img');
    fireEvent.error(img);
    expect(screen.getByText('图片加载失败')).toBeInTheDocument();
  });

  it('resets image state when displayUrl changes', () => {
    const { rerender } = render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    // Simulate successful load
    const img = screen.getByRole('img');
    Object.defineProperty(img, 'naturalWidth', { value: 1920, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 1080, configurable: true });
    fireEvent.load(img);
    expect(screen.getByText('1920 × 1080')).toBeInTheDocument();

    // Change to a new URL — state should reset to loading
    rerender(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/new-img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    // Should show loading indicator again and dimensions should be gone
    expect(screen.getByText('计算中')).toBeInTheDocument();
    expect(screen.queryByText('1920 × 1080')).not.toBeInTheDocument();
  });

  it('resets to error state when displayUrl changes to undefined', () => {
    const { rerender } = render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    expect(screen.getByRole('img')).toBeInTheDocument();

    rerender(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl={undefined}
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    expect(screen.getByText('图片加载失败')).toBeInTheDocument();
  });
});
