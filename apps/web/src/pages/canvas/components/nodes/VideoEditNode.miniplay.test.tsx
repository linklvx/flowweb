import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import * as Y from 'yjs';
import { VideoEditNode } from './VideoEditNode';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { setTimelineDocRef } from '@/stores/timelineUndo';
import type { ProjectData } from '@/pages/canvas/video-editor/types';

vi.mock('@/api/mediaApi', () => ({ batchGetMedia: vi.fn(async () => []) })); // G10：loadMediaUrls 不发真 fetch
// 决策 16 后组件不 import audioEngine——无 engine mock（playback.ts 的 engine 依赖也不在本组件链上）
vi.mock('@/pages/canvas/video-editor/renderer/render-frame', () => ({ renderFrameAt: vi.fn(async () => { }) })); // 播放循环隔离（jsdom getContext 返回 null → 播放 effect 早退，rAF 循环实际不启动；renderFrameAt mock 防 deps 构造路径意外触发）
vi.mock('@/pages/canvas/video-editor/renderer/video-cache', () => ({ videoCache: { release: vi.fn() } }));
vi.mock('@/pages/canvas/video-editor/renderer/image-cache', () => ({ clearImageBitmaps: vi.fn(), getImageBitmap: vi.fn(async () => null) }));

const props = (id = 'n1', selected = false) => ({ id, selected, dragging: false }) as any;
void ({} as ProjectData);   // 形态随装置移入 doc（上面 beforeEach 种入 timelines.n1）

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
  let live: Y.Doc;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('VideoDecoder', function () {});
    vi.stubGlobal('AudioDecoder', function () {});
    vi.stubGlobal('OffscreenCanvas', function () {});
    ioInstances = [];
    vi.stubGlobal('IntersectionObserver', class extends IO { constructor(cb: IntersectionObserverCallback) { super(cb); ioInstances.push(this); } });
    useVideoEditorStore.setState({ open: false, sourceNodeId: null, closedAt: 0, miniPlaybackNodeId: null });
    // Y4a T7：迷你画布数据源=内存 doc 直读（timelines.n1 由装置种入——zero REST）
    live = new Y.Doc();
    setTimelineDocRef(live);
    live.transact(() => {
      const track = new Y.Map();
      track.set('type', 'video'); track.set('name', 'V');
      track.set('muted', false); track.set('hidden', false); track.set('order', '5000');
      const tracks = new Y.Map(); tracks.set('n1:video', track);
      const c1 = new Y.Map();
      c1.set('type', 'video');
      c1.set('span', { trackId: 'n1:video', start: 0, duration: 3, sourceStart: 0 });
      c1.set('mediaId', 'm1'); c1.set('playbackSpeed', 1);
      c1.set('transform', { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
      c1.set('keyframes', new Y.Map());
      const clips = new Y.Map(); clips.set('c1', c1);
      const entry = new Y.Map();
      entry.set('version', 1); entry.set('fps', 30);
      entry.set('tracks', tracks); entry.set('clips', clips);
      live.getMap('timelines').set('n1', entry);
    }, 'local-user');
  });
  afterEach(() => { vi.unstubAllGlobals(); setTimelineDocRef(null); live.destroy(); });

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
