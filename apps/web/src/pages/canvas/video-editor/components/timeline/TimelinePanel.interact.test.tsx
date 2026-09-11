import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TimelinePanel } from './TimelinePanel';
import { PreviewPlayer } from '../PreviewPlayer';
import { useEditorStore } from '../../store/editorStore';
import { createDefaultProjectData, type ProjectData } from '../../types';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { ensurePoster } from '../../renderer/poster';

vi.mock('../../renderer/poster', () => ({ ensurePoster: vi.fn() }));

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

// jsdom 同样无 DragEvent——fireEvent.drop 造的是 Event 基类（dataTransfer 由 testing-library 特殊注入但 clientX 不透传→NaN）。
// 同 firePointer 先例：MouseEvent 携带 type='drop' + clientX，dataTransfer 用 defineProperty 注入
const fireDrop = (target: EventTarget, payload: string, clientX: number) => {
  const ev = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX });
  Object.defineProperty(ev, 'dataTransfer', { value: { getData: (t: string) => (t === 'application/x-clip' ? payload : '') } });
  target.dispatchEvent(ev);
};

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

  it('拖拽音频落到视频轨：不静默丢弃——自动建音频轨并按落点 x 放置', () => {
    ready(); // 默认单视频轨
    render(<TimelinePanel />);
    const trackBody = document.querySelector('[data-track-type="video"]')!;
    const payload = JSON.stringify({ mediaId: 'm2', mimeType: 'audio/mp3', originalName: '音乐B.mp3', durationSec: 6 });
    fireDrop(trackBody, payload, trackBody.getBoundingClientRect().left + 160); // 160px = 2s @80px/s
    const d = useEditorStore.getState().data!;
    const aTrack = d.tracks.find(t => t.type === 'audio');
    expect(aTrack).toBeTruthy(); // 错型不再静默丢弃——自动建音频轨
    expect(aTrack!.clips).toHaveLength(1);
    const clip = d.clips[aTrack!.clips[0]];
    expect(clip.type).toBe('audio');
    expect((clip as any).mediaId).toBe('m2');
    expect(clip.duration).toBe(6); // payload 已解析时长契约
    expect(clip.start).toBe(2); // 落点量化（rect 取被悬停轨——start 语义按 drop 位置）
    expect(d.tracks[0].clips).toHaveLength(0); // 视频轨未收错型片段
    expect(useEditorStore.getState().mediaInfo['m2']).toMatchObject({ name: '音乐B.mp3', durationSec: 6, mimeType: 'audio/mp3' });
  });

  it('drop 视频 payload 带 url 无 thumbnailUrl → fire-and-forget 取首帧回写（拖拽路径对称点击 poster 回退，批3-4）', async () => {
    ready();
    vi.mocked(ensurePoster).mockResolvedValue('data:image/jpeg;base64,poster');
    render(<TimelinePanel />);
    const trackBody = document.querySelector('[data-track-type="video"]')!;
    const payload = JSON.stringify({ mediaId: 'm2', mimeType: 'video/mp4', originalName: '视频C.mp4', durationSec: 7, url: 'http://c' });
    fireDrop(trackBody, payload, trackBody.getBoundingClientRect().left + 80);
    await act(async () => {}); // flush fire-and-forget 微任务（ensurePoster 异步写回）
    expect(ensurePoster).toHaveBeenCalledWith('http://c');
    expect(useEditorStore.getState().mediaInfo['m2']).toMatchObject({
      name: '视频C.mp4', durationSec: 7, url: 'http://c', mimeType: 'video/mp4', thumbnailUrl: 'data:image/jpeg;base64,poster',
    });
  });

  it('分割按钮：播放头切中选中片段 → 两片', () => {
    ready();
    const id = addVideoClip(0);
    useEditorStore.getState().selectClip(id);
    useEditorStore.getState().setPlayhead(4);
    render(<><PreviewPlayer /><TimelinePanel /></>); // 分割按钮已迁预览控制条（Task 8）
    fireEvent.click(screen.getByRole('button', { name: '分割' }));
    expect(useEditorStore.getState().data!.tracks[0].clips).toHaveLength(2);
  });

  it('删除按钮：删选中片段（历史可撤销）', () => {
    ready();
    const id = addVideoClip(0);
    useEditorStore.getState().selectClip(id);
    render(<><PreviewPlayer /><TimelinePanel /></>); // 删除按钮已迁预览控制条（Task 8）
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(useEditorStore.getState().data!.tracks[0].clips).toHaveLength(0);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().data!.tracks[0].clips).toHaveLength(1);
  });

  it('字幕轨头 ➕ → 播放头处新增 3s 字幕', () => {
    ready();
    const subTrackId = useEditorStore.getState().addTrack('subtitle'); // 单轨默认值下显式建字幕轨（与生产动态建轨对齐）
    render(<TimelinePanel />);
    act(() => { useEditorStore.getState().setPlayhead(2); }); // act 包裹：render 后的 store 更新须 flush 渲染（同跨轨用例）
    fireEvent.click(screen.getByTitle('该轨内新增字幕'));
    const clips = useEditorStore.getState().data!.tracks.find(t => t.id === subTrackId)!.clips;
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
