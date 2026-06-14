import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FileCard from './FileCard';

const toggleFavorite = vi.hoisted(() => vi.fn());
const deleteFile = vi.hoisted(() => vi.fn());

const mockStore = vi.hoisted(() => {
  return vi.fn((selector?: (state: any) => any) => {
    const state = { toggleFavorite, deleteFile };
    return selector ? selector(state) : state;
  });
});

vi.mock('../../../stores/materialLibraryStore', () => ({
  useMaterialLibraryStore: mockStore,
}));

describe('FileCard', () => {
  const file = {
    id: '1',
    originalName: 'test.png',
    mimeType: 'image/png',
    size: 1024,
    url: 'http://example.com/test.png',
    folderId: null as string | null,
    isFavorite: false,
    createdAt: '2026-06-01',
    updatedAt: '2026-06-01',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render file name', () => {
    render(<FileCard file={file} />);
    expect(screen.getByText('test.png')).toBeInTheDocument();
  });

  it('should show favorite icon when favorited', () => {
    render(<FileCard file={{ ...file, isFavorite: true }} />);
    expect(screen.getByText('⭐')).toBeInTheDocument();
  });

  it('should have action buttons', () => {
    render(<FileCard file={file} />);
    expect(screen.getByTitle('收藏')).toBeInTheDocument();
    expect(screen.getByTitle('删除')).toBeInTheDocument();
  });

  describe('batch mode', () => {
    const baseProps = { file, batchMode: false, selected: false, onToggleSelect: vi.fn() };

    it('should render checkbox when in batch mode', () => {
      render(<FileCard {...baseProps} batchMode={true} />);
      expect(screen.getByRole('checkbox')).toBeInTheDocument();
    });

    it('should not render checkbox when not in batch mode', () => {
      render(<FileCard {...baseProps} batchMode={false} />);
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('should hide action buttons when in batch mode', () => {
      render(<FileCard {...baseProps} batchMode={true} />);
      expect(screen.queryByTitle('收藏')).not.toBeInTheDocument();
      expect(screen.queryByTitle('删除')).not.toBeInTheDocument();
    });

    it('should call onToggleSelect when clicked in batch mode', () => {
      const onToggleSelect = vi.fn();
      render(<FileCard {...baseProps} batchMode={true} onToggleSelect={onToggleSelect} />);
      // Click the card
      screen.getByText('test.png').click();
      expect(onToggleSelect).toHaveBeenCalled();
    });
  });

  describe('video preview', () => {
    it('should render video element for video file without thumbnail', () => {
      const videoFile = { ...file, mimeType: 'video/mp4', originalName: 'test.mp4' };
      render(<FileCard file={videoFile} />);
      const video = document.querySelector('video');
      expect(video).toBeInTheDocument();
      expect(video).toHaveAttribute('src', file.url);
    });

    it('should render img for video file with thumbnail', () => {
      const videoFile = { ...file, mimeType: 'video/mp4', thumbnailUrl: 'http://example.com/thumb.webp' };
      render(<FileCard file={videoFile} />);
      const img = document.querySelector('img');
      const video = document.querySelector('video');
      expect(img).toBeInTheDocument();
      expect(video).not.toBeInTheDocument();
      expect(img).toHaveAttribute('src', videoFile.thumbnailUrl);
    });

    it('should render img for image file without thumbnail', () => {
      render(<FileCard file={file} />);
      const img = document.querySelector('img');
      const video = document.querySelector('video');
      expect(img).toBeInTheDocument();
      expect(video).not.toBeInTheDocument();
    });

    it('should show emoji fallback when no url or thumbnail', () => {
      const noUrlFile = { ...file, url: undefined };
      render(<FileCard file={noUrlFile} />);
      expect(screen.getByText('🖼️')).toBeInTheDocument();
    });

    it('should show video emoji fallback when video has no url or thumbnail', () => {
      const noUrlVideo = { ...file, mimeType: 'video/mp4', url: undefined };
      render(<FileCard file={noUrlVideo} />);
      expect(screen.getByText('🎬')).toBeInTheDocument();
    });
  });
});
