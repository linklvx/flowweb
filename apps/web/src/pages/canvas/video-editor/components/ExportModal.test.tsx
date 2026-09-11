// apps/web/src/pages/canvas/video-editor/components/ExportModal.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// mock：videoProjectApi.exportPrecheck / client（SaveTarget 三态族）/ capabilities / upload 与 product-node
// （后两者已在 Task 9 建成——mock 仅为组件测试隔离上传/上画布副作用，真实行为在 Task 9 自测）
// 批1-2：组件 message 改经 App.useApp()——antd context 默认值无 static 回退，裸渲染必须 stub
// （Popover/Select/Input/Progress/Button 经 ...orig 保真；四键齐全防未来通道撞 is not a function：
//   canceled 提示走 info、降级提示 info、回退警告 warning）
const { messageSuccess, messageError, messageWarning, messageInfo, confirmMock, runJob, pickTarget, pickOpfs, cleanupTarget, cleanupStale, uploadMock, createNodeMock } = vi.hoisted(() => ({
  messageSuccess: vi.fn(), messageError: vi.fn(), messageWarning: vi.fn(), messageInfo: vi.fn(), confirmMock: vi.fn(),
  runJob: vi.fn(), pickTarget: vi.fn(), pickOpfs: vi.fn(), cleanupTarget: vi.fn(), cleanupStale: vi.fn(),
  uploadMock: vi.fn(), createNodeMock: vi.fn(),
}));
vi.mock('antd', async (importOriginal) => {
  const orig = await importOriginal<typeof import('antd')>();
  return {
    ...orig,
    App: { ...orig.App, useApp: () => ({ message: { success: messageSuccess, error: messageError, warning: messageWarning, info: messageInfo }, modal: { confirm: confirmMock } }) },
  };
});
const precheckApi = vi.fn();
vi.mock('@/api/videoProjectApi', () => ({ exportPrecheck: (...a: unknown[]) => precheckApi(...a) }));
vi.mock('../export/upload', () => ({ uploadExportedProduct: (...a: unknown[]) => uploadMock(...a) }));
vi.mock('../export/product-node', () => ({ createProductNode: (...a: unknown[]) => createNodeMock(...a) }));
// Task 19 mock 工厂：pickSaveTarget 三态 / openOpfsTarget（画布路径）/ cleanupOpfsTarget + cleanupStaleOpfsExports（空实现）/ sessionOpfsKeys（空 Set）
vi.mock('../export/client', () => ({
  runExportJob: (...a: unknown[]) => runJob(...a),
  pickSaveTarget: (...a: unknown[]) => pickTarget(...a),
  openOpfsTarget: (...a: unknown[]) => pickOpfs(...a),
  cleanupOpfsTarget: (...a: unknown[]) => cleanupTarget(...a),
  cleanupStaleOpfsExports: (...a: unknown[]) => cleanupStale(...a),
  sessionOpfsKeys: new Set<string>(),
  ExportJobError: class extends Error { constructor(public category: string, m: string) { super(m); } },
}));
const detectCaps = vi.fn();
vi.mock('../capabilities', async (orig) => ({
  ...(await orig<typeof import('../capabilities')>()),
  detectExportCapabilities: () => detectCaps(),
}));

import { ExportPopover } from './ExportModal';
import { useEditorStore } from '../store/editorStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useVideoEditorStore } from '@/stores/videoEditorStore'; // R4-1：startExport 三 getter 真值守卫的上下文

const clip = (id: string, mediaId: string, duration: number) => ({
  id, trackId: 'tv', type: 'video' as const, start: 0, duration, sourceStart: 0, mediaId, playbackSpeed: 1 as const,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
});
// 句柄桩：getFile 返回非空 File（若组件误用句柄产物当回退源，R8-N5 用例以 0 字节 File 显式暴露）
const mkHandle = () => ({ name: 'export-test.mp4', getFile: vi.fn().mockResolvedValue(new File([new Uint8Array([1, 2, 3, 4])], 'export-test.mp4')) });

