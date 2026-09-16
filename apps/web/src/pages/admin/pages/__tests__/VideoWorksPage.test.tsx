// 第八轮补 harness + renderWithProviders 定义（原块用而未定义；包装照 HomeBannersPage.test.tsx:17 内联三行）：
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'; // within——Task 10.2 tabpanel 撞名用（第十二轮 P1）
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import { App as AntdApp } from 'antd';
import type { ReactElement } from 'react';
import { router } from '@/router';
import { VideoWorksPage } from '../VideoWorksPage';
import { adminVideoWorkApi } from '@/api/adminApi';

vi.mock('@/api/adminApi');
const renderWithProviders = (ui: ReactElement) => render(<MemoryRouter><AntdApp>{ui}</AntdApp></MemoryRouter>);

// 第十轮：文件级 mock 复位 + 默认四件套——原各用例 mock"越界存活"且无复位（Vitest 默认不 reset），
// 调换用例顺序或 -t 单跑即露。clearAllMocks 只清调用记录不清实现；默认值供未显式 mock 的用例兜底，用例可再覆盖。
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(adminVideoWorkApi.listWorks).mockResolvedValue({ items: [], total: 0 } as any);
  vi.mocked(adminVideoWorkApi.listCategories).mockResolvedValue([] as any);
  vi.mocked(adminVideoWorkApi.listTags).mockResolvedValue([] as any);
  vi.mocked(adminVideoWorkApi.listCandidates).mockResolvedValue({ items: [], total: 0 } as any);
  // 第十一轮加、第十二轮修正理由：antd Tabs 懒渲染——非激活过的 pane 不挂载，未点「播放页设置」tab 时
  // CarouselSettingsCard 不存在、不调 getSettings（原"页面会拉设置"不成立）。默认值是纯防御（防实现改页面级
  // 预取、或本文件用例点过设置 tab 后其他 tab 用例回归时残留调用拿到 undefined），保留无害。
  vi.mocked(adminVideoWorkApi.getSettings).mockResolvedValue({ carouselEnabled: true, carouselScope: 'all' });
});

// flatten 内联（router.admin.test.tsx:19-21 同款局部函数——勿 import 测试文件：连带其 vi.mock 副作用）
const flatten = (routes: any[]): any[] =>
  routes.flatMap((r) => [r, ...(r.children ? flatten(r.children) : [])]);

it('/admin/content/video-works 路由存在（router.admin.test 过滤器不覆盖 content/，自建断言；admin 子路由是相对路径——router.tsx:61-68）', () => {
  expect(flatten(router.routes).some((r: any) => r.path === 'content/video-works')).toBe(true); // 相对路径，非 '/admin/...'
});

it('作品表格列：标题/类型/状态/观看/喜欢/排序（第六轮落地——原为空壳用例）', async () => {
  vi.mocked(adminVideoWorkApi.listWorks).mockResolvedValue({ items: [{
    id: 'w1', title: '末班地铁', categoryId: 'c1', status: 'PUBLISHED',
    viewCount: 10, likeCount: 5, sortOrder: 0, updatedAt: '2026-09-01T00:00:00Z',
  }], total: 1 } as any);
  renderWithProviders(<VideoWorksPage />);
  await waitFor(() => screen.getByText('末班地铁'));
  for (const col of ['标题', '类型', '状态', '观看', '喜欢', '排序']) expect(screen.getByText(col)).toBeInTheDocument();
  expect(screen.getByText('10')).toBeInTheDocument();  // 观看数
});

it('ModalForm 含候选下拉（candidates）/两开关/标签 tags 模式/封面控件（第六轮落地）', async () => {
  vi.mocked(adminVideoWorkApi.listCandidates).mockResolvedValue({ items: [{ id: 'm1', key: 'k', projectId: 'p1', canvasExists: true, thumbnailKey: null, durationSec: 10, width: 16, height: 9, createdAt: '2026-09-01', previewUrl: null }], total: 1 } as any);
  vi.mocked(adminVideoWorkApi.listCategories).mockResolvedValue([{ id: 'c1', name: 'AI真人影视', sortOrder: 0, active: true }] as any);
  vi.mocked(adminVideoWorkApi.listTags).mockResolvedValue([{ id: 't1', name: '悬疑', sortOrder: 0, active: true }] as any);
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('button', { name: /新增/ })); // 按钮文案钉死「新增作品」（第十一轮：≥3 字不触发 antd 两字插空格坑——写"新增"两字会变"新 增"致 /新增/ 不匹配；写"新建作品"则不含"新增"子串同样不匹配，实现侧 toolBarRender 必须用「新增作品」）
  await waitFor(() => screen.getByText(/候选视频/));
  expect(screen.getByText(/允许查看创作过程|查看制作过程/)).toBeInTheDocument(); // 两开关（allowViewProcess/allowClone）
  // 本批次实施发现（plan 十三轮未覆盖的内部冲突）：Task 10.2 落地 Tabs 后「标签池」tab 名与本弹层字段 label
  // 同含「标签」子串，全局 getByText(/标签/) 抛 Found multiple；而 10.2 用例把 tab 名钉死「标签池」（getByRole 精确
  // 匹配）不可改。按 plan 第十二轮 P1 对同款撞名的既定手法 within() 收敛——这里收敛到弹层（role=dialog）
  expect(within(screen.getByRole('dialog')).getByText(/标签/)).toBeInTheDocument();
});

