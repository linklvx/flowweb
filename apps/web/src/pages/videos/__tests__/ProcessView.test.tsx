// 文件顶部装配（第八轮补全 harness）：import 头 + api mock + AuthProvider mock（C5 模板）+
// 本文件自有 snap fixture（原引用 Task 9.1 测试文件的局部 fixture，跨文件不存在）。
// ProcessView 用 useNavigate——所有 render 必须包 Router（原三处裸 render 是 invariant 抛错）。
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, createMemoryRouter, RouterProvider } from 'react-router';
import { App as AntdApp } from 'antd';
import * as api from '@/api/videoWorkApi';
import { ProcessView } from '../ProcessView';

vi.mock('@/api/videoWorkApi');
const authCtx = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false, logout: vi.fn(), refresh: vi.fn(), updateUser: vi.fn() }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => authCtx }));
beforeEach(() => { vi.clearAllMocks(); authCtx.user = null; }); // 第十二轮 C1-6：未清记录时"未登录克隆"用例的 not.toHaveBeenCalled() 撞上一用例（克隆成功已真实调 cloneWork）残留——clearAllMocks 只清记录，各用例体内自声明 mockResolvedValue

// 环境补丁（同款先例 route.integration.test.tsx:18-23）：jsdom/undici realm 错配——克隆成功用例 navigate('/canvas')
// 命中真路由后 react-router new Request(url, { signal }) 以 jsdom AbortSignal 击穿 undici brandCheck 抛
// TypeError（unhandled rejection 使退出码 1）。剥离 signal 让 undici 自建同 realm AbortSignal；
// 路由无 loader，request.signal 无消费方。
class RealmSafeRequest extends Request {
  constructor(input: string | URL, init?: RequestInit) {
    super(input, { ...init, signal: undefined } as RequestInit);
  }
}
vi.stubGlobal('Request', RealmSafeRequest);

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

  it('顶栏 pr 预留（P5c/P0-2 防竞争口径）：pl-4 + pr-[var(--vw-close-reserve)]，无 px-4 残留', async () => {
    vi.mocked(api.fetchProcessSnapshot).mockResolvedValue(snap as any);
    render(<MemoryRouter><ProcessView workId="w1" title="t" canClone={false} onBack={() => {}} onNeedLogin={() => {}} /></MemoryRouter>);
    await waitFor(() => screen.getByTestId('process-snapshot'));
    const topbar = screen.getByRole('button', { name: /返回/ }).parentElement;
    expect(topbar?.classList.contains('pl-4')).toBe(true);
    expect(topbar?.classList.contains('pr-[var(--vw-close-reserve)]')).toBe(true);
    expect(topbar?.classList.contains('px-4')).toBe(false);   // px-4 与 pr-* 同特异性竞争输出序——勿赌，直接消除竞争
  });

  it('复制项目按钮（U7a/c）：左侧「只读模式」提示白字 + 白底黑字 + 复制 SVG 图标', async () => {
    vi.mocked(api.fetchProcessSnapshot).mockResolvedValue(snap as any);
    render(<MemoryRouter><ProcessView workId="w1" title="t" canClone={true} onBack={() => {}} onNeedLogin={() => {}} /></MemoryRouter>);
    await waitFor(() => screen.getByTestId('process-snapshot'));
    expect(screen.getByText('只读模式，如需创建请点击')).toBeInTheDocument();   // U7c 按钮左侧提示
    const btn = screen.getByRole('button', { name: /复制项目/ });
    expect(btn.className).toContain('bg-white');                              // U7a 白底
    expect(btn.className).toContain('text-[#111]');                           // U7a 黑字
    expect(btn.querySelector('svg')).toBeTruthy();                            // U7a 复制图标
    expect(btn.textContent).toContain('复制项目');
  });

  it('克隆成功 → toast + 「打开画布」跳 /canvas?projectId=（先例 WorkspaceDimension.tsx:93）', async () => {
    authCtx.user = { id: 'u1' }; // 登录态才走 cloneWork（plan:325 harness 惯例/PlayView.test.tsx:39 先例——plan 原文漏补：第十二轮 beforeEach 复位 user=null 后本用例未同步，onClone 短路 onNeedLogin、「打开画布」永不出现）
    vi.mocked(api.fetchProcessSnapshot).mockResolvedValue(snap as any); // 第十一轮：原靠上一用例的 mock 实现残留才绿（Vitest 默认不 reset 实现）——-t 单跑/换序即 .then undefined 同步 TypeError
    vi.mocked(api.cloneWork).mockResolvedValue({ projectId: 'new-p' });
    const router = createMemoryRouter([{ path: '/', element: <ProcessView workId="w1" title="t" canClone={true} onBack={() => {}} onNeedLogin={() => {}} /> }, { path: '/canvas', element: null }], { initialEntries: ['/'] }); // /canvas 空路由：navigate 落地消 "No route matches" 噪音
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

  it('克隆 in-flight 期间再点不重复发请求（防双击）', async () => {
    authCtx.user = { id: 'u1' };
    vi.mocked(api.fetchProcessSnapshot).mockResolvedValue(snap as any);
    let resolveClone!: (v: { projectId: string }) => void; // 可控 pending promise：resolve 前按钮可点但请求不得重复
    vi.mocked(api.cloneWork).mockImplementationOnce(() => new Promise((res) => { resolveClone = res; }));
    const router = createMemoryRouter([{ path: '/', element: <ProcessView workId="w1" title="t" canClone={true} onBack={() => {}} onNeedLogin={() => {}} /> }, { path: '/canvas', element: null }], { initialEntries: ['/'] });
    render(<AntdApp><RouterProvider router={router} /></AntdApp>);
    await waitFor(() => screen.getByTestId('process-snapshot'));
    fireEvent.click(screen.getByRole('button', { name: /复制项目/ })); // 第一次点击 → cloneWork 调 1 次、pending 未 resolve
    fireEvent.click(screen.getByRole('button', { name: /复制项目/ })); // 未 resolve 时再点
    expect(api.cloneWork).toHaveBeenCalledTimes(1);
    await act(async () => { resolveClone({ projectId: 'new-p' }); }); // resolve 后正常收尾
    await waitFor(() => screen.getByRole('button', { name: /打开画布/ }));
  });
});
