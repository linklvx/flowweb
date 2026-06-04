import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMaterialLibraryStore } from './materialLibraryStore';

const mockPost = vi.fn();
const mockPut = vi.fn();
const mockDelete = vi.fn();
const mockGet = vi.fn();

vi.mock('axios', () => ({
  default: {
    post: (...args: any[]) => mockPost(...args),
    put: (...args: any[]) => mockPut(...args),
    delete: (...args: any[]) => mockDelete(...args),
    get: (...args: any[]) => mockGet(...args),
  },
  CancelToken: { source: () => ({ token: null }) },
}));

vi.mock('antd', () => ({
  message: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/api/storageApi', () => ({
  presignUpload: vi.fn(),
  confirmUpload: vi.fn(),
}));

import { message } from 'antd';

describe('materialLibraryStore - renameModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMaterialLibraryStore.setState({
      folders: [],
      selectedFolderId: null,
      files: [],
    });
  });

  it('should have initial renameModal state as closed', () => {
    const state = useMaterialLibraryStore.getState();
    expect((state as any).renameModal).toEqual({ open: false, folderId: null, defaultValue: '' });
  });

  it('should set renameModal state', () => {
    useMaterialLibraryStore.getState().setRenameModal({ open: true, folderId: 'f1', defaultValue: 'Old' });
    const state = useMaterialLibraryStore.getState();
    expect((state as any).renameModal).toEqual({ open: true, folderId: 'f1', defaultValue: 'Old' });
  });
});

describe('materialLibraryStore - duplicate name check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reject createFolder when name duplicate under same parent', async () => {
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });
    const folders = [
      { id: 'f1', name: '角色', parentId: null, userId: 'u1', sortOrder: 0, isDefault: true, createdAt: '', updatedAt: '' },
    ];
    useMaterialLibraryStore.setState({ folders });

    await useMaterialLibraryStore.getState().createFolder('角色', null);
    expect(message.error).toHaveBeenCalledWith('同名文件夹已存在');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('should allow createFolder when name is unique', async () => {
    mockPost.mockResolvedValue({ data: {} });
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });
    const folders = [
      { id: 'f1', name: '角色', parentId: null, userId: 'u1', sortOrder: 0, isDefault: true, createdAt: '', updatedAt: '' },
    ];
    useMaterialLibraryStore.setState({ folders });

    await useMaterialLibraryStore.getState().createFolder('新建', null);
    expect(message.error).not.toHaveBeenCalled();
    expect(mockPost).toHaveBeenCalledWith('/api/material/folders', { name: '新建', parentId: null });
  });

  it('should reject renameFolder when name duplicate excluding self', async () => {
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });
    const folders = [
      { id: 'f1', name: '角色', parentId: null, userId: 'u1', sortOrder: 0, isDefault: true, createdAt: '', updatedAt: '' },
      { id: 'f2', name: '场景', parentId: null, userId: 'u1', sortOrder: 1, isDefault: true, createdAt: '', updatedAt: '' },
    ];
    useMaterialLibraryStore.setState({ folders });

    await useMaterialLibraryStore.getState().renameFolder('f2', '角色');
    expect(message.error).toHaveBeenCalledWith('同名文件夹已存在');
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('should allow renameFolder when keeping same name', async () => {
    mockPut.mockResolvedValue({ data: {} });
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });
    const folders = [
      { id: 'f1', name: '角色', parentId: null, userId: 'u1', sortOrder: 0, isDefault: true, createdAt: '', updatedAt: '' },
    ];
    useMaterialLibraryStore.setState({ folders });

    await useMaterialLibraryStore.getState().renameFolder('f1', '角色');
    expect(mockPut).toHaveBeenCalledWith('/api/material/folders/f1', { name: '角色' });
  });
});