// 渲染约定（R10-1）：一律真实触发链打开——render(<ExportPopover />) + 点击 trigger（不加 defaultOpen 测试 seam）
const openPopover = async () => {
  render(<ExportPopover />);
  fireEvent.click(await screen.findByTestId('export-trigger'));
  await screen.findByTestId('export-config');
};
// caps 未落地时按钮天然禁用——必须等 detectExportCapabilities 落地后再点（防竞态假红）
const enableStart = async () => {
  const btn = await screen.findByTestId('export-start');
  await waitFor(() => expect(btn).not.toBeDisabled());
  return btn;
};
// antd Select 换档：mousedown 开下拉 → click 选项（rc-select option 点击即选中）
const chooseDestination = async (label: string) => {
  fireEvent.mouseDown(document.getElementById('timeline-export-destination')!);
  fireEvent.click(await screen.findByText(label));
};

beforeEach(() => {
  vi.clearAllMocks(); // 清调用计数保实现（旧 I-1 坑：beforeEach 不清则 not.toHaveBeenCalled 撞上前用例残留计数）
  precheckApi.mockResolvedValue({ ok: true });
  detectCaps.mockResolvedValue({ video: true, audio: true });
  pickTarget.mockResolvedValue({ kind: 'opfs', handle: mkHandle() }); // 默认 OPFS 中转（jsdom 无 FSA）
  pickOpfs.mockResolvedValue({ kind: 'opfs', handle: mkHandle() }); // 画布路径默认 OPFS
  uploadMock.mockResolvedValue({ mediaId: 'uuid-1' });
  runJob.mockImplementation((_p, cb) => {
    cb.onProgress('mix', 1);
    cb.onProgress('encode', 0.5);
    return { promise: Promise.resolve({ blob: new Blob(['x']), fsa: false }), cancel: vi.fn() };
  });
  useEditorStore.setState({
    status: 'ready',
    data: { version: 1, fps: 30, tracks: [{ id: 'tv', type: 'video', name: 'v', muted: false, hidden: false, clips: ['a'] }], clips: { a: clip('a', 'm1', 2) } },
    mediaInfo: { m1: { name: 'v', durationSec: 2, url: 'http://x' } },
    projectId: 'vp1', title: '多轨剪辑', // R4-1：startExport 守卫三 getter 的取值来源（缺这三处 → 静默 return → runJob 用例必红）
    pendingProduct: null,
  } as never);
  useCanvasStore.setState({ projectId: 'wf1' } as never);
  useVideoEditorStore.setState({ sourceNodeId: 'edit1' } as never);
});

