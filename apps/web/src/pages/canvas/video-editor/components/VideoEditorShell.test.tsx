import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { VideoEditorShell } from './VideoEditorShell';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { isGroupEditContext } from '@/hooks/useGroupKeyboard';
import { upsertProject, patchProject } from '@/api/videoProjectApi';
import { createDefaultProjectData } from '../types';
import { useEditorStore } from '../store/editorStore';
import { LAST_ASPECT_KEY } from '../timeline/canvas-size';

vi.mock('@/api/videoProjectApi', () => ({
  upsertProject: vi.fn(),
  patchProject: vi.fn(),
  getProjectByNode: vi.fn().mockResolvedValue(null),
  deleteProjectByNode: vi.fn(),
}));

describe('VideoEditorShell', () => {
  beforeEach(() => {
    useVideoEditorStore.setState({ open: false, sourceNodeId: null, closedAt: 0 });
    useEditorStore.getState().reset();
    // Shell 接线后 open 即触发 upsertProject → loadProject；mock 全量 DTO（data 用真实默认工程形状）
    vi.mocked(upsertProject).mockResolvedValue({
      id: 'p1', sourceNodeId: 'n1', workflowId: 'w', teamId: 'team1', title: 't',
      data: createDefaultProjectData(), updatedAt: 't0',
    });
  });
  it('open=false 不渲染；open 后渲染全屏壳与占位区', async () => {
    const { rerender } = render(<VideoEditorShell />);
    expect(screen.queryByTestId('video-editor-shell')).not.toBeInTheDocument();
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    rerender(<VideoEditorShell />);
    expect(screen.getByTestId('video-editor-shell')).toBeInTheDocument();
    expect(screen.getByTestId('preview-canvas')).toBeInTheDocument(); // PreviewPlayer 替换 PreviewPlaceholder（Task 8）
    // 入口时序（Task 14）：面板先 loading 禁编辑，loadProject resolve 后才就绪为 timeline-panel
    await waitFor(() => expect(screen.getByTestId('timeline-panel')).toBeInTheDocument());
  });
  it('点遮罩不关闭（closeOnBackdrop=false 透传）', () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    // 层级：遮罩 > role=dialog > video-editor-shell
    fireEvent.click(screen.getByTestId('video-editor-shell').parentElement!.parentElement!);
    expect(useVideoEditorStore.getState().open).toBe(true);
  });
  it('收起按钮 → close（经 handleClose：flush 排空后异步关，M1 检查点）', async () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    fireEvent.click(screen.getByText('收起'));
    await waitFor(() => expect(useVideoEditorStore.getState().open).toBe(false));
  });
  it('编辑器 open 时 isGroupEditContext 恒 true（画布快捷键早退，spec 验收 27）', () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    expect(isGroupEditContext(document.body)).toBe(true);
    useVideoEditorStore.setState({ open: false });
    expect(isGroupEditContext(document.body)).toBe(false);
  });
  it('编辑器打开期间 Delete 通路隔离——根 div 带 nokey 且焦点移入壳内（C1 回归锁）', async () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    const shell = screen.getByTestId('video-editor-shell');
    expect(shell.className).toContain('nokey');
    // 焦点断言：open 后焦点应落在壳内（initialFocusRef 生效），而非残留画布按钮
    await waitFor(() => expect(shell).toContainElement(document.activeElement as HTMLElement | null));
  });
  it('P0-A 回归：壳内 antd 弹层挂载容器归属壳节点（删 Shell 的 ConfigProvider 后此用例必红）', async () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    await waitFor(() => expect(screen.getByTestId('timeline-panel')).toBeInTheDocument()); // 就绪（upsert → loadProject）
    fireEvent.click(screen.getByText('导出')); // 打开导出弹层（Task 19 起为 ExportPopover——批 1 壳内归属语义不变）
    await waitFor(() => {
      const wrap = document.querySelector('.ant-popover');
      expect(wrap).toBeTruthy();
      // 容器归属断言（真红点）：Popover 弹层挂进壳内而非 body 直挂——
      // 无 ConfigProvider(getPopupContainer) 时 wrap.closest(壳) === null，用例红
      expect((wrap as HTMLElement).closest('[data-testid="video-editor-shell"]')).not.toBeNull();
    });
  });
  it('布局为可调面板组：垂直(主区/时间轴) + 水平(素材/预览/属性) 各两级', async () => {
    // 复用 P0-A 渲染等待方式（upsert → loadProject 就绪）
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    await waitFor(() => expect(screen.getByTestId('timeline-panel')).toBeInTheDocument());
    // v2 DOM 属性 data-panel-group-id/data-panel-id（组 id ve-vertical/ve-horizontal 由实现写入）
    expect(document.querySelectorAll('[data-panel-group-id]').length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('[data-panel-group-id="ve-vertical"]')).not.toBeNull();
    expect(document.querySelector('[data-panel-group-id="ve-horizontal"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-panel-id]').length).toBe(5); // vertical 2 + horizontal 3
  });
  it('顶栏比例按钮存在且点击切换 canvasSize（走真实 store）+ 记忆写入', async () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    await waitFor(() => expect(screen.getByTestId('timeline-panel')).toBeInTheDocument());
    expect(screen.getByTestId('aspect-ratio-button')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('aspect-ratio-button'));
    await waitFor(() => expect(screen.getByText('9:16（1080×1920）')).toBeInTheDocument());
    fireEvent.click(screen.getByText('9:16（1080×1920）'));
    await waitFor(() => expect(useEditorStore.getState().data!.canvasSize).toEqual({ width: 1080, height: 1920 }));
    expect(localStorage.getItem(LAST_ASPECT_KEY)).toBe('9:16');
  });
  it('新建工程默认画布用记忆比例（LAST_ASPECT_KEY——spec 5.1 D6 显式不静默）', async () => {
    localStorage.setItem(LAST_ASPECT_KEY, '9:16');
    try {
      useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
      render(<VideoEditorShell />);
      await waitFor(() => expect(vi.mocked(upsertProject)).toHaveBeenCalled());
      const calls = vi.mocked(upsertProject).mock.calls; // 本文件 beforeEach 无 clearAllMocks——取最后一次调用
      expect(calls[calls.length - 1][0]).toMatchObject({
        data: { canvasSize: { width: 1080, height: 1920 } },
      });
    } finally {
      localStorage.removeItem(LAST_ASPECT_KEY);
    }
  });
  it('loadProject 迁移不触发 autosave（幻影 PATCH 过滤——I2）', async () => {
    vi.useFakeTimers();
    try {
      useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
      render(<VideoEditorShell />);
      // upsertProject 已 resolve（microtask）→ loadProject 已跑 → 推进防抖窗口
      await vi.advanceTimersByTimeAsync(2000);
      expect(vi.mocked(upsertProject)).toHaveBeenCalled();
      expect(vi.mocked(patchProject)).not.toHaveBeenCalled(); // 零幻影 PATCH
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('批0d：Shell 数据止血接线（catch 不放行 + beforeunload + editorDirty）', () => {
  beforeEach(() => {
    useVideoEditorStore.setState({ open: false, sourceNodeId: null, closedAt: 0 });
    useEditorStore.getState().reset();
    useCanvasStore.setState({ editorDirty: false });
    vi.mocked(upsertProject).mockResolvedValue({
      id: 'p1', sourceNodeId: 'n1', workflowId: 'w', teamId: 'team1', title: 't',
      data: createDefaultProjectData(), updatedAt: 't0',
    });
  });

  it('flush 异常路径不放行：保存链路异常时 handleClose 不 close（close=丢出口，数据留编辑器重试）', async () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    await waitFor(() => expect(screen.getByTestId('timeline-panel')).toBeInTheDocument()); // ready
    // 构造 flush reject：setSaveState 抛错 → doSave 在 onStateChange('saving')（try 外）reject → flush reject
    const spy = vi.spyOn(useEditorStore.getState(), 'setSaveState').mockImplementation(() => { throw new Error('boom'); });
    try {
      act(() => { useEditorStore.setState({ data: createDefaultProjectData() }); }); // 编辑 → notifyChange（dirty 排队）
      fireEvent.click(screen.getByText('收起')); // handleClose → flush → reject → .catch
      await act(async () => {}); // flush microtask 排空
      expect(useVideoEditorStore.getState().open).toBe(true); // 不 close——数据留在编辑器给用户重试
    } finally {
      spy.mockRestore();
    }
  });

  it('editorDirty true 时 beforeunload preventDefault（B4——关标签无提示丢拦截）', async () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    await waitFor(() => expect(screen.getByTestId('timeline-panel')).toBeInTheDocument()); // ready
    act(() => { useEditorStore.setState({ data: createDefaultProjectData() }); }); // 编辑 → notifyChange → latch 置位
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});
