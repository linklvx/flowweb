import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const { mockUseAuth, mockCreditsStore, mockCanvasState, mockTeamApi, mockGetAwareness, mockListProjectMembers, mockUndoUiState } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockCreditsStore: {
    credits: 88,
    subscriptionCredits: 12,
    subscriptionCreditsExpiry: null,
    tier: null,
    scope: 'personal',
    teamId: null,
    loading: false,
    error: null,
    fetchBalance: vi.fn(),
    fetchTeamBalance: vi.fn(),
    isSubscriptionActive: vi.fn(() => false),
  },
  mockCanvasState: { teamId: null as string | null },
  mockTeamApi: { getDefaultTeam: vi.fn() },
  mockGetAwareness: vi.fn(),
  mockListProjectMembers: vi.fn(),
  mockUndoUiState: {
    canvasCanUndo: false, canvasCanRedo: false, timelineCanUndo: false, timelineCanRedo: false,
  },
}));

vi.mock('@/api/projectMemberApi', () => ({
  listProjectMembers: mockListProjectMembers,
  addProjectMember: vi.fn(),
  changeProjectMemberRole: vi.fn(),
  removeProjectMember: vi.fn(),
}));

vi.mock('@/stores/creditsStore', () => ({
  useCreditsStore: () => mockCreditsStore,
}));

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: (selector: (s: { teamId: string | null }) => unknown) => selector(mockCanvasState),
}));

vi.mock('@/api/teamApi', () => ({
  getDefaultTeam: mockTeamApi.getDefaultTeam,
}));

vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/stores/canvasCollabRuntime', () => ({
  getAwareness: () => mockGetAwareness(),
}));

// Y4a T11：undoUiStore mock 面——CanvasTopBar 两颗 undo/redo 按钮 disabled 随 canvas 布尔；
// undoCanvas/redoCanvas 动作面 mock（点击断言消费——真实栈语义在 undoUiStore.spec.ts 锁）
vi.mock('@/stores/undoUiStore', () => ({
  useUndoUiStore: (selector: (s: typeof mockUndoUiState) => unknown) => selector(mockUndoUiState),
}));
vi.mock('@/stores/canvasUndo', () => ({
  undoCanvas: vi.fn(async () => { }),
  redoCanvas: vi.fn(async () => { }),
}));

import { CanvasTopBar } from './CanvasTopBar';
import { undoCanvas, redoCanvas } from '@/stores/canvasUndo';

