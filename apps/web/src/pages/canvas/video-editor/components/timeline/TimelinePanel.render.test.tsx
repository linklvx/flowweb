import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimelinePanel } from './TimelinePanel';
import { useEditorStore } from '../../store/editorStore';
import { createDefaultProjectData, type ProjectData } from '../../types';

const dataWithClips = (): ProjectData => {
  const d = createDefaultProjectData();
  const videoTrack = d.tracks[0];
  const subTrack = d.tracks[1];
  const v1 = { id: 'v1', trackId: videoTrack.id, type: 'video' as const, start: 0, duration: 3, sourceStart: 0, mediaId: 'm1', sourceNodeId: 's1', playbackSpeed: 1 as const, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] };
  const a1 = { id: 'a1', trackId: d.tracks[2].id, type: 'audio' as const, start: 1, duration: 2, sourceStart: 0, mediaId: 'm2', playbackSpeed: 1 as const, volume: 1, fade: { in: 0, out: 0 }, keyframes: [] };
  const sub1 = { id: 'sub1', trackId: subTrack.id, type: 'subtitle' as const, start: 0, duration: 2, text: '你好', visible: true, style: { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 } };
  d.clips['v1'] = v1; d.clips['a1'] = a1; d.clips['sub1'] = sub1;
  videoTrack.clips.push('v1');
  d.tracks[2].clips.push('a1');
  subTrack.clips.push('sub1');
  return d;
};

describe('TimelinePanel 静态渲染', () => {
  beforeEach(() => {
    useEditorStore.getState().reset();
  });
  it('status=loading → 加载占位（打开等待禁编辑，spec 入口时序）', () => {
    useEditorStore.setState({ status: 'loading', data: null });
    render(<TimelinePanel />);
    expect(screen.getByTestId('timeline-loading')).toBeInTheDocument();
  });
  it('status=error → 错误态', () => {
    useEditorStore.setState({ status: 'error', loadError: '网络错误', data: null });
    render(<TimelinePanel />);
    expect(screen.getByTestId('timeline-error')).toBeInTheDocument();
    expect(screen.getByText('网络错误')).toBeInTheDocument();
  });
  it('ready → 渲染标尺/全部轨道/片段块与源时间码', () => {
    const d = dataWithClips();
    useEditorStore.setState({
      status: 'ready', data: d, projectId: 'p1', sourceNodeId: 'edit1', baseUpdatedAt: 't',
      mediaInfo: { m1: { name: '视频A', durationSec: 10 }, m2: { name: '音频B', durationSec: 5 } },
    });
    render(<TimelinePanel />);
    expect(screen.getByTestId('timeline-ruler')).toBeInTheDocument();
    d.tracks.forEach(t => expect(screen.getByTestId(`track-row-${t.id}`)).toBeInTheDocument());
    expect(screen.getByTestId('clip-block-v1')).toBeInTheDocument();
    expect(screen.getByTestId('clip-block-a1')).toBeInTheDocument();
    expect(screen.getByTestId('clip-block-sub1')).toBeInTheDocument();
    // 片段块显示"名称 · 源时间码"（HH:MM:SS:FF）——源时间码是素材内位置 sourceStart
    expect(screen.getByText(/视频A · 00:00:00:00/)).toBeInTheDocument();
    expect(screen.getByText(/音频B · 00:00:00:00/)).toBeInTheDocument();
    expect(screen.getByText('你好')).toBeInTheDocument(); // 字幕块显示文本
  });
  it('空轨渲染占位条，工具行有撤销/重做/分割/删除', () => {
    useEditorStore.setState({ status: 'ready', data: createDefaultProjectData(), projectId: 'p1', sourceNodeId: 'edit1', baseUpdatedAt: 't' });
    render(<TimelinePanel />);
    expect(screen.getByText('撤销')).toBeInTheDocument();
    expect(screen.getByText('重做')).toBeInTheDocument();
    expect(screen.getByText('分割')).toBeInTheDocument();
    expect(screen.getByText('删除')).toBeInTheDocument();
  });
});
