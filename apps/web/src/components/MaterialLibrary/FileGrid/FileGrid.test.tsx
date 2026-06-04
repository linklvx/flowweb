import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FileGrid from './FileGrid';

const testFile = (id: string, date: string) => ({
  id, originalName: `file-${id}`, mimeType: 'image/png', size: 100,
  url: `/minio-storage/${id}`, thumbnailUrl: null, folderId: 'folder-1',
  isFavorite: false, createdAt: date, updatedAt: date,
});

const mockStore = vi.hoisted(() => {
  return vi.fn((selector?: (state: any) => any) => {
    const state = {
      files: [] as any[],
      fileGridSize: 200,
      loading: false,
      batchMode: false,
      selectedFileIds: new Set<string>(),
    };
    return selector ? selector(state) : state;
  });
});

vi.mock('../../../stores/materialLibraryStore', () => ({
  useMaterialLibraryStore: mockStore,
}));

describe('FileGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show empty state when no files', () => {
    render(<FileGrid />);
    expect(screen.getByText('暂无素材，点击上传按钮添加')).toBeInTheDocument();
  });

  it('should show loading state', () => {
    mockStore.mockImplementation((selector?: (state: any) => any) => {
      const state = { files: [], fileGridSize: 200, loading: true, batchMode: false, selectedFileIds: new Set() };
      return selector ? selector(state) : state;
    });
    render(<FileGrid />);
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  describe('batch mode', () => {
    it('should show date group checkboxes when in batch mode', () => {
      mockStore.mockImplementation((selector?: (state: any) => any) => {
        const state = {
          files: [testFile('f1', '2026-06-01T00:00:00Z'), testFile('f2', '2026-06-02T00:00:00Z')],
          fileGridSize: 200, loading: false, batchMode: true, selectedFileIds: new Set<string>(),
        };
        return selector ? selector(state) : state;
      });
      render(<FileGrid />);
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBeGreaterThan(0);
    });

    it('should not show checkboxes when not in batch mode', () => {
      mockStore.mockImplementation((selector?: (state: any) => any) => {
        const state = {
          files: [testFile('f1', '2026-06-01T00:00:00Z')],
          fileGridSize: 200, loading: false, batchMode: false, selectedFileIds: new Set<string>(),
        };
        return selector ? selector(state) : state;
      });
      render(<FileGrid />);
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });
  });
});
