import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/api/folderApi', () => ({
  getFolders: vi.fn(),
  createFolder: vi.fn(),
  renameFolder: vi.fn(),
  deleteFolder: vi.fn(),
}));
vi.mock('@/api/canvasApi', () => ({
  createCanvas: vi.fn(),
}));
vi.mock('@/api/templateApi', () => ({
  getTemplates: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));

import { useWorkspaceData } from '../hooks/useWorkspaceData';
import { getFolders, createFolder as apiCreateFolder, renameFolder as apiRenameFolder, deleteFolder as apiDeleteFolder } from '@/api/folderApi';
import { createCanvas as apiCreateCanvas } from '@/api/canvasApi';
import { getTemplates, updateTemplate, deleteTemplate } from '@/api/templateApi';

const tpl = (id: string, name: string, updatedAt: string, folderId: string | null = null) => ({
  id, name, description: '', coverUrl: null, isPublic: false, folderId,
  status: 'SAVED', createdAt: updatedAt, updatedAt, importCount: 0,
});
const folderDto = (id: string, name: string, count = 0) => ({
  id, name, parentId: null,
  createdAt: '2026-08-17T10:00:00', updatedAt: '2026-08-18T10:00:00',
  canvasCount: count, thumbnails: [{ id: 't1', coverUrl: null }],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getFolders).mockResolvedValue({
    folders: [folderDto('f1', '工作', 2), folderDto('f2', '项目', 0)],
  } as never);
  vi.mocked(getTemplates).mockResolvedValue({
    templates: [], total: 0, page: 1, limit: 20, totalPages: 0,
  } as never);
  vi.mocked(updateTemplate).mockResolvedValue(undefined as never);
  vi.mocked(deleteTemplate).mockResolvedValue(undefined as never);
});

