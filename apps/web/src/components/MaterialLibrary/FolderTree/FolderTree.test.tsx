import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FolderTree, { canDrop, computeDropParams } from './FolderTree';
import type { MaterialFolder } from '@flowweb/shared';

const mockFolders: MaterialFolder[] = [
  { id: '1', name: '角色', parentId: null, userId: 'u1', sortOrder: 0, isDefault: true, createdAt: '', updatedAt: '' },
  { id: '2', name: '场景', parentId: null, userId: 'u1', sortOrder: 1, isDefault: true, createdAt: '', updatedAt: '' },
  { id: '3', name: '子文件夹', parentId: '1', userId: 'u1', sortOrder: 0, isDefault: false, createdAt: '', updatedAt: '' },
];

const { setSelectedFolder, createFolder, loadFiles, moveFolder, setRenameModal } = vi.hoisted(() => ({
  setSelectedFolder: vi.fn(),
  createFolder: vi.fn(),
  loadFiles: vi.fn(),
  moveFolder: vi.fn(),
  setRenameModal: vi.fn(),
}));

const mockStore = vi.hoisted(() => {
  const fn = vi.fn((selector?: (state: any) => any) => {
    const state = {
      folders: mockFolders,
      selectedFolderId: null,
      setSelectedFolder,
      renameModal: { open: false, folderId: null, defaultValue: '' },
      setRenameModal,
      renameFolder: vi.fn(),
    };
    return selector ? selector(state) : state;
  });
  (fn as any).getState = vi.fn(() => ({ createFolder, loadFiles, moveFolder, setRenameModal }));
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

  it('should open context menu on right-click of folder', () => {
    render(<FolderTree />);
    const folderNode = screen.getByText('角色');
    fireEvent.contextMenu(folderNode, { clientX: 100, clientY: 200 });
    // Context menu renders FolderContextMenu which has role="menu"
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('新建子文件夹')).toBeInTheDocument();
    expect(screen.getByText('删除')).toBeInTheDocument();
  });

  it('should close context menu on outside mousedown', () => {
    render(<FolderTree />);
    fireEvent.contextMenu(screen.getByText('角色'), { clientX: 100, clientY: 200 });
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('should create temp folder and open rename on 新建子文件夹 click', async () => {
    createFolder.mockResolvedValue(undefined);
    // Simulate store returning updated folders after create
    (mockStore as any).getState.mockReturnValue({
      createFolder,
      loadFiles,
      moveFolder,
      setRenameModal,
      folders: [
        ...mockFolders,
        { id: 'new-id', name: '新建文件夹', parentId: '1', userId: 'u1', sortOrder: 1, isDefault: false, createdAt: '', updatedAt: '' },
      ],
    });
    render(<FolderTree />);
    // Right-click on 角色 (id=1)
    fireEvent.contextMenu(screen.getByText('角色'), { clientX: 100, clientY: 200 });
    // Click 新建子文件夹
    fireEvent.click(screen.getByText('新建子文件夹'));
    // Create should be called with temp name and parentId
    await vi.waitFor(() => {
      expect(createFolder).toHaveBeenCalledWith('新建文件夹', '1');
    });
    // Rename modal should open with empty defaultValue
    expect(setRenameModal).toHaveBeenCalledWith(
      expect.objectContaining({ open: true, folderId: 'new-id', defaultValue: '' }),
    );
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
    const result = computeDropParams(mockFolders, '3', '2', makeEvent(30));
    expect(result).toEqual({ parentId: '2', afterId: null });
  });

  it('should compute drop into at upper middle boundary', () => {
    const result = computeDropParams(mockFolders, '3', '2', makeEvent(26));
    expect(result).toEqual({ parentId: '2', afterId: null });
  });

  it('should compute drop into at lower middle boundary', () => {
    const result = computeDropParams(mockFolders, '3', '2', makeEvent(74));
    expect(result).toEqual({ parentId: '2', afterId: null });
  });

  it('should compute before placement when mouse is above target', () => {
    const result = computeDropParams(mockFolders, '3', '2', makeEvent(10));
    expect(result).toEqual({ parentId: null, afterId: '1' });
  });

  it('should compute before first sibling', () => {
    const result = computeDropParams(mockFolders, '3', '1', makeEvent(10));
    expect(result).toEqual({ parentId: null, afterId: null });
  });

  it('should compute after placement when mouse is below target', () => {
    const result = computeDropParams(mockFolders, '3', '2', makeEvent(80));
    expect(result).toEqual({ parentId: null, afterId: '2' });
  });

  it('should compute drop into for nested target', () => {
    const result = computeDropParams(mockFolders, '2', '1', makeEvent(50));
    expect(result).toEqual({ parentId: '1', afterId: null });
  });
});