describe('ExportPopover（导出弹层）', () => {
  it('目的地 Select：导出到画布（默认）/下载到本地', async () => {
    await openPopover();
    expect(screen.getByText('导出到画布')).toBeTruthy(); // 默认值画布（selector 显示选中 label）
    fireEvent.mouseDown(document.getElementById('timeline-export-destination')!);
    expect(await screen.findByText('下载到本地')).toBeTruthy(); // 下拉选项渲染
  });

  it('canceled → 不调 runExportJob 且提示「已取消导出，未开始编码」', async () => {
    pickTarget.mockResolvedValue({ kind: 'canceled' }); // 用户取消 FSA picker（AbortError 映射三态）
    await openPopover();
    await chooseDestination('下载到本地');
    const btn = await enableStart();
    fireEvent.click(btn);
    await waitFor(() => expect(messageInfo).toHaveBeenCalledWith('已取消导出，未开始编码')); // P1-E：取消即中止不白跑编码
    expect(runJob).not.toHaveBeenCalled();
    expect(screen.getByTestId('export-config')).toBeTruthy(); // 留在 config 可重试
  });

  it('导出中 Popover 不可外部关闭（open 受控 + onOpenChange 导出中拒绝）', async () => {
    let resolveJob!: (v: unknown) => void;
    runJob.mockImplementation(() => ({ promise: new Promise((r) => { resolveJob = r; }), cancel: vi.fn() }));
    await openPopover();
    const btn = await enableStart();
    fireEvent.click(btn);
    await waitFor(() => expect(runJob).toHaveBeenCalled());
    fireEvent.mouseDown(document.body); // 外部点击 → onOpenChange(false)——导出中被拒
    expect(screen.getByTestId('export-progress')).toBeTruthy(); // 弹层保持打开
    resolveJob({ blob: new Blob(['x']), fsa: false });
    await waitFor(() => expect(messageSuccess).toHaveBeenCalledWith('导出完成，已添加到画布'));
  });

  it('画布路径：不弹 FSA picker（直接 openOpfsTarget）→ 编码完成 getFile 上传 + 即时清理', async () => {
    const fileHandle = mkHandle();
    const target = { kind: 'opfs' as const, handle: fileHandle };
    pickOpfs.mockResolvedValue(target);
    runJob.mockImplementation(() => ({ promise: Promise.resolve({ blob: new Blob(['x']), fsa: true }), cancel: vi.fn() }));
    await openPopover();
    const btn = await enableStart();
    fireEvent.click(btn);
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    expect(pickTarget).not.toHaveBeenCalled(); // 画布路径不走 pickSaveTarget（无手势依赖）
    expect(runJob.mock.calls[0][2]).toBe(fileHandle); // 第三参 target.handle 直传 worker
    const input = uploadMock.mock.calls[0][0];
    expect(input.file.size).toBe(4); // r.fsa=true → getFile() 择源（非 blob）
    expect(input.width).toBeGreaterThan(0);
    expect(input.height).toBeGreaterThan(0); // R13①：尺寸随上传透传 register
    await waitFor(() => expect(cleanupTarget).toHaveBeenCalledWith(target)); // 上传完成即时清理中转
    expect(messageSuccess).toHaveBeenCalledWith('导出完成，已添加到画布');
    expect(screen.queryByTestId('export-config')).toBeNull(); // 成功后弹层收起
  });

  it('本地路径三分支：FSA 直写后不 a.click 不 createObjectURL；OPFS → a[download] 且 revoke 延迟 60s', async () => {
    // jsdom 无 URL.createObjectURL/revokeObjectURL 实现——直接赋桩（spyOn 对不存在属性不稳）
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    const urlBag = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
    const origCreate = urlBag.createObjectURL;
    const origRevoke = urlBag.revokeObjectURL;
    urlBag.createObjectURL = createObjectURL;
    urlBag.revokeObjectURL = revokeObjectURL;
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      // —— FSA：worker 直写所选位置，不得再 a.click/createObjectURL（双份文件防线）——
      pickTarget.mockResolvedValue({ kind: 'fsa', handle: mkHandle() });
      runJob.mockImplementation(() => ({ promise: Promise.resolve({ blob: new Blob(['x']), fsa: true }), cancel: vi.fn() }));
      await openPopover();
      await chooseDestination('下载到本地');
      let btn = await enableStart();
      fireEvent.click(btn);
      await waitFor(() => expect(messageSuccess).toHaveBeenCalledWith('导出完成，已保存到所选位置'));
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(anchorClick).not.toHaveBeenCalled();
      // —— OPFS：读回中转文件走 a[download]，revoke 延迟 60s（防下载流截断，spec 6.2）——
      pickTarget.mockResolvedValue({ kind: 'opfs', handle: mkHandle() });
      fireEvent.click(await screen.findByTestId('export-trigger')); // FSA 成功已收起——重开（destination 记忆保持 local）
      btn = await enableStart();
      fireEvent.click(btn);
      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
      expect(anchorClick).toHaveBeenCalledTimes(1);
      const anchor = anchorClick.mock.contexts[0] as HTMLAnchorElement;
      expect(anchor.download).toBe('多轨剪辑.mp4');
      const revokeCall = setTimeoutSpy.mock.calls.find((c) => c[1] === 60_000);
      expect(revokeCall).toBeTruthy();
      revokeCall![0](); // 手动到期——60s 延迟语义由 delay 参数钉住
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
      expect(cleanupTarget).not.toHaveBeenCalled(); // 本地 OPFS 不即时 removeEntry（a.click fire-and-forget，R6-B12）
    } finally {
      urlBag.createObjectURL = origCreate;
      urlBag.revokeObjectURL = origRevoke;
      setTimeoutSpy.mockRestore();
      anchorClick.mockRestore();
    }
  });

  it('上传成功建节点失败 → fail 态提示 + 重试按钮仅补建节点（不重复上传）', async () => {
    createNodeMock.mockImplementation(() => { throw new Error('剪辑节点不存在: edit1'); });
    await openPopover();
    const btn = await enableStart();
    fireEvent.click(btn);
    expect(await screen.findByText(/上次导出失败（unknown）/)).toBeTruthy(); // 建节点抛错 → fail 分辙
    expect(await screen.findByTestId('retry-product-node')).toBeTruthy(); // pendingProduct 落 store 后浮出重试
    expect(useEditorStore.getState().pendingProduct).toEqual({ mediaId: 'uuid-1', title: '多轨剪辑' });
    createNodeMock.mockClear(); uploadMock.mockClear(); runJob.mockClear();
    createNodeMock.mockImplementation(() => 'node-1'); // 第二次成功
    fireEvent.click(screen.getByTestId('retry-product-node'));
    await waitFor(() => expect(messageSuccess).toHaveBeenCalledWith('产物节点已补建'));
    expect(createNodeMock).toHaveBeenCalledTimes(1); // 重试只补建节点
    expect(uploadMock).not.toHaveBeenCalled(); // 不重复上传
    expect(runJob).not.toHaveBeenCalled(); // 不重跑编码
    expect(useEditorStore.getState().pendingProduct).toBeNull();
  });

  it('成功导出后 pendingProduct 清空', async () => {
    await openPopover();
    const btn = await enableStart();
    fireEvent.click(btn);
    await waitFor(() => expect(messageSuccess).toHaveBeenCalledWith('导出完成，已添加到画布'));
    expect(useEditorStore.getState().pendingProduct).toBeNull(); // publishProduct 末尾 clear
  });

  it('R8-N5 回退择源：worker 回退 Buffer（fsa:false）→ 上传 blob 而非 0 字节句柄文件 + warning 通道', async () => {
    const zeroFile = new File([], 'x.mp4'); // 若误用 handle.getFile() 产物则 size=0——显式暴露静默上传 0 字节
    pickOpfs.mockResolvedValue({ kind: 'opfs', handle: { name: 'export-zero.mp4', getFile: vi.fn().mockResolvedValue(zeroFile) } });
    runJob.mockImplementation(() => ({ promise: Promise.resolve({ blob: new Blob(['real-bytes']), fsa: false }), cancel: vi.fn() }));
    await openPopover();
    const btn = await enableStart();
    fireEvent.click(btn);
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    expect(uploadMock.mock.calls[0][0].file.size).toBeGreaterThan(0); // r.fsa=false → blob 择源（R8-N5）
    expect(messageWarning).toHaveBeenCalledWith(expect.stringContaining('内存')); // R15②：回退 warning 通道测试钉
  });

  it('R8-N7 OPFS 打开失败 → fail 态提示而非 unhandled rejection；phase 回 config 弹层仍可交互', async () => {
    pickOpfs.mockRejectedValue(new Error('getDirectory 被拒绝（Firefox 无痕）'));
    await openPopover();
    const btn = await enableStart();
    fireEvent.click(btn);
    expect(await screen.findByText(/上次导出失败（unknown）/)).toBeTruthy(); // 前置段异常进 fail 分辙
    expect(screen.getByTestId('export-config')).toBeTruthy(); // phase 回 config，弹层仍可交互
    expect(runJob).not.toHaveBeenCalled();
  });
});

