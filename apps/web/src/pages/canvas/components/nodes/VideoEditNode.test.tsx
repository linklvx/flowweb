// apps/web/src/pages/canvas/components/nodes/VideoEditNode.test.tsx
// Y4a T7：迷你画布/缩略数据源改内存 doc 直读（timelines.<id> readTimelineFromDoc——zero REST）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import * as Y from 'yjs';
import { VideoEditNode } from './VideoEditNode';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { setTimelineDocRef } from '@/stores/timelineUndo';

// NodeProps 必填字段多——测试只传组件消费的三项，统一 as any
const props = (id = 'n1') => ({ id, selected: false, dragging: false }) as any;

// Handle 需要 ReactFlow store 上下文（无 Provider 抛 error001）——与既有节点测试一致
const renderNode = (id?: string) =>
  render(
    <ReactFlowProvider>
      <VideoEditNode {...props(id)} />
    </ReactFlowProvider>
  );

/** doc 装置：timelines.n1 工程入口（seed=false 不种键——空态档；seed=true 种入口+一片段）。 */
function setupDoc(seed?: boolean): { doc: Y.Doc; seedClip: (id: string) => void } {
  const doc = new Y.Doc();
  setTimelineDocRef(doc);
  if (seed) { seedEntry(doc); seedClipInto(doc, 'c0'); }
  return { doc, seedClip: (id: string) => seedClipInto(doc, id) };
}
function seedEntry(doc: Y.Doc): void {
  doc.transact(() => {
    const track = new Y.Map();
    track.set('type', 'video'); track.set('name', '视频');
    track.set('muted', false); track.set('hidden', false); track.set('order', '5000');
    const tracks = new Y.Map(); tracks.set('n1:video', track);
    const entry = new Y.Map();
    entry.set('version', 1); entry.set('fps', 30);
    entry.set('tracks', tracks); entry.set('clips', new Y.Map());
    doc.getMap('timelines').set('n1', entry);
  }, 'local-user');
}
function seedClipInto(doc: Y.Doc, cid: string): void {
  doc.transact(() => {
    const entry = doc.getMap('timelines').get('n1') as Y.Map<unknown>;
    const c = new Y.Map();
    c.set('type', 'video');
    c.set('span', { trackId: 'n1:video', start: 0, duration: 3, sourceStart: 0 });
    c.set('mediaId', 'm1'); c.set('playbackSpeed', 1);
    c.set('transform', { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
    c.set('keyframes', new Y.Map());
    (entry.get('clips') as Y.Map<unknown>).set(cid, c);
  }, 'local-user');
}

describe('VideoEditNode 本体（Y4a T7：doc 直读——zero REST）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('VideoDecoder', function () {});
    vi.stubGlobal('AudioDecoder', function () {});
    vi.stubGlobal('OffscreenCanvas', function () {});
    useVideoEditorStore.setState({ open: false, sourceNodeId: null, closedAt: 0 });
  });
  afterEach(() => { vi.unstubAllGlobals(); setTimelineDocRef(null); });

  it('doc 无该节点工程键 → 空态"+ 添加素材"，无执行按钮', async () => {
    const { doc } = setupDoc(false);
    void doc;
    renderNode();
    await waitFor(() => expect(screen.getByText('+ 添加素材')).toBeInTheDocument());
    expect(screen.queryByText('执行')).not.toBeInTheDocument();
  });

  it('doc 里 timelines.n1 含片段 → 渲染片段色块 + 时间码 M:SS', async () => {
    const { doc } = setupDoc(true);
    seedClipInto(doc, 'c1');
    renderNode();
    await waitFor(() => expect(screen.getByTestId('node-clip-c1')).toBeInTheDocument());
    expect(screen.getByText('0:00 / 0:03')).toBeInTheDocument(); // 总长 3s（多文本节点合并为整串匹配）
  });

  it('全屏编辑 → videoEditorStore.openEditor(id)', async () => {
    const { doc } = setupDoc(true);
    void doc;
    renderNode();
    await waitFor(() => expect(screen.getByTestId('node-track-thumb')).toBeInTheDocument());
    fireEvent.click(screen.getByText('⤢ 全屏编辑'));
    expect(useVideoEditorStore.getState()).toMatchObject({ open: true, sourceNodeId: 'n1' });
  });

  it('能力不满足 → 全屏编辑置灰不可点', async () => {
    vi.unstubAllGlobals(); // 三件全缺
    const { doc } = setupDoc(true);
    void doc;
    renderNode();
    await waitFor(() => expect(screen.getByTestId('node-track-thumb')).toBeInTheDocument());
    const btn = screen.getByText('⤢ 全屏编辑').closest('button')!;
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(useVideoEditorStore.getState().open).toBe(false);
  });

  it('closedAt 递增且 sourceNodeId 匹配 → 重读 doc 缩略（编辑器关闭后新片段可见）', async () => {
    const { doc } = setupDoc(true);
    renderNode();
    await waitFor(() => expect(screen.getByTestId('node-clip-c0')).toBeInTheDocument());
    // 编辑器在本节点上打开又关闭——期间 doc 落了新片段 → 关闭触发重读（closedAt 递增）
    seedClipInto(doc, 'c2');
    useVideoEditorStore.setState({ closedAt: 1, sourceNodeId: 'n1' });
    await waitFor(() => expect(screen.getByTestId('node-clip-c2')).toBeInTheDocument());
  });

  it('closedAt 递增但 sourceNodeId 指向其他节点 → 不重读（M2 精确化）', async () => {
    const { doc } = setupDoc(true);
    renderNode();
    await waitFor(() => expect(screen.getByTestId('node-clip-c0')).toBeInTheDocument());
    seedClipInto(doc, 'c3');
    useVideoEditorStore.setState({ closedAt: 1, sourceNodeId: 'other-node' });
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByTestId('node-clip-c3')).not.toBeInTheDocument(); // 不匹配不重读
  });

  it('左右 Handle 渲染（单 target/source）', async () => {
    const { doc } = setupDoc(true);
    void doc;
    renderNode();
    await waitFor(() => expect(screen.getByTestId('node-track-thumb')).toBeInTheDocument());
    expect(document.querySelector('[data-testid="video-edit-target"]')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="video-edit-source"]')).toBeInTheDocument();
  });

  it('能力不满足 → hover 全屏编辑显示不支持提示（Tooltip span 包裹——C1 回归锁）', async () => {
    vi.unstubAllGlobals(); // 三件全缺
    const { doc } = setupDoc(true);
    void doc;
    renderNode();
    await waitFor(() => expect(screen.getByTestId('node-track-thumb')).toBeInTheDocument());
    fireEvent.mouseEnter(screen.getByText('⤢ 全屏编辑').closest('button')!.parentElement!);
    const tip = await screen.findByText('当前浏览器不支持 WebCodecs，请使用最新版 Chrome/Edge');
    expect(tip).toBeInTheDocument();
  });
});
