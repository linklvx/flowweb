import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from '@/api/videoWorkApi';
import { VideosPage } from '../VideosPage'; // 真实页面——Modal 由其内部挂载（C2 Task 8.x 执行序：本任务在 8.2/8.3/9.1/9.2 之后执行，全部真实子组件就位）。第十一轮：原 '../../VideosPage' 多一级——本文件在 pages/videos/__tests__/ 下，解析到 pages/VideosPage 不存在（同目录先例全部 ../X）

vi.mock('@/api/videoWorkApi');
vi.mock('@/components/BaseFullscreenModal', () => ({
  BaseFullscreenModal: ({ open, children }: any) => open ? <div data-testid="modal">{children}</div> : null,
}));
vi.mock('@/components/AuthProvider', () => {  // C5 模板——渲染链含 useAuth（PlayView）
  const ctx = { user: null, loading: false, logout: vi.fn(), refresh: vi.fn(), updateUser: vi.fn() };
  return { useAuth: () => ctx };
});

// 环境补丁（批次 7 传递，照抄 route.integration.test.tsx）：jsdom 全局 AbortController 产出 jsdom AbortSignal，
// 而 jsdom 无 Request → 全局 Request 是 Node(undici) 的；react-router navigate 时
// new Request(url, { signal }) 命中 undici webidl brandCheck 抛 TypeError（断言照常通过，
// 但 unhandled rejection 使 vitest 退出码 1）。剥离 signal 让 undici 自建同 realm AbortSignal。
// 本文件四场景全部经 navigate（Link 点击/轮播切换/关闭），必须打补丁。
class RealmSafeRequest extends Request {
  constructor(input: string | URL, init?: RequestInit) {
    super(input, { ...init, signal: undefined } as RequestInit);
  }
}
vi.stubGlobal('Request', RealmSafeRequest);

const detail = { id: 'w1', title: '末班地铁', videoUrl: '/flowai/v.mp4', coverUrl: null, categoryId: null,
  viewCount: 10, likeCount: 5, liked: false, description: '简介', authorName: '作者', publishedAt: '2026-09-01T00:00:00Z',
  width: null, height: null, canViewProcess: false, canClone: false, durationSec: 100, tags: ['悬疑'] };
const detailW2 = { ...detail, id: 'w2', title: '第二作品' };
const listItems = [ // 列表含 w1/w2 两卡（场景 1/4 点真实卡片进入——VideoCard 的 Link 自带 state:{fromList:true}）
  { id: 'w1', title: '末班地铁', coverUrl: null, durationSec: 100, tags: [] },
  { id: 'w2', title: '第二作品', coverUrl: null, durationSec: 90, tags: [] },
];

