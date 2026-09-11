import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VideoEditorShell } from './VideoEditorShell';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { isGroupEditContext } from '@/hooks/useGroupKeyboard';
import { upsertProject, patchProject } from '@/api/videoProjectApi';
import { createDefaultProjectData } from '../types';
import { useEditorStore } from '../store/editorStore';

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
    fireEvent.click(screen.getByText('导出')); // 打开导出弹层（批 6 前仍是 Modal）
    await waitFor(() => {
      const wrap = document.querySelector('.ant-modal-wrap');
      expect(wrap).toBeTruthy();
      // 容器归属断言（真红点）：Modal 挂进壳内而非 body 直挂——
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
  it('loadProject 迁移不触发 autosave（幻影 PATCH 过滤——I2）', async () => {
    vi.useFakeTimers();
    try {
      useCanvasStore.setState({ connStatus: 'connected' }); // 在线才走 PATCH——否则离线早退使断言恒真
      useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
      render(<VideoEditorShell />);
      // upsertProject 已 resolve（microtask）→ loadProject 已跑 → 推进防抖窗口
      await vi.advanceTimersByTimeAsync(2000);
      expect(vi.mocked(upsertProject)).toHaveBeenCalled();
      expect(vi.mocked(patchProject)).not.toHaveBeenCalled(); // 零幻影 PATCH
    } finally {
      vi.useRealTimers();
      useCanvasStore.setState({ connStatus: 'connecting' });
    }
  });
});
