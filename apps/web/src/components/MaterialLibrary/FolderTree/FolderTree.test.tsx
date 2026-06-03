import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FolderTree from './FolderTree';

const { setSelectedFolder, createFolder } = vi.hoisted(() => ({
  setSelectedFolder: vi.fn(),
  createFolder: vi.fn(),
}));

const mockStore = vi.hoisted(() => {
  const fn = vi.fn((selector?: (state: any) => any) => {
    const state = {
      folders: [
        { id: '1', name: '角色', parentId: null, userId: 'u1', sortOrder: 0, isDefault: true, createdAt: '', updatedAt: '' },
        { id: '2', name: '场景', parentId: null, userId: 'u1', sortOrder: 1, isDefault: true, createdAt: '', updatedAt: '' },
      ],
      selectedFolderId: null,
      setSelectedFolder,
    };
    return selector ? selector(state) : state;
  });
  (fn as any).getState = vi.fn(() => ({ createFolder }));
  return fn;
});

vi.mock('../../../stores/materialLibraryStore', () => ({
  useMaterialLibraryStore: mockStore,
}));

describe('FolderTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render default folders', () => {
    render(<FolderTree />);
    expect(screen.getByText('角色')).toBeInTheDocument();
    expect(screen.getByText('场景')).toBeInTheDocument();
  });

  it('should show new folder button', () => {
    render(<FolderTree />);
    expect(screen.getByText('+ 新建文件夹')).toBeInTheDocument();
  });
});
