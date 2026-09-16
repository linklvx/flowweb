// 第八轮补 harness（原块无 import 头；渲染链经 VideosPage 含 useAuth → 需 C5 模板 AuthProvider mock。
// 若下文用例块已含相同声明则勿重复 vi.mock 同模块两次）：
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import * as api from '@/api/videoWorkApi';
import { VideosPage } from '../VideosPage'; // 第十一轮：原 '../../VideosPage' 多一级（__tests__/ 下应为 ../X，同仓全部先例）；第十二轮删未用的 AntdApp 导入（本文件 render 不包 App 组件）

vi.mock('@/api/videoWorkApi');
const authCtx = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false, logout: vi.fn(), refresh: vi.fn(), updateUser: vi.fn() }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => authCtx }));
// 第九轮：automock 无 mockResolvedValue → fetchVideoWorks/fetchVideoWorkDetail 返回 undefined、.then 是同步
// TypeError（C7-F2 为 8.3 诊断的同款形态）→ Modal 永不渲染、getByRole('喜欢') 抛错。照 Task 8.1 补四件套；
// getPublicSettings 关轮播防 CarouselBar 二次调列表。
const detailFixture = { id: 'w1', title: '末班地铁', videoUrl: '/flowai/v.mp4', coverUrl: null, categoryId: null,
  viewCount: 10, likeCount: 5, liked: false, description: '简介', authorName: '作者', publishedAt: '2026-09-01T00:00:00Z',
  width: null, height: null, canViewProcess: false, canClone: false, durationSec: 100, tags: ['悬疑'] };
beforeEach(() => {
  authCtx.user = null;
  vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: [{ id: 'w1', title: '末班地铁', coverUrl: null, durationSec: 100, tags: [] }], total: 1, page: 1, pageSize: 20 });
  vi.mocked(api.fetchVideoCategories).mockResolvedValue([]);
  vi.mocked(api.fetchVideoWorkDetail).mockResolvedValue(detailFixture as any);
  vi.mocked(api.getPublicSettings).mockResolvedValue({ carouselEnabled: false, carouselScope: 'all' });
  vi.mocked(api.recordView).mockResolvedValue(undefined);
});

// 第九轮：BaseFullscreenModal 落成真 mock——原只在 Esc 用例的注释里：onCloseRef 未定义是 ReferenceError/TS2304、
// getByTestId('modal') 无来源必红。vi.hoisted 捕获 onClose（vi.mock 工厂被提升，工厂内引用外部变量必须经 vi.hoisted——C5 同款）。
const onCloseRef = vi.hoisted(() => ({ current: undefined as undefined | (() => void) }));
vi.mock('@/components/BaseFullscreenModal', () => ({
  BaseFullscreenModal: ({ open, onClose, children }: any) => {
    onCloseRef.current = onClose;
    return open ? <div data-testid="modal">{children}</div> : null;
  },
}));

// 第六轮：login-modal-root 由 mock 提供（真实 LoginModal 无此 testid——直接断言会 getByTestId 抛错）。
// mock 渲染在 JSX 原位（非 portal），closest 到 Provider 内层 data-zprovider 锚点在 DOM 上可达（第十一轮 S2）。
vi.mock('@/components/auth/LoginModal', () => ({
  LoginModal: () => <div data-testid="login-modal-root" />,
}));
// 第七轮：renderModalWithNeedLogin 在本文件内定义（原写"复用 Task 8.1 的 renderAt"——那是另一测试文件的
// 局部函数，跨文件复用不可能；本文件自建同款装配）：
function renderModalWithNeedLogin() {
  const router = createMemoryRouter([{ path: '/videos/:id?', element: <VideosPage /> }], { initialEntries: ['/videos/w1'] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('播放 Modal 内页内登录', () => {
  it('onNeedLogin → 渲染 LoginModal 且在 Provider 内层（data-zprovider 锚点带 token 值）', async () => {
    renderModalWithNeedLogin(); // 本文件自建装配（真实 VideosPage）+ AuthProvider mock（user:null）
    // 喜欢按钮属 PlayView，须待 fetchVideoWorkDetail 微任务 resolve 后才存在——plan 原句同步 getByRole
    // 必抛 Unable to find，改 findByRole 等待（批次 8 实施修复，断言语义不变）
    fireEvent.click(await screen.findByRole('button', { name: /喜欢/ })); // 未登录触发
    await waitFor(() => screen.getByTestId('login-modal-root'));
    // 第十一轮 S2 引入、第十二轮口径修正：断言钉住**值耦合**——VIDEO_MODAL_Z_BASE 改值即 String(值) ≠ '100000' 红；
    // "Provider 包裹存在"jsdom 不可测（ConfigProvider/AntdApp 是 context 组件无 DOM 痕迹，删层重写保留锚点 div 仍绿），
    // 层叠正确性走浏览器手工验收 #6（spec §7 前端5 已同步此口径）。原 closest('[data-zprovider="true"]') 挂壳根，
    // 连值耦合都没有，是假防线。
    const anchor = screen.getByTestId('login-modal-root').closest('[data-zprovider]');
    expect(anchor?.getAttribute('data-zprovider')).toBe('100000');
  });

  it('Esc 守卫（承重）：登录层开着时触发壳 onClose → 只关登录层、播放 Modal 仍在（第六轮新增——否则守卫永远没有测试；第九轮：mock 从注释落成文件顶部真代码）', async () => {
    renderModalWithNeedLogin();
    fireEvent.click(await screen.findByRole('button', { name: /喜欢/ })); // 同上：待详情 resolve 后按钮才存在
    await waitFor(() => screen.getByTestId('login-modal-root'));
    act(() => onCloseRef.current!()); // 壳的 Esc 路径（焦点不在登录框内时事件直达 document 的场景）
    await waitFor(() => expect(screen.queryByTestId('login-modal-root')).toBeNull()); // 登录层关
    expect(screen.getByTestId('modal')).toBeInTheDocument(); // 播放 Modal 不关
  });
});
