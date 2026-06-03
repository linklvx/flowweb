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

function makeEvent(clientY: number): { clientY: number; target: EventTarget | null } {
  const rect = { top: 0, height: 100 };
  const target = {
    getBoundingClientRect: () => rect,
  } as unknown as HTMLElement;
  return { clientY, target };
}

describe('computeDropParams', () => {
  it('should compute child append when mouse is in middle of target', () => {
    // clientY=30 on a 0-100 rect -> ratio=0.3 -> middle 50% -> into
    const result = computeDropParams(mockFolders, '3', '2', makeEvent(30));
    expect(result).toEqual({ parentId: '2', afterId: null });
  });

  it('should compute drop into at upper middle boundary', () => {
    // clientY=26 -> ratio=0.26 -> middle 50% -> into
    const result = computeDropParams(mockFolders, '3', '2', makeEvent(26));
    expect(result).toEqual({ parentId: '2', afterId: null });
  });

  it('should compute drop into at lower middle boundary', () => {
    // clientY=74 -> ratio=0.74 -> middle 50% -> into
    const result = computeDropParams(mockFolders, '3', '2', makeEvent(74));
    expect(result).toEqual({ parentId: '2', afterId: null });
  });

  it('should compute before placement when mouse is above target', () => {
    // clientY=10 on a 0-100 rect -> ratio=0.1 -> top 25% -> above
    const result = computeDropParams(mockFolders, '3', '2', makeEvent(10));
    // Target '2' is root-level sibling 1 (after '1'), drop above '2' -> afterId='1'
    expect(result).toEqual({ parentId: null, afterId: '1' });
  });

  it('should compute before first sibling', () => {
    // Drop above the first sibling (folder '1')
    const result = computeDropParams(mockFolders, '3', '1', makeEvent(10));
    expect(result).toEqual({ parentId: null, afterId: null });
  });

  it('should compute after placement when mouse is below target', () => {
    // clientY=80 on a 0-100 rect -> ratio=0.8 -> bottom 25% -> below
    const result = computeDropParams(mockFolders, '3', '2', makeEvent(80));
    expect(result).toEqual({ parentId: null, afterId: '2' });
  });

  it('should compute drop into for nested target', () => {
    // Target '1' (has child '3'), drop into the middle
    const result = computeDropParams(mockFolders, '2', '1', makeEvent(50));
    expect(result).toEqual({ parentId: '1', afterId: null });
  });
});
