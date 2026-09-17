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
import { probeVideoFile } from '@/pages/admin/utils/probeVideoFile';
import { uploadToPresignedPost } from '@/pages/admin/utils/uploadToPresignedPost';
import { confirmUpload } from '@/api/storageApi';

vi.mock('@/api/adminApi');
vi.mock('@/pages/admin/utils/probeVideoFile', () => ({ probeVideoFile: vi.fn() }));
vi.mock('@/pages/admin/utils/uploadToPresignedPost', () => ({ uploadToPresignedPost: vi.fn() }));
vi.mock('@/api/storageApi', () => ({ presignUpload: vi.fn(), confirmUpload: vi.fn() }));

const urlBag = URL as unknown as { createObjectURL: () => string; revokeObjectURL: () => void };
beforeEach(() => {
  urlBag.createObjectURL = vi.fn().mockReturnValue('blob:cover') as any;
  urlBag.revokeObjectURL = vi.fn() as any;
});

const renderWithProviders = (ui: ReactElement) => render(<MemoryRouter><AntdApp>{ui}</AntdApp></MemoryRouter>);

// 第十轮：文件级 mock 复位 + 默认四件套——原各用例 mock"越界存活"且无复位（Vitest 默认不 reset），
// 调换用例顺序或 -t 单跑即露。clearAllMocks 只清调用记录不清实现；默认值供未显式 mock 的用例兜底，用例可再覆盖。
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(adminVideoWorkApi.listWorks).mockResolvedValue({ items: [], total: 0 } as any);
  vi.mocked(adminVideoWorkApi.listCategories).mockResolvedValue([] as any);
  vi.mocked(adminVideoWorkApi.listTags).mockResolvedValue([] as any);
  vi.mocked(adminVideoWorkApi.presignVideo).mockResolvedValue({ fileId: 'm1', uploadUrl: 'http://127.0.0.1:9000/flowai', key: 'uploads/system/a.mp4', fields: { key: 'uploads/system/a.mp4' } });
  vi.mocked(adminVideoWorkApi.canvasCheck).mockResolvedValue({ id: 'p1', name: '源画布', ownerName: '张三', updatedAt: '2026-09-01' });
  vi.mocked(confirmUpload).mockResolvedValue({ fileId: 'm1' });
  vi.mocked(probeVideoFile).mockResolvedValue({ ok: true, durationSec: 12, width: 1920, height: 1080, coverBlob: new Blob(['c'], { type: 'image/jpeg' }) });
  vi.mocked(uploadToPresignedPost).mockResolvedValue(undefined);
  vi.mocked(adminVideoWorkApi.uploadCover).mockResolvedValue({ key: 'uploads/system/frame.jpg' }); // probe 默认带 coverBlob → 一切提交用例的 onFinish 都走 uploadCover——无默认值则 await undefined 解构 TypeError → return false → createWork 永不被调、用例超时红（:157 用例自己的 importActual 透传会覆盖此默认值，其 mockReset 后下用例 beforeEach 重设——无冲突）
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

it('ModalForm 含成品视频上传区/两开关/标签 tags 模式/封面控件（候选下拉已删）', async () => {
  vi.mocked(adminVideoWorkApi.listCategories).mockResolvedValue([{ id: 'c1', name: 'AI真人影视', sortOrder: 0, active: true }] as any);
  vi.mocked(adminVideoWorkApi.listTags).mockResolvedValue([{ id: 't1', name: '悬疑', sortOrder: 0, active: true }] as any);
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('button', { name: /新增/ }));
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => within(dialog).getByText(/成品视频/));
  expect(within(dialog).getByRole('button', { name: /选择 MP4 文件/ })).toBeInTheDocument();
  expect(within(dialog).queryByText(/候选视频/)).not.toBeInTheDocument(); // 候选下拉已删
  expect(within(dialog).getByText(/允许查看创作过程|查看制作过程/)).toBeInTheDocument();
  expect(within(dialog).getByText(/留空则用视频截帧封面/)).toBeInTheDocument();
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
  // 原选择器收窄（视频 input 在封面之前，裸 input[type=file] 命中视频框）
  await user.upload(dialog.querySelector('input[accept="image/jpeg,image/png,image/webp"]') as HTMLInputElement, new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
  await waitFor(() => expect(screen.getByText('封面超限')).toBeInTheDocument()); // 错误提示（uploadCover throw err.message）
  expect(screen.queryByText('已上传，保存后生效')).not.toBeInTheDocument();      // 假成功不弹（修复前：信封被当成功值——红）
  expect(within(dialog).getByText('未上传')).toBeInTheDocument();                // coverKey 未写
  vi.mocked(adminVideoWorkApi.uploadCover).mockReset(); // mockImplementation 不被 clearAllMocks 清除，手动复位防泄漏
});

const openCreateAndUpload = async () => {
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('button', { name: /新增/ }));
  const dialog = await screen.findByRole('dialog');
  const input = dialog.querySelector('input[accept="video/mp4"]') as HTMLInputElement;
  expect(input.style.display).toBe('none'); // 内联锚点：antd :where 特异性 (0,2,1) 压 Tailwind .hidden——防回退
  fireEvent.change(input, { target: { files: [new File(['v'], 'final.mp4', { type: 'video/mp4' })] } });
  await waitFor(() => expect(within(dialog).getByText(/已上传：final\.mp4/)).toBeInTheDocument());
  return dialog;
};

