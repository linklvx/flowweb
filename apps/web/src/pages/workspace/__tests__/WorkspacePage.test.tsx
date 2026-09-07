import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('@/api/folderApi', () => ({
  getFolders: vi.fn(),
  createFolder: vi.fn(),
  renameFolder: vi.fn(),
  deleteFolder: vi.fn(),
}));
vi.mock('@/api/canvasApi', () => ({ createCanvas: vi.fn(), saveCanvas: vi.fn(), getNextUntitledName: vi.fn().mockResolvedValue({ name: '画布1' }) }));
const { getMyTeams: mockGetMyTeams } = vi.hoisted(() => ({ getMyTeams: vi.fn() }));
vi.mock('@/api/teamApi', () => ({
  getMyTeams: mockGetMyTeams,
  teamDisplayName: (t: { isDefault: boolean; name: string }) => (t.isDefault ? '个人项目' : t.name),
}));
vi.mock('@/api/templateApi', () => ({
  getTemplates: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));
vi.mock('react-router', async (orig) => {
  const actual = await orig<typeof import('react-router')>();
  return { ...actual, useNavigate: vi.fn() };
});

import * as folderApi from '@/api/folderApi';
import * as canvasApi from '@/api/canvasApi';
import * as templateApi from '@/api/templateApi';
import { useLocation, useNavigate } from 'react-router';
import { WorkspacePage } from '../WorkspacePage';

const navigate = vi.fn();
const tpl = (id: string, name: string, folderId: string | null = null) => ({
  id, name, description: '', coverUrl: null, isPublic: false, folderId,
  status: 'SAVED', createdAt: '2026-08-18T10:00:00', updatedAt: '2026-08-18T10:00:00', importCount: 0,
});
const folderDto = (id: string, name: string, canvasCount = 0) => ({
  id, name, parentId: null, createdAt: '2026-08-17T10:00:00', updatedAt: '2026-08-18T10:00:00',
  canvasCount, thumbnails: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMyTeams.mockResolvedValue([]);
  vi.mocked(folderApi.getFolders).mockResolvedValue({
    folders: [folderDto('f1', '工作文件夹', 1), folderDto('f2', '项目文件夹', 0)],
  } as never);
  vi.mocked(templateApi.getTemplates).mockResolvedValue({
    templates: [], total: 0, page: 1, limit: 20, totalPages: 0,
  } as never);
  vi.mocked(templateApi.updateTemplate).mockResolvedValue(undefined as never);
  vi.mocked(templateApi.deleteTemplate).mockResolvedValue(undefined as never);
  vi.mocked(useNavigate).mockReturnValue(navigate);
});

function renderPage(initialUrl = '/works') {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <WorkspacePage />
    </MemoryRouter>
  );
}

