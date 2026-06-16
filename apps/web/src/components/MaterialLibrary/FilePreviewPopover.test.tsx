import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import FilePreviewPopoverContent from './FilePreviewPopover';
import type { MaterialFile } from '@flowweb/shared';

function makeFile(overrides: Partial<MaterialFile> = {}): MaterialFile {
  return {
    id: 'file-1',
    originalName: 'test-image.png',
    mimeType: 'image/png',
    size: 1024,
    url: 'https://example.com/image.png',
    thumbnailUrl: 'https://example.com/thumb.png',
    folderId: null,
    isFavorite: false,
    createdAt: '2026-06-16T14:06:29.000Z',
    updatedAt: '2026-06-16T14:06:29.000Z',
    ...overrides,
  };
}

describe('FilePreviewPopoverContent', () => {
  beforeEach(() => {
    // Mock fetch to return a blob
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      blob: () => Promise.resolve(new Blob(['fake'], { type: 'image/png' })),
    } as Response);

    // jsdom may not have createObjectURL — define if missing
    if (typeof URL.createObjectURL === 'undefined') {
      (URL as any).createObjectURL = vi.fn(() => 'blob:fake-url');
    } else {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
    }
    if (typeof URL.revokeObjectURL === 'undefined') {
      (URL as any).revokeObjectURL = vi.fn();
    } else {
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    }

    // Mock video play
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Basic rendering ───

  it('renders file name and date for image', async () => {
    const file = makeFile();
    render(<FilePreviewPopoverContent file={file} onApplyToCanvas={vi.fn()} />);

    expect(screen.getByText('test-image.png')).toBeInTheDocument();
    expect(screen.getByText(/创建于/)).toBeInTheDocument();
    expect(screen.getByText('应用到画布')).toBeInTheDocument();
  });

  it('renders file name with title attribute (full name)', () => {
    const file = makeFile({ originalName: 'very-long-filename-that-gets-truncated.png' });
    render(<FilePreviewPopoverContent file={file} onApplyToCanvas={vi.fn()} />);

    const name = screen.getByText('very-long-filename-that-gets-truncated.png');
    expect(name).toHaveAttribute('title', 'very-long-filename-that-gets-truncated.png');
  });

  it('renders apply button', () => {
    const file = makeFile();
    render(<FilePreviewPopoverContent file={file} onApplyToCanvas={vi.fn()} />);

    expect(screen.getByRole('button', { name: '应用到画布' })).toBeInTheDocument();
  });

  // ─── Date formatting ───

  it('formats date using dayjs', () => {
    const file = makeFile({ createdAt: '2026-06-16T14:06:29.000Z' });
    render(<FilePreviewPopoverContent file={file} onApplyToCanvas={vi.fn()} />);

    // dayjs default format: YYYY/M/D HH:mm:ss
    expect(screen.getByText(/创建于 2026\/6\/16/)).toBeInTheDocument();
  });

  // ─── Button behavior ───

  it('calls onApplyToCanvas with file when button clicked', () => {
    const onApply = vi.fn();
    const file = makeFile();
    render(<FilePreviewPopoverContent file={file} onApplyToCanvas={onApply} />);

    fireEvent.click(screen.getByRole('button', { name: '应用到画布' }));
    expect(onApply).toHaveBeenCalledWith(file);
  });

  it('shows loading state on button after click', () => {
    const file = makeFile();
    render(<FilePreviewPopoverContent file={file} onApplyToCanvas={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '应用到画布' }));
    expect(screen.getByText('处理中...')).toBeInTheDocument();
  });

  // ─── Image: thumbnail renders immediately ───

  it('renders thumbnail img immediately for image files', () => {
    const file = makeFile({ mimeType: 'image/png', thumbnailUrl: 'https://example.com/thumb.png' });
    const { container } = render(<FilePreviewPopoverContent file={file} onApplyToCanvas={vi.fn()} />);

    const imgs = container.querySelectorAll('img');
    const thumbSrcs = Array.from(imgs).map((img) => img.getAttribute('src'));
    expect(thumbSrcs).toContain('https://example.com/thumb.png');
  });

  // ─── Image: fetch original with AbortController ───

  it('fetches original image and displays it', async () => {
    const file = makeFile({ mimeType: 'image/jpeg', url: 'https://example.com/original.jpg', thumbnailUrl: 'https://example.com/thumb.jpg' });
    render(<FilePreviewPopoverContent file={file} onApplyToCanvas={vi.fn()} />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('https://example.com/original.jpg', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    });
  });

  // ─── Image: abort fetch on unmount ───

  it('aborts fetch on unmount', () => {
    const file = makeFile({ mimeType: 'image/png', url: 'https://example.com/img.png' });
    const { unmount } = render(<FilePreviewPopoverContent file={file} onApplyToCanvas={vi.fn()} />);

    unmount();
    // fetch signal should have been aborted
    expect(fetch).toHaveBeenCalled();
    const callArgs = (fetch as Mock).mock.calls[0];
    const signal = callArgs[1]?.signal;
    expect(signal?.aborted).toBe(true);
  });

  // ─── Image: error state ───

  it('shows error placeholder when image fetch fails', async () => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const file = makeFile({ mimeType: 'image/png', url: 'https://example.com/broken.png' });
    render(<FilePreviewPopoverContent file={file} onApplyToCanvas={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('加载失败')).toBeInTheDocument();
    });
  });

  it('shows error placeholder when file.url is empty', () => {
    const file = makeFile({ mimeType: 'image/png', url: undefined });
    render(<FilePreviewPopoverContent file={file} onApplyToCanvas={vi.fn()} />);

    expect(screen.getByText('加载失败')).toBeInTheDocument();
  });

  // ─── Video: renders video element ───

  it('renders video element for video files', () => {
    const file = makeFile({ mimeType: 'video/mp4', url: 'https://example.com/video.mp4', thumbnailUrl: 'https://example.com/poster.jpg' });
    render(<FilePreviewPopoverContent file={file} onApplyToCanvas={vi.fn()} />);

    const video = document.querySelector('video');
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute('poster', 'https://example.com/poster.jpg');
  });

  // ─── Video: error state ───

  it('shows error placeholder when video errors', async () => {
    const file = makeFile({ mimeType: 'video/mp4', url: 'https://example.com/broken.mp4' });
    render(<FilePreviewPopoverContent file={file} onApplyToCanvas={vi.fn()} />);

    const video = document.querySelector('video')!;
    video.dispatchEvent(new Event('error'));
    // Wait for state update
    await waitFor(() => {
      expect(screen.getByText('加载失败')).toBeInTheDocument();
    });
  });

  // ─── Video: autoplay attributes ───

  it('video has autoplay, loop, muted, playsInline attributes', () => {
    const file = makeFile({ mimeType: 'video/mp4', url: 'https://example.com/video.mp4' });
    render(<FilePreviewPopoverContent file={file} onApplyToCanvas={vi.fn()} />);

    const video = document.querySelector('video')!;
    expect(video.autoplay).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
  });

  // ─── Play icon for video ───

  it('shows play icon for video files', () => {
    const file = makeFile({ mimeType: 'video/mp4', url: 'https://example.com/video.mp4' });
    const { container } = render(<FilePreviewPopoverContent file={file} onApplyToCanvas={vi.fn()} />);

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });
});
