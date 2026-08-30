import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
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
    isCancel: () => false,
    CancelToken: { source: () => ({ token: null }) },
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

const { mockPresignUpload, mockConfirmUpload } = vi.hoisted(() => ({
  mockPresignUpload: vi.fn(),
  mockConfirmUpload: vi.fn(),
}));

vi.mock('@/api/storageApi', () => ({
  presignUpload: mockPresignUpload,
  confirmUpload: mockConfirmUpload,
}));

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: { getState: () => ({ projectId: 'p1', teamId: 't-team' }) },
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

describe('materialLibraryStore - batch operations', () => {
  const testFile: any = (id: string) => ({
    id, originalName: `file-${id}`, mimeType: 'image/png', size: 100,
    url: `/flowai/${id}`, thumbnailUrl: null, folderId: 'folder-1',
    isFavorite: false, createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useMaterialLibraryStore.setState({
      batchMode: false,
      selectedFileIds: new Set(),
      files: [testFile('f1'), testFile('f2'), testFile('f3')],
    });
  });

  it('should enter batch mode', () => {
    useMaterialLibraryStore.getState().enterBatchMode();
    expect(useMaterialLibraryStore.getState().batchMode).toBe(true);
  });

  it('should exit batch mode and clear selection', () => {
    useMaterialLibraryStore.setState({ batchMode: true, selectedFileIds: new Set(['f1']) });
    useMaterialLibraryStore.getState().exitBatchMode();
    const state = useMaterialLibraryStore.getState();
    expect(state.batchMode).toBe(false);
    expect(state.selectedFileIds.size).toBe(0);
  });

  it('should select a file', () => {
    useMaterialLibraryStore.getState().selectFile('f1');
    expect(useMaterialLibraryStore.getState().selectedFileIds.has('f1')).toBe(true);
  });

  it('should deselect a file', () => {
    useMaterialLibraryStore.setState({ selectedFileIds: new Set(['f1', 'f2']) });
    useMaterialLibraryStore.getState().deselectFile('f1');
    expect(useMaterialLibraryStore.getState().selectedFileIds.has('f1')).toBe(false);
    expect(useMaterialLibraryStore.getState().selectedFileIds.has('f2')).toBe(true);
  });

  it('should toggle file selection', () => {
    const store = useMaterialLibraryStore.getState();
    store.toggleFileSelection('f1');
    expect(useMaterialLibraryStore.getState().selectedFileIds.has('f1')).toBe(true);
    useMaterialLibraryStore.getState().toggleFileSelection('f1');
    expect(useMaterialLibraryStore.getState().selectedFileIds.has('f1')).toBe(false);
  });

  it('should select all files', () => {
    useMaterialLibraryStore.getState().selectAllFiles();
    const { selectedFileIds } = useMaterialLibraryStore.getState();
    expect(selectedFileIds.has('f1')).toBe(true);
    expect(selectedFileIds.has('f2')).toBe(true);
    expect(selectedFileIds.has('f3')).toBe(true);
  });

  it('batchDelete should send POST and remove files on success', async () => {
    mockPost.mockResolvedValue({ data: { code: 0, data: { success: true, count: 2 }, message: 'ok' } });
    useMaterialLibraryStore.setState({ batchMode: true, selectedFileIds: new Set(['f1', 'f2']) });

    await useMaterialLibraryStore.getState().batchDelete();

    expect(mockPost).toHaveBeenCalledWith('/api/material/files/batch-delete', { ids: ['f1', 'f2'] });
    const state = useMaterialLibraryStore.getState();
    expect(state.files).toHaveLength(1);
    expect(state.files[0].id).toBe('f3');
    expect(state.batchMode).toBe(false);
    expect(state.selectedFileIds.size).toBe(0);
    expect(message.success).toHaveBeenCalledWith('成功删除 2 个文件');
  });

  it('batchDelete should warn on partial success', async () => {
    mockPost.mockResolvedValue({ data: { code: 0, data: { success: true, count: 1 }, message: 'ok' } });
    useMaterialLibraryStore.setState({ batchMode: true, selectedFileIds: new Set(['f1', 'f2']) });

    await useMaterialLibraryStore.getState().batchDelete();

    expect(message.warning).toHaveBeenCalledWith('部分文件删除失败，成功删除 1/2 个');
  });

  it('batchDelete should not send request when nothing selected', async () => {
    useMaterialLibraryStore.setState({ selectedFileIds: new Set() });
    await useMaterialLibraryStore.getState().batchDelete();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('batchDelete should show error on failure', async () => {
    mockPost.mockRejectedValue(new Error('Network error'));
    useMaterialLibraryStore.setState({ batchMode: true, selectedFileIds: new Set(['f1']) });

    await useMaterialLibraryStore.getState().batchDelete();

    expect(message.error).toHaveBeenCalledWith('批量删除失败，请稍后重试');
  });

  it('should auto-exit batch mode when closing', () => {
    useMaterialLibraryStore.setState({ batchMode: true, selectedFileIds: new Set(['f1']) });
    useMaterialLibraryStore.getState().close();
    const state = useMaterialLibraryStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.batchMode).toBe(false);
    expect(state.selectedFileIds.size).toBe(0);
  });

  describe('batchMove', () => {
    it('should move files and exit batch mode on success', async () => {
      mockPost.mockResolvedValue({ data: { code: 0, data: { success: true, count: 2 }, message: 'ok' } });
      useMaterialLibraryStore.setState({ batchMode: true, selectedFileIds: new Set(['f1', 'f2']), selectedFolderId: 'folder-1' });

      await useMaterialLibraryStore.getState().batchMove('folder-2');

      expect(mockPost).toHaveBeenCalledWith('/api/material/files/batch-move', { ids: ['f1', 'f2'], folderId: 'folder-2' });
      const state = useMaterialLibraryStore.getState();
      expect(state.files).toHaveLength(1);
      expect(state.files[0].id).toBe('f3');
      expect(state.batchMode).toBe(false);
      expect(state.selectedFileIds.size).toBe(0);
      expect(message.success).toHaveBeenCalledWith('成功移动 2 个文件');
    });

    it('should move to root when folderId is null', async () => {
      mockPost.mockResolvedValue({ data: { code: 0, data: { success: true, count: 1 }, message: 'ok' } });
      useMaterialLibraryStore.setState({ batchMode: true, selectedFileIds: new Set(['f1']), selectedFolderId: 'folder-1' });

      await useMaterialLibraryStore.getState().batchMove(null);

      expect(mockPost).toHaveBeenCalledWith('/api/material/files/batch-move', { ids: ['f1'], folderId: null });
    });

    it('should warn on partial move', async () => {
      mockPost.mockResolvedValue({ data: { code: 0, data: { success: true, count: 1 }, message: 'ok' } });
      useMaterialLibraryStore.setState({ batchMode: true, selectedFileIds: new Set(['f1', 'f2']), selectedFolderId: 'folder-1' });

      await useMaterialLibraryStore.getState().batchMove('folder-2');

      expect(message.warning).toHaveBeenCalledWith('部分文件移动失败，成功移动 1/2 个');
    });

    it('should block move to same folder', async () => {
      useMaterialLibraryStore.setState({ batchMode: true, selectedFileIds: new Set(['f1']), selectedFolderId: 'folder-1' });

      await useMaterialLibraryStore.getState().batchMove('folder-1');

      expect(message.warning).toHaveBeenCalledWith('文件已在目标文件夹中');
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('should not send request when nothing selected', async () => {
      useMaterialLibraryStore.setState({ selectedFileIds: new Set() });
      await useMaterialLibraryStore.getState().batchMove('folder-1');
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('should show error on failure', async () => {
      mockPost.mockRejectedValue(new Error('Network error'));
      useMaterialLibraryStore.setState({ batchMode: true, selectedFileIds: new Set(['f1']), selectedFolderId: 'folder-1' });

      await useMaterialLibraryStore.getState().batchMove('folder-2');

      expect(message.error).toHaveBeenCalledWith('批量移动失败，请稍后重试');
    });
  });
});

describe('materialLibraryStore - 画布团队维度', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMaterialLibraryStore.setState({
      folders: [],
      selectedFolderId: null,
      files: [],
      uploading: false,
      uploadProgress: 0,
    });
  });

  it('loadFolders 按画布团队维度拉取', async () => {
    useMaterialLibraryStore.setState({ context: { teamId: 't-team', projectId: 'p1' } });
    mockGet.mockResolvedValue({ data: { data: { success: true, data: { folders: [] } } } });
    await useMaterialLibraryStore.getState().loadFolders();
    expect(mockGet).toHaveBeenCalledWith('/api/material/folders', expect.objectContaining({
      params: expect.objectContaining({ teamId: 't-team' }),
    }));
  });

  it('uploadFile presign 传 projectId（后端三级回落①级）', async () => {
    useMaterialLibraryStore.setState({ context: { teamId: 't-team', projectId: 'p1' } });
    mockPresignUpload.mockResolvedValue({ fileId: 'file-1', uploadUrl: 'http://127.0.0.1:9000/flowai/k1', key: 'k1', fields: {} });
    mockConfirmUpload.mockResolvedValue({ fileId: 'file-1' });
    mockPost.mockResolvedValue({ data: {} });
    mockPut.mockResolvedValue({ data: {} });
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });

    await useMaterialLibraryStore.getState().uploadFile(new File(['x'], 'a.png', { type: 'image/png' }));
    expect(mockPresignUpload).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'a.png',
      fileSize: 1,
      fileType: 'image/png',
      type: 'uploaded',
      projectId: 'p1',
    }));
  });
});

