// apps/web/src/pages/canvas/video-editor/components/VideoEditorShell.test.tsx
// Y4a T7（spec §0 条 7 + plan Task 7）：Shell 改订阅既有 timelines.<nodeId> Map——upsert/autosave/
// 三选 ConfirmModal/close-drain REST 链整删（关闭=直接关；tests 随消费点同批退场）。装载装置=
// setTimelineDocRef(live)+doc 里 timelines.n1 已种（编辑器只读已存在 Map——键不在不创建工程）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { VideoEditorShell } from './VideoEditorShell';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { isGroupEditContext } from '@/hooks/useGroupKeyboard';
import { useEditorStore } from '../store/editorStore';
import { setTimelineDocRef, getTimelineUndoManager, detachTimelineUndo } from '@/stores/timelineUndo';

/** 装置：真 live doc + timelines.n1 已种（loadProject 走 doc 水合）。 */
const LIVE = 777_777;
function setupDoc(): Y.Doc {
  const live = new Y.Doc();
  live.clientID = LIVE;
  live.transact(() => {
    const track = new Y.Map();
    track.set('type', 'video'); track.set('name', '视频');
    track.set('muted', false); track.set('hidden', false); track.set('order', '5000');
    const tracks = new Y.Map(); tracks.set('n1:video', track);
    const entry = new Y.Map();
    entry.set('version', 1); entry.set('fps', 30);
    entry.set('tracks', tracks); entry.set('clips', new Y.Map());
    live.getMap('timelines').set('n1', entry);
  }, 'local-user');
  setTimelineDocRef(live);
  return live;
}

describe('VideoEditorShell（Y4a T7 订阅既有 Map——REST 链退场）', () => {
  let live: Y.Doc;
  beforeEach(() => {
    useVideoEditorStore.setState({ open: false, sourceNodeId: null, closedAt: 0 });
    useEditorStore.getState().reset();
    live = setupDoc();
  });
  afterEach(() => {
    detachTimelineUndo();
    setTimelineDocRef(null);
    live.destroy();
  });

  it('open=false 不渲染；open 后渲染全屏壳与就绪时间轴（doc 水合 ready）', async () => {
    const { rerender } = render(<VideoEditorShell />);
    expect(screen.queryByTestId('video-editor-shell')).not.toBeInTheDocument();
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    rerender(<VideoEditorShell />);
    expect(screen.getByTestId('video-editor-shell')).toBeInTheDocument();
    expect(screen.getByTestId('preview-canvas')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('timeline-panel')).toBeInTheDocument());
    expect(useEditorStore.getState().status).toBe('ready');   // doc 水合就绪
    expect(useEditorStore.getState().data).not.toBeNull();
  });
  it('点遮罩不关闭（closeOnBackdrop=false 透传）', () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    fireEvent.click(screen.getByTestId('video-editor-shell').parentElement!.parentElement!);
    expect(useVideoEditorStore.getState().open).toBe(true);
  });
  it('收起按钮 → 直接关（close-drain 三选/autosave 链退场——无 REST 排空）', async () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    await waitFor(() => expect(screen.getByTestId('timeline-panel')).toBeInTheDocument());
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
    await waitFor(() => expect(shell).toContainElement(document.activeElement as HTMLElement | null));
  });
  it('P0-A 回归：壳内 antd 弹层挂载容器归属壳节点（删 Shell 的 ConfigProvider 后此用例必红）', async () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    await waitFor(() => expect(screen.getByTestId('timeline-panel')).toBeInTheDocument());
    fireEvent.click(screen.getByText('导出'));
    await waitFor(() => {
      const wrap = document.querySelector('.ant-popover');
      expect(wrap).toBeTruthy();
      expect((wrap as HTMLElement).closest('[data-testid="video-editor-shell"]')).not.toBeNull();
    });
  });
  it('布局为可调面板组：垂直(主区/时间轴) + 水平(素材/预览/属性) 各两级', async () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    await waitFor(() => expect(screen.getByTestId('timeline-panel')).toBeInTheDocument());
    expect(document.querySelectorAll('[data-panel-group-id]').length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('[data-panel-group-id="ve-vertical"]')).not.toBeNull();
    expect(document.querySelector('[data-panel-group-id="ve-horizontal"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-panel-id]').length).toBe(5);
  });
  it('顶栏比例按钮存在且点击切换 canvasSize（走真实 store commit→doc 写穿）', async () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    await waitFor(() => expect(screen.getByTestId('timeline-panel')).toBeInTheDocument());
    expect(screen.getByTestId('aspect-ratio-button')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('aspect-ratio-button'));
    await waitFor(() => expect(screen.getByText('9:16（1080×1920）')).toBeInTheDocument());
    fireEvent.click(screen.getByText('9:16（1080×1920）'));
    await waitFor(() => expect(useEditorStore.getState().data!.canvasSize).toEqual({ width: 1080, height: 1920 }));
    // doc 写穿：entry 里 canvasSize 标量已落
    const entry = live.getMap('timelines').get('n1') as Y.Map<unknown>;
    await waitFor(() => expect(entry.get('canvasSize')).toEqual({ width: 1080, height: 1920 }));
  });
  it('键不在（timelines 无该 nodeId）→ 停 loading 不创建工程', async () => {
    live.transact(() => { (live.getMap('timelines') as Y.Map<unknown>).delete('n1'); }, 'local-user');
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    await waitFor(() => expect(screen.getByTestId('timeline-loading')).toBeInTheDocument());
    expect(useEditorStore.getState().status).toBe('loading');
    expect([...(live.getMap('timelines') as Y.Map<unknown>).keys()]).toEqual([]);   // 不创建
  });
  it('重绑（spec §0 条 7）：open 期间远端换掉 entry → 根键监听重绑新 Map、栈从空开始', async () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    await waitFor(() => expect(screen.getByTestId('timeline-panel')).toBeInTheDocument());
    const oldUm = getTimelineUndoManager()!;
    // 造一笔栈项
    useEditorStore.getState().addClip({ type: 'image', mediaId: 'm9', trackId: 'n1:video', start: 0 });
    expect(oldUm.undoStack.length).toBe(1);
    // 远端换掉整棵 Map
    live.transact(() => {
      const timelines = live.getMap('timelines') as Y.Map<unknown>;
      timelines.delete('n1');
      const track = new Y.Map();
      track.set('type', 'video'); track.set('name', '视频');
      track.set('muted', false); track.set('hidden', false); track.set('order', '5000');
      const tracks = new Y.Map(); tracks.set('n1:video', track);
      const entry = new Y.Map();
      entry.set('version', 1); entry.set('fps', 30);
      entry.set('tracks', tracks); entry.set('clips', new Y.Map());
      timelines.set('n1', entry);
    }, null as unknown as string);
    await waitFor(() => expect(getTimelineUndoManager()).not.toBe(oldUm));
    expect(getTimelineUndoManager()!.undoStack.length).toBe(0);   // 栈从空开始
    // 关闭=直接关（收起无排空路径）
    fireEvent.click(screen.getByText('收起'));
    await waitFor(() => expect(useVideoEditorStore.getState().open).toBe(false));
  });
  it('键删除（节点没了）→ open 期间根键监听捕获 → 编辑器关掉', async () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    await waitFor(() => expect(screen.getByTestId('timeline-panel')).toBeInTheDocument());
    live.transact(() => { (live.getMap('timelines') as Y.Map<unknown>).delete('n1'); }, 'local-user');
    await waitFor(() => expect(useVideoEditorStore.getState().open).toBe(false));   // 编辑器关掉
  });
});