describe('useWorkspaceData', () => {
  it('初始加载：根目录画布 + 文件夹 ViewModel（缩略图渐变）', async () => {
    vi.mocked(getTemplates).mockResolvedValue({
      templates: [tpl('c1', '画布 1', '2026-08-18T10:00:00', null)],
      total: 1, page: 1, limit: 20, totalPages: 1,
    } as never);
    vi.mocked(getFolders).mockResolvedValue({
      folders: [folderDto('f1', '工作', 1)],
    } as never);
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(getTemplates).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'root', page: 1 }));
    expect(result.current.canvases.map((c) => c.id)).toEqual(['c1']);
    expect(result.current.folders[0].canvasCount).toBe(1);
    expect(typeof result.current.folders[0].thumbnails[0]).toBe('string');
  });

  it('加载失败 → status=error，可重试', async () => {
    vi.mocked(getFolders).mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('error'));
    await act(async () => { await result.current.reload(); });
    expect(result.current.status).toBe('success');
  });

  it('loadFolder 切换文件夹并按 folderId 请求画布', async () => {
    vi.mocked(getTemplates).mockResolvedValue({
      templates: [tpl('c2', '画布 2', '2026-08-18T09:00:00', 'f1')],
      total: 1, page: 1, limit: 20, totalPages: 1,
    } as never);
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    await act(async () => { await result.current.loadFolder('f1'); });
    expect(getTemplates).toHaveBeenLastCalledWith(expect.objectContaining({ folderId: 'f1', page: 1 }));
    expect(result.current.canvases.map((c) => c.id)).toEqual(['c2']);
  });

  it('loadMore 追加下一页，无更多时 hasMore=false', async () => {
    vi.mocked(getTemplates)
      .mockResolvedValueOnce({ templates: [tpl('c1', 'a', '2026-08-18T10:00:00')], total: 25, page: 1, limit: 20, totalPages: 2 } as never)
      .mockResolvedValueOnce({ templates: [tpl('c21', 'b', '2026-08-18T09:00:00')], total: 25, page: 2, limit: 20, totalPages: 2 } as never);
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.hasMore).toBe(true);
    await act(async () => { await result.current.loadMore(); });
    expect(getTemplates).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(result.current.canvases.map((c) => c.id)).toEqual(['c1', 'c21']);
    expect(result.current.hasMore).toBe(false);
  });

  it('createCanvas 真实入列（无占位）并返回 projectId', async () => {
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    vi.mocked(apiCreateCanvas).mockResolvedValue({ templateId: 't9', projectId: 'p9' } as never);
    let projectId: string | undefined;
    await act(async () => { projectId = await result.current.createCanvas('新作品', 'f1'); });
    expect(projectId).toBe('p9');
    const created = result.current.canvases.find((c) => c.id === 't9');
    expect(created).toBeDefined();
    expect(created?.folderId).toBe('f1');
  });

  it('createFolder 直连 API 并刷新列表', async () => {
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    vi.mocked(apiCreateFolder).mockResolvedValue(folderDto('f9', '新建') as never);
    await act(async () => { await result.current.createFolder('新建'); });
    expect(apiCreateFolder).toHaveBeenCalledWith('新建', undefined);
  });

  it('renameFolder 乐观更新失败回滚', async () => {
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    vi.mocked(apiRenameFolder).mockRejectedValueOnce(new Error('x'));
    await act(async () => { await result.current.renameFolder('f1', '改名'); });
    expect(result.current.folders.find((f) => f.id === 'f1')?.name).toBe('工作');
  });

  it('deleteFolder 成功返回 movedCanvasCount 并刷新', async () => {
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    vi.mocked(apiDeleteFolder).mockResolvedValue({ movedCanvasCount: 3 } as never);
    let count = -1;
    await act(async () => { count = await result.current.deleteFolder('f2'); });
    expect(count).toBe(3);
    expect(apiDeleteFolder).toHaveBeenCalledWith('f2', undefined);
    // 删除非当前文件夹（当前为根）→ 仍加载根目录
    expect(getTemplates).toHaveBeenLastCalledWith(expect.objectContaining({ folderId: 'root' }));
  });

  it('deleteFolder 删除当前浏览的文件夹时回根目录', async () => {
    vi.mocked(getTemplates).mockResolvedValue({
      templates: [tpl('c1', '画布 1', '2026-08-18T10:00:00', 'f1')],
      total: 1, page: 1, limit: 20, totalPages: 1,
    } as never);
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    await act(async () => { await result.current.loadFolder('f1'); });
    vi.mocked(apiDeleteFolder).mockResolvedValue({ movedCanvasCount: 1 } as never);
    await act(async () => { await result.current.deleteFolder('f1'); });
    expect(getTemplates).toHaveBeenLastCalledWith(expect.objectContaining({ folderId: 'root', page: 1 }));
  });

  it('moveCanvas 乐观更新 folderId，调 updateTemplate', async () => {
    vi.mocked(getTemplates).mockResolvedValue({
      templates: [tpl('c1', '画布 1', '2026-08-18T10:00:00', 'f1')],
      total: 1, page: 1, limit: 20, totalPages: 1,
    } as never);
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    await act(async () => { await result.current.moveCanvas('c1', null); });
    expect(updateTemplate).toHaveBeenCalledWith('c1', { folderId: null });
    expect(result.current.canvases.find((c) => c.id === 'c1')?.folderId).toBeNull();
  });

  it('renameCanvas / deleteCanvas 走 API，失败回滚', async () => {
    vi.mocked(getTemplates).mockResolvedValue({
      templates: [tpl('c1', '画布 1', '2026-08-18T10:00:00')],
      total: 1, page: 1, limit: 20, totalPages: 1,
    } as never);
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    vi.mocked(updateTemplate).mockRejectedValueOnce(new Error('x'));
    await act(async () => {
      try { await result.current.renameCanvas('c1', '新名'); } catch {}
    });
    expect(result.current.canvases.find((c) => c.id === 'c1')?.name).toBe('画布 1');
    vi.mocked(deleteTemplate).mockRejectedValueOnce(new Error('x'));
    await act(async () => {
      try { await result.current.deleteCanvas('c1'); } catch {}
    });
    expect(result.current.canvases.find((c) => c.id === 'c1')).toBeDefined();
  });

  it('传 teamId 时 API 调用带团队维度', async () => {
    vi.mocked(getFolders).mockResolvedValue({ folders: [] } as never);
    vi.mocked(getTemplates).mockResolvedValue({ templates: [], total: 0, page: 1, limit: 20, totalPages: 1 } as never);
    const { result } = renderHook(() => useWorkspaceData('t-team'));
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(getFolders).toHaveBeenCalledWith('t-team');
    expect(getTemplates).toHaveBeenLastCalledWith(
      expect.objectContaining({ teamId: 't-team' }),
    );
  });

  it('传 teamId 时 createFolder/createCanvas 透传 teamId', async () => {
    vi.mocked(getFolders).mockResolvedValue({ folders: [] } as never);
    vi.mocked(getTemplates).mockResolvedValue({ templates: [], total: 0, page: 1, limit: 20, totalPages: 1 } as never);
    vi.mocked(apiCreateFolder).mockResolvedValue({ id: 'f1' } as never);
    vi.mocked(apiCreateCanvas).mockResolvedValue({ templateId: 'tp', projectId: 'p1', name: 'n' } as never);
    const { result } = renderHook(() => useWorkspaceData('t-team'));
    await waitFor(() => expect(result.current.status).toBe('success'));
    await act(async () => { await result.current.createFolder('x'); });
    await act(async () => { await result.current.createCanvas('y', null); });
    expect(apiCreateFolder).toHaveBeenCalledWith('x', 't-team');
    expect(apiCreateCanvas).toHaveBeenCalledWith('y', null, 't-team');
  });
});

