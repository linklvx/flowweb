import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FolderTree, { canDrop, computeDropParams } from './FolderTree';
import type { MaterialFolder } from '@flowweb/shared';

const mockFolders: MaterialFolder[] = [
  { id: '1', name: '角色', parentId: null, userId: 'u1', sortOrder: 0, isDefault: true, createdAt: '', updatedAt: '' },
  { id: '2', name: '场景', parentId: null, userId: 'u1', sortOrder: 1, isDefault: true, createdAt: '', updatedAt: '' },
  { id: '3', name: '子文件夹', parentId: '1', userId: 'u1', sortOrder: 0, isDefault: false, createdAt: '', updatedAt: '' },
];

const { setSelectedFolder, createFolder, loadFiles, moveFolder } = vi.hoisted(() => ({
  setSelectedFolder: vi.fn(),
  createFolder: vi.fn(),
  loadFiles: vi.fn(),
  moveFolder: vi.fn(),
}));

const mockStore = vi.hoisted(() => {
  const fn = vi.fn((selector?: (state: any) => any) => {
    const state = {
      folders: mockFolders,
      selectedFolderId: null,
      setSelectedFolder,
    };
    return selector ? selector(state) : state;
  });
  (fn as any).getState = vi.fn(() => ({ createFolder, loadFiles, moveFolder }));
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

  it('should call loadFiles when folder is selected', () => {
    render(<FolderTree />);
    const folderNode = screen.getByText('角色');
    folderNode.click();
    expect(setSelectedFolder).toHaveBeenCalledWith('1');
    expect(loadFiles).toHaveBeenCalled();
  });
});

describe('canDrop', () => {
  it('should not allow dropping on self', () => {
    expect(canDrop(mockFolders, '1', '1', -1)).toBe(false);
  });

  it('should allow dragging default folder', () => {
    expect(canDrop(mockFolders, '1', '3', -1)).toBe(true);
  });

  it('should allow dropping into default folder', () => {
    expect(canDrop(mockFolders, '3', '1', 0)).toBe(true);
  });

  it('should allow dropping above/below default folder', () => {
    expect(canDrop(mockFolders, '3', '1', -1)).toBe(true);
    expect(canDrop(mockFolders, '3', '1', 1)).toBe(true);
  });

  it('should allow normal drop', () => {
    expect(canDrop(mockFolders, '3', '2', 1)).toBe(true);
    expect(canDrop(mockFolders, '3', '2', 0)).toBe(true);
  });
});

describe('computeDropParams', () => {
  it('should compute child append when dropping into folder', () => {
    const result = computeDropParams(mockFolders, '3', '2', 0, false);
    expect(result).toEqual({ parentId: '2', afterId: null });
  });

  it('should compute before placement when dropping above', () => {
    // Drop folder 3 above folder 2 (both at root), afterId = folder before target (folder '1')
    const result = computeDropParams(mockFolders, '3', '2', -1, true);
    expect(result).toEqual({ parentId: null, afterId: '1' });
  });

  it('should compute after placement when dropping below', () => {
    const result = computeDropParams(mockFolders, '3', '2', 1, true);
    expect(result).toEqual({ parentId: null, afterId: '2' });
  });

  it('should compute before first sibling', () => {
    // Drop above the first sibling (folder '1'), afterId should be null
    const result = computeDropParams(mockFolders, '3', '1', -1, true);
    expect(result).toEqual({ parentId: null, afterId: null });
  });
});