function renderAt(initial: string) {
  const router = createMemoryRouter([{ path: '/videos/:id?', element: <VideosPage /> }],
    { initialEntries: [initial] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('关闭算法（模式 A：state.fromList）', () => {
  beforeEach(() => {
    vi.clearAllMocks(); // 第十二轮 C1-6：仓内未开 clearMocks，调用历史跨用例累积——场景1 已产生 1 次 recordView，不清则场景2 的 toHaveBeenCalledTimes(1) 拿到 2（clearAllMocks 只清记录，下方 mockResolvedValue 随即重新声明）
    vi.mocked(api.fetchVideoWorkDetail).mockImplementation(async (id: string) => (id === 'w2' ? detailW2 : detail) as any);
    vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: listItems, total: 2, page: 1, pageSize: 20 }); // 列表+轮播同源（轮播 pageSize=11 同端点）
    vi.mocked(api.fetchVideoCategories).mockResolvedValue([]);
    vi.mocked(api.getPublicSettings).mockResolvedValue({ carouselEnabled: true, carouselScope: 'all' }); // 轮播渲染依赖（Task 8.3）
    vi.mocked(api.recordView).mockResolvedValue(undefined);
  });

  it('场景1 列表进入 → 关闭 navigate(-1) 回列表', async () => {
    const router = renderAt('/videos');
    fireEvent.click(await screen.findByText('末班地铁')); // 真实卡片 Link（state:{fromList:true}）
    await waitFor(() => screen.getByTestId('modal'));
    fireEvent.click(screen.getByTestId('close-btn'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/videos'));
  });

  it('场景2 直链进入（无 state）→ 关闭 replace 到 /videos；view 埋点仅打开时 1 次（spec §7 前端8——第十一轮补断言）', async () => {
    const router = renderAt('/videos/w1');
    await waitFor(() => screen.getByTestId('modal'));
    expect(api.recordView).toHaveBeenCalledTimes(1); // 单点埋点（打开 Modal 时）；effect 依赖写错（缺 id/每 render 重跑）会变 2+ → 红
    fireEvent.click(screen.getByTestId('close-btn'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/videos'));
    expect(api.recordView).toHaveBeenCalledTimes(1); // 关闭不再触发
  });

  it('场景3 直链→轮播(继承 null state)→关闭 → 落 /videos 不退出站点', async () => {
    const router = renderAt('/videos/w1');
    await waitFor(() => screen.getByTestId('carousel-item-w2')); // 轮播出现（列表过滤掉 w1 后剩 w2）
    fireEvent.click(screen.getByTestId('carousel-item-w2')); // 轮播切换 replace+location.state 继承
    await waitFor(() => expect(router.state.location.pathname).toBe('/videos/w2'));
    fireEvent.click(screen.getByTestId('close-btn'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/videos'));
  });

  it('场景4 列表→轮播(继承 fromList)→关闭 → 回列表而非上一作品', async () => {
    const router = renderAt('/videos');
    fireEvent.click(await screen.findByText('末班地铁'));
    await waitFor(() => screen.getByTestId('carousel-item-w2'));
    fireEvent.click(screen.getByTestId('carousel-item-w2'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/videos/w2'));
    fireEvent.click(screen.getByTestId('close-btn'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/videos'));
  });

  it('场景5 列表带 ?page=2&categoryId=x 进入 → 关闭后查询串仍在（模式 A 与朴素 replace 的唯一可测差异）', async () => {
    const router = renderAt('/videos?page=2&categoryId=x');
    fireEvent.click(await screen.findByText('末班地铁'));
    await waitFor(() => screen.getByTestId('modal'));
    fireEvent.click(screen.getByTestId('close-btn'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/videos'));
    expect(router.state.location.search).toBe('?page=2&categoryId=x'); // navigate(-1) 保留查询串；replace 会丢
  });

  it('快速切换 w1→w2 时旧响应晚到不覆盖（无 stale 守卫时 w1 响应晚到覆盖已展示的 w2 标题）', async () => {
    let resolveW1!: (v: any) => void;
    let resolveW2!: (v: any) => void;
    vi.mocked(api.fetchVideoWorkDetail)
      .mockImplementationOnce(() => new Promise(res => { resolveW1 = res; })) // w1 可控 pending
      .mockImplementationOnce(() => new Promise(res => { resolveW2 = res; })); // w2 可控 pending
    const router = renderAt('/videos/w1');
    await waitFor(() => expect(api.fetchVideoWorkDetail).toHaveBeenCalledTimes(1)); // w1 请求在途（Modal 未渲染——detail null 整壳返回 null）
    await act(async () => { await router.navigate('/videos/w2'); }); // w1 resolve 前切到 w2
    await waitFor(() => expect(api.fetchVideoWorkDetail).toHaveBeenCalledWith('w2'));
    resolveW2(detailW2); // w2 响应先到
    await waitFor(() => expect(within(screen.getByTestId('modal')).getByText('第二作品')).toBeInTheDocument()); // w2 正常展示（within 收窄——列表卡片同名文本会误中）
    resolveW1(detail); // w1 旧响应晚到
    await waitFor(() => { expect(within(screen.getByTestId('modal')).queryByText('末班地铁')).toBeNull(); }); // 不被覆盖
    expect(within(screen.getByTestId('modal')).getByText('第二作品')).toBeInTheDocument();
  });
});

// ─── P5b 轮播条件渲染 + 壳根属性（spec v3.1 裁定 A）───
const detailP = { ...detail, id: 'w1p', title: '可看过程', canViewProcess: true };
const detailW2P = { ...detail, id: 'w2p', title: '第二作品P', canViewProcess: true };
const listItemsP = [ // 轮播数据：两作品互为对方卡片
  { id: 'w1p', title: '可看过程', coverUrl: null, durationSec: 100, tags: [] },
  { id: 'w2p', title: '第二作品P', coverUrl: null, durationSec: 90, tags: [] },
];

describe('P5b 轮播条件渲染（view === \'play\' && !playing）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.fetchVideoWorkDetail).mockImplementation(async (id: string) => (id === 'w2p' ? detailW2P : detailP) as any);
    vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: listItemsP, total: 2, page: 1, pageSize: 20 });
    vi.mocked(api.fetchVideoCategories).mockResolvedValue([]);
    vi.mocked(api.getPublicSettings).mockResolvedValue({ carouselEnabled: true, carouselScope: 'all' });
    vi.mocked(api.recordView).mockResolvedValue(undefined);
    vi.mocked(api.fetchProcessSnapshot).mockResolvedValue({ workId: 'w1p', title: '可看过程', nodes: [], edges: [] } as any);
    // play spy：用例点「立即观看」进播放态 → effect playing 分支直调 play()（jsdom notImplemented 打噪音不红，spy 保输出干净）
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  it('process 视图：轮播不渲染；返回 play 恢复', async () => {
    renderAt('/videos/w1p');
    await screen.findByTestId('carousel-item-w2p');
    fireEvent.click(screen.getByRole('button', { name: /查看制作过程/ }));
    await waitFor(() => expect(screen.queryByTestId('carousel')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /返回/ }));
    await waitFor(() => expect(screen.getByTestId('carousel-item-w2p')).toBeInTheDocument());
  });

  it('播放态：轮播不渲染；暂停保持播放态（轮播仍隐藏），播完才回预览恢复', async () => {
    renderAt('/videos/w1p');
    await screen.findByTestId('carousel-item-w2p');
    fireEvent.click(screen.getByRole('button', { name: /立即观看/ }));
    await waitFor(() => expect(screen.queryByTestId('carousel')).toBeNull());
    fireEvent.pause(screen.getByTestId('video'));                          // 点视频=原生暂停，UI 不回预览
    await new Promise(res => setTimeout(res, 100));
    expect(screen.queryByTestId('carousel')).toBeNull();                    // 仍播放态
    fireEvent.ended(screen.getByTestId('video'));                          // 播完=回预览
    await waitFor(() => expect(screen.getByTestId('carousel-item-w2p')).toBeInTheDocument());
  });

  it('播放态下切作品 → 轮播恢复（钉外壳 id-effect setPlaying(false) 复位——漏则停在无轮播伪播放态）', async () => {
    const router = renderAt('/videos/w1p');
    await screen.findByTestId('carousel-item-w2p');
    fireEvent.click(screen.getByRole('button', { name: /立即观看/ }));
    await waitFor(() => expect(screen.queryByTestId('carousel')).toBeNull());
    await act(async () => { await router.navigate('/videos/w2p'); });
    await waitFor(() => expect(screen.getByTestId('carousel-item-w1p')).toBeInTheDocument()); // w2p 页轮播显示 w1p 卡 → playing 已复位
  });

  it('壳根 data-vw-shell（壳作用域锚点，R3 reset 已被 preflight 取代退役）+ [color-scheme:dark]（原生 controls 深色，B1）', async () => {
    renderAt('/videos/w1p');
    await screen.findByTestId('modal');
    const shell = screen.getByTestId('modal').firstElementChild; // BaseFullscreenModal mock 直通 children → 首子即壳根 div
    expect(shell?.hasAttribute('data-vw-shell')).toBe(true);
    expect(shell?.className).toContain('[color-scheme:dark]');
  });

  it('关闭钮只显示 ✕（U7b：去「关闭」文字，data-testid 定位不变）', async () => {
    renderAt('/videos/w1p');
    await screen.findByTestId('modal');
    const btn = screen.getByTestId('close-btn');
    expect(btn.textContent?.trim()).toBe('✕');
  });
});
