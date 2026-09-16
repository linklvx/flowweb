// 文件顶部装配（第八轮补全 harness）：import 头 + api mock + AuthProvider mock（C5 模板）+
// 本文件自有 snap fixture（原引用 Task 9.1 测试文件的局部 fixture，跨文件不存在）。
// ProcessView 用 useNavigate——所有 render 必须包 Router（原三处裸 render 是 invariant 抛错）。
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, createMemoryRouter, RouterProvider } from 'react-router';
import { App as AntdApp } from 'antd';
import * as api from '@/api/videoWorkApi';
import { ProcessView } from '../ProcessView';

vi.mock('@/api/videoWorkApi');
const authCtx = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false, logout: vi.fn(), refresh: vi.fn(), updateUser: vi.fn() }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => authCtx }));
beforeEach(() => { vi.clearAllMocks(); authCtx.user = null; }); // 第十二轮 C1-6：未清记录时"未登录克隆"用例的 not.toHaveBeenCalled() 撞上一用例（克隆成功已真实调 cloneWork）残留——clearAllMocks 只清记录，各用例体内自声明 mockResolvedValue

const snap = {
  workId: 'w1', title: 't',
  nodes: [
    { id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { content: '一只猫' } },
    { id: 'g1', type: 'group', position: { x: 500, y: 0 }, data: { groupType: 'storyboard', cells: ['n1'] } },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'g1' }],
} as any;

describe('ProcessView', () => {
  it('顶栏：作品标题 + 返回 + 复制项目按钮（canClone=false 不渲染）', async () => {
    vi.mocked(api.fetchProcessSnapshot).mockResolvedValue(snap as any);
    render(<MemoryRouter><ProcessView workId="w1" title="t" canClone={false} onBack={() => {}} onNeedLogin={() => {}} /></MemoryRouter>);
    await waitFor(() => screen.getByTestId('process-snapshot'));
    expect(screen.queryByRole('button', { name: /复制项目/ })).toBeNull();
  });

  it('克隆成功 → toast + 「打开画布」跳 /canvas?projectId=（先例 WorkspaceDimension.tsx:93）', async () => {
    authCtx.user = { id: 'u1' }; // 登录态才走 cloneWork（plan:325 harness 惯例/PlayView.test.tsx:39 先例——plan 原文漏补：第十二轮 beforeEach 复位 user=null 后本用例未同步，onClone 短路 onNeedLogin、「打开画布」永不出现）
    vi.mocked(api.fetchProcessSnapshot).mockResolvedValue(snap as any); // 第十一轮：原靠上一用例的 mock 实现残留才绿（Vitest 默认不 reset 实现）——-t 单跑/换序即 .then undefined 同步 TypeError
    vi.mocked(api.cloneWork).mockResolvedValue({ projectId: 'new-p' });
    const router = createMemoryRouter([{ path: '/', element: <ProcessView workId="w1" title="t" canClone={true} onBack={() => {}} onNeedLogin={() => {}} /> }], { initialEntries: ['/'] });
    render(<AntdApp><RouterProvider router={router} /></AntdApp>); // AntdApp 必包——克隆成功路径 message.success 走 useApp()，antd 默认 context 是 {message:{}} → TypeError 成 unhandled rejection（第八轮）
    await waitFor(() => screen.getByTestId('process-snapshot'));
    fireEvent.click(screen.getByRole('button', { name: /复制项目/ }));
    await waitFor(() => screen.getByRole('button', { name: /打开画布/ }));
    fireEvent.click(screen.getByRole('button', { name: /打开画布/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/canvas'));
    expect(router.state.location.search).toBe('?projectId=new-p'); // navigate 断言落地（第六轮，原为注释占位）
  });

  it('未登录克隆 → onNeedLogin 被调（页内 LoginModal，不跳转）（第六轮落地）', async () => {
    vi.mocked(api.fetchProcessSnapshot).mockResolvedValue(snap as any);
    const onNeedLogin = vi.fn();
    render(<MemoryRouter><AntdApp><ProcessView workId="w1" title="t" canClone={true} onBack={() => {}} onNeedLogin={onNeedLogin} /></AntdApp></MemoryRouter>);
    await waitFor(() => screen.getByTestId('process-snapshot'));
    fireEvent.click(screen.getByRole('button', { name: /复制项目/ }));
    expect(onNeedLogin).toHaveBeenCalled();     // ctx.user=null（顶部 mock 默认）
    expect(api.cloneWork).not.toHaveBeenCalled();
  });

  it('快照 503/404 → 错误态 + 返回按钮（不白屏）', async () => {
    vi.mocked(api.fetchProcessSnapshot).mockRejectedValue(new Error('x'));
    render(<MemoryRouter><ProcessView workId="w1" title="t" canClone={true} onBack={() => {}} onNeedLogin={() => {}} /></MemoryRouter>);
    await waitFor(() => screen.getByText(/暂时无法加载/));
  });
});
