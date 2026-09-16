// 第八轮补 harness + renderWithProviders 定义（原块用而未定义；包装照 HomeBannersPage.test.tsx:17 内联三行）：
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'; // within——Task 10.2 tabpanel 撞名用（第十二轮 P1）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
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
afterEach(() => { vi.unstubAllGlobals(); }); // uploadCover 失败用例 stub 的 fetch 复位，防泄漏到其他用例

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

// —— 批次 10 质量审查 C-1：提交路径用例（原 7 用例零提交路径覆盖——候选字段仅靠 setFieldsValue 写入、从未注册，
// onFinish 的 v.videoKey 恒 undefined → 门禁永远拦截，createWork/updateWork 从未被调；审查者实测复现）——

it('create 提交：选中候选+填必填保存 → createWork 载荷含候选五字段（videoKey/canvasProjectId/durationSec/width/height）+videoMediaId（C-1：数据源改 candRef，不依赖未注册字段）', async () => {
  vi.mocked(adminVideoWorkApi.listCandidates).mockResolvedValue({ items: [{ id: 'm1', key: 'videos/demo.mp4', projectId: 'p1', canvasExists: true, thumbnailKey: null, durationSec: 10, width: 1920, height: 1080, createdAt: '2026-09-01', previewUrl: null }], total: 1 } as any);
  vi.mocked(adminVideoWorkApi.createWork).mockResolvedValue({ id: 'w9' } as any);
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('button', { name: /新增/ }));
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => within(dialog).getByText(/候选视频/));
  fireEvent.mouseDown(within(dialog).getByText('从候选池选择')); // antd Select jsdom 开下拉惯例（mousedown 冒泡至 selector）
  fireEvent.click(await screen.findByText('videos/demo.mp4'));  // 选中候选（dropdown portal 到 body）
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: '测试标题' } });
  fireEvent.change(within(dialog).getByLabelText('作者名'), { target: { value: '作者甲' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ })); // 两字插空格坑（同文件 52 行注释）
  await waitFor(() => expect(adminVideoWorkApi.createWork).toHaveBeenCalledTimes(1));
  expect(adminVideoWorkApi.createWork).toHaveBeenCalledWith(expect.objectContaining({
    title: '测试标题', authorName: '作者甲',
    videoKey: 'videos/demo.mp4', videoMediaId: 'm1', canvasProjectId: 'p1',
    durationSec: 10, width: 1920, height: 1080,
  }));
});

it('edit 提交：不重选候选直接改标题保存 → updateWork 被调且载荷无 videoKey/videoMediaId、标题已更新（C-1：UpdateVideoWorkDto 禁字段——forbidNonWhitelisted 400，换源=重建；不依赖候选池）', async () => {
  vi.mocked(adminVideoWorkApi.listWorks).mockResolvedValue({ items: [{
    id: 'w1', title: '末班地铁', description: null, authorName: '作者甲', categoryId: null,
    videoKey: 'videos/old.mp4', videoMediaId: 'm9', coverKey: null, canvasProjectId: 'p1',
    durationSec: 10, width: 1920, height: 1080, viewCount: 1, likeCount: 2, tags: [],
    sortOrder: 0, status: 'DRAFT', allowViewProcess: false, allowClone: false,
    updatedAt: '2026-09-01T00:00:00Z',
  }], total: 1 } as any);
  vi.mocked(adminVideoWorkApi.updateWork).mockResolvedValue({ id: 'w1' } as any);
  renderWithProviders(<VideoWorksPage />);
  await waitFor(() => screen.getByText('末班地铁'));
  fireEvent.click(screen.getByText('编辑')); // <a> trigger（同文件 71 行先例：role=link 非 button）
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: '早班高铁' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(adminVideoWorkApi.updateWork).toHaveBeenCalledTimes(1)); // 修复前：门禁拦截、updateWork 不被调（红）
  const payload = vi.mocked(adminVideoWorkApi.updateWork).mock.calls[0][1] as Record<string, unknown>;
  expect(payload).not.toHaveProperty('videoKey');     // 修复前：v.videoMediaId 等进 payload → forbidNonWhitelisted 400
  expect(payload).not.toHaveProperty('videoMediaId');
  expect(payload.title).toBe('早班高铁');
});

