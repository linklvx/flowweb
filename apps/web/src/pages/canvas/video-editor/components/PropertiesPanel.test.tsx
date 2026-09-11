import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PropertiesPanel } from './PropertiesPanel';
import { useEditorStore } from '../store/editorStore';
import { createDefaultProjectData } from '../types';

const readyWith = (make: (d: ReturnType<typeof createDefaultProjectData>) => string) => {
  const d = createDefaultProjectData();
  const clipId = make(d);
  useEditorStore.setState({ status: 'ready', data: d, projectId: 'p1', sourceNodeId: 'e1', baseUpdatedAt: 't', playhead: 0 });
  useEditorStore.getState().selectClip(clipId);
};
const videoClip = (d: ReturnType<typeof createDefaultProjectData>) => {
  const id = 'v1';
  d.clips[id] = { id, trackId: d.tracks[0].id, type: 'video', start: 0, duration: 5, sourceStart: 0, mediaId: 'm1', playbackSpeed: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [], transitionIn: undefined, transitionOut: undefined };
  d.tracks[0].clips.push(id);
  return id;
};
const audioClip = (d: ReturnType<typeof createDefaultProjectData>) => {
  const id = 'a1';
  d.clips[id] = { id, trackId: d.tracks[2].id, type: 'audio', start: 0, duration: 5, sourceStart: 0, mediaId: 'ma', volume: 1, fade: { in: 0, out: 0 }, playbackSpeed: 1, keyframes: [] };
  d.tracks[2].clips.push(id);
  return id;
};
const subClip = (d: ReturnType<typeof createDefaultProjectData>) => {
  const id = 's1';
  d.clips[id] = { id, trackId: d.tracks[1].id, type: 'subtitle', start: 0, duration: 3, text: '旧文本', visible: true, style: { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 } };
  d.tracks[1].clips.push(id);
  return id;
};

describe('PropertiesPanel 四态', () => {
  beforeEach(() => useEditorStore.getState().reset());

  it('未选中 → 空态', () => {
    useEditorStore.setState({ status: 'ready', data: createDefaultProjectData(), projectId: 'p1', sourceNodeId: 'e1', baseUpdatedAt: 't' });
    render(<PropertiesPanel />);
    expect(screen.getByTestId('properties-empty')).toBeInTheDocument();
  });
  it('视频态：transform 五输入 + 速度 + 转场 + 秒表；改 x → updateClip', () => {
    readyWith(videoClip);
    render(<PropertiesPanel />);
    expect(screen.getByLabelText('x')).toBeInTheDocument();
    expect(screen.getByLabelText('播放速度')).toBeInTheDocument();
    expect(screen.getByText('入场转场')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('x'), { target: { value: '100' } });
    expect((useEditorStore.getState().data!.clips['v1'] as any).transform.x).toBe(100);
  });
  it('视频态秒表：播放头处无关键帧点击添加、有关键帧点击删除', () => {
    readyWith(videoClip);
    useEditorStore.getState().setPlayhead(1);
    render(<PropertiesPanel />);
    fireEvent.click(screen.getByTestId('stopwatch-scale'));
    expect((useEditorStore.getState().data!.clips['v1'] as any).keyframes).toHaveLength(1);
    fireEvent.click(screen.getByTestId('stopwatch-scale'));
    expect((useEditorStore.getState().data!.clips['v1'] as any).keyframes).toHaveLength(0);
  });
  it('音频态：音量/fade/速度；改音量 → updateClip', () => {
    readyWith(audioClip);
    render(<PropertiesPanel />);
    fireEvent.change(screen.getByLabelText('音量'), { target: { value: '0.5' } });
    expect((useEditorStore.getState().data!.clips['a1'] as any).volume).toBe(0.5);
  });
  it('字幕态：文本/显示开关/字号/颜色/字间距', () => {
    readyWith(subClip);
    render(<PropertiesPanel />);
    fireEvent.change(screen.getByLabelText('字幕文本'), { target: { value: '新文本' } });
    expect((useEditorStore.getState().data!.clips['s1'] as any).text).toBe('新文本');
    expect(screen.getByLabelText('显示字幕')).toBeInTheDocument();
  });
});
