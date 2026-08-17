import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FolderContextMenu from './FolderContextMenu';
import type { MaterialFolder } from '@flowweb/shared';

const { mockConfirm } = vi.hoisted(() => ({ mockConfirm: vi.fn() }));

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return {
    ...actual,
    App: {
      ...actual.App,
      useApp: () => ({ modal: { confirm: mockConfirm } }),
    },
  };
});

const mockFolder: MaterialFolder = {
  id: 'f1', name: '我的文件夹', parentId: null, userId: 'u1',
  sortOrder: 0, isDefault: false, createdAt: '', updatedAt: '',
};

const mockDefaultFolder: MaterialFolder = {
  id: 'f-def', name: '角色', parentId: null, userId: 'u1',
  sortOrder: 0, isDefault: true, createdAt: '', updatedAt: '',
};

const storeMocks = {
  setRenameModal: vi.fn(),
  createFolder: vi.fn(),
  renameFolder: vi.fn(),
  deleteFolder: vi.fn(),
  moveFolderUp: vi.fn(),
};

const mockStore = vi.hoisted(() => {
  const fn = vi.fn((selector?: (state: any) => any) => {
    return selector ? selector(storeMocks) : storeMocks;
  });
  (fn as any).getState = vi.fn(() => storeMocks);
  return fn;
});

vi.mock('../../../stores/materialLibraryStore', () => ({
  useMaterialLibraryStore: mockStore,
}));

const defaultProps = {
  onClose: vi.fn(),
  onCreateSub: vi.fn(),
  onRename: vi.fn(),
};

describe('FolderContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render all context menu items in correct order', () => {
    render(<FolderContextMenu x={0} y={0} folder={mockFolder} {...defaultProps} />);
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('新建子文件夹');
    expect(items[1]).toHaveTextContent('重命名');
    expect(items[2]).toHaveTextContent('向上移动');
    expect(items[3]).toHaveTextContent('删除');
  });

  it('should render SVG icons for each menu item', () => {
    render(<FolderContextMenu x={0} y={0} folder={mockFolder} {...defaultProps} />);
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(4);
    items.forEach((item) => {
      expect(item.querySelector('svg')).toBeTruthy();
    });
  });

  it('should render separator before delete item', () => {
    const { container } = render(<FolderContextMenu x={0} y={0} folder={mockFolder} {...defaultProps} />);
    const separator = container.querySelector('[role="separator"]');
    expect(separator).toBeTruthy();
    const deleteItem = screen.getByText('删除').closest('[role="menuitem"]');
    expect(separator!.compareDocumentPosition(deleteItem!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('should apply destructive styling to delete item', () => {
    render(<FolderContextMenu x={0} y={0} folder={mockFolder} {...defaultProps} />);
    const deleteItem = screen.getByText('删除').closest('[role="menuitem"]');
    expect(deleteItem?.getAttribute('data-variant')).toBe('destructive');
  });

  it('should show all items for default folder too', () => {
    render(<FolderContextMenu x={0} y={0} folder={mockDefaultFolder} {...defaultProps} />);
    expect(screen.getByText('新建子文件夹')).toBeInTheDocument();
    expect(screen.getByText('重命名')).toBeInTheDocument();
    expect(screen.getByText('删除')).toBeInTheDocument();
    expect(screen.getByText('向上移动')).toBeInTheDocument();
  });

  it('should call onCreateSub and onClose on 新建子文件夹 click', () => {
    const onClose = vi.fn();
    const onCreateSub = vi.fn();
    render(<FolderContextMenu x={0} y={0} folder={mockFolder} onClose={onClose} onCreateSub={onCreateSub} onRename={vi.fn()} />);
    fireEvent.click(screen.getByText('新建子文件夹'));
    expect(onCreateSub).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('should call onRename and onClose on 重命名 click', () => {
    const onClose = vi.fn();
    const onRename = vi.fn();
    render(<FolderContextMenu x={0} y={0} folder={mockFolder} onClose={onClose} onCreateSub={vi.fn()} onRename={onRename} />);
    fireEvent.click(screen.getByText('重命名'));
    expect(onRename).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('should show delete confirm dialog on click', () => {
    render(<FolderContextMenu x={0} y={0} folder={mockFolder} {...defaultProps} />);
    fireEvent.click(screen.getByText('删除'));
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: '删除文件夹',
      content: expect.stringContaining('确定删除文件夹'),
    }));
  });
});
