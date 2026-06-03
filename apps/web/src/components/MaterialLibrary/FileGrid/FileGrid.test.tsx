import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FileGrid from './FileGrid';

const mockStore = vi.hoisted(() => {
  return vi.fn((selector?: (state: any) => any) => {
    const state = {
      files: [],
      fileGridSize: 200,
      loading: false,
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
      const state = { files: [], fileGridSize: 200, loading: true };
      return selector ? selector(state) : state;
    });
    render(<FileGrid />);
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });
});