it('开关联动（裁决：allowClone 依赖 allowViewProcess）——编辑已有画布作品：关 allowViewProcess → allowClone 被强制关并禁用（第九轮修正：原断言挂在"新增"空表单下——无 canvasProjectId 时两开关本来 disabled、click 是 no-op、断言恒真）', async () => {
  vi.mocked(adminVideoWorkApi.listWorks).mockResolvedValue({ items: [{
    id: 'w1', title: '末班地铁', categoryId: 'c1', status: 'PUBLISHED', canvasProjectId: 'p1',
    allowViewProcess: true, allowClone: true,
    viewCount: 10, likeCount: 5, sortOrder: 0, updatedAt: '2026-09-01T00:00:00Z',
  }], total: 1 } as any);
  vi.mocked(adminVideoWorkApi.listCategories).mockResolvedValue([{ id: 'c1', name: 'AI真人影视', sortOrder: 0, active: true }] as any);
  vi.mocked(adminVideoWorkApi.listTags).mockResolvedValue([] as any);
  renderWithProviders(<VideoWorksPage />);
  await waitFor(() => screen.getByText('末班地铁'));
  fireEvent.click(screen.getByText('编辑')); // 编辑入口——role 无关查询（先例 HomeBannersPage.tsx:39 的编辑 trigger 是 <a>、role=link 非 button，第十轮更正）；ModalForm initialValues 带 canvasProjectId，两开关初始可点
  await waitFor(() => screen.getByText(/允许查看创作过程|查看制作过程/));
  expect(screen.getByRole('switch', { name: /允许克隆/ }) as HTMLButtonElement).toBeEnabled(); // 前置：有画布 → 初始可点（防再写空转断言）
  fireEvent.click(screen.getByRole('switch', { name: /允许查看创作过程|查看制作过程/ })); // 关闭
  expect(screen.getByRole('switch', { name: /允许克隆/ }) as HTMLButtonElement).toBeDisabled(); // 联动禁用（后端 400 校验的前端半边）
});

// 第六轮落地（原为空壳用例）
it('类型管理 tab：ProTable 列 name/sortOrder/active + 新增入口', async () => {
  vi.mocked(adminVideoWorkApi.listCategories).mockResolvedValue([
    { id: 'c1', name: 'AI真人影视', sortOrder: 0, active: true }, { id: 'c2', name: 'MV', sortOrder: 1, active: false },
  ] as any);
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('tab', { name: '视频类型' }));
  await waitFor(() => screen.getByText('AI真人影视'));
  // 第十二轮 P1：rc-tabs 不卸载已激活面板（destroyInactiveTabPane 默认 false，rc-tabs@15.4.0 TabPanelList/index.js:38
  // removeOnLeave:false；TabPane.js:16 aria-hidden）——切走后作品面板仍挂载，其「排序」列头与类型表撞名、getByText 抛
  // Found multiple elements。within(激活 panel) 收敛：getByRole('tabpanel') 默认排除 aria-hidden → 唯一命中当前面板
  const panel = within(screen.getByRole('tabpanel'));
  for (const col of ['名称', '排序', '启用']) expect(panel.getByText(col)).toBeInTheDocument();
});
it('标签管理 tab：同构', async () => {
  vi.mocked(adminVideoWorkApi.listTags).mockResolvedValue([{ id: 't1', name: '悬疑', sortOrder: 0, active: true }] as any);
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('tab', { name: '标签池' }));
  await waitFor(() => screen.getByText('悬疑'));
});
it('轮播设置卡片：开关 + 范围单选，保存调 updateSettings', async () => {
  vi.mocked(adminVideoWorkApi.getSettings).mockResolvedValue({ carouselEnabled: true, carouselScope: 'all' });
  vi.mocked(adminVideoWorkApi.updateSettings).mockResolvedValue({ carouselEnabled: true, carouselScope: 'category' });
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('tab', { name: '播放页设置' }));
  // 第十一轮 S3：原 getByText(/全部作品/) 只证标签存在（initialValue 写错成 category 也绿）——radio 的 checked 才反映初值
  await waitFor(() => expect(screen.getByRole('radio', { name: /全部作品/ })).toBeChecked());
  fireEvent.click(screen.getByText(/同类型/));        // 切 scope=category
  fireEvent.click(screen.getByRole('button', { name: /保存/ })); // 按钮文案钉死「保存设置」（≥3 字不触发 antd 两字插空格——"保存"两字会变"保 存"致 /保存/ 不匹配）
  await waitFor(() => expect(adminVideoWorkApi.updateSettings).toHaveBeenCalledWith({ carouselEnabled: true, carouselScope: 'category' }));
});
