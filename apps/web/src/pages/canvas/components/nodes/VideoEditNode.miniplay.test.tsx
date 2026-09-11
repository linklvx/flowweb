import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { VideoEditNode } from './VideoEditNode';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import type { ProjectData } from '@/pages/canvas/video-editor/types';

vi.mock('@/api/videoProjectApi', () => ({ getProjectByNode: vi.fn() }));
import { getProjectByNode } from '@/api/videoProjectApi';
vi.mock('@/api/mediaApi', () => ({ batchGetMedia: vi.fn(async () => []) })); // G10：loadMediaUrls 不发真 fetch
// 决策 16 后组件不 import audioEngine——无 engine mock（playback.ts 的 engine 依赖也不在本组件链上）
vi.mock('@/pages/canvas/video-editor/renderer/render-frame', () => ({ renderFrameAt: vi.fn(async () => { }) })); // 播放循环隔离（jsdom getContext 返回 null → 播放 effect 早退，rAF 循环实际不启动；renderFrameAt mock 防 deps 构造路径意外触发）
vi.mock('@/pages/canvas/video-editor/renderer/video-cache', () => ({ videoCache: { release: vi.fn() } }));
vi.mock('@/pages/canvas/video-editor/renderer/image-cache', () => ({ clearImageBitmaps: vi.fn(), getImageBitmap: vi.fn(async () => null) }));

const props = (id = 'n1', selected = false) => ({ id, selected, dragging: false }) as any;
const data = (): ProjectData => {
  const d: ProjectData = { version: 1, fps: 30, tracks: [{ id: 'tv', type: 'video', name: 'V', muted: false, hidden: false, clips: ['c1'] }],
    clips: { c1: { id: 'c1', trackId: 'tv', type: 'video', start: 0, duration: 3, sourceStart: 0, mediaId: 'm1', playbackSpeed: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] } } };
  return d;
};

// IntersectionObserver mock（jsdom/本仓均无——研究 §8）
const observeMock = vi.fn();
const unobserveMock = vi.fn();
class IO {
  constructor(private cb: IntersectionObserverCallback) {}
  observe = observeMock;
  unobserve = unobserveMock;
  disconnect = vi.fn();
  trigger(isVisible: boolean) { this.cb([{ isIntersecting: isVisible } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
}

describe('VideoEditNode 迷你播放（资源纪律）', () => {
  let ioInstances: IO[];
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('VideoDecoder', function () {});
    vi.stubGlobal('AudioDecoder', function () {});
    vi.stubGlobal('OffscreenCanvas', function () {});
    ioInstances = [];
    vi.stubGlobal('IntersectionObserver', class extends IO { constructor(cb: IntersectionObserverCallback) { super(cb); ioInstances.push(this); } });
    useVideoEditorStore.setState({ open: false, sourceNodeId: null, closedAt: 0, miniPlaybackNodeId: null });
    vi.mocked(getProjectByNode).mockResolvedValue({ id: 'p1', data: data() } as never);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderNode = (selected = false) => render(<ReactFlowProvider><VideoEditNode {...props('n1', selected)} /></ReactFlowProvider>);

  it('播放按钮激活：点击 → startMiniPlayback(本节点) + 本地播放态', async () => {
    renderNode();
    await waitFor(() => expect(screen.getByTestId('node-track-thumb')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('node-play-btn'));
    expect(useVideoEditorStore.getState().miniPlaybackNodeId).toBe('n1');
    expect(screen.getByTestId('node-mini-canvas')).toBeInTheDocument(); // 播放时显示迷你画布
  });

  it('互斥：miniPlaybackNodeId 指向其他节点 → 本地停止', async () => {
    renderNode();
    await waitFor(() => expect(screen.getByTestId('node-track-thumb')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('node-play-btn'));
    useVideoEditorStore.getState().startMiniPlayback('other-node'); // 播 B
    await waitFor(() => expect(screen.queryByTestId('node-mini-canvas')).not.toBeInTheDocument());
    expect(screen.getByTestId('node-play-btn').textContent).toBe('▶');
  });

  it('全屏编辑打开 → 迷你播放停止（资源纪律④）', async () => {
    renderNode();
    await waitFor(() => expect(screen.getByTestId('node-track-thumb')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('node-play-btn'));
    useVideoEditorStore.getState().openEditor('n1');
    await waitFor(() => expect(screen.queryByTestId('node-mini-canvas')).not.toBeInTheDocument());
  });

  it('移出视口（IO 不可见）→ 停止 + videoCache.release（资源纪律③）', async () => {
    const { videoCache } = await import('@/pages/canvas/video-editor/renderer/video-cache');
    renderNode();
    await waitFor(() => expect(ioInstances.length).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId('node-play-btn'));
    (ioInstances[0] as IO).trigger(false); // 移出视口
    await waitFor(() => expect(screen.queryByTestId('node-mini-canvas')).not.toBeInTheDocument());
    expect(videoCache.release).toHaveBeenCalled();
  });

  it('取消选中（selected prop 变 false）→ 停止（资源纪律③）', async () => {
    const { rerender } = render(<ReactFlowProvider><VideoEditNode {...props('n1', true)} /></ReactFlowProvider>);
    await waitFor(() => expect(screen.getByTestId('node-track-thumb')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('node-play-btn'));
    rerender(<ReactFlowProvider><VideoEditNode {...props('n1', false)} /></ReactFlowProvider>);
    await waitFor(() => expect(screen.queryByTestId('node-mini-canvas')).not.toBeInTheDocument());
  });

  it('卸载（节点删除/画布卸载）中播放 → 停止并释放（资源纪律③——卸载清理 effect）', async () => {
    const { videoCache } = await import('@/pages/canvas/video-editor/renderer/video-cache');
    const { unmount } = renderNode();
    await waitFor(() => expect(screen.getByTestId('node-track-thumb')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('node-play-btn'));
    expect(screen.getByTestId('node-mini-canvas')).toBeInTheDocument();
    (videoCache.release as ReturnType<typeof vi.fn>).mockClear();
    unmount();
    expect(videoCache.release).toHaveBeenCalled();
  });
});
