import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { WorkspaceDimension } from '../components/WorkspaceDimension';

const mockGetTemplates = vi.fn();
vi.mock('@/api/templateApi', () => ({
  getTemplates: (...a: any[]) => mockGetTemplates(...a),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));
const mockGetFolders = vi.fn();
vi.mock('@/api/folderApi', () => ({
  getFolders: (...a: any[]) => mockGetFolders(...a),
  createFolder: vi.fn(),
  renameFolder: vi.fn(),
  deleteFolder: vi.fn(),
}));
const mockGetNext = vi.fn();
vi.mock('@/api/canvasApi', () => ({
  createCanvas: vi.fn(),
  getNextUntitledName: (...a: any[]) => mockGetNext(...a),
}));

const renderDim = (teamId: string | undefined, initialEntries = ['/works']) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <WorkspaceDimension teamId={teamId} />
    </MemoryRouter>,
  );

const folderY = { id: 'yyy', name: 'Y', parentId: null, createdAt: '', updatedAt: '', canvasCount: 0, thumbnails: [] };

describe('WorkspaceDimension 共享组件', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetFolders.mockResolvedValue({ folders: [] });
    mockGetTemplates.mockResolvedValue({ templates: [], totalPages: 1 });
    mockGetNext.mockResolvedValue({ name: '画布 1' });
  });

  it('个人维度：mount 单请求（folderId=root）+ 渲染新建画布卡', async () => {
    renderDim(undefined);
    await waitFor(() => expect(mockGetTemplates).toHaveBeenCalledTimes(1));
    expect(mockGetTemplates).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'root' }));
    expect(await screen.findByTestId('create-canvas-card')).toBeInTheDocument();
    // 面包屑默认维度名=个人项目（scope 到 nav，避免与 Tab 栏「个人项目」撞文本）
    expect(screen.getByRole('navigation', { name: '当前位置' }).textContent).toContain('个人项目');
  });

  it('团队维度：dimensionLabel 透传到当前位置指示器', async () => {
    render(
      <MemoryRouter initialEntries={['/works']}>
        <WorkspaceDimension teamId="t1" dimensionLabel="我的团队" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(mockGetTemplates).toHaveBeenCalled());
    expect(screen.getByRole('navigation', { name: '当前位置' }).textContent).toContain('我的团队');
  });

  it('list 视图：bg-overlay-1 rounded-xl 外壳 + 表头六列 + 新建画布行', async () => {
    renderDim(undefined);
    fireEvent.click(await screen.findByRole('button', { name: 'List view' }));
    const shell = await screen.findByTestId('workspace-list-shell');
    expect(shell.className).toContain('bg-overlay-1');
    expect(shell.className).toContain('rounded-xl');
    for (const header of ['预览', '名称', '类型', '内容', '创建时间', '最近更新']) {
      expect(screen.getByText(header, { exact: true })).toBeInTheDocument();
    }
    expect(screen.getByTestId('create-canvas-card')).toBeInTheDocument();
  });

  it('list 视图：hasMore 时加载更多在外壳内', async () => {
    mockGetTemplates.mockResolvedValue({
      templates: [{ id: 't1', name: '画布A', createdAt: '2026-09-01T10:00:00', updatedAt: '2026-09-01T10:00:00' }],
      totalPages: 2,
    });
    renderDim(undefined);
    fireEvent.click(await screen.findByRole('button', { name: 'List view' }));
    const loadMore = await screen.findByTestId('load-more');
    expect(loadMore).toBeInTheDocument();
    expect(screen.getByTestId('workspace-list-shell')).toContainElement(loadMore);
  });

  it('团队维度：请求带 teamId', async () => {
    renderDim('t1');
    await waitFor(() => expect(mockGetTemplates).toHaveBeenCalledWith(expect.objectContaining({ teamId: 't1' })));
  });

  it('有效 folder 直链：mount 直打 yyy 且全程仅 1 次请求', async () => {
    // folders 树必须含 yyy——空树下 yyy 会被判无效走 fallback，用例前提就变了
    mockGetFolders.mockResolvedValue({ folders: [folderY] });
    renderDim(undefined, ['/works?folder=yyy']);
    await waitFor(() => expect(mockGetTemplates).toHaveBeenCalledTimes(1));
    expect(mockGetTemplates).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'yyy' }));
    // 静置后再复核——nav valid 恢复造成的 null→yyy 跳变若被误判为后续导航，第二次请求会在此窗口出现
    await new Promise((r) => setTimeout(r, 100));
    expect(mockGetTemplates).toHaveBeenCalledTimes(1);
  });

  it('无效 folder 直链：=2 次请求且终态根目录（spec 请求次数边界表）', async () => {
    // folders 树不含 yyy（beforeEach 默认空树）→ loaded 后 fallback replace 删 folder → URL raw 变 null 与基准不等 → 打根目录
    renderDim(undefined, ['/works?folder=yyy']);
    await waitFor(() => expect(mockGetTemplates).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(mockGetTemplates.mock.calls[0][0]).toEqual(expect.objectContaining({ folderId: 'yyy' }));
    const lastCall = mockGetTemplates.mock.calls[mockGetTemplates.mock.calls.length - 1][0];
    expect(lastCall.folderId).toBe('root');
  });
});
