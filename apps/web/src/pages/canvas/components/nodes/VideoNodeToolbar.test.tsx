import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    expect(screen.getByText('智能去字幕')).toBeInTheDocument();
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
});