describe('useWorkspaceData 维度化改造（spec §一.3/§一.6/竞态）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFolders).mockResolvedValue({ folders: [] } as never);
    vi.mocked(getTemplates).mockResolvedValue({ templates: [], totalPages: 1 } as never);
  });

  it('mount 直打 initialFolderId（首帧单请求，URL 原始值）', async () => {
    renderHook(() => useWorkspaceData(undefined, 'yyy'));
    await waitFor(() => expect(vi.mocked(getTemplates)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(getTemplates)).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'yyy' }));
  });

  it('无 initialFolderId → mount 打根目录 1 次', async () => {
    renderHook(() => useWorkspaceData());
    await waitFor(() => expect(vi.mocked(getTemplates)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(getTemplates)).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'root' }));
  });

  it('renameFolder/deleteFolder 传维度 teamId（断链修复）', async () => {
    const { result } = renderHook(() => useWorkspaceData('t1'));
    await waitFor(() => expect(result.current.status).toBe('success'));
    await result.current.renameFolder('f1', '新名');
    expect(vi.mocked(apiRenameFolder)).toHaveBeenCalledWith('f1', '新名', 't1');
    await result.current.deleteFolder('f1');
    expect(vi.mocked(apiDeleteFolder)).toHaveBeenCalledWith('f1', 't1');
  });

  it('loadFolder 替换型乱序：慢响应后到被丢弃', async () => {
    let resolveSlow!: (v: any) => void;
    vi.mocked(getTemplates).mockImplementation((q: any) =>
      (q.folderId ?? 'root') === 'A'
        ? new Promise((r) => { resolveSlow = r; })
        : Promise.resolve({ templates: [{ id: 'b' }], totalPages: 1 } as never),
    );
    const { result } = renderHook(() => useWorkspaceData());
    await act(async () => { await Promise.resolve(); });
    await act(async () => { void result.current.loadFolder('A'); });
    await act(async () => { void result.current.loadFolder('B'); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.canvases.map((c) => c.id)).toEqual(['b']); // B 已生效
    await act(async () => { resolveSlow({ templates: [{ id: 'a-stale' }], totalPages: 1 }); await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.canvases.map((c) => c.id)).toEqual(['b']); // A 慢响应被丢弃
  });

  it('loadMore 追加型：sessionId 相等才 append', async () => {
    vi.mocked(getTemplates)
      .mockResolvedValueOnce({ templates: [{ id: 'c1' }], totalPages: 2 } as never)
      .mockResolvedValueOnce({ templates: [{ id: 'c2' }], totalPages: 2 } as never);
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.canvases.map((c) => c.id)).toEqual(['c1', 'c2']);
  });
});
