import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TimelinePanel } from './TimelinePanel';
import { useEditorStore } from '../../store/editorStore';
import { createDefaultProjectData, type ProjectData } from '../../types';
import { useVideoEditorStore } from '@/stores/videoEditorStore';

const ready = (data?: ProjectData) => {
  const d = data ?? createDefaultProjectData();
  useEditorStore.setState({ status: 'ready', data: d, projectId: 'p1', sourceNodeId: 'edit1', baseUpdatedAt: 't', history: useEditorStore.getState().history, mediaInfo: { m1: { name: 'A', durationSec: 10 } } });
  return d;
};
const addVideoClip = (start = 0) => {
  const d = useEditorStore.getState().data!;
  return useEditorStore.getState().addClip({ type: 'video', mediaId: 'm1', sourceNodeId: 's1', trackId: d.tracks[0].id, start })!;
};

// jsdom 无 PointerEvent 构造器（项目先例 useTrackCanvasPointerShift.test / VideoTrimTimeline.test）：
// addEventListener 按 type 匹配，MouseEvent 携带所需属性即可驱动 React 合成 pointer 事件与原生 window 监听
const firePointer = (target: EventTarget, type: string, opts: MouseEventInit = {}) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...opts }));

describe('TimelinePanel 交互', () => {
  beforeEach(() => {
    useEditorStore.getState().reset();
    useVideoEditorStore.setState({ open: false, sourceNodeId: null, closedAt: 0 });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (document as any).elementFromPoint; // 跨轨用例注入的 mock（jsdom 本无此 API），防残留串用例
  });

  it('拖动片段：pointer 序列 → transient move + pointerup 一次入栈 + 新位置', () => {
    ready();
    const id = addVideoClip(0);
    render(<TimelinePanel />);
    const block = screen.getByTestId(`clip-block-${id}`);
    const depthBefore = useEditorStore.getState().history.past.length;

    firePointer(block, 'pointerdown', { button: 0, clientX: 100, clientY: 50 });
    firePointer(window, 'pointermove', { clientX: 180, clientY: 50 }); // +80px = +1s @80px/s
    firePointer(window, 'pointerup');

    expect(useEditorStore.getState().data!.clips[id].start).toBe(1);
    expect(useEditorStore.getState().history.past.length).toBe(depthBefore + 1); // 一次入栈
    expect(useEditorStore.getState().selectedClipId).toBe(id);
  });

  it('trim 右缘：命中边缘 → duration 变化且 sourceStart 不动', () => {
    ready();
    const id = addVideoClip(0);
    // 控制器批准修正：素材时长给富余（10 用满时 trimRightGuard maxDelta=0 夹死；guard 实时查 mediaInfo）
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 15 });
    render(<TimelinePanel />);
    const block = screen.getByTestId(`clip-block-${id}`);
    // 宽度 = 10s * 80px/s = 800px；右缘 x=800 内 6px 命中
    firePointer(block, 'pointerdown', { button: 0, clientX: 798, clientY: 50 });
    firePointer(window, 'pointermove', { clientX: 878, clientY: 50 }); // +80px = +1s
    firePointer(window, 'pointerup');
    const c = useEditorStore.getState().data!.clips[id];
    expect(c.duration).toBe(11);
    expect((c as any).sourceStart).toBe(0);
  });

  it('吸附：拖到冲突位吸附相邻空位（canPlaceAt→findNearestFreeStart）', () => {
    ready();
    const a = addVideoClip(0); // 0-10s
    const b = useEditorStore.getState().addClip({ type: 'video', mediaId: 'm1', trackId: useEditorStore.getState().data!.tracks[0].id, start: 12 })!;
    render(<TimelinePanel />);
    const block = screen.getByTestId(`clip-block-${b}`);
    firePointer(block, 'pointerdown', { button: 0, clientX: 1000, clientY: 50 });
    firePointer(window, 'pointermove', { clientX: 805, clientY: 50 }); // 拖到 ~9.56s 与 a 冲突 → 吸附 10
    firePointer(window, 'pointerup');
    expect(useEditorStore.getState().data!.clips[b].start).toBe(10);
  });

  it('跨轨拖动：拖到同类视频轨换轨（elementFromPoint 命中）', async () => {
    ready();
    const id = addVideoClip(0);
    render(<TimelinePanel />);
    // act 包裹：zustand setState 在非 React 事件上下文走微任务调度，同步 querySelector 前必须 flush 渲染
    await act(async () => { useEditorStore.getState().addTrack('video'); });
    const track2 = useEditorStore.getState().data!.tracks.filter(t => t.type === 'video')[1];
    // jsdom 无 elementFromPoint——直接注入 mock（afterEach 统一 delete 清理）
    (document as any).elementFromPoint = () => document.querySelector(`[data-track-id="${track2.id}"]`);
    const block = screen.getByTestId(`clip-block-${id}`);
    firePointer(block, 'pointerdown', { button: 0, clientX: 100, clientY: 50 });
    firePointer(window, 'pointermove', { clientX: 180, clientY: 300 }); // 纵向移入第二轨
    firePointer(window, 'pointerup');
    expect(useEditorStore.getState().data!.clips[id].trackId).toBe(track2.id);
    expect(useEditorStore.getState().data!.tracks[0].clips).not.toContain(id);
  });

  it('分割按钮：播放头切中选中片段 → 两片', () => {
    ready();
    const id = addVideoClip(0);
    useEditorStore.getState().selectClip(id);
    useEditorStore.getState().setPlayhead(4);
    render(<TimelinePanel />);
    fireEvent.click(screen.getByText('分割'));
    expect(useEditorStore.getState().data!.tracks[0].clips).toHaveLength(2);
  });

  it('删除按钮：删选中片段（历史可撤销）', () => {
    ready();
    const id = addVideoClip(0);
    useEditorStore.getState().selectClip(id);
    render(<TimelinePanel />);
    fireEvent.click(screen.getByText('删除'));
    expect(useEditorStore.getState().data!.tracks[0].clips).toHaveLength(0);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().data!.tracks[0].clips).toHaveLength(1);
  });

  it('字幕轨头 ➕ → 播放头处新增 3s 字幕', () => {
    ready();
    render(<TimelinePanel />);
    const subTrack = useEditorStore.getState().data!.tracks.find(t => t.type === 'subtitle')!;
    act(() => { useEditorStore.getState().setPlayhead(2); }); // act 包裹：render 后的 store 更新须 flush 渲染（同跨轨用例）
    fireEvent.click(screen.getByTitle('该轨内新增字幕'));
    const clips = useEditorStore.getState().data!.tracks.find(t => t.id === subTrack.id)!.clips;
    expect(clips).toHaveLength(1);
    expect((useEditorStore.getState().data!.clips[clips[0]] as any).duration).toBe(3);
  });

  it('Ctrl+Z 编辑器内撤销（键盘，画布层已隔离）', () => {
    ready();
    addVideoClip(0);
    useVideoEditorStore.setState({ open: true }); // 控制器批准修正：useEditorKeyboard 首行检查 open
    render(<TimelinePanel />);
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    expect(useEditorStore.getState().data!.tracks[0].clips).toHaveLength(0);
  });

  it('Delete 键删除选中片段', () => {
    ready();
    const id = addVideoClip(0);
    useEditorStore.getState().selectClip(id);
    useVideoEditorStore.setState({ open: true }); // 同上
    render(<TimelinePanel />);
    fireEvent.keyDown(document, { key: 'Delete' });
    expect(useEditorStore.getState().data!.tracks[0].clips).toHaveLength(0);
  });
});
