import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VideoFullscreenViewer } from './VideoFullscreenViewer';

describe('VideoFullscreenViewer', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    videoUrl: 'http://media/video.mp4',
    triggerRef: { current: null },
    nodeData: {
      model: 'kling-v1',
      ratio: '16:9',
      duration: 10,
      resolution: '1080p',
      prompt: { text: '测试提示词' },
    } as any,
  };

  it('renders nothing when open is false', () => {
    const { container } = render(
      <VideoFullscreenViewer {...defaultProps} open={false} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders fullscreen modal with video element when open', () => {
    render(<VideoFullscreenViewer {...defaultProps} />);
    expect(screen.getByLabelText('全屏视频播放')).toBeInTheDocument();
  });

  it('renders video with controls and source URL', () => {
    render(<VideoFullscreenViewer {...defaultProps} />);
    const video = screen.getByLabelText('全屏视频播放') as HTMLVideoElement;
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.querySelector('source')?.getAttribute('src')).toBe('http://media/video.mp4');
  });

  it('renders close button', () => {
    render(<VideoFullscreenViewer {...defaultProps} />);
    expect(screen.getByLabelText('关闭全屏查看')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<VideoFullscreenViewer {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('关闭全屏查看'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders prompt text in sidebar', () => {
    render(<VideoFullscreenViewer {...defaultProps} />);
    expect(screen.getByText('测试提示词')).toBeInTheDocument();
  });

  it('renders model info in sidebar', () => {
    render(<VideoFullscreenViewer {...defaultProps} />);
    expect(screen.getByText('kling-v1')).toBeInTheDocument();
  });

  it('renders ratio and resolution in sidebar', () => {
    render(<VideoFullscreenViewer {...defaultProps} />);
    expect(screen.getByText('16:9')).toBeInTheDocument();
    expect(screen.getByText('1080p')).toBeInTheDocument();
  });

  it('renders duration in sidebar', () => {
    render(<VideoFullscreenViewer {...defaultProps} />);
    expect(screen.getByText('10s')).toBeInTheDocument();
  });

  it('renders download button in sidebar', () => {
    render(<VideoFullscreenViewer {...defaultProps} />);
    expect(screen.getByText('下载视频')).toBeInTheDocument();
  });

  it('renders error state when videoUrl is undefined', () => {
    render(<VideoFullscreenViewer {...defaultProps} videoUrl={undefined} />);
    expect(screen.getByText('视频加载失败')).toBeInTheDocument();
  });

  it('renders sidebar sections with labels', () => {
    render(<VideoFullscreenViewer {...defaultProps} />);
    expect(screen.getByText('提示词')).toBeInTheDocument();
    expect(screen.getByText('信息')).toBeInTheDocument();
  });

  it('has aria-modal dialog with label', () => {
    render(<VideoFullscreenViewer {...defaultProps} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', '全屏查看');
  });

  it('shows defaults when nodeData fields are empty', () => {
    render(
      <VideoFullscreenViewer
        {...defaultProps}
        nodeData={{ model: '', ratio: '', duration: undefined, resolution: '', prompt: undefined } as any}
      />,
    );
    expect(screen.getByText('暂无提示词')).toBeInTheDocument();
    // Default fallbacks matching VideoConfigPanel: ratio→16:9, resolution→1080p, duration→5s
    expect(screen.getByText('16:9')).toBeInTheDocument();
    expect(screen.getByText('1080p')).toBeInTheDocument();
    expect(screen.getByText('5s')).toBeInTheDocument();
  });
});