it('uploadCover 上传失败（fetch 500）→ 弹错误不弹假成功、coverKey 未写（I-1：裸 fetch 缺 res.ok——错误信封 {code:-1,data:null} 走 body.data??body 返回信封，key undefined + 假成功 toast）', async () => {
  const actual = await vi.importActual<typeof import('@/api/adminApi')>('@/api/adminApi');
  vi.mocked(adminVideoWorkApi.uploadCover).mockImplementation(actual.adminVideoWorkApi.uploadCover); // 透传真实实现（本文件 vi.mock('@/api/adminApi') 全模块 auto-mock）
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ code: -1, data: null, message: '封面超限' }) })));
  const user = userEvent.setup();
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('button', { name: /新增/ }));
  const dialog = await screen.findByRole('dialog');
  // user-event v14 只拦截 pointer-events:none，不查 display——直接对隐藏 input 上传（SubscriptionBannerPage.test.tsx:38-41 先例）
  await user.upload(dialog.querySelector('input[type=file]') as HTMLInputElement, new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
  await waitFor(() => expect(screen.getByText('封面超限')).toBeInTheDocument()); // 错误提示（uploadCover throw err.message）
  expect(screen.queryByText('已上传，保存后生效')).not.toBeInTheDocument();      // 假成功不弹（修复前：信封被当成功值——红）
  expect(within(dialog).getByText('未上传')).toBeInTheDocument();                // coverKey 未写
  vi.mocked(adminVideoWorkApi.uploadCover).mockReset(); // mockImplementation 不被 clearAllMocks 清除，手动复位防泄漏
});

// —— 最终收尾审查（2026-09-16）I-1：候选下拉 previewUrl 过 /flowai 同源改写——生产 presign URL 是内网地址不可达、
// 缩略图必裂（批次 8 列表封面同因，videoWorkApi.ts:15-16 注释）；本地 127.0.0.1:9000 可直连故 dev 验收不暴露。
// 修复前 mapper 根本未透传 previewUrl（option.data 上恒 undefined、img 不渲染），双重缺陷一次修。
it('候选下拉缩略图：previewUrl 过 /flowai 改写（I-1：mapper 透传 + toFlowaiUrl，img src 不再是原始 presign host）', async () => {
  vi.mocked(adminVideoWorkApi.listCandidates).mockResolvedValue({ items: [{ id: 'm1', key: 'results/x.mp4', projectId: 'p1', canvasExists: true, thumbnailKey: null, durationSec: 10, width: 16, height: 9, createdAt: '2026-09-01', previewUrl: 'http://minio:9000/flowai/results/x.mp4' }], total: 1 } as any); // fixture 命中 toFlowaiUrl 正则 ^https?://[^/]+/flowai
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('button', { name: /新增/ }));
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => within(dialog).getByText(/候选视频/));
  fireEvent.mouseDown(within(dialog).getByText('从候选池选择')); // antd Select jsdom 开下拉（同文件 122 行先例）
  await screen.findByText('results/x.mp4'); // 下拉已展开（portal 到 body）
  const img = await waitFor(() => {
    const el = document.body.querySelector('.ant-select-dropdown img');
    expect(el).not.toBeNull(); // 修复前：mapper 未透传 previewUrl → img 根本不渲染（红）
    return el as HTMLImageElement;
  });
  expect(img.getAttribute('src')).toBe('/flowai/results/x.mp4'); // 修复后非原始 host（minio:9000）——同源路径
});

// —— 最终收尾审查（2026-09-16）I-2：候选下拉原固定 listCandidates(1)（api 侧 pageSize=20），候选池超 20 后 UI 不可达；
// API controller 有 Math.min(50,...) clamp（admin-video-work.controller.ts:31），上限取满 50。
it('候选下拉请求满额 pageSize：listCandidates(1, 50)（I-2：API clamp 上限 50，修复前固定 (1)→20）', async () => {
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('button', { name: /新增/ }));
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => within(dialog).getByText(/候选视频/));
  await waitFor(() => expect(adminVideoWorkApi.listCandidates).toHaveBeenCalledWith(1, 50)); // 修复前：listCandidates(1)（红）
});