describe('WorkspacePage', () => {
  it('根目录渲染：文件夹卡片 + 无根级画布 + 新建画布卡首位', async () => {
    renderPage();
    expect(await screen.findByTestId('folder-card-f1')).toBeInTheDocument();
    expect(screen.getByTestId('folder-card-f2')).toBeInTheDocument();
    expect(screen.queryByTestId('canvas-card-c1')).not.toBeInTheDocument();
    const first = document.querySelector('[data-testid="workspace-grid"] > :first-child');
    expect(first).toHaveAttribute('data-testid', 'create-canvas-card');
  });

  it('进入文件夹：按 folderId 请求画布，返回根目录重新请求', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('folder-card-f1'));
    await waitFor(() => expect(templateApi.getTemplates).toHaveBeenLastCalledWith(
      expect.objectContaining({ folderId: 'f1' })));
    fireEvent.click(screen.getByText('根目录'));
    await waitFor(() => expect(templateApi.getTemplates).toHaveBeenLastCalledWith(
      expect.objectContaining({ folderId: 'root' })));
  });

  it('直链进入文件夹视图：按 URL folderId 请求画布（刷新/分享场景）', async () => {
    vi.mocked(templateApi.getTemplates).mockResolvedValue({
      templates: [tpl('c1', '文件夹内画布', 'f1')], total: 1, page: 1, limit: 20, totalPages: 1,
    } as never);
    renderPage('/works?folder=f1');
    await waitFor(() => expect(templateApi.getTemplates).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'f1' })));
    expect(await screen.findByTestId('canvas-card-c1')).toBeInTheDocument();
  });

  it('画布点击直接进画布编辑页', async () => {
    vi.mocked(templateApi.getTemplates).mockResolvedValue({
      templates: [{ ...tpl('c1', '画布'), projectId: 'p1' }], total: 1, page: 1, limit: 20, totalPages: 1,
    } as never);
    renderPage();
    fireEvent.click(await screen.findByTestId('canvas-card-c1'));
    expect(navigate).toHaveBeenCalledWith('/canvas?projectId=p1');
  });

  it('hasMore 时显示加载更多，点击追加下一页', async () => {
    vi.mocked(templateApi.getTemplates)
      .mockResolvedValueOnce({ templates: [tpl('c1', 'a')], total: 25, page: 1, limit: 20, totalPages: 2 } as never)
      .mockResolvedValueOnce({ templates: [tpl('c21', 'b')], total: 25, page: 2, limit: 20, totalPages: 2 } as never);
    renderPage();
    fireEvent.click(await screen.findByTestId('load-more'));
    await waitFor(() => expect(screen.getByTestId('canvas-card-c21')).toBeInTheDocument());
    expect(screen.queryByTestId('load-more')).not.toBeInTheDocument();
  });

  it('新建画布：调 API 后跳转编辑器，无占位卡片', async () => {
    vi.mocked(canvasApi.createCanvas).mockResolvedValue({ templateId: 't9', projectId: 'p9' } as never);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /新建画布/ }));
    fireEvent.change(await screen.findByLabelText('画布名称'), { target: { value: '新作品' } });
    fireEvent.click(screen.getByRole('button', { name: '确 定' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/canvas?projectId=p9'));
  });

  it('删除文件夹调用 API', async () => {
    vi.mocked(folderApi.deleteFolder).mockResolvedValue({ movedCanvasCount: 2 } as never);
    renderPage();
    const card = await screen.findByTestId('folder-card-f1');
    fireEvent.click(card.querySelector('[aria-label="更多操作"]')!);
    fireEvent.click(await screen.findByText('删除'));
    await waitFor(() => expect(folderApi.deleteFolder).toHaveBeenCalledWith('f1', undefined));
  });

  it('移动画布到根目录：updateTemplate folderId null', async () => {
    vi.mocked(templateApi.getTemplates).mockResolvedValue({
      templates: [tpl('c1', '画布', 'f1')], total: 1, page: 1, limit: 20, totalPages: 1,
    } as never);
    renderPage('/works?folder=f1');
    const card = await screen.findByTestId('canvas-card-c1');
    fireEvent.click(card.querySelector('[aria-label="更多操作"]')!);
    fireEvent.click(await screen.findByText('移动到文件夹'));
    fireEvent.click(await screen.findByText('根目录（未分组）'));
    fireEvent.click(screen.getByRole('button', { name: '确 定' }));
    await waitFor(() => expect(templateApi.updateTemplate).toHaveBeenCalledWith('c1', { folderId: null }));
  });

  it('加载失败显示错误空态，重试成功', async () => {
    vi.mocked(folderApi.getFolders).mockRejectedValueOnce(new Error('x'));
    renderPage();
    expect(await screen.findByTestId('empty-state-error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重 试' }));
    expect(await screen.findByTestId('folder-card-f1')).toBeInTheDocument();
  });

  it('list 视图渲染行', async () => {
    renderPage();
    fireEvent.click(await screen.findByLabelText('List view'));
    expect(await screen.findByTestId('workspace-list')).toBeInTheDocument();
  });

  it('搜索防抖过滤（全局，跨文件夹）', async () => {
    vi.mocked(templateApi.getTemplates).mockResolvedValue({
      templates: [tpl('c1', '阿尔法画布')], total: 1, page: 1, limit: 20, totalPages: 1,
    } as never);
    renderPage();
    const input = await screen.findByLabelText('搜索');
    vi.useFakeTimers();
    fireEvent.change(input, { target: { value: '阿尔法' } });
    // 防抖前 c1 存在（因为 searchQuery 还是空，显示根目录所有画布）
    expect(screen.getByTestId('canvas-card-c1')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(300); });
    // 防抖后匹配'阿尔法'，c1 仍存在
    expect(screen.getByTestId('canvas-card-c1')).toBeInTheDocument();
    expect(screen.queryByTestId('folder-card-f2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('create-canvas-card')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('筛选「仅文件夹」隐藏新建画布卡，文件夹仍显示', async () => {
    renderPage();
    // 点击筛选下拉按钮展开菜单
    fireEvent.click(await screen.findByText('显示全部'));
    fireEvent.click(await screen.findByText('仅文件夹'));
    await waitFor(() => expect(screen.queryByTestId('create-canvas-card')).not.toBeInTheDocument());
    expect(screen.getByTestId('folder-card-f1')).toBeInTheDocument();
  });

  it('新建文件夹流程', async () => {
    vi.mocked(folderApi.createFolder).mockResolvedValue({ id: 'f9' } as never);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /新建文件夹/ }));
    fireEvent.change(await screen.findByLabelText('文件夹名称'), { target: { value: '我的新文件夹' } });
    fireEvent.click(screen.getByRole('button', { name: '确 定' }));
    await waitFor(() => expect(folderApi.createFolder).toHaveBeenCalledWith('我的新文件夹', undefined));
  });

  it('无效 folderId 重置根目录', async () => {
    renderPage('/works?folder=nope');
    await waitFor(() => expect(screen.getByTestId('folder-card-f1')).toBeInTheDocument());
    expect(screen.queryByTestId('canvas-card-c1')).not.toBeInTheDocument();
  });

  it('?tab=team 渲染团队页签（owned 前 joined 后平铺），过滤默认团队', async () => {
    mockGetMyTeams.mockResolvedValue([
      { id: 't-default', name: 'A的团队', role: 'OWNER', status: 'ACTIVE', isDefault: true, isOwner: true, createdAt: '2026-08-01', memberCount: 1, projectCount: 0, balance: { credits: 0, subscriptionCredits: 0 }, subscription: null },
      { id: 't-joined', name: '加入的团', role: 'MEMBER', status: 'ACTIVE', isDefault: false, isOwner: false, createdAt: '2026-08-02', memberCount: 5, projectCount: 0, balance: { credits: 0, subscriptionCredits: 0 }, subscription: null },
      { id: 't-owned', name: '我建的团', role: 'OWNER', status: 'ACTIVE', isDefault: false, isOwner: true, createdAt: '2026-08-01', memberCount: 2, projectCount: 0, balance: { credits: 0, subscriptionCredits: 0 }, subscription: null },
    ]);
    renderPage('/works?tab=team');
    await waitFor(() => expect(screen.getByTestId('team-tabs-row')).toBeInTheDocument());
    const tabs = screen.getByTestId('team-tabs-row').querySelectorAll('.ant-tabs-tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].textContent).toContain('我建的团');
    expect(tabs[1].textContent).toContain('加入的团');
    expect(screen.queryByText('我创建的')).not.toBeInTheDocument();
    // 默认团队（teamDisplayName=个人项目）被过滤——scope 到团队 tabs，避免与 Tab 栏「个人项目」按钮撞文本
    expect(screen.getByTestId('team-tabs-row').textContent).not.toContain('个人项目');
  });

  it('?tab=team 无真实团队时空状态引导', async () => {
    mockGetMyTeams.mockResolvedValue([
      { id: 't-default', name: 'A的团队', role: 'OWNER', status: 'ACTIVE', isDefault: true, isOwner: true, createdAt: '2026-08-01', memberCount: 1, projectCount: 0, balance: { credits: 0, subscriptionCredits: 0 }, subscription: null },
    ]);
    renderPage('/works?tab=team');
    expect(await screen.findByText(/还没有团队/)).toBeInTheDocument();
  });

});

