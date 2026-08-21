import { describe, it, expect, vi, beforeAll } from 'vitest';
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
  prompt: { text: '一只猫在花园里', html: '', referencedImageIds: [] },
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

  it('does not throw when nodeData is undefined (refresh restore race)', () => {
    expect(() =>
      render(
        <ImageFullscreenViewer
          open={true}
          onClose={vi.fn()}
          displayUrl="https://example.com/img.jpg"
          nodeData={undefined as unknown as ImageNodeData}
          triggerRef={{ current: null }}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByText('暂无提示词')).toBeInTheDocument();
    expect(screen.getAllByText('未知').length).toBeGreaterThanOrEqual(3);
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
      prompt: { text: '', html: '', referencedImageIds: [] },
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
      prompt: { text: '', html: '', referencedImageIds: [] },
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

  it('renders download button enabled when displayUrl is valid', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    const btn = screen.getByRole('button', { name: '下载图片' });
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveTextContent('下载图片');
  });

  it('renders disabled download button when displayUrl is empty', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl={undefined}
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    const btn = screen.getByRole('button', { name: '下载图片' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('下载图片');
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
    const noPrompt = { ...mockNodeData, prompt: { text: '', html: '', referencedImageIds: [] } };
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

  describe('download button — fetch + blob', () => {
    beforeAll(() => {
      if (!URL.createObjectURL) {
        Object.defineProperty(URL, 'createObjectURL', {
          value: vi.fn(),
          writable: true,
          configurable: true,
        });
      }
      if (!URL.revokeObjectURL) {
        Object.defineProperty(URL, 'revokeObjectURL', {
          value: vi.fn(),
          writable: true,
          configurable: true,
        });
      }
    });

    it('fetches image as blob and triggers download on click', async () => {
      const blob = new Blob(['fake-img'], { type: 'image/png' });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(blob, { status: 200 }),
      );
      const createObjectURLSpy = vi
        .spyOn(URL, 'createObjectURL')
        .mockReturnValue('blob:fake-url');
      const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL');

      // 模拟临时 <a> 的 click
      const clickSpy = vi.fn();
      const origCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag, options) => {
        const el = origCreateElement(tag, options);
        if (tag === 'a') {
          vi.spyOn(el, 'click').mockImplementation(clickSpy);
        }
        return el;
      });

      render(
        <ImageFullscreenViewer
          open={true}
          onClose={vi.fn()}
          displayUrl="https://example.com/img.jpg"
          nodeData={mockNodeData}
          triggerRef={{ current: null }}
        />,
      );

      const btn = screen.getByRole('button', { name: '下载图片' });
      fireEvent.click(btn);

      expect(fetchSpy).toHaveBeenCalledWith('https://example.com/img.jpg');
      expect(btn).toHaveTextContent('下载中...');
      expect(btn).toBeDisabled();

      // 等待 fetch 完成
      await vi.waitFor(() => {
        expect(createObjectURLSpy).toHaveBeenCalledWith(blob);
        expect(clickSpy).toHaveBeenCalled();
        expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:fake-url');
        expect(btn).toHaveTextContent('下载图片');
        expect(btn).not.toBeDisabled();
      });

      fetchSpy.mockRestore();
      createObjectURLSpy.mockRestore();
      revokeObjectURLSpy.mockRestore();
    });

    it('falls back to window.open when fetch fails', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('Network error'));
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      render(
        <ImageFullscreenViewer
          open={true}
          onClose={vi.fn()}
          displayUrl="https://example.com/img.jpg"
          nodeData={mockNodeData}
          triggerRef={{ current: null }}
        />,
      );

      const btn = screen.getByRole('button', { name: '下载图片' });
      fireEvent.click(btn);

      await vi.waitFor(() => {
        expect(openSpy).toHaveBeenCalledWith('https://example.com/img.jpg', '_blank');
        expect(btn).toHaveTextContent('下载图片');
        expect(btn).not.toBeDisabled();
      });

      fetchSpy.mockRestore();
      openSpy.mockRestore();
    });

    it('does nothing when displayUrl is empty', () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      render(
        <ImageFullscreenViewer
          open={true}
          onClose={vi.fn()}
          displayUrl={undefined}
          nodeData={mockNodeData}
          triggerRef={{ current: null }}
        />,
      );

      const btn = screen.getByRole('button', { name: '下载图片' });
      fireEvent.click(btn);

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  describe('full-bleed overlay', () => {
    it('opens full-bleed overlay on image click and closes on close button', () => {
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
      fireEvent.load(img);

      // Image has cursor-zoom-in before click
      expect(img.className).toContain('cursor-zoom-in');

      // Click image → full-bleed overlay opens
      fireEvent.click(img);
      expect(screen.getByLabelText('关闭图片预览')).toBeInTheDocument();

      // Click close button → overlay closes
      fireEvent.click(screen.getByLabelText('关闭图片预览'));
      expect(screen.queryByLabelText('关闭图片预览')).not.toBeInTheDocument();
    });

    it('closes full-bleed overlay on backdrop click', () => {
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
      fireEvent.load(img);
      fireEvent.click(img);

      const overlay = screen.getByLabelText('关闭图片预览').parentElement!;
      fireEvent.click(overlay);
      expect(screen.queryByLabelText('关闭图片预览')).not.toBeInTheDocument();
    });

    it('does not open full-bleed when image is not loaded', () => {
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
      // Image is still loading, click should not open full-bleed
      fireEvent.click(img);
      expect(screen.queryByLabelText('关闭图片预览')).not.toBeInTheDocument();
    });
  });
});
