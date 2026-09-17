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
  await waitFor(() => expect(screen.getByRole('switch', { name: /允许克隆/ }) as HTMLButtonElement).toBeEnabled()); // 包 waitFor：enabled 依赖 canvasCheck resolve 后 canvasVerified 落定（beforeEach 默认值已供 resolve）
  const viewSwitch = screen.getByRole('switch', { name: /允许查看创作过程|查看制作过程/ });
  expect(viewSwitch).toBeChecked(); // 前置：fixture allowViewProcess=true → 初始开（防 click 打在禁用开关上 no-op、后续 toBeDisabled 沦为假绿）
  fireEvent.click(viewSwitch); // 关闭
  await waitFor(() => expect(screen.getByRole('switch', { name: /允许克隆/ }) as HTMLButtonElement).toBeDisabled()); // 联动禁用同样包 waitFor（禁用依赖 setFieldsValue 重渲染）
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

const mockWorkRow = (over: Record<string, unknown> = {}) => ({
  id: 'w1', title: '末班地铁', description: null, authorName: '作者甲', categoryId: null,
  videoKey: 'videos/old.mp4', videoMediaId: 'm9', coverKey: null, coverUrl: null, canvasProjectId: 'p1',
  durationSec: 10, width: 1920, height: 1080, viewCount: 1, likeCount: 2, tags: [],
  sortOrder: 0, status: 'DRAFT', allowViewProcess: false, allowClone: false,
  updatedAt: '2026-09-01T00:00:00Z', ...over,
});

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
  const coverFile = vi.mocked(adminVideoWorkApi.uploadCover).mock.calls[0][0] as File; // Task 10 审查 M-3：收窄文件名/type——服务端 ext 推导依赖文件名
  expect(coverFile.name).toBe('cover.jpg');
  expect(coverFile.type).toBe('image/jpeg');
  await waitFor(() => expect(adminVideoWorkApi.createWork).toHaveBeenCalledWith(expect.objectContaining({ coverKey: 'uploads/system/frame.jpg' })));
});

it('edit：只读信息条（时长/分辨率/封面缩略图）且无上传控件；改标题保存 payload 无 videoKey/videoMediaId、未动画布则 payload 省略 canvasProjectId（后端不动已存值）', async () => {
  vi.mocked(adminVideoWorkApi.listWorks).mockResolvedValue({ items: [mockWorkRow({ coverUrl: 'http://127.0.0.1:9000/flowai/uploads/system/c.jpg?X-Amz-Signature=s' })], total: 1 } as any);
  vi.mocked(adminVideoWorkApi.updateWork).mockResolvedValue({ id: 'w1' } as any);
  vi.mocked(adminVideoWorkApi.canvasCheck).mockResolvedValue({ id: 'p1', name: '源画布', ownerName: '张三', updatedAt: '2026-09-01' } as any);
  renderWithProviders(<VideoWorksPage />);
  await waitFor(() => screen.getByText('末班地铁'));
  expect(adminVideoWorkApi.canvasCheck).not.toHaveBeenCalled(); // 初始校验挂 onOpenChange——WorkFormModal 是每行一个的常驻 trigger 宿主组件（弹层内容才 destroyOnClose），useEffect([]) 会在列表渲染时就打 N 个请求
  fireEvent.click(screen.getByText('编辑'));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/当前视频：10s \/ 1920×1080/)).toBeInTheDocument();  // 只读信息条
  expect(within(dialog).getByLabelText('源画布（可选）')).toHaveValue('p1');          // initialValues 确实播种到字段——门禁"文本===初值"判据的前提钉死（initialValues 没落字段这里立刻红）
  expect(within(dialog).queryByRole('button', { name: /选择 MP4 文件/ })).not.toBeInTheDocument(); // edit 无上传控件
  await waitFor(() => expect(within(dialog).getByText(/画布：源画布（作者 张三）/)).toBeInTheDocument()); // 打开即初始校验回显
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: '早班高铁' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(adminVideoWorkApi.updateWork).toHaveBeenCalledTimes(1));
  const payload = vi.mocked(adminVideoWorkApi.updateWork).mock.calls[0][1] as Record<string, unknown>;
  expect(payload).not.toHaveProperty('videoKey');
  expect(payload).not.toHaveProperty('videoMediaId');
  expect(payload.title).toBe('早班高铁');
  expect(payload).not.toHaveProperty('canvasProjectId'); // 未动画布 → 省略（后端 dto-only：undefined 不动已存值）
});

