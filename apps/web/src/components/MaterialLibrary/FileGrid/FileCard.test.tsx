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
});
