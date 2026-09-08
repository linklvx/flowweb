import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import MaterialsPage from './MaterialsPage';
import { useTeamStore, _internal } from '@/stores/teamStore';

const mockGetMyTeams = vi.fn();
vi.mock('@/api/teamApi', () => ({
  getMyTeams: (...a: any[]) => mockGetMyTeams(...a),
  teamDisplayName: (t: any) => t.name,
}));
vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', name: '我' }, loading: false }),
}));
vi.mock('@/components/MaterialLibrary/MaterialLibraryBrowser', () => ({
  MaterialLibraryBrowser: (p: any) => <div data-testid="browser">{p.title}</div>,
}));
const mockGet = vi.fn();
vi.mock('axios', () => ({
  default: { get: (...a: any[]) => mockGet(...a), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const team = (id: string, isOwner: boolean) => ({ id, name: id, isOwner, isDefault: false, memberCount: 1, projectCount: 0 });
const renderPage = (url = '/materials') =>
  render(<MemoryRouter initialEntries={[url]}><MaterialsPage /></MemoryRouter>);

// MemoryRouter 不写 window.history，URL replace 断言经 useLocation 探针读取路由真实状态
function LocationProbe() {
  const { search } = useLocation();
  return <span data-testid="location-probe" data-search={search} />;
}
function renderWithProbe(initialUrl: string) {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <MaterialsPage />
      <LocationProbe />
    </MemoryRouter>
  );
}
const probeSearch = () => screen.getByTestId('location-probe').getAttribute('data-search') ?? '';

describe('MaterialsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _internal.reset();
    useTeamStore.setState({ teams: [], status: 'loading', currentTeamId: null });
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });
  });

  it('个人素材 tab（默认）：渲染 Browser，无团队页签', async () => {
    mockGetMyTeams.mockResolvedValue([team('t1', true)]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId('browser')).toBeInTheDocument());
    expect(screen.queryByTestId('team-tabs-row')).not.toBeInTheDocument();
  });

  it('团队 tab：渲染团队页签 + Browser（key 重挂载）；非法 teamId replace 回落', async () => {
    mockGetMyTeams.mockResolvedValue([team('t1', true)]);
    renderWithProbe('/materials?tab=team&teamId=bogus');
    await waitFor(() => expect(screen.getByTestId('team-tabs-row')).toBeInTheDocument());
    expect(await screen.findByTestId('browser')).toBeInTheDocument();
    // 非法 teamId 被 replace 为第一个真实团队
    await waitFor(() => expect(probeSearch()).toContain('teamId=t1'));
    expect(probeSearch()).not.toContain('teamId=bogus');
  });

  it('无真实团队：空态引导', async () => {
    mockGetMyTeams.mockResolvedValue([{ id: 'd', name: '默认', isOwner: true, isDefault: true, memberCount: 1, projectCount: 0 }]);
    renderPage('/materials?tab=team');
    await waitFor(() => expect(screen.getByTestId('materials-empty-state')).toBeInTheDocument());
  });

  it('enterContext 时序：挂载/切团队各恰好一组 folders+files 请求（spec 切团队=1 次）', async () => {
    mockGetMyTeams.mockResolvedValue([team('t1', true), team('t2', true)]);
    renderWithProbe('/materials?tab=team&teamId=t1');
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/material/folders', { params: { teamId: 't1' } }));
    mockGet.mockClear();
    (await screen.findAllByRole('tab')).find((el) => el.textContent === 't2')!.click();
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/material/folders', { params: { teamId: 't2' } }));
    expect(mockGet).toHaveBeenCalledTimes(2); // folders+files 各 1，无重复加载
  });
});