it('edit + 死画布（canvasCheck 404）+ 未动画布文本 → 可保存且存量开关不被静默关（第十一轮②：预填校验失败 resetSwitches=false——开关 true 与黄字"保留原关联"一致，后端 flags 用 merged 已存 canvasProjectId 非空不 400）', async () => {
  // fixture 故意 true/true（画布删除前建的合法存量）——断言"预填 404 不落 false"必须开关初值真，false 初值验不出"被改"
  vi.mocked(adminVideoWorkApi.listWorks).mockResolvedValue({ items: [mockWorkRow({ canvasProjectId: 'p-dead', allowViewProcess: true, allowClone: true })], total: 1 } as any);
  vi.mocked(adminVideoWorkApi.updateWork).mockResolvedValue({ id: 'w1' } as any);
  vi.mocked(adminVideoWorkApi.canvasCheck).mockRejectedValue(new Error('画布不存在') as any);
  renderWithProviders(<VideoWorksPage />);
  await waitFor(() => screen.getByText('末班地铁'));
  fireEvent.click(screen.getByText('编辑'));
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(within(dialog).getByText('源画布已删除，保存将保留原关联')).toBeInTheDocument()); // 黄字警告非红字硬拦
  const viewSwitch = within(dialog).getByRole('switch', { name: /允许查看创作过程|查看制作过程/ });
  await waitFor(() => expect(viewSwitch).toBeDisabled()); // verified=null → 禁用
  expect(viewSwitch).toBeChecked(); // 第十一轮②：预填 404 不落 false——存量 true 保持（落 false 则此断言红、黄字在骗人）
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: 'x' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(adminVideoWorkApi.updateWork).toHaveBeenCalledTimes(1)); // 未动文本 → 放行
  const payload = vi.mocked(adminVideoWorkApi.updateWork).mock.calls[0][1] as Record<string, unknown>;
  expect(payload).not.toHaveProperty('canvasProjectId'); // 省略——后端不动已存值，不触发画布校验
  expect(payload.allowViewProcess).toBe(true); // 开关原样进 payload——未被预填校验静默改（改动即红）
});

it('画布状态机：粘贴 URL → blur 校验回显 → payload 带解析后 ID（C-1 家族回归：注册字段 onFinish 现算）', async () => {
  vi.mocked(adminVideoWorkApi.createWork).mockResolvedValue({ id: 'w9' } as any);
  vi.mocked(adminVideoWorkApi.canvasCheck).mockResolvedValue({ id: 'cparsed', name: '我的画布', ownerName: null, updatedAt: '2026-09-01' } as any);
  const dialog = await openCreateAndUpload(); // Task 10 定义的 helper
  const canvasInput = within(dialog).getByLabelText('源画布（可选）');
  fireEvent.change(canvasInput, { target: { value: 'http://localhost:5173/canvas?projectId=cparsed' } });
  fireEvent.blur(canvasInput);
  await waitFor(() => expect(within(dialog).getByText('画布：我的画布（团队画布）')).toBeInTheDocument()); // ownerName null → 团队画布
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: 't' } });
  fireEvent.change(within(dialog).getByLabelText('作者名'), { target: { value: 'a' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(adminVideoWorkApi.createWork).toHaveBeenCalledWith(expect.objectContaining({ canvasProjectId: 'cparsed' })));
});

