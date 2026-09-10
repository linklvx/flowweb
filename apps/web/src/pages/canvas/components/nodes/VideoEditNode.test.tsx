// apps/web/src/pages/canvas/components/nodes/VideoEditNode.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { VideoEditNode } from './VideoEditNode';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { getProjectByNode } from '@/api/videoProjectApi';
import type { ProjectData } from '@/pages/canvas/video-editor/types';

vi.mock('@/api/videoProjectApi', () => ({
  getProjectByNode: vi.fn(),
}));

// NodeProps 必填字段多——测试只传组件消费的三项，统一 as any
const props = (id = 'n1') => ({ id, selected: false, dragging: false }) as any;

// Handle 需要 ReactFlow store 上下文（无 Provider 抛 error001）——与既有节点测试一致
const renderNode = (id?: string) =>
  render(
    <ReactFlowProvider>
      <VideoEditNode {...props(id)} />
    </ReactFlowProvider>
  );

const mkData = (): ProjectData => {
  const entries = (() => {
    const v = {
      id: 'c1', trackId: 'tv', type: 'video' as const, start: 0, duration: 3, sourceStart: 0, mediaId: 'm1', playbackSpeed: 1 as const,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
    };
    return [['c1', v]] as const;
  })();
  return {
    version: 1, fps: 30,
    tracks: [{ id: 'tv', type: 'video', name: '视频', muted: false, hidden: false, clips: ['c1'] }],
    clips: Object.fromEntries(entries),
  };
};

describe('VideoEditNode 本体', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('VideoDecoder', function () {});
    vi.stubGlobal('AudioDecoder', function () {});
    vi.stubGlobal('OffscreenCanvas', function () {});
    useVideoEditorStore.setState({ open: false, sourceNodeId: null, closedAt: 0 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('工程不存在 → 空态"+ 添加素材"，无执行按钮', async () => {
    (getProjectByNode as any).mockResolvedValue(null);
    renderNode();
    await waitFor(() => expect(screen.getByText('+ 添加素材')).toBeInTheDocument());
    expect(screen.queryByText('执行')).not.toBeInTheDocument();
  });

  it('有工程 → 渲染片段色块 + 时间码 M:SS', async () => {
    (getProjectByNode as any).mockResolvedValue({ id: 'p1', data: mkData() });
    renderNode();
    await waitFor(() => expect(screen.getByTestId('node-clip-c1')).toBeInTheDocument());
    expect(screen.getByText('0:00 / 0:03')).toBeInTheDocument(); // 总长 3s（多文本节点合并为整串匹配）
  });

  it('全屏编辑 → videoEditorStore.openEditor(id)', async () => {
    (getProjectByNode as any).mockResolvedValue(null);
    renderNode();
    await waitFor(() => expect(screen.getByText('+ 添加素材')).toBeInTheDocument());
    fireEvent.click(screen.getByText('⤢ 全屏编辑'));
    expect(useVideoEditorStore.getState()).toMatchObject({ open: true, sourceNodeId: 'n1' });
  });

  it('能力不满足 → 全屏编辑置灰不可点', async () => {
    vi.unstubAllGlobals(); // 三件全缺
    (getProjectByNode as any).mockResolvedValue(null);
    renderNode();
    await waitFor(() => expect(screen.getByText('+ 添加素材')).toBeInTheDocument());
    const btn = screen.getByText('⤢ 全屏编辑').closest('button')!;
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(useVideoEditorStore.getState().open).toBe(false);
  });

  it('closedAt 递增且 sourceNodeId 匹配 → refetch 工程缩略', async () => {
    (getProjectByNode as any).mockResolvedValue(null);
    renderNode();
    await waitFor(() => expect(getProjectByNode).toHaveBeenCalledTimes(1));
    useVideoEditorStore.setState({ closedAt: 1, sourceNodeId: 'n1' }); // 编辑器在本节点上关闭
    await waitFor(() => expect(getProjectByNode).toHaveBeenCalledTimes(2));
  });

  it('左右 Handle 渲染（单 target/source）', async () => {
    (getProjectByNode as any).mockResolvedValue(null);
    renderNode();
    await waitFor(() => expect(screen.getByText('+ 添加素材')).toBeInTheDocument());
    expect(document.querySelector('[data-testid="video-edit-target"]')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="video-edit-source"]')).toBeInTheDocument();
  });

  it('能力不满足 → hover 全屏编辑显示不支持提示（Tooltip span 包裹——C1 回归锁）', async () => {
    vi.unstubAllGlobals(); // 三件全缺
    (getProjectByNode as any).mockResolvedValue(null);
    renderNode();
    await waitFor(() => expect(screen.getByText('+ 添加素材')).toBeInTheDocument());
    fireEvent.mouseEnter(screen.getByText('⤢ 全屏编辑').closest('button')!.parentElement!);
    const tip = await screen.findByText('当前浏览器不支持 WebCodecs，请使用最新版 Chrome/Edge');
    expect(tip).toBeInTheDocument();
  });

  it('closedAt 递增但 sourceNodeId 指向其他节点 → 不 refetch（M2 精确化）', async () => {
    (getProjectByNode as any).mockResolvedValue(null);
    renderNode();
    await waitFor(() => expect(getProjectByNode).toHaveBeenCalledTimes(1));
    useVideoEditorStore.setState({ closedAt: 1, sourceNodeId: 'other-node' });
    await new Promise(r => setTimeout(r, 50));
    expect(getProjectByNode).toHaveBeenCalledTimes(1); // 不匹配不重取
  });
});