// —— 既有 ExportModal 7 用例语义迁移（R10-1 渲染约定 / R9-6 按钮查询 / R13② 大写档位文案）——
describe('ExportPopover 既有语义迁移（原 ExportModal 7 用例）', () => {
  it('渲染选档（720P/1080P）+ 体积估算 + 校验通过态', async () => {
    await openPopover();
    expect(await screen.findByText(/720P/)).toBeTruthy(); // R13②：Select 大写文案（旧 Radio 720p → 720P）
    expect(screen.getByText(/预计体积/)).toBeTruthy(); // 提示行保留（尾段按目的地分派见组件）
    // R4-10：caps 未落地时按钮天然禁用——必须等 detectExportCapabilities 落地后断言（waitFor 防竞态）
    await waitFor(() => expect(screen.getByTestId('export-start')).not.toBeDisabled());
  });

  it('素材缺失（mediaInfo 无该 mediaId）→ 确认禁用 + 缺失提示', async () => {
    useEditorStore.setState({ mediaInfo: {} } as never);
    await openPopover();
    // R8-1：实现文案是"素材 m1 缺失或未加载（…）"——/素材缺失/ 要求两词相邻永不匹配（findByText 超时红，R1 起漏网）
    expect(await screen.findByText(/缺失或未加载/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('export-start')).toBeDisabled()); // R8-1②：caps 未落地时按钮天然禁用——包 waitFor 防假绿
  });

  it('配额预检失败（exportPrecheck reject）→ 禁用 + 配额提示', async () => {
    precheckApi.mockRejectedValue(new Error('存储配额不足'));
    await openPopover();
    await waitFor(() => expect(screen.getByText(/存储配额/)).toBeTruthy());
    expect(screen.getByTestId('export-start')).toBeDisabled();
  });

  it('开始导出：调 runExportJob（params 含 data/resolution/mediaUrls）并展示两段进度', async () => {
    await openPopover();
    const btn = await enableStart();
    fireEvent.click(btn);
    await waitFor(() => expect(runJob).toHaveBeenCalledTimes(1));
    const params = runJob.mock.calls[0][0];
    expect(params.resolution).toBe('720p'); // 默认档
    expect(params.mediaUrls).toEqual({ m1: 'http://x' });
    expect(await screen.findByTestId('export-progress')).toBeTruthy();
  });

  it('I-1 防重入：openOpfsTarget await 窗口内双击确认 → runExportJob 仅一次（否则双 Worker 双上传双配额）', async () => {
    await openPopover();
    const btn = await enableStart();
    fireEvent.click(btn);
    fireEvent.click(btn); // 第二击落在第一次 await openOpfsTarget 的让出窗口内（phase 仍是 config）
    await new Promise((r) => setTimeout(r, 0)); // 冲刷两次 startExport 的全部微任务再断言
    expect(runJob).toHaveBeenCalledTimes(1);
  });

  it('I-2 beforeunload 模块级守卫：导出中 Popover 卸载守卫仍在；导出结束（finally）后拆除', async () => {
    let resolveJob!: (v: unknown) => void;
    runJob.mockImplementation(() => ({ promise: new Promise((r) => { resolveJob = r; }), cancel: vi.fn() }));
    const { unmount } = render(<ExportPopover />);
    fireEvent.click(await screen.findByTestId('export-trigger'));
    const btn = await enableStart();
    fireEvent.click(btn);
    await waitFor(() => expect(runJob).toHaveBeenCalled());
    unmount(); // 模拟收起编辑器 → Shell return null → Popover 卸载
    const during = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true); // 收起后关页仍被拦（R2-N12 后台完成语义）
    resolveJob({ blob: new Blob(['x']), fsa: false });
    await new Promise((r) => setTimeout(r, 0)); // 走完 finally（upload mock resolve → setOpen(false) → disarm）
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('编码器不支持（detectExportCapabilities video=false）→ 拦截提示', async () => {
    detectCaps.mockResolvedValue({ video: false, audio: true });
    await openPopover();
    expect(await screen.findByText(/不支持 H.264/)).toBeTruthy();
    expect(screen.getByTestId('export-start')).toBeDisabled();
  });
});

