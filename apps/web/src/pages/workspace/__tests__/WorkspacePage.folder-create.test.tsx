import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('@/api/folderApi', () => ({
  getFolders: vi.fn(),
  createFolder: vi.fn(),
  renameFolder: vi.fn(),
  deleteFolder: vi.fn(),
}));
vi.mock('@/api/canvasApi', () => ({ createCanvas: vi.fn(), getNextUntitledName: vi.fn().mockResolvedValue({ name: '画布1' }) }));
// WorkspacePage 无条件挂 useTeams：给 getMyTeams 默认成功值，避免团队请求走真实网络
const { getMyTeams: mockGetMyTeams } = vi.hoisted(() => ({ getMyTeams: vi.fn() }));
vi.mock('@/api/teamApi', () => ({
  getMyTeams: mockGetMyTeams,
  teamDisplayName: (t: { isDefault: boolean; name: string }) => (t.isDefault ? '个人项目' : t.name),
}));
// user 必须稳定引用（真实 AuthProvider 的 user 是 state）：每渲染新建对象会让
// useTeams 挂载 fetchTeams 的 [user] 依赖每帧重跑 → 强制重拉无限循环卡死测试
const { stableUser } = vi.hoisted(() => ({ stableUser: { id: 'u1', name: '我' } }));
vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ user: stableUser, loading: false }),
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
import { useTeamStore, _internal } from '@/stores/teamStore';
import { useNavigate } from 'react-router';
import { WorkspacePage } from '../WorkspacePage';

// 独立文件原因：antd Select 在同一 jsdom 实例中二次挂载会触发 cssinjs/nwsapi
// 的坏选择符解析崩溃（级联污染后续测试）。本文件与 WorkspacePage.test.tsx
// 各自只打开一次含 Select 的 Modal。
const navigate = vi.fn();
const folderDto = (id: string, name: string, canvasCount = 0) => ({
  id, name, parentId: null, createdAt: '2026-08-17T10:00:00', updatedAt: '2026-08-18T10:00:00',
  canvasCount, thumbnails: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  _internal.reset();
  useTeamStore.setState({ teams: [], status: 'loading', currentTeamId: null });
  mockGetMyTeams.mockResolvedValue([]);
  vi.mocked(folderApi.getFolders).mockResolvedValue({
    folders: [folderDto('f1', '工作文件夹', 1), folderDto('f2', '项目文件夹', 0)],
  } as never);
  vi.mocked(templateApi.getTemplates).mockResolvedValue({
    templates: [], total: 0, page: 1, limit: 20, totalPages: 0,
  } as never);
  vi.mocked(useNavigate).mockReturnValue(navigate);
});

describe('WorkspacePage 文件夹内新建画布', () => {
  it('文件夹内通过新建画布卡创建：画布存入当前文件夹', async () => {
    vi.mocked(canvasApi.createCanvas).mockResolvedValue({ templateId: 't9', projectId: 'p9' } as never);
    render(
      <MemoryRouter initialEntries={['/works?folder=f1']}>
        <WorkspacePage />
      </MemoryRouter>
    );
    // 直链挂载单请求：WorkspaceDimension 按 initialFolderId 直打 f1（Task 5 起不再双发）
    await waitFor(() => expect(templateApi.getTemplates).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: /新建画布/ }));
    fireEvent.change(await screen.findByLabelText('画布名称'), { target: { value: '文件夹内新作' } });
    fireEvent.click(screen.getByRole('button', { name: '确 定' }));
    await waitFor(() => expect(canvasApi.createCanvas).toHaveBeenCalledWith('文件夹内新作', 'f1', undefined));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/canvas?projectId=p9'));
  });
});
