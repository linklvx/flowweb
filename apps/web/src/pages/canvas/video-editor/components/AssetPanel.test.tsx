import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AssetPanel } from './AssetPanel';
import { useEditorStore } from '../store/editorStore';
import { createDefaultProjectData } from '../types';
import { batchGetMedia, type BatchMediaItem } from '@/api/mediaApi';
import { useNodeStore } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { presignUpload, confirmUpload } from '@/api/storageApi';

vi.mock('@/api/mediaApi', () => ({ batchGetMedia: vi.fn() }));

// R4-10：挂 useTeamAssets 后组件 mount 即发 axios.get——不打真 XHR（句柄模块级暴露，上传用例断言复用）。
// 响应实形：TransformInterceptor 包 {code,data,message} → res.data.data = {success,data:[]}（双层 data）
const { axiosGet, axiosPost } = vi.hoisted(() => ({
  axiosGet: vi.fn().mockResolvedValue({ data: { code: 0, message: 'ok', data: { success: true, data: [] } } }),
  axiosPost: vi.fn().mockResolvedValue({ status: 200 }),
}));
vi.mock('axios', () => ({ default: { get: (...a: unknown[]) => axiosGet(...a), post: (...a: unknown[]) => axiosPost(...a) } }));
vi.mock('@/api/storageApi', () => ({ presignUpload: vi.fn(), confirmUpload: vi.fn() }));
const { messageSuccess, messageError, messageWarning, messageInfo, confirmMock } = vi.hoisted(() => ({
  messageSuccess: vi.fn(), messageError: vi.fn(), messageWarning: vi.fn(), messageInfo: vi.fn(), confirmMock: vi.fn(),
}));
vi.mock('antd', async (importOriginal) => {
  const orig = await importOriginal<typeof import('antd')>();
  return {
    ...orig, // Input 等保真
    // 批1-2：组件 message 改经 App.useApp()——antd context 默认值无 static 回退，裸渲染必须 stub（四键齐全防未来通道撞 is not a function）
    App: { ...orig.App, useApp: () => ({ message: { success: messageSuccess, error: messageError, warning: messageWarning, info: messageInfo }, modal: { confirm: confirmMock } }) },
  };
});

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
    act(() => { useEditorStore.getState().addTrack('subtitle'); }); // 单轨默认值下显式建字幕轨（与生产动态建轨对齐）
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

  it('"+新建"上传：presignUpload → FormData POST → confirmUpload → 刷新团队素材 + mergeMediaInfo（遗留①：上传产物入面板）', async () => {
    (batchGetMedia as any).mockResolvedValue([]); // beforeEach 建了 v1 节点 → 全集资产 hook 会调 batchGetMedia（本用例聚焦团队素材）
    useCanvasStore.setState({ projectId: 'wf1' }); // R4-9 夹具前置：presign 透传画布 projectId（后端解析归属团队）
    (presignUpload as any).mockResolvedValue({ fileId: 'up-1', uploadUrl: 'https://minio/flowai/up', key: 'k', fields: { policy: 'p' } });
    (confirmUpload as any).mockResolvedValue({ fileId: 'up-1' });
    const { container } = render(<AssetPanel />);
    await waitFor(() => expect(screen.getByText('暂无团队素材')).toBeInTheDocument()); // 首次加载空列表（hoisted 默认 mock）
    // 上传"完成后的服务端状态"——二次拉取（teamKey+1 刷新路径）返回含 up-1
    axiosGet.mockResolvedValue({ data: { code: 0, message: 'ok', data: { success: true, data: [
      { id: 'up-1', originalName: '上传a.mp4', mimeType: 'video/mp4', url: 'https://minio/flowai/a', thumbnailUrl: null, metadata: { durationSec: 3 } },
    ] } } });
    const file = new File(['x'], '上传a.mp4', { type: 'video/mp4' });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await waitFor(() => expect(messageSuccess).toHaveBeenCalledWith('上传完成'));
    expect(presignUpload).toHaveBeenCalledWith(expect.objectContaining({ fileName: '上传a.mp4', type: 'uploaded', projectId: 'wf1' })); // R4-9：projectId 透传
    expect(axiosPost).toHaveBeenCalledWith('/flowai/up', expect.any(FormData)); // uploadUrl 经 /flowai 同源改写（materialLibraryStore 同款）
    expect(confirmUpload).toHaveBeenCalledWith({ fileId: 'up-1', key: 'k', fileSize: file.size });
    expect(axiosGet.mock.calls.filter((c: unknown[]) => c[0] === '/api/material/files').length).toBeGreaterThanOrEqual(2); // setTeamKey+1 刷新路径
    expect(screen.getByText('上传a.mp4')).toBeInTheDocument(); // 团队素材列表刷新含 up-1
    expect(useEditorStore.getState().mediaInfo['up-1']).toMatchObject({ name: '上传a.mp4', url: '/flowai/a', mimeType: 'video/mp4', durationSec: 3 }); // P1-9
  });

  it('上传负路径：非媒体文件（pdf）客户端前置拒绝——message.error 且 presign 未调（review I-2：accept 仅提示可绕过，防隐形上传占配额）', async () => {
    (batchGetMedia as any).mockResolvedValue([]);
    axiosGet.mockResolvedValue({ data: { code: 0, message: 'ok', data: { success: true, data: [] } } }); // 正向用例覆写过实现——还原空列表（mockResolvedValue 跨用例存续）
    const { container } = render(<AssetPanel />);
    await waitFor(() => expect(screen.getByText('暂无团队素材')).toBeInTheDocument());
    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    expect(messageError).toHaveBeenCalledWith('仅支持视频、音频、图片文件');
    expect(presignUpload).not.toHaveBeenCalled();
  });

  it('上传负路径：超 2GB 客户端前置拒绝——message.error 且 presign 未调（I-2：编辑器素材放宽值，先例 100MB 不足 15min 视频剪辑）', async () => {
    (batchGetMedia as any).mockResolvedValue([]);
    axiosGet.mockResolvedValue({ data: { code: 0, message: 'ok', data: { success: true, data: [] } } }); // 同上
    const { container } = render(<AssetPanel />);
    await waitFor(() => expect(screen.getByText('暂无团队素材')).toBeInTheDocument());
    const file = new File(['x'], 'big.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'size', { value: 2 * 1024 * 1024 * 1024 + 1 }); // 实例覆写免真分配 2GB
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    expect(messageError).toHaveBeenCalledWith('文件超过大小限制');
    expect(presignUpload).not.toHaveBeenCalled();
  });
});