it('画布状态机：校验通过后改动文本 → 提交阻止"画布已修改，请重新校验"+两开关回禁用（值不动——第十轮收窄：churn 不落 false，B2 防线由门禁承担；B3）', async () => {
  vi.mocked(adminVideoWorkApi.canvasCheck).mockResolvedValue({ id: 'p1', name: 'n', ownerName: 'o', updatedAt: '2026-09-01' } as any);
  const dialog = await openCreateAndUpload();
  const canvasInput = within(dialog).getByLabelText('源画布（可选）');
  fireEvent.change(canvasInput, { target: { value: 'p1' } });
  fireEvent.blur(canvasInput);
  await waitFor(() => expect(within(dialog).getByText(/画布：n/)).toBeInTheDocument());
  const viewSwitch = within(dialog).getByRole('switch', { name: /允许查看创作过程|查看制作过程/ });
  await waitFor(() => expect(viewSwitch).toBeEnabled()); // 包 waitFor：enabled 依赖 canvasCheck resolve 后的 setState
  fireEvent.click(viewSwitch); // 开（create 初值 false）——为 B2 断言铺状态
  expect(viewSwitch).toBeChecked();
  fireEvent.change(canvasInput, { target: { value: 'p1-changed' } }); // 校验后改动 → verified 失效
  await waitFor(() => expect(viewSwitch).toBeDisabled()); // 开关回禁用
  expect(viewSwitch).toBeChecked(); // 第十轮收窄：文本 churn **不动开关值**（edit 场景敲错字又改回原文若落 false 会静默关掉存量开关）——本路径的 400 防线由门禁拦截承担（下方 createWork not called）；落 false 只发生在 checkCanvas 空文本/catch 分支（见清空用例）
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: 't' } });
  fireEvent.change(within(dialog).getByLabelText('作者名'), { target: { value: 'a' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(screen.getByText('画布已修改，请重新校验')).toBeInTheDocument());
  expect(adminVideoWorkApi.createWork).not.toHaveBeenCalled();
});

it('画布状态机：校验通过→开开关→清空文本 blur → 开关值落 false（B2 收窄落点：清空=放弃画布，防 true 残留撞 400）+ 提交成功（create 清空回初值 → untouched → payload 省略 canvasProjectId）', async () => {
  vi.mocked(adminVideoWorkApi.canvasCheck).mockResolvedValue({ id: 'p1', name: 'n', ownerName: 'o', updatedAt: '2026-09-01' } as any);
  vi.mocked(adminVideoWorkApi.createWork).mockResolvedValue({ id: 'w9' } as any);
  const dialog = await openCreateAndUpload();
  const canvasInput = within(dialog).getByLabelText('源画布（可选）');
  fireEvent.change(canvasInput, { target: { value: 'p1' } });
  fireEvent.blur(canvasInput);
  const viewSwitch = within(dialog).getByRole('switch', { name: /允许查看创作过程|查看制作过程/ });
  await waitFor(() => expect(viewSwitch).toBeEnabled());
  fireEvent.click(viewSwitch); // 开
  expect(viewSwitch).toBeChecked();
  fireEvent.change(canvasInput, { target: { value: '' } }); // 清空
  fireEvent.blur(canvasInput); // 真实浏览器点确定前输入框必先 blur（jsdom fireEvent.click 不自动 blur——显式化）
  await waitFor(() => expect(viewSwitch).toBeDisabled());
  expect(viewSwitch).not.toBeChecked(); // checkCanvas 空文本分支落 false——canvasProjectId 省略落 null 后 allowViewProcess:true 必撞 assertProcessFlags 400
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: 't' } });
  fireEvent.change(within(dialog).getByLabelText('作者名'), { target: { value: 'a' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(adminVideoWorkApi.createWork).toHaveBeenCalledTimes(1));
  const payload = vi.mocked(adminVideoWorkApi.createWork).mock.calls[0][0] as Record<string, unknown>;
  expect(payload.allowViewProcess).toBe(false);
  expect(payload).not.toHaveProperty('canvasProjectId'); // '' === create 初值 '' → untouched → 省略（后端落 null）
});

