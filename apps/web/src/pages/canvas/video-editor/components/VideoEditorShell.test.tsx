import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VideoEditorShell } from './VideoEditorShell';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { isGroupEditContext } from '@/hooks/useGroupKeyboard';

describe('VideoEditorShell', () => {
  beforeEach(() => {
    useVideoEditorStore.setState({ open: false, sourceNodeId: null, closedAt: 0 });
  });
  it('open=false 不渲染；open 后渲染全屏壳与占位区', () => {
    const { rerender } = render(<VideoEditorShell />);
    expect(screen.queryByTestId('video-editor-shell')).not.toBeInTheDocument();
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    rerender(<VideoEditorShell />);
    expect(screen.getByTestId('video-editor-shell')).toBeInTheDocument();
    expect(screen.getByTestId('preview-placeholder')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-panel')).toBeInTheDocument();
  });
  it('点遮罩不关闭（closeOnBackdrop=false 透传）', () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    // 层级：遮罩 > role=dialog > video-editor-shell
    fireEvent.click(screen.getByTestId('video-editor-shell').parentElement!.parentElement!);
    expect(useVideoEditorStore.getState().open).toBe(true);
  });
  it('收起按钮 → close', () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    fireEvent.click(screen.getByText('收起'));
    expect(useVideoEditorStore.getState().open).toBe(false);
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
});