describe('materialLibraryStore - enterContext 完整重置（spec §二.3）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('重置清单全覆盖：context+selectedFolderId+folders+files+batchMode+selectedFileIds+renameModal', async () => {
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });
    // 预置脏状态（模拟团队 A 的残留）
    useMaterialLibraryStore.setState({
      selectedFolderId: 'folder-A',
      folders: [{ id: 'fa', name: 'A文件夹', parentId: null, userId: 'u1', sortOrder: 0, isDefault: false, createdAt: '', updatedAt: '' }] as any,
      files: [{ id: 'fa-file' }] as any,
      batchMode: true,
      selectedFileIds: new Set(['fa-file']),
      renameModal: { open: true, folderId: 'fa', defaultValue: 'x' },
    });

    await useMaterialLibraryStore.getState().enterContext({ teamId: 'B' });

    const s = useMaterialLibraryStore.getState();
    expect(s.context).toEqual({ teamId: 'B' });
    expect(s.selectedFolderId).toBeNull();
    expect(s.folders).toEqual([]);
    expect(s.files).toEqual([]);
    expect(s.batchMode).toBe(false);
    expect(s.selectedFileIds.size).toBe(0);
    expect((s as any).renameModal).toEqual({ open: false, folderId: null, defaultValue: '' });
    expect(mockGet).toHaveBeenCalledWith('/api/material/folders', expect.objectContaining({
      params: expect.objectContaining({ teamId: 'B' }),
    }));
  });

  it('跨团队批量误操作回归：A 勾选残留切 B 后 batchDelete 请求体不含 A 的 fileId', async () => {
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });
    useMaterialLibraryStore.setState({ batchMode: true, selectedFileIds: new Set(['file-A1', 'file-A2']) });

    await useMaterialLibraryStore.getState().enterContext({});
    useMaterialLibraryStore.getState().enterBatchMode();
    await useMaterialLibraryStore.getState().batchDelete();

    // enterContext 已清空 A 的残留勾选 → batchDelete 空选择 early return → 删除请求根本不发出
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('materialLibraryStore - context 注入与快照（spec §二.4/§二.5）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMaterialLibraryStore.setState({
      context: {}, folders: [], selectedFolderId: null, files: [], uploading: false, uploadProgress: 0,
    });
  });

  it('个人上下文 loadFolders 不带 teamId（③级回落）', async () => {
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });
    await useMaterialLibraryStore.getState().loadFolders();
    expect(mockGet).toHaveBeenCalledWith('/api/material/folders', { params: {} });
  });

  it('团队上下文 loadFiles 带 teamId（②级）', async () => {
    useMaterialLibraryStore.setState({ context: { teamId: 'T2' } });
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });
    await useMaterialLibraryStore.getState().loadFiles();
    expect(mockGet).toHaveBeenCalledWith('/api/material/files', expect.objectContaining({
      params: expect.objectContaining({ teamId: 'T2' }),
    }));
  });

  it('createFolder body 带 teamId', async () => {
    useMaterialLibraryStore.setState({ context: { teamId: 'T2' } });
    mockPost.mockResolvedValue({ data: {} });
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });
    await useMaterialLibraryStore.getState().createFolder('新夹', null);
    expect(mockPost).toHaveBeenCalledWith('/api/material/folders', { name: '新夹', parentId: null, teamId: 'T2' });
  });

  it('renameFolder/moveFolder body 带 teamId；deleteFolder/moveFolderUp query 带 teamId', async () => {
    useMaterialLibraryStore.setState({
      context: { teamId: 'T2' },
      folders: [{ id: 'f1', name: 'a', parentId: null, userId: 'u1', sortOrder: 0, isDefault: false, createdAt: '', updatedAt: '' }] as any,
    });
    mockPut.mockResolvedValue({ data: {} });
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });
    mockDelete.mockResolvedValue({ data: {} });
    await useMaterialLibraryStore.getState().renameFolder('f1', 'b');
    expect(mockPut).toHaveBeenCalledWith('/api/material/folders/f1', { name: 'b', teamId: 'T2' });
    await useMaterialLibraryStore.getState().moveFolder('f1', { parentId: null, afterId: null });
    expect(mockPut).toHaveBeenCalledWith('/api/material/folders/f1/move', { parentId: null, afterId: null, teamId: 'T2' });
    await useMaterialLibraryStore.getState().moveFolderUp('f1');
    expect(mockPut).toHaveBeenCalledWith('/api/material/folders/f1/move-up', null, { params: { teamId: 'T2' } });
    await useMaterialLibraryStore.getState().deleteFolder('f1');
    expect(mockDelete).toHaveBeenCalledWith('/api/material/folders/f1', { params: { teamId: 'T2' } });
  });

  it('deleteFolder 后 loadFiles 被调用（残留修复）', async () => {
    mockDelete.mockResolvedValue({ data: {} });
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });
    await useMaterialLibraryStore.getState().deleteFolder('f1');
    expect(mockGet).toHaveBeenCalledWith('/api/material/files', expect.anything());
  });

  it('deleteFile/toggleFavorite query 带 teamId', async () => {
    useMaterialLibraryStore.setState({ context: { teamId: 'T2' }, files: [{ id: 'x1' }] as any });
    mockDelete.mockResolvedValue({ data: {} });
    mockPut.mockResolvedValue({ data: { data: { success: true, data: { isFavorite: true } } } });
    await useMaterialLibraryStore.getState().deleteFile('x1');
    expect(mockDelete).toHaveBeenCalledWith('/api/material/files/x1', { params: { teamId: 'T2' } });
    await useMaterialLibraryStore.getState().toggleFavorite('x1');
    expect(mockPut).toHaveBeenCalledWith('/api/material/files/x1/toggle-favorite', null, { params: { teamId: 'T2' } });
  });

  it('batchDelete/batchMove body 带 teamId', async () => {
    useMaterialLibraryStore.setState({ context: { teamId: 'T2' }, batchMode: true, selectedFileIds: new Set(['a']) });
    mockPost.mockResolvedValue({ data: { data: { success: true, count: 1 } } });
    await useMaterialLibraryStore.getState().batchDelete();
    expect(mockPost).toHaveBeenCalledWith('/api/material/files/batch-delete', { ids: ['a'], teamId: 'T2' });
    useMaterialLibraryStore.setState({ batchMode: true, selectedFileIds: new Set(['a']), selectedFolderId: 'f1' });
    await useMaterialLibraryStore.getState().batchMove('f2');
    expect(mockPost).toHaveBeenCalledWith('/api/material/files/batch-move', { ids: ['a'], folderId: 'f2', teamId: 'T2' });
  });

  it('uploadFile 快照：presign/move 用快照 teamId+projectId，confirm 不传 teamId，末尾仅 context 未变才刷新', async () => {
    useMaterialLibraryStore.setState({ context: { teamId: 'A', projectId: 'P' }, selectedFolderId: 'fa' });
    mockPresignUpload.mockImplementation(async () => {
      // 上传在途切换上下文到 B
      useMaterialLibraryStore.setState({ context: { teamId: 'B' }, selectedFolderId: null, files: [{ id: 'b-file' }] as any });
      return { fileId: 'fid', uploadUrl: 'http://127.0.0.1:9000/flowai/k1', key: 'k1', fields: {} };
    });
    mockConfirmUpload.mockResolvedValue({});
    mockPost.mockResolvedValue({ data: {} });
    mockPut.mockResolvedValue({ data: {} });

    await useMaterialLibraryStore.getState().uploadFile(new File(['x'], 'a.png', { type: 'image/png' }));

    expect(mockPresignUpload).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'A', projectId: 'P' }));
    expect(mockPut).toHaveBeenCalledWith('/api/material/files/fid/move', { folderId: 'fa', teamId: 'A' });
    // confirm 不传 teamId（后端按 fileId 自证）
    expect(mockConfirmUpload).toHaveBeenCalledWith(expect.not.objectContaining({ teamId: expect.anything() }));
    // 末尾不刷新旧视图（context 已变）
    const calls = mockGet.mock.calls.filter((c: any[]) => c[0] === '/api/material/files');
    expect(calls.every((c: any[]) => c[1]?.params?.teamId !== 'A')).toBe(true);
  });

  it('loadFolders 替换型乱序：慢响应后到被丢弃', async () => {
    let resolveSlowFolders!: (v: any) => void;
    mockGet.mockImplementation((url: string, cfg?: any) => {
      // 只挂起 folders+A 请求：断言对象是 folders，须保证 resolveSlowFolders 是 loadFolders(A) 的 resolver
      if (url === '/api/material/folders' && cfg?.params?.teamId === 'A') {
        return new Promise((r) => { resolveSlowFolders = r; });
      }
      return Promise.resolve({ data: { data: { success: true, data: [{ id: 'b-folder' }] } } });
    });
    const store = useMaterialLibraryStore.getState();
    void store.enterContext({ teamId: 'A' });
    void store.enterContext({ teamId: 'B' });
    await waitFor(() => expect(useMaterialLibraryStore.getState().folders).toEqual([{ id: 'b-folder' }]));
    resolveSlowFolders({ data: { data: { success: true, data: [{ id: 'a-stale' }] } } });
    // macrotask flush：waitFor 首查是同步的、会跑在慢回包续体之前，必须先排空微任务再断言终态
    await new Promise((r) => setTimeout(r, 0));
    expect(useMaterialLibraryStore.getState().folders).toEqual([{ id: 'b-folder' }]); // A 慢回包被序号守卫丢弃
  });

  it('uploadFile 末尾刷新正向：context 与 folder 未变 → loadFiles 以快照团队刷新', async () => {
    useMaterialLibraryStore.setState({ context: { teamId: 'A', projectId: 'P' }, selectedFolderId: 'fa' });
    mockPresignUpload.mockResolvedValue({ fileId: 'fid', uploadUrl: 'http://127.0.0.1:9000/flowai/k1', key: 'k1', fields: {} });
    mockConfirmUpload.mockResolvedValue({});
    mockPost.mockResolvedValue({ data: {} });
    mockPut.mockResolvedValue({ data: {} });
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });

    await useMaterialLibraryStore.getState().uploadFile(new File(['x'], 'a.png', { type: 'image/png' }));

    const calls = mockGet.mock.calls.filter((c: any[]) => c[0] === '/api/material/files');
    expect(calls.some((c: any[]) => c[1]?.params?.teamId === 'A')).toBe(true);
  });
});