it('画布状态机：校验通过→改出去→改回原值（未 blur）→ 等价放行不弹"已修改"（第十轮 C1：verifiedRef.id 与当前解析一致即视同已验证——否则文本与已验证值相同的提交也遭拦）', async () => {
  vi.mocked(adminVideoWorkApi.canvasCheck).mockResolvedValue({ id: 'p1', name: 'n', ownerName: 'o', updatedAt: '2026-09-01' } as any);
  vi.mocked(adminVideoWorkApi.createWork).mockResolvedValue({ id: 'w9' } as any);
  const dialog = await openCreateAndUpload();
  const canvasInput = within(dialog).getByLabelText('源画布（可选）');
  fireEvent.change(canvasInput, { target: { value: 'p1' } });
  fireEvent.blur(canvasInput);
  await waitFor(() => expect(within(dialog).getByText(/画布：n/)).toBeInTheDocument());
  fireEvent.change(canvasInput, { target: { value: 'x' } });  // 改出去
  fireEvent.change(canvasInput, { target: { value: 'p1' } }); // 改回原值（未 blur——canvasVerified 已清、verifiedRef 仍在）
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: 't' } });
  fireEvent.change(within(dialog).getByLabelText('作者名'), { target: { value: 'a' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(adminVideoWorkApi.createWork).toHaveBeenCalledWith(expect.objectContaining({ canvasProjectId: 'p1' }))); // 等价放行——修复前弹"画布已修改，请重新校验"、createWork 不被调
});

it('画布 404 → 红字"画布不存在"；未校验通过（乱码未 blur）提交 → 阻止', async () => {
  vi.mocked(adminVideoWorkApi.canvasCheck).mockRejectedValue(new Error('画布不存在') as any);
  const dialog = await openCreateAndUpload();
  const canvasInput = within(dialog).getByLabelText('源画布（可选）');
  fireEvent.change(canvasInput, { target: { value: 'garbage' } });
  fireEvent.blur(canvasInput);
  await waitFor(() => expect(within(dialog).getByText('画布不存在')).toBeInTheDocument());
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: 't' } });
  fireEvent.change(within(dialog).getByLabelText('作者名'), { target: { value: 'a' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(adminVideoWorkApi.createWork).not.toHaveBeenCalled());
});

it('afterClose 画布状态重置：校验通过→取消→重开，绿字消失+两开关禁用（第九轮必修2：canvasVerified 不重置则重开"假画布"——resetFields 已清字段、verified 却残留 → 两开关可点 → 提交 payload 无 canvasProjectId 撞 assertProcessFlags 400，绿字在骗人）', async () => {
  vi.mocked(adminVideoWorkApi.canvasCheck).mockResolvedValue({ id: 'p1', name: '源画布', ownerName: '张三', updatedAt: '2026-09-01' } as any);
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('button', { name: /新增/ }));
  const dialog = await screen.findByRole('dialog');
  const canvasInput = within(dialog).getByLabelText('源画布（可选）');
  fireEvent.change(canvasInput, { target: { value: 'p1' } });
  fireEvent.blur(canvasInput);
  await waitFor(() => expect(within(dialog).getByText(/画布：源画布/)).toBeInTheDocument()); // 先证存在（防 not 断言空转）
  fireEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
  fireEvent.click(screen.getByRole('button', { name: /新增/ }));
  await screen.findByRole('dialog');
  await waitFor(() => expect(screen.queryByText(/画布：源画布/)).not.toBeInTheDocument()); // 绿字不残留
  await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('switch', { name: /允许查看创作过程|查看制作过程/ })).toBeDisabled()); // verified 已清——修复前此断言红（残留 verified → enabled）
});
