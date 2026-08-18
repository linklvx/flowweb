import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWorkspaceData } from '../hooks/useWorkspaceData';

vi.mock('@/api/templateApi', () => ({
  getTemplates: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));
vi.mock('@/api/projectApi', () => ({
  createProject: vi.fn(),
}));
// message 是 antd 组件，直接用真实实现

const { getTemplates } = await import('@/api/templateApi');
const { createProject } = await import('@/api/projectApi');
const { updateTemplate, deleteTemplate } = await import('@/api/templateApi');

const tpl = (id: string, name: string, updatedAt: string) => ({
  id, name, description: '', coverUrl: null, isPublic: false,
  createdAt: updatedAt, updatedAt, importCount: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTemplates).mockResolvedValue({
    templates: [tpl('c1', '画布 1', '2026-08-18T10:00:00'), tpl('c2', '画布 2', '2026-08-18T09:00:00')],
  });
  vi.mocked(updateTemplate).mockResolvedValue(undefined as never);
  vi.mocked(deleteTemplate).mockResolvedValue(undefined as never);
});

describe('useWorkspaceData', () => {
  it('加载画布并按 fixtures 分配初始归属（c1 → folder-demo-1）', async () => {
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    const c1 = result.current.canvases.find((c) => c.id === 'c1');
    expect(c1?.folderId).toBe('folder-demo-1');
    expect(result.current.folders[0].canvasCount).toBeGreaterThanOrEqual(1);
  });

  it('加载失败 → status=error，可重试', async () => {
    vi.mocked(getTemplates).mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('error'));
    await act(async () => { await result.current.reload(); });
    expect(result.current.status).toBe('success');
  });

  it('createFolder / renameFolder 本地生效', async () => {
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    act(() => result.current.createFolder('新文件夹'));
    expect(result.current.folders.some((f) => f.name === '新文件夹')).toBe(true);
    const id = result.current.folders.find((f) => f.name === '新文件夹')!.id;
    act(() => result.current.renameFolder(id, '改名'));
    expect(result.current.folders.find((f) => f.id === id)?.name).toBe('改名');
  });

  it('deleteFolder 非空时抛「请先移出画布」', async () => {
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(() => result.current.deleteFolder('folder-demo-1')).toThrow('请先移出画布');
  });

  it('moveCanvas 更新归属并刷新源/目标文件夹 updatedAt', async () => {
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T12:00:00'));
    act(() => result.current.createFolder('目标'));
    const targetId = result.current.folders.find((f) => f.name === '目标')!.id;
    act(() => result.current.moveCanvas('c2', targetId));
    const moved = result.current.canvases.find((c) => c.id === 'c2');
    expect(moved?.folderId).toBe(targetId);
    expect(result.current.folders.find((f) => f.id === targetId)?.updatedAt).toBe(new Date().toISOString());
    vi.useRealTimers();
  });

  it('renameCanvas 乐观更新，API 失败回滚', async () => {
    vi.mocked(updateTemplate).mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    await act(async () => { await result.current.renameCanvas('c1', '新名'); });
    expect(result.current.canvases.find((c) => c.id === 'c1')?.name).toBe('画布 1');
  });

  it('deleteCanvas 乐观删除，API 失败恢复', async () => {
    vi.mocked(deleteTemplate).mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    await act(async () => { await result.current.deleteCanvas('c1'); });
    expect(result.current.canvases.find((c) => c.id === 'c1')).toBeDefined();
  });

  it('createCanvas 调 createProject 并插入占位', async () => {
    vi.mocked(createProject).mockResolvedValue({ id: 'p1', name: '新画布' } as never);
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    let projectId = '';
    await act(async () => { projectId = await result.current.createCanvas('新画布', 'folder-demo-1'); });
    expect(projectId).toBe('p1');
    const ph = result.current.canvases.find((c) => c.isPlaceholder);
    expect(ph?.id).toBe('placeholder-p1');
    expect(ph?.folderId).toBe('folder-demo-1');
  });

  it('deletePlaceholder 仅移除本地占位，不调 API', async () => {
    vi.mocked(createProject).mockResolvedValue({ id: 'p1', name: 'x' } as never);
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    await act(async () => { await result.current.createCanvas('x', null); });
    act(() => result.current.deletePlaceholder('placeholder-p1'));
    expect(result.current.canvases.find((c) => c.id === 'placeholder-p1')).toBeUndefined();
    expect(deleteTemplate).not.toHaveBeenCalled();
  });
});
