import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const api = vi.hoisted(() => ({
  getFolders: vi.fn(),
  createFolder: vi.fn(),
  renameFolder: vi.fn(),
  getTemplates: vi.fn(),
  canvasCreate: vi.fn(),
  getNextUntitledName: vi.fn(),
}));
const routerApi = vi.hoisted(() => ({ useNavigate: vi.fn() }));
vi.mock('@/api/folderApi', () => api);
vi.mock('@/api/templateApi', () => ({ getTemplates: api.getTemplates, updateTemplate: vi.fn(), deleteTemplate: vi.fn() }));
vi.mock('@/api/canvasApi', () => ({ createCanvas: api.canvasCreate, getNextUntitledName: api.getNextUntitledName }));
vi.mock('react-router', async (orig) => {
  const actual = await orig<typeof import('react-router')>();
  return { ...actual, useNavigate: routerApi.useNavigate };
});
// teamApi 不整模块 mock：teamDisplayName 是纯函数，走真实模块
// 注意：api 缺 deleteFolder（useWorkspaceData.ts:4 有该导入绑定）——当前用例不触发删除、运行无碍

import { TeamSection } from '../components/TeamSection';

const navigate = vi.fn();

const team = {
  id: 't-1', name: '梦幻团队', role: 'OWNER' as const, status: 'ACTIVE',
  isDefault: false, isOwner: true, createdAt: '2026-08-01', memberCount: 3,
  balance: { credits: 100, subscriptionCredits: 0 }, subscription: null,
};

function renderSection(overrides: Partial<typeof team> = {}) {
  return render(<MemoryRouter><TeamSection team={{ ...team, ...overrides }} /></MemoryRouter>);
}

function folderDto(id: string, name: string, parentId: string | null) {
  return { id, name, parentId, createdAt: '2026-08-01', updatedAt: '2026-08-01', canvasCount: 0, thumbnails: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getFolders.mockResolvedValue({ folders: [] });
  api.getTemplates.mockResolvedValue({ templates: [], totalPages: 1 });
  routerApi.useNavigate.mockReturnValue(navigate);
});

describe('TeamSection', () => {
  it('按 teamId 拉取文件夹与画布列表', async () => {
    renderSection();
    await waitFor(() => expect(api.getFolders).toHaveBeenCalledWith('t-1'));
    expect(api.getTemplates).toHaveBeenLastCalledWith(expect.objectContaining({ teamId: 't-1' }));
  });

  it('渲染团队名与成员数', async () => {
    renderSection();
    expect(await screen.findByText('梦幻团队')).toBeInTheDocument();
    expect(screen.getByText(/3 名成员/)).toBeInTheDocument();
  });

  it('新建画布归属该团队，编号预填走团队维度', async () => {
    api.canvasCreate.mockResolvedValue({ templateId: 'tp', projectId: 'p1', name: 'n' });
    api.getNextUntitledName.mockResolvedValue({ name: '画布7' });
    renderSection();
    fireEvent.click(await screen.findByTestId('team-create-canvas-t-1'));
    await waitFor(() => expect(api.getNextUntitledName).toHaveBeenCalledWith('t-1'));
    expect(await screen.findByDisplayValue('画布7')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确 定' }));
    await waitFor(() => expect(api.canvasCreate).toHaveBeenCalledWith('画布7', null, 't-1'));
  });

  it('新建文件夹归属该团队', async () => {
    renderSection();
    fireEvent.click(await screen.findByTestId('team-create-folder-t-1'));
    fireEvent.change(await screen.findByLabelText('文件夹名称'), { target: { value: '团队文件夹' } });
    fireEvent.click(screen.getByRole('button', { name: '确 定' }));
    await waitFor(() => expect(api.createFolder).toHaveBeenCalledWith('团队文件夹', 't-1'));
  });

  it('文件夹重命名：onRequestRename 收 folder 对象，Modal 预填旧名走 renameFolder', async () => {
    api.getFolders.mockResolvedValue({ folders: [folderDto('f1', '旧名', null)] });
    renderSection();
    fireEvent.click((await screen.findByTestId('folder-card-f1')).querySelector('button[aria-label="重命名文件夹"]')!);
    const input = await screen.findByLabelText('文件夹名称');
    expect(input).toHaveValue('旧名');
    fireEvent.change(input, { target: { value: '新名' } });
    fireEvent.click(screen.getByRole('button', { name: '确 定' }));
    await waitFor(() => expect(api.renameFolder).toHaveBeenCalledWith('f1', '新名'));
  });

  it('文件夹列表按当前层级过滤（root 只显示顶级，进入后只显示子级）', async () => {
    api.getFolders.mockResolvedValue({ folders: [
      folderDto('f-root', '顶级', null),
      folderDto('f-child', '子级', 'f-root'),
    ] });
    api.getTemplates.mockResolvedValue({ templates: [], totalPages: 1 });
    renderSection();
    expect(await screen.findByTestId('folder-card-f-root')).toBeInTheDocument();
    expect(screen.queryByTestId('folder-card-f-child')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('folder-card-f-root'));
    await waitFor(() => expect(screen.getByTestId('folder-card-f-child')).toBeInTheDocument());
    expect(screen.queryByTestId('folder-card-f-root')).not.toBeInTheDocument();
  });

  it('画布卡片点击跳转 /canvas?projectId=', async () => {
    api.getTemplates.mockResolvedValue({ templates: [{ id: 'tp1', projectId: 'p1', name: 'A', isPublic: false, folderId: null, coverUrl: null, createdAt: '2026-08-01', updatedAt: '2026-08-01' }], totalPages: 1 });
    renderSection();
    fireEvent.click(await screen.findByTestId('canvas-card-tp1'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/canvas?projectId=p1'));
  });
});
