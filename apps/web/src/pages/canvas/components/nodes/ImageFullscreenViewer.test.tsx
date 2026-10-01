import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageFullscreenViewer } from './ImageFullscreenViewer';
import type { ImageNodeData } from '@/stores/nodeStore';

const { mockDownloadMediaFile } = vi.hoisted(() => ({ mockDownloadMediaFile: vi.fn() }));
vi.mock('@/utils/mediaDownload', () => ({ downloadMediaFile: mockDownloadMediaFile }));

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

  describe('download button — downloadMediaFile（R2b-2 切换）', () => {
    beforeEach(() => {
      mockDownloadMediaFile.mockReset();
      mockDownloadMediaFile.mockResolvedValue({ ok: true });
    });

    it('点击下载 → downloadMediaFile 携 fileId+url+类型前缀文件名；downloading 守卫保持', async () => {
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

      expect(btn).toHaveTextContent('下载中...');
      expect(btn).toBeDisabled();

      await vi.waitFor(() => {
        expect(mockDownloadMediaFile).toHaveBeenCalledWith({
          fileId: 'img-001',
          url: 'https://example.com/img.jpg',
          filename: '图片-mg-001',
        });
        expect(btn).toHaveTextContent('下载图片');
        expect(btn).not.toBeDisabled();
      });
    });

    it('mediaName 优先于类型前缀文件名（delta①）', async () => {
      render(
        <ImageFullscreenViewer
          open={true}
          onClose={vi.fn()}
          displayUrl="https://example.com/img.jpg"
          nodeData={{ ...mockNodeData, mediaName: '我的图' }}
          triggerRef={{ current: null }}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: '下载图片' }));

      await vi.waitFor(() => {
        expect(mockDownloadMediaFile).toHaveBeenCalledWith(
          expect.objectContaining({ filename: '我的图' }),
        );
      });
    });

    it('下载失败（{ok:false}）→ 不再 window.open 兜底（delta②，message.error 归 downloadMediaFile），守卫复位', async () => {
      mockDownloadMediaFile.mockResolvedValueOnce({ ok: false, reason: 'fetch-failed' });
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
        expect(btn).toHaveTextContent('下载图片');
        expect(btn).not.toBeDisabled();
      });
      expect(openSpy).not.toHaveBeenCalled();

      openSpy.mockRestore();
    });

    it('displayUrl 为空点击不触发下载', () => {
      render(
        <ImageFullscreenViewer
          open={true}
          onClose={vi.fn()}
          displayUrl={undefined}
          nodeData={mockNodeData}
          triggerRef={{ current: null }}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: '下载图片' }));

      expect(mockDownloadMediaFile).not.toHaveBeenCalled();
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
