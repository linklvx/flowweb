import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VideoNodeToolbar } from './VideoNodeToolbar';

describe('VideoNodeToolbar', () => {
  it('renders nothing when show is false', () => {
    const { container } = render(<VideoNodeToolbar show={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders toolbar when show is true', () => {
    render(<VideoNodeToolbar show={true} />);
    expect(screen.getByText('剪辑')).toBeInTheDocument();
    expect(screen.getByText('裁剪')).toBeInTheDocument();
    expect(screen.getByText('高清')).toBeInTheDocument();
    expect(screen.getByText('解析')).toBeInTheDocument();
    expect(screen.getByText('视频截帧')).toBeInTheDocument();
    expect(screen.getByText('音频分离')).toBeInTheDocument();
  });

  it('has nodrag nopan class to prevent React Flow interactions', () => {
    render(<VideoNodeToolbar show={true} />);
    const container = screen.getByText('剪辑').closest('.nodrag');
    expect(container).toBeTruthy();
    expect(container?.classList.contains('nopan')).toBe(true);
  });

  it('renders icon-only buttons for download and expand', () => {
    render(<VideoNodeToolbar show={true} />);
    // Download and expand are icon-only buttons with aria-labels
    const downloadBtn = screen.getByLabelText('下载');
    const expandBtn = screen.getByLabelText('全屏');
    expect(downloadBtn).toBeInTheDocument();
    expect(expandBtn).toBeInTheDocument();
  });

  it('calls onFullscreen when expand button is clicked', () => {
    const onFullscreen = vi.fn();
    render(<VideoNodeToolbar show={true} onFullscreen={onFullscreen} />);
    fireEvent.click(screen.getByLabelText('全屏'));
    expect(onFullscreen).toHaveBeenCalledTimes(1);
  });

  it('calls onDownload when download button is clicked', () => {
    const onDownload = vi.fn();
    render(<VideoNodeToolbar show={true} onDownload={onDownload} />);
    fireEvent.click(screen.getByLabelText('下载'));
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('opens dropdown with three frame capture options when 视频截帧 is clicked', async () => {
    const user = userEvent.setup();
    render(<VideoNodeToolbar show={true} />);
    await user.click(screen.getByText('视频截帧'));
    await waitFor(() => {
      expect(screen.getByText('截取当前帧')).toBeInTheDocument();
      expect(screen.getByText('截取首帧')).toBeInTheDocument();
      expect(screen.getByText('截取尾帧')).toBeInTheDocument();
    });
  });

  // ── Frame capture callbacks ───────────────────────────

  it('calls onCaptureFrame("current") when 截取当前帧 is clicked', async () => {
    const onCaptureFrame = vi.fn();
    const user = userEvent.setup();
    render(<VideoNodeToolbar show={true} onCaptureFrame={onCaptureFrame} />);
    await user.click(screen.getByText('视频截帧'));
    await waitFor(() => expect(screen.getByText('截取当前帧')).toBeInTheDocument());
    fireEvent.click(screen.getByText('截取当前帧'));
    expect(onCaptureFrame).toHaveBeenCalledWith('current');
  });

  it('calls onCaptureFrame("first") when 截取首帧 is clicked', async () => {
    const onCaptureFrame = vi.fn();
    const user = userEvent.setup();
    render(<VideoNodeToolbar show={true} onCaptureFrame={onCaptureFrame} />);
    await user.click(screen.getByText('视频截帧'));
    await waitFor(() => expect(screen.getByText('截取首帧')).toBeInTheDocument());
    fireEvent.click(screen.getByText('截取首帧'));
    expect(onCaptureFrame).toHaveBeenCalledWith('first');
  });

  it('calls onCaptureFrame("last") when 截取尾帧 is clicked', async () => {
    const onCaptureFrame = vi.fn();
    const user = userEvent.setup();
    render(<VideoNodeToolbar show={true} onCaptureFrame={onCaptureFrame} />);
    await user.click(screen.getByText('视频截帧'));
    await waitFor(() => expect(screen.getByText('截取尾帧')).toBeInTheDocument());
    fireEvent.click(screen.getByText('截取尾帧'));
    expect(onCaptureFrame).toHaveBeenCalledWith('last');
  });

  it('disables all capture buttons when capturingType is set', async () => {
    const user = userEvent.setup();
    render(<VideoNodeToolbar show={true} capturingType="current" />);
    await user.click(screen.getByText('视频截帧'));

    await waitFor(() => {
      const btns = screen.getAllByRole('button').filter((b) =>
        ['截取当前帧', '截取首帧', '截取尾帧'].some((t) => b.textContent?.includes(t)),
      );
      btns.forEach((b) => expect(b).toBeDisabled());
    });
  });

  it('dropdown stays closed when capturingType is set', async () => {
    const user = userEvent.setup();
    render(<VideoNodeToolbar show={true} capturingType="first" />);
    await user.click(screen.getByText('视频截帧'));
    // Dropdown should not open
    expect(screen.queryByText('截取当前帧')).not.toBeInTheDocument();
  });

  it('does not throw when onCaptureFrame is not provided', async () => {
    const user = userEvent.setup();
    render(<VideoNodeToolbar show={true} />);
    await user.click(screen.getByText('视频截帧'));
    await waitFor(() => expect(screen.getByText('截取当前帧')).toBeInTheDocument());
    // Should not throw
    fireEvent.click(screen.getByText('截取当前帧'));
  });

  // ── Audio separation dropdown ─────────────────────────

  it('opens dropdown with three audio separate options when 音频分离 is clicked', async () => {
    const user = userEvent.setup();
    render(<VideoNodeToolbar show={true} />);
    await user.click(screen.getByText('音频分离'));
    await waitFor(() => {
      expect(screen.getByText('仅保留人声')).toBeInTheDocument();
      expect(screen.getByText('仅保留背景音')).toBeInTheDocument();
      expect(screen.getByText('音视频分离')).toBeInTheDocument();
    });
  });

  it('vocal button is disabled and does not trigger onAudioSeparate', async () => {
    const onAudioSeparate = vi.fn();
    const user = userEvent.setup();
    render(<VideoNodeToolbar show={true} onAudioSeparate={onAudioSeparate} />);
    await user.click(screen.getByText('音频分离'));
    await waitFor(() => expect(screen.getByText('仅保留人声')).toBeInTheDocument());
    const vocalBtn = screen.getByText('仅保留人声');
    expect(vocalBtn).toBeDisabled();
    fireEvent.click(vocalBtn);
    expect(onAudioSeparate).not.toHaveBeenCalled();
  });

  it('background button is disabled and does not trigger onAudioSeparate', async () => {
    const onAudioSeparate = vi.fn();
    const user = userEvent.setup();
    render(<VideoNodeToolbar show={true} onAudioSeparate={onAudioSeparate} />);
    await user.click(screen.getByText('音频分离'));
    await waitFor(() => expect(screen.getByText('仅保留背景音')).toBeInTheDocument());
    const bgBtn = screen.getByText('仅保留背景音');
    expect(bgBtn).toBeDisabled();
    fireEvent.click(bgBtn);
    expect(onAudioSeparate).not.toHaveBeenCalled();
  });

  it('calls onAudioSeparate("split") when 音视频分离 is clicked', async () => {
    const onAudioSeparate = vi.fn();
    const user = userEvent.setup();
    render(<VideoNodeToolbar show={true} onAudioSeparate={onAudioSeparate} />);
    await user.click(screen.getByText('音频分离'));
    await waitFor(() => expect(screen.getByText('音视频分离')).toBeInTheDocument());
    fireEvent.click(screen.getByText('音视频分离'));
    expect(onAudioSeparate).toHaveBeenCalledWith('split');
  });

  it('disables all audio separate buttons when audioSeparatingType is set', async () => {
    const user = userEvent.setup();
    render(<VideoNodeToolbar show={true} audioSeparatingType="vocal" />);
    await user.click(screen.getByText('音频分离'));

    await waitFor(() => {
      const btns = screen.getAllByRole('button').filter((b) =>
        ['仅保留人声', '仅保留背景音', '音视频分离'].some((t) => b.textContent?.includes(t)),
      );
      btns.forEach((b) => expect(b).toBeDisabled());
    });
  });

  it('audio dropdown stays closed when audioSeparatingType is set', async () => {
    const user = userEvent.setup();
    render(<VideoNodeToolbar show={true} audioSeparatingType="background" />);
    await user.click(screen.getByText('音频分离'));
    expect(screen.queryByText('仅保留人声')).not.toBeInTheDocument();
  });

  it('does not throw when onAudioSeparate is not provided', async () => {
    const user = userEvent.setup();
    render(<VideoNodeToolbar show={true} />);
    await user.click(screen.getByText('音频分离'));
    await waitFor(() => expect(screen.getByText('仅保留人声')).toBeInTheDocument());
    fireEvent.click(screen.getByText('仅保留人声'));
  });

  // ── HD button ────────────────────────────────────────

  it('calls onHD when HD button is clicked', () => {
    const onHD = vi.fn();
    render(<VideoNodeToolbar show={true} onHD={onHD} />);
    fireEvent.click(screen.getByText('高清'));
    expect(onHD).toHaveBeenCalledTimes(1);
  });

  it('does not throw when onHD is not provided', () => {
    render(<VideoNodeToolbar show={true} />);
    // Should not throw
    fireEvent.click(screen.getByText('高清'));
  });

  it('HD button has data-active="true" when hdPanelOpen is true', () => {
    render(<VideoNodeToolbar show={true} hdPanelOpen />);
    const hdBtn = screen.getByText('高清').closest('button')!;
    expect(hdBtn).toHaveAttribute('data-active', 'true');
  });

  it('HD button does not have data-active when hdPanelOpen is false', () => {
    render(<VideoNodeToolbar show={true} />);
    const hdBtn = screen.getByText('高清').closest('button')!;
    expect(hdBtn).not.toHaveAttribute('data-active');
  });
});