describe('WorkspacePage 团队 tab（spec §一.1/§一.2）', () => {
  const team = (id: string, isOwner: boolean) => ({ id, name: id, isOwner, isDefault: false, memberCount: 2, projectCount: 0 });

  // MemoryRouter 不写 window.history，URL replace 断言经 useLocation 探针读取路由真实状态
  function LocationProbe() {
    const { search } = useLocation();
    return <span data-testid="location-probe" data-search={search} />;
  }
  function renderWithProbe(initialUrl: string) {
    return render(
      <MemoryRouter initialEntries={[initialUrl]}>
        <WorkspacePage />
        <LocationProbe />
      </MemoryRouter>
    );
  }
  const probeSearch = () => screen.getByTestId('location-probe').getAttribute('data-search') ?? '';

  it('团队页签：owned 在前 joined 在后、平铺无分组标题、默认选第一个', async () => {
    mockGetMyTeams.mockResolvedValue([team('joined-1', false), team('owned-1', true)]);
    renderWithProbe('/works?tab=team');
    await waitFor(() => expect(screen.getByTestId('team-tabs-row')).toBeInTheDocument());
    const tabs = screen.getByTestId('team-tabs-row').querySelectorAll('.ant-tabs-tab');
    expect(tabs[0].textContent).toContain('owned-1');
    expect(tabs[1].textContent).toContain('joined-1');
    expect(screen.queryByText('我创建的')).not.toBeInTheDocument();
    // 当前位置指示器显示团队名（scope 到 nav，避免与团队 tabs label 撞文本）
    await waitFor(() => expect(screen.getByRole('navigation', { name: '当前位置' }).textContent).toContain('owned-1'));
    await waitFor(() => expect(probeSearch()).toContain('teamId=owned-1')); // replace 补默认
  });

  it('非法 teamId 直链：replace 到第一个真实团队且不带 folder', async () => {
    mockGetMyTeams.mockResolvedValue([team('owned-1', true)]);
    renderWithProbe('/works?tab=team&teamId=bogus&folder=fff');
    await waitFor(() => expect(screen.getByTestId('team-tabs-row')).toBeInTheDocument());
    const search = probeSearch();
    expect(search).not.toContain('folder=');
    expect(search).toContain('teamId=owned-1');
    // 维度组件从不带 folder 请求
    expect(vi.mocked(templateApi.getTemplates)).not.toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'fff' }));
  });

  it('teams 加载失败：渲染失败+重试，不挂载维度组件（不死屏）', async () => {
    mockGetMyTeams.mockRejectedValue(new Error('boom'));
    renderPage('/works?tab=team');
    await waitFor(() => expect(screen.getByTestId('teams-error')).toBeInTheDocument());
    expect(screen.queryByTestId('workspace-grid')).not.toBeInTheDocument();
  });

  it('团队 error 分支：tabs 位于头部行容器内且可切回个人', async () => {
    mockGetMyTeams.mockRejectedValue(new Error('boom'));
    renderPage('/works?tab=team');
    await waitFor(() => expect(screen.getByTestId('teams-error')).toBeInTheDocument());
    const row = screen.getByRole('button', { name: '个人项目' }).closest('div[class*="md:flex-row"]');
    expect(row).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '个人项目' }));
    expect(await screen.findByTestId('create-canvas-card')).toBeInTheDocument();
  });

  it('团队 empty 分支：tabs 位于头部行容器内且可切回个人', async () => {
    // 只含默认团队 → realTeams 过滤后为 0（与既有 team-empty-state 用例同 mock 方式）
    mockGetMyTeams.mockResolvedValue([{ id: 'd', name: '默认', isOwner: true, isDefault: true, memberCount: 1, projectCount: 0 }]);
    renderPage('/works?tab=team');
    await waitFor(() => expect(screen.getByTestId('team-empty-state')).toBeInTheDocument());
    const row = screen.getByRole('button', { name: '个人项目' }).closest('div[class*="md:flex-row"]');
    expect(row).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '个人项目' }));
    expect(await screen.findByTestId('create-canvas-card')).toBeInTheDocument();
  });

  it('无真实团队：team-empty-state', async () => {
    mockGetMyTeams.mockResolvedValue([{ id: 'd', name: '默认', isOwner: true, isDefault: true, memberCount: 1, projectCount: 0 }]);
    renderPage('/works?tab=team');
    await waitFor(() => expect(screen.getByTestId('team-empty-state')).toBeInTheDocument());
  });

  it('teams 未就绪：不挂载维度组件（不发画布请求）', () => {
    mockGetMyTeams.mockReturnValue(new Promise(() => {}));
    renderPage('/works?tab=team&teamId=t1');
    expect(screen.queryByTestId('workspace-grid')).not.toBeInTheDocument();
    expect(vi.mocked(templateApi.getTemplates)).not.toHaveBeenCalled();
  });

  it('切团队：维度组件 key 重挂载，搜索/筛选等本地 state 归零', async () => {
    mockGetMyTeams.mockResolvedValue([team('t1', true), team('t2', true)]);
    renderPage('/works?tab=team');
    await waitFor(() => expect(screen.getByTestId('team-tabs-row')).toBeInTheDocument());
    // 输入搜索词后切团队 → 新维度实例搜索框为空
    const searchInput = screen.getByLabelText('搜索');
    fireEvent.change(searchInput, { target: { value: 'abc' } });
    const tab2 = screen.getByTestId('team-tabs-row').querySelectorAll('.ant-tabs-tab')[1];
    fireEvent.click(tab2!);
    await waitFor(() => {
      const fresh = screen.getByLabelText('搜索') as HTMLInputElement;
      expect(fresh.value).toBe('');
    });
    // 新维度实例以 t2 打根目录（spec：切团队 =1 请求）
    await waitFor(() => expect(templateApi.getTemplates).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 't2', folderId: 'root' })));
  });
});