describe('CanvasTopBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanvasState.teamId = null;
    mockGetAwareness.mockReturnValue(null);
    mockUndoUiState.canvasCanUndo = false;
    mockUndoUiState.canvasCanRedo = false;
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'u1@flowai.dev', name: 'U1' },
      loading: false,
    });
    mockTeamApi.getDefaultTeam.mockResolvedValue({ id: 't-default', name: '个人项目', isDefault: true });
  });

  function renderTopBarWith({ teamId }: { teamId: string | null }) {
    mockCanvasState.teamId = teamId;
    return render(
      <MemoryRouter>
        <CanvasTopBar projectId="test-pid" />
      </MemoryRouter>,
    );
  }

  function renderBar() {
    return renderTopBarWith({ teamId: null });
  }

  it('should display user avatar when authenticated', () => {
    renderBar();
    expect(screen.getByText('U')).toBeInTheDocument();
  });

  it('should display credits from store', () => {
    renderBar();
    expect(screen.getByLabelText('查看积分明细')).toBeDefined();
  });

  it('should show login link when not authenticated', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });
    renderBar();
    expect(screen.getByText('登录')).toBeDefined();
  });

  it('画布属非默认团队：挂载拉 /team/:id/balance（fetchTeamBalance——统一刷新函数默认档）', async () => {
    renderTopBarWith({ teamId: 't-team' });
    await waitFor(() => expect(mockCreditsStore.fetchTeamBalance).toHaveBeenCalledWith('t-team', {}));
    expect(mockCreditsStore.fetchBalance).not.toHaveBeenCalled();
  });

  it('画布属默认团队：挂载走 personal fetchBalance', async () => {
    renderTopBarWith({ teamId: 't-default' });
    await waitFor(() => expect(mockCreditsStore.fetchBalance).toHaveBeenCalled());
    expect(mockCreditsStore.fetchTeamBalance).not.toHaveBeenCalled();
  });

  it('Y3 D1：credits:update 空 detail=信号——按挂载 scope 静默重拉（非默认团队走 fetchTeamBalance(teamId)）', async () => {
    renderTopBarWith({ teamId: 't-team' });
    await waitFor(() => expect(mockTeamApi.getDefaultTeam).toHaveBeenCalled());
    mockTeamApi.getDefaultTeam.mockClear();
    mockCreditsStore.fetchTeamBalance.mockClear();
    act(() => {
      window.dispatchEvent(new CustomEvent('credits:update'));
    });
    // 空 detail 收号：fetchTeamBalance(teamId, { silent: true })——不再请求默认团队、不走 applyBalance
    await waitFor(() => expect(mockCreditsStore.fetchTeamBalance).toHaveBeenCalledWith('t-team', { silent: true }));
    expect(mockTeamApi.getDefaultTeam).not.toHaveBeenCalled();   // 比较结果 ref 化——终态事件不再每次请求
    expect(mockCreditsStore.fetchBalance).not.toHaveBeenCalled();
  });

  it('Y3 D1：空 detail 信号——个人/默认团队档走 fetchBalance({ silent: true })', async () => {
    renderTopBarWith({ teamId: 't-default' });
    await waitFor(() => expect(mockCreditsStore.fetchBalance).toHaveBeenCalled());
    mockTeamApi.getDefaultTeam.mockClear();
    mockCreditsStore.fetchBalance.mockClear();
    act(() => {
      window.dispatchEvent(new CustomEvent('credits:update'));
    });
    await waitFor(() => expect(mockCreditsStore.fetchBalance).toHaveBeenCalledWith({ silent: true }));
    expect(mockTeamApi.getDefaultTeam).not.toHaveBeenCalled();
    expect(mockCreditsStore.fetchTeamBalance).not.toHaveBeenCalled();
  });

  it('Y3 D1：挂载与非默认团队首次判定——默认团队请求仍发生一次（ref 化后终态才免请求）', async () => {
    renderTopBarWith({ teamId: 't-team' });
    await waitFor(() => expect(mockTeamApi.getDefaultTeam).toHaveBeenCalledTimes(1));   // 挂载时恰一次
  });

  it('R33：在线成员列表排除本机（getRemoteStates——现状 getStates 全量自计入必红）；T7：色=注入字段 s.user.color', () => {
    mockGetAwareness.mockReturnValue({
      getStates: () => new Map([
        [1, { user: { id: 'me', name: '本机我' } }],   // 本机 clientID=1
        [2, { user: { id: 'u2', name: '协作者', color: '#123456' } }],
      ]),
      getRemoteStates: () => [{ user: { id: 'u2', name: '协作者', color: '#123456' } }],
      onStateChange: () => () => {},
    });
    renderBar();
    expect(screen.getByTitle('协作者')).toBeInTheDocument();
    expect(screen.getByTitle('协作者').style.background).toBe('rgb(18, 52, 86)');   // 注入字段直读（禁 id 自算 fallback）
    expect(screen.queryByTitle('本机我')).toBeNull(); // R33：在线列表自计入（本机已在右侧头像区呈现）
  });

  it('成员表（Q-M）：presence 在线点+点击成员入口挂既有 ProjectMembersPanel（角色/撤销全复用——零新端点）', async () => {
    mockGetAwareness.mockReturnValue({
      getStates: () => new Map(),
      getRemoteStates: () => [{ user: { id: 'u2', name: '协作者', color: '#123456' } }],
      onStateChange: () => () => {},
    });
    mockListProjectMembers.mockResolvedValue({
      items: [
        { userId: 'u2', name: '成员A', email: 'a@x.dev', teamRole: 'MEMBER', effectiveRole: 'PROJECT_EDITOR', source: 'inherited' },
      ],
    });
    renderBar();
    // presence 增强：在线头像带在线点（bg-brand-green）
    expect(screen.getByTestId('presence-dot-u2')).toBeInTheDocument();
    // 成员入口 → Popover 挂既有 ProjectMembersPanel（复用 projectMemberApi 既有端点）
    fireEvent.click(screen.getByTestId('members-trigger'));
    expect(await screen.findByText('项目成员')).toBeInTheDocument();
    expect(mockListProjectMembers).toHaveBeenCalledWith('test-pid');
    expect(await screen.findByText('成员A')).toBeInTheDocument();
  });

  it('Y4a T11：undo/redo 两颗渲染——空栈双 disabled、点击不吃空栈（undoCanvas/redoCanvas 不被调）', () => {
    renderBar();
    const undo = screen.getByRole('button', { name: '撤销' });
    const redo = screen.getByRole('button', { name: '重做' });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
    fireEvent.click(undo);
    fireEvent.click(redo);
    expect(undoCanvas).not.toHaveBeenCalled();
    expect(redoCanvas).not.toHaveBeenCalled();
  });

  it('Y4a T11：disabled 态随 undoUiStore canvas 布尔——栈可撤/可重做各亮一颗', () => {
    mockUndoUiState.canvasCanUndo = true;
    mockUndoUiState.canvasCanRedo = true;
    renderBar();
    expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '重做' })).toBeEnabled();
  });

  it('Y4a T11：点击接 canvasUndo（undoCanvas/redoCanvas）', () => {
    mockUndoUiState.canvasCanUndo = true;
    mockUndoUiState.canvasCanRedo = true;
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(undoCanvas).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(redoCanvas).toHaveBeenCalledTimes(1);
  });

  it('评审 III：批注面板入口恒可用（纯读面板——只读会话仍须能读既有批注）+ 点击派发 threads:open', () => {
    const onOpen = vi.fn();
    window.addEventListener('threads:open', onOpen);
    renderBar();
    const trigger = screen.getByTestId('threads-trigger');
    expect(trigger).toBeEnabled();   // 写动作闸在 ThreadsPanel/ThreadComposer 内——入口不挡读
    fireEvent.click(trigger);
    expect(onOpen).toHaveBeenCalledTimes(1);
    window.removeEventListener('threads:open', onOpen);
  });
});
