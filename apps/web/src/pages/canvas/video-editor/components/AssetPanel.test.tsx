import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AssetPanel } from './AssetPanel';
import { useEditorStore } from '../store/editorStore';
import { createDefaultProjectData } from '../types';
import { batchGetMedia, type BatchMediaItem } from '@/api/mediaApi';
import { useNodeStore } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';

vi.mock('@/api/mediaApi', () => ({ batchGetMedia: vi.fn() }));

const mkItem = (id: string, name: string, mime: string, metadata: Record<string, unknown> = {}): BatchMediaItem =>
  ({ id, originalName: name, mimeType: mime, url: `http://${id}`, thumbnailUrl: null, size: 1, metadata });

describe('AssetPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.getState().reset();
    useEditorStore.setState({ status: 'ready', data: createDefaultProjectData(), projectId: 'p1', sourceNodeId: 'edit1', baseUpdatedAt: 't' });
    // 素材缺失守卫（Task 8 I1）：ensureAutoEdges 的 toAdd 按画布现存节点过滤——断言 auto 边存在须提供 edit1/v1 节点（执行期修正）
    useCanvasStore.setState({
      nodes: [
        { id: 'edit1', type: 'videoEdit', position: { x: 0, y: 0 }, data: {} } as any,
        { id: 'v1', type: 'videoGen', position: { x: 0, y: 0 }, data: {} } as any,
      ],
      edges: [], selectedId: null,
    });
    useNodeStore.setState({
      nodes: {
        v1: { id: 'v1', type: 'videoGen', position: { x: 0, y: 0 }, data: { fileId: 'm1', status: 'done', duration: 5 } }, // 节点配置 5s——与素材 metadata 8s 双值分解（R4 P1-1）
      } as any,
    });
  });

  it('渲染资产条目（缩略图占位 + 名称）', async () => {
    (batchGetMedia as any).mockResolvedValue([mkItem('m1', '视频A.mp4', 'video/mp4')]);
    render(<AssetPanel />);
    await waitFor(() => expect(screen.getByText('视频A.mp4')).toBeInTheDocument());
  });

  it('搜索框过滤', async () => {
    (batchGetMedia as any).mockResolvedValue([mkItem('m1', '视频A.mp4', 'video/mp4'), mkItem('m2', '音乐B.mp3', 'audio/mpeg')]);
    render(<AssetPanel />);
    await waitFor(() => expect(screen.getByText('音乐B.mp3')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('搜索资产'), { target: { value: '视频' } });
    expect(screen.queryByText('音乐B.mp3')).not.toBeInTheDocument();
    expect(screen.getByText('视频A.mp4')).toBeInTheDocument();
  });

  it('已添加标记：时间轴引用的 mediaId 显示"已添加"', async () => {
    (batchGetMedia as any).mockResolvedValue([mkItem('m1', '视频A.mp4', 'video/mp4'), mkItem('m2', '音乐B.mp3', 'audio/mpeg')]);
    render(<AssetPanel />);
    await waitFor(() => expect(screen.getByText('视频A.mp4')).toBeInTheDocument());
    const d = useEditorStore.getState().data!;
    // act 包裹：render 后事件外的 zustand setState 走微任务调度，同步查询前必须 flush 渲染（同 TimelinePanel.interact 先例）
    act(() => { useEditorStore.getState().addClip({ type: 'video', mediaId: 'm1', sourceNodeId: 'v1', trackId: d.tracks[0].id, start: 0 }); });
    expect(screen.getByText('已添加')).toBeInTheDocument();
  });

  it('dragStart payload：节点配置时长优先于 media metadata（决策 6 第一优先级，R4 P1-1）', async () => {
    (batchGetMedia as any).mockResolvedValue([mkItem('m1', '视频A.mp4', 'video/mp4', { durationSec: 8 })]);
    render(<AssetPanel />);
    await waitFor(() => expect(screen.getByText('视频A.mp4')).toBeInTheDocument());
    const setData = vi.fn();
    fireEvent.dragStart(screen.getByTestId('asset-item-m1'), { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith('application/x-clip', expect.any(String));
    const payload = JSON.parse(setData.mock.calls[0][1] as string);
    expect(payload).toMatchObject({ mediaId: 'm1', sourceNodeId: 'v1', originalName: '视频A.mp4' });
    expect(payload.durationSec).toBe(5); // 节点 5s 胜出 metadata 8s——优先级在此锁死
  });

  it('drop 到视频轨 → addClip（带 sourceNodeId，连线同步闭环起点）', async () => {
    (batchGetMedia as any).mockResolvedValue([mkItem('m1', '视频A.mp4', 'video/mp4')]);
    const { TimelinePanel } = await import('./timeline/TimelinePanel');
    render(<TimelinePanel />);
    const trackBody = document.querySelector('[data-track-type="video"]')!;
    // payload 是 dragStart 汇点解析后的"已解析时长"契约——本用例锁 drop 侧消费（payload 8 → 片段 8），
    // 与 dragStart 用例（节点 5 胜出 metadata 8 → payload 5）双值分解，任一侧回归均可独立定位
    const payload = JSON.stringify({
      mediaId: 'm1', sourceNodeId: 'v1', mimeType: 'video/mp4',
      originalName: '视频A.mp4', durationSec: 8,
    });
    fireEvent.drop(trackBody, {
      dataTransfer: { getData: (type: string) => (type === 'application/x-clip' ? payload : '') },
      clientX: trackBody.getBoundingClientRect().left + 80, // 80px = 1s @80px/s
    });
    const d = useEditorStore.getState().data!;
    expect(d.tracks[0].clips).toHaveLength(1);
    const clipId = d.tracks[0].clips[0];
    expect((d.clips[clipId] as any).sourceNodeId).toBe('v1');
    expect(d.clips[clipId].duration).toBe(8);
    expect(useEditorStore.getState().mediaInfo['m1']).toMatchObject({
      name: '视频A.mp4', durationSec: 8,
    });
    expect(useCanvasStore.getState().edges.some(e => e.id === 'auto:edit1:v1')).toBe(true); // 连线闭环
  });

  it('drop 到字幕轨 → 忽略（错型不入库——review I1）', async () => {
    (batchGetMedia as any).mockResolvedValue([mkItem('m1', '视频A.mp4', 'video/mp4')]);
    const { TimelinePanel } = await import('./timeline/TimelinePanel');
    render(<TimelinePanel />);
    const subTrackBody = document.querySelector('[data-track-type="subtitle"]')!;
    const payload = JSON.stringify({
      mediaId: 'm1', sourceNodeId: 'v1', mimeType: 'video/mp4',
      originalName: '视频A.mp4', durationSec: 8,
    });
    fireEvent.drop(subTrackBody, {
      dataTransfer: { getData: (type: string) => (type === 'application/x-clip' ? payload : '') },
      clientX: 80,
    });
    const subTrack = useEditorStore.getState().data!.tracks.find(t => t.type === 'subtitle')!;
    expect(subTrack.clips).toHaveLength(0); // 视频素材不进字幕轨
  });
});
