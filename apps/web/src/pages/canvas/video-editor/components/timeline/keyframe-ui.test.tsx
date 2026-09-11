import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimelinePanel } from './TimelinePanel';
import { useEditorStore } from '../../store/editorStore';
import { createDefaultProjectData } from '../../types';
import { useVideoEditorStore } from '@/stores/videoEditorStore';

// jsdom 无 PointerEvent 构造器——按本仓 TimelinePanel.interact.test.tsx 既有先例用 MouseEvent 按 type 派发（R1 审核 B5：
// fireEvent.pointerDown 走 createEvent 的 window[EventType]||Event 回退，button/clientX 全丢 → if (e.button !== 0) 早退）
const firePointer = (target: Element | Window, type: string, init: { button?: number; clientX?: number; clientY?: number } = {}) => {
  fireEvent(target, new MouseEvent(type, { bubbles: true, cancelable: true, button: init.button ?? 0, clientX: init.clientX ?? 0, clientY: init.clientY ?? 0 }));
};

const ready = () => {
  const d = createDefaultProjectData();
  useEditorStore.setState({ status: 'ready', data: d, projectId: 'p1', sourceNodeId: 'edit1', baseUpdatedAt: 't' });
  return d;
};
const addVideoWithKf = () => {
  const d = useEditorStore.getState().data!;
  const id = useEditorStore.getState().addClip({ type: 'video', mediaId: 'm1', trackId: d.tracks[0].id, start: 0 })!;
  useEditorStore.getState().setPlayhead(2);
  useEditorStore.getState().addKeyframe(id, 'scale');
  useEditorStore.getState().setPlayhead(0);
  return id;
};

describe('时间轴关键帧菱形刻度', () => {
  beforeEach(() => {
    useEditorStore.getState().reset();
    useVideoEditorStore.setState({ open: false }); // useEditorKeyboard 首行 open 早退（同 interact.test 先例），防串用例
  });

  it('渲染菱形（data-testid=kf-*），点击跳转播放头', () => {
    ready();
    addVideoWithKf();
    render(<TimelinePanel />);
    const kf = screen.getByTestId(/^kf-/); // 首个菱形
    firePointer(kf, 'pointerdown', { clientX: 160, clientY: 50 });
    firePointer(window, 'pointerup');
    expect(useEditorStore.getState().playhead).toBe(2); // kf.t=2 → 跳转
  });

  it('拖拽菱形移动关键帧（transient，pointerup 入栈）', () => {
    ready();
    const id = addVideoWithKf();
    render(<TimelinePanel />);
    const kf = screen.getByTestId(/^kf-/);
    firePointer(kf, 'pointerdown', { clientX: 160, clientY: 50 });
    firePointer(window, 'pointermove', { clientX: 240, clientY: 50 }); // +80px = +1s @80px/s
    firePointer(window, 'pointerup');
    const clip = useEditorStore.getState().data!.clips[id] as any;
    expect(clip.keyframes[0].t).toBe(3);
    useEditorStore.getState().undo(); // 一次拖拽恰好一条历史（pointerup 入栈）
    expect((useEditorStore.getState().data!.clips[id] as any).keyframes[0].t).toBe(2);
  });

  it('Delete 优先删除选中关键帧（其次选中片段）——N3 定案：点菱形双写两 id（未预选片段的直接点击路径）', () => {
    ready();
    const id = addVideoWithKf();
    useVideoEditorStore.setState({ open: true }); // 控制器批准修正：useEditorKeyboard 首行检查 open（同 interact.test 先例）
    render(<TimelinePanel />);
    // 不预选片段——直接点菱形：selectKeyframe 双写 selectedKeyframeId + selectedClipId（变异：只写 kfId 则下断言红）
    const kf = screen.getByTestId(/^kf-/);
    firePointer(kf, 'pointerdown', { clientX: 160, clientY: 50 });
    expect(useEditorStore.getState().selectedClipId).toBe(id);       // 双写联动（直接点菱形也选中其片段）
    expect(useEditorStore.getState().selectedKeyframeId).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Delete' });
    const clip = useEditorStore.getState().data!.clips[id] as any;
    expect(clip.keyframes).toHaveLength(0);                          // 关键帧优先被删（两真条件成立的前提即双写）
    expect(useEditorStore.getState().data!.tracks[0].clips).toContain(id); // 片段保留
  });

  it('undo/redo 后 selectedKeyframeId 清空（R4 收口守护——历史跳转后 kf 选中不残留）', () => {
    ready();
    const id = addVideoWithKf();
    useEditorStore.getState().selectKeyframe(
      (useEditorStore.getState().data!.clips[id] as any).keyframes[0].id, id);
    expect(useEditorStore.getState().selectedKeyframeId).toBeTruthy();
    useEditorStore.getState().undo(); // addKeyframe 那条历史
    expect(useEditorStore.getState().selectedKeyframeId).toBeNull();
  });
});
