import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TimelinePanel } from './TimelinePanel';
import { PreviewPlayer } from '../PreviewPlayer';
import { useEditorStore } from '../../store/editorStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { createDefaultProjectData, type ProjectData } from '../../types';

const dataWithClips = (): ProjectData => {
  const d = createDefaultProjectData();
  const videoTrack = d.tracks[0];
  // 单轨默认值下显式建音频/字幕轨（与生产动态建轨对齐）
  const audioTrack = { id: 'ta1', type: 'audio' as const, name: '音频1', muted: false, hidden: false, clips: [] as string[] };
  const subTrack = { id: 'ts1', type: 'subtitle' as const, name: '字幕1', muted: false, hidden: false, clips: [] as string[] };
  d.tracks.push(audioTrack, subTrack);
  const v1 = { id: 'v1', trackId: videoTrack.id, type: 'video' as const, start: 0, duration: 3, sourceStart: 0, mediaId: 'm1', sourceNodeId: 's1', playbackSpeed: 1 as const, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] };
  const a1 = { id: 'a1', trackId: audioTrack.id, type: 'audio' as const, start: 1, duration: 2, sourceStart: 0, mediaId: 'm2', playbackSpeed: 1 as const, volume: 1, fade: { in: 0, out: 0 }, keyframes: [] };
  const sub1 = { id: 'sub1', trackId: subTrack.id, type: 'subtitle' as const, start: 0, duration: 2, text: '你好', visible: true, style: { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 } };
  d.clips['v1'] = v1; d.clips['a1'] = a1; d.clips['sub1'] = sub1;
  videoTrack.clips.push('v1');
  audioTrack.clips.push('a1');
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
    expect(screen.getByTestId('playhead-line')).toBeInTheDocument(); // 贯穿播放头（执行期 I3）
  });
  it('空轨渲染占位条，控制条有撤销/重做/分割/删除（Task 8 迁入预览控制条——补渲染 PreviewPlayer 保持断言语义）', () => {
    useEditorStore.setState({ status: 'ready', data: createDefaultProjectData(), projectId: 'p1', sourceNodeId: 'edit1', baseUpdatedAt: 't' });
    render(<><PreviewPlayer /><TimelinePanel /></>);
    expect(screen.getByRole('button', { name: '撤销' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重做' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '分割' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument();
  });
  it('Ctrl+滚轮缩放：原生 wheel 监听改 pxPerSec（passive:false——I1）', () => {
    useEditorStore.setState({ status: 'ready', data: createDefaultProjectData(), projectId: 'p1', sourceNodeId: 'edit1', baseUpdatedAt: 't' });
    // 判别力核心：wheel 必须以 { passive: false } 原生注册在滚动元素上（react-dom 根容器 wheel 是 passive，合成 onWheel 的 preventDefault 无效）
    const addSpy = vi.spyOn(HTMLElement.prototype, 'addEventListener');
    render(<TimelinePanel />);
    // 注：React root 自身以 passive:true 委托 wheel，必须断言"存在 passive:false 注册"而非首个注册
    const hasPassiveFalseWheel = addSpy.mock.calls.some(
      ([type, , opts]) => type === 'wheel' && (opts as AddEventListenerOptions | undefined)?.passive === false,
    );
    expect(hasPassiveFalseWheel).toBe(true);
    addSpy.mockRestore();
    const panel = screen.getByTestId('timeline-panel');
    const scroll = panel.querySelector('.overflow-x-auto') as HTMLElement;
    const before = useEditorStore.getState().pxPerSec;
    fireEvent.wheel(scroll, { ctrlKey: true, deltaY: -100 });
    expect(useEditorStore.getState().pxPerSec).toBeGreaterThan(before);
    const after = useEditorStore.getState().pxPerSec;
    fireEvent.wheel(scroll, { ctrlKey: false, deltaY: -100 }); // 非 Ctrl 不缩放
    expect(useEditorStore.getState().pxPerSec).toBe(after);
  });
  it('视频片段渲染帧缩略图平铺：background-image=thumbnailUrl + repeat-x + auto 100%', () => {
    const d = dataWithClips();
    useEditorStore.setState({
      status: 'ready', data: d, projectId: 'p1', sourceNodeId: 'edit1', baseUpdatedAt: 't',
      mediaInfo: { m1: { name: '视频A', durationSec: 10, thumbnailUrl: 'http://x/t.jpg' } },
    });
    render(<TimelinePanel />);
    const el = screen.getByTestId('clip-block-v1') as HTMLElement;
    // jsdom CSSOM 序列化 url 值带双引号——只断前缀
    expect(el.style.backgroundImage).toContain('url(');
    expect(el.style.backgroundRepeat).toBe('repeat-x'); // 逐字精确断言（实测可靠）
    expect(el.style.backgroundSize).toBe('auto 100%');
  });

  it('轨道色表：subtitle #5DBAA0 / audio #8F5DBA / video 兜底 var(--ve-track-video)', () => {
    const d = dataWithClips();
    useEditorStore.setState({
      status: 'ready', data: d, projectId: 'p1', sourceNodeId: 'edit1', baseUpdatedAt: 't',
      mediaInfo: { m1: { name: '视频A', durationSec: 10 }, m2: { name: '音频B', durationSec: 5 } },
    });
    // 夹具 v1 带 sourceNodeId:'s1'（missing 红底会盖过色表）——先注入节点解除红态，与下方 missing 用例口径一致
    act(() => { useCanvasStore.setState({ nodes: [{ id: 's1', position: { x: 0, y: 0 }, data: {} } as never] }); });
    render(<TimelinePanel />);
    // jest-dom 两侧过 CSSOM 归一：'#5DBAA0' ↔ 'rgb(93, 186, 160)'、'#8F5DBA' ↔ 'rgb(143, 93, 186)'
    expect(screen.getByTestId('clip-block-sub1')).toHaveStyle({ backgroundColor: '#5DBAA0' });
    expect(screen.getByTestId('clip-block-a1')).toHaveStyle({ backgroundColor: '#8F5DBA' });
    // var() 原样字符串——jsdom 不解析 CSS 变量
    expect((screen.getByTestId('clip-block-v1') as HTMLElement).style.backgroundColor).toBe('var(--ve-track-video)');
    // 恢复全局 canvasStore（测试隔离，同 missing 用例）
    act(() => { useCanvasStore.setState({ nodes: [] }); });
  });

  it('素材缺失态：sourceNodeId 不在画布 → 红态角标；源节点回画布 → 消失', () => {
    const d = dataWithClips(); // 夹具 v1 带 sourceNodeId: 's1'（canvasStore.nodes 默认不含 → 红态）
    useEditorStore.setState({ status: 'ready', data: d, projectId: 'p1', sourceNodeId: 'edit1', baseUpdatedAt: 't' });
    render(<TimelinePanel />);
    expect(screen.getByText('素材已删除')).toBeInTheDocument();
    act(() => { useCanvasStore.setState({ nodes: [{ id: 's1', position: { x: 0, y: 0 }, data: {} } as never] }); });
    expect(screen.queryByText('素材已删除')).not.toBeInTheDocument();
    // 恢复全局 canvasStore（本用例动了 nodes——后续/他文件用例依赖默认空 nodes，测试隔离）
    act(() => { useCanvasStore.setState({ nodes: [] }); });
  });
});
