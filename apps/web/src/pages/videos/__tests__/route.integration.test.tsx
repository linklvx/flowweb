import { render, waitFor, act } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, it, expect, vi } from 'vitest';
import * as api from '@/api/videoWorkApi';
import { VideosPage } from '../VideosPage'; // 真实页面（第六轮：VideosPageStub 全文未定义是 TS2304/ReferenceError——本任务页面尚无 Modal，断言照样成立；批次 8 挂载 Modal 后本用例回归仍须保持绿）

vi.mock('@/api/videoWorkApi');
// 第十一轮（B4）：批次 8 挂载 Modal 后 navigate('/videos/w1') 渲染真实 PlayView，其首行 useAuth() 解构
// createContext(null!)（AuthProvider.tsx:25）裸值即 TypeError——本文件注释自称"批次 8 后回归须保持绿"却缺 C5 模板
const authCtx = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false, logout: vi.fn(), refresh: vi.fn(), updateUser: vi.fn() }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => authCtx }));

// 环境补丁（plan 未预见的 jsdom/undici realm 错配）：jsdom 全局 AbortController 产出 jsdom AbortSignal，
// 而 jsdom 无 Request → 全局 Request 是 Node(undici) 的；react-router navigate 时
// new Request(url, { signal }) 命中 undici webidl brandCheck 抛 TypeError（断言照常通过，
// 但 unhandled rejection 使 vitest 退出码 1）。剥离 signal 让 undici 自建同 realm AbortSignal——
// 路由无 loader，RR 中止走自身 controller，request.signal 在本测试中无消费方。
class RealmSafeRequest extends Request {
  constructor(input: string | URL, init?: RequestInit) {
    super(input, { ...init, signal: undefined } as RequestInit);
  }
}
vi.stubGlobal('Request', RealmSafeRequest);

// 路由不重挂：Modal 开关前后列表 API 只调 1 次
it('Modal 开关前后 fetchVideoWorks 仅调用 1 次（断言点在动画后）', async () => {
  vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: [{ id: 'w1', title: 'T', coverUrl: null, durationSec: 1, tags: [] }], total: 1, page: 1, pageSize: 20 });
  vi.mocked(api.fetchVideoCategories).mockResolvedValue([]);
  vi.mocked(api.fetchVideoWorkDetail).mockResolvedValue({ id: 'w1', title: 'T', videoUrl: '/flowai/v.mp4', coverUrl: null, categoryId: null, viewCount: 0, likeCount: 0, liked: false, description: null, authorName: 'a', publishedAt: '2026-09-01', width: null, height: null, canViewProcess: false, canClone: false, durationSec: 1, tags: [] } as any);
  // 第七轮 F2：批次 8 挂载 Modal 后这两项必须 mock——getPublicSettings 返回 undefined 是同步 TypeError
  // （automock 无实现）；且必须关轮播（enabled:false）——否则 CarouselBar 复用列表端点（pageSize=11）
  // 第二次调用 fetchVideoWorks 会击穿 toHaveBeenCalledTimes(1)
  vi.mocked(api.getPublicSettings).mockResolvedValue({ carouselEnabled: false, carouselScope: 'all' });
  vi.mocked(api.recordView).mockResolvedValue(undefined);

  const router = createMemoryRouter([
    { path: '/videos/:id?', element: <VideosPage /> },
  ], { initialEntries: ['/videos'] });
  render(<RouterProvider router={router} />);

  await waitFor(() => expect(api.fetchVideoWorks).toHaveBeenCalledTimes(1));
  await act(async () => { router.navigate('/videos/w1'); });
  await act(async () => { router.navigate('/videos'); });
  expect(api.fetchVideoWorks).toHaveBeenCalledTimes(1); // 不重挂 → 不重取
});