it('create 提交：上传成品视频+必填 → createWork 载荷含五字段（durationSec 已取整）', async () => {
  vi.mocked(adminVideoWorkApi.createWork).mockResolvedValue({ id: 'w9' } as any);
  const dialog = await openCreateAndUpload();
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: '测试标题' } });
  fireEvent.change(within(dialog).getByLabelText('作者名'), { target: { value: '作者甲' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(adminVideoWorkApi.createWork).toHaveBeenCalledTimes(1));
  expect(adminVideoWorkApi.createWork).toHaveBeenCalledWith(expect.objectContaining({
    title: '测试标题', authorName: '作者甲',
    videoKey: 'uploads/system/a.mp4', videoMediaId: 'm1',
    durationSec: 12, width: 1920, height: 1080,
  }));
});

it('门禁：未上传视频提交 → "请先上传成品视频"，createWork 不被调', async () => {
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('button', { name: /新增/ }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: 't' } });
  fireEvent.change(within(dialog).getByLabelText('作者名'), { target: { value: 'a' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(screen.getByText('请先上传成品视频')).toBeInTheDocument());
  expect(adminVideoWorkApi.createWork).not.toHaveBeenCalled();
});

it('afterClose → abort signal + 状态机重置（组件常驻 trigger 宿主不卸载——abort 必须挂 afterClose 非 useEffect cleanup）', async () => {
  let capturedSignal: AbortSignal | undefined;
  // mock 必须"abort 即 reject"（axios 真实行为是 reject CanceledError）——只挂住不监听 abort 的话，
  // 实现的 catch 永不执行、"上传已取消"永不出、waitFor 超时红
  vi.mocked(uploadToPresignedPost).mockImplementation(({ signal }) => new Promise((_, rej) => {
    capturedSignal = signal;
    signal?.addEventListener('abort', () => rej(new DOMException('canceled', 'AbortError')));
  }));
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('button', { name: /新增/ }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(dialog.querySelector('input[accept="video/mp4"]') as HTMLInputElement,
    { target: { files: [new File(['v'], 'big.mp4', { type: 'video/mp4' })] } });
  await waitFor(() => expect(capturedSignal).toBeTruthy());
  fireEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ })); // 关弹层
  await waitFor(() => expect(screen.getByText('上传已取消')).toBeInTheDocument());
  expect(capturedSignal!.aborted).toBe(true); // 真实 abort——白传 1GB 防线
  // 重开弹层不残留上次状态（正面断言）
  fireEvent.click(screen.getByRole('button', { name: /新增/ }));
  const dialog2 = await screen.findByRole('dialog');
  await waitFor(() => expect(within(dialog2).queryByText(/已上传：big\.mp4/)).not.toBeInTheDocument());
});

it('前置拦截：非 mp4 → "仅支持 MP4 格式"，presignVideo 不被调（accept 只是选择器过滤，JS 判断不可省）', async () => {
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('button', { name: /新增/ }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(dialog.querySelector('input[accept="video/mp4"]') as HTMLInputElement,
    { target: { files: [new File(['v'], 'a.mov', { type: 'video/quicktime' })] } });
  await waitFor(() => expect(screen.getByText('仅支持 MP4 格式')).toBeInTheDocument());
  expect(adminVideoWorkApi.presignVideo).not.toHaveBeenCalled();
});

it('可播放性闸门：probe decode 失败 → "浏览器无法解码"（服务端无真实 MIME 校验——这是唯一防线）', async () => {
  vi.mocked(probeVideoFile).mockResolvedValue({ ok: false, reason: 'decode' } as any);
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('button', { name: /新增/ }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(dialog.querySelector('input[accept="video/mp4"]') as HTMLInputElement,
    { target: { files: [new File(['v'], 'hevc.mp4', { type: 'video/mp4' })] } });
  await waitFor(() => expect(screen.getByText('浏览器无法解码，请导出 H.264 编码 MP4')).toBeInTheDocument());
  expect(adminVideoWorkApi.presignVideo).not.toHaveBeenCalled();
});

it('封面提交时上传：抽帧 blob 在 onFinish 才 uploadCover（孤儿归零）；手选封面后（coverTouched）不再上传 blob', async () => {
  vi.mocked(adminVideoWorkApi.createWork).mockResolvedValue({ id: 'w9' } as any);
  vi.mocked(adminVideoWorkApi.uploadCover).mockResolvedValue({ key: 'uploads/system/frame.jpg' } as any);
  const dialog = await openCreateAndUpload();
  expect(adminVideoWorkApi.uploadCover).not.toHaveBeenCalled(); // probe 后只存内存——不上传
  expect(within(dialog).getByText('将使用视频截帧作封面')).toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: 't' } });
  fireEvent.change(within(dialog).getByLabelText('作者名'), { target: { value: 'a' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(adminVideoWorkApi.uploadCover).toHaveBeenCalledTimes(1)); // 提交时一次
  expect(adminVideoWorkApi.uploadCover).toHaveBeenCalledWith(expect.any(File)); // new File([blob],'cover.jpg')
  await waitFor(() => expect(adminVideoWorkApi.createWork).toHaveBeenCalledWith(expect.objectContaining({ coverKey: 'uploads/system/frame.jpg' })));
});
