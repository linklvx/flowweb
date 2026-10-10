import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { confirmMock, regenMock, messageSuccess, messageError, messageWarning, messageInfo } = vi.hoisted(() => ({
  confirmMock: vi.fn((opts: { onOk?: () => unknown; content?: string }) => { opts.onOk?.(); }),
  regenMock: vi.fn(),
  messageSuccess: vi.fn(), messageError: vi.fn(), messageWarning: vi.fn(), messageInfo: vi.fn(),
}));
vi.mock('antd', async (importOriginal) => {
  const orig = await importOriginal<typeof import('antd')>();
  return {
    ...orig, // Slider/Tooltip 等保真
    // 批1-2：组件 modal/message 改经 App.useApp()——antd context 默认值无 static 回退，裸渲染必须 stub（四键齐全防未来通道撞 is not a function）
    App: { ...orig.App, useApp: () => ({ message: { success: messageSuccess, error: messageError, warning: messageWarning, info: messageInfo }, modal: { confirm: confirmMock } }) },
  };
});
vi.mock('@/api/videoProjectApi', () => ({ regenerateNode: regenMock }));

import { PreviewPlayer } from './PreviewPlayer';
import { useEditorStore } from '../store/editorStore';
import { createDefaultProjectData, type ProjectData, type VideoClip } from '../types';
import { useNodeStore } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';
import type { ExecStatusEntry } from '@/stores/execStatusView';

vi.mock('../audio-engine/engine', () => ({
  audioEngine: {
    prepare: vi.fn(async () => { }),
    playFrom: vi.fn(),
    stop: vi.fn(),
    now: vi.fn(() => 0),
    hasPcm: vi.fn(() => true),
    setClockMode: vi.fn(),
    setMasterVolume: vi.fn(),
    suspend: vi.fn(),
    releasePcm: vi.fn(),
  },
}));
vi.mock('../renderer/render-frame', () => ({ renderFrameAt: vi.fn(async () => { }) }));

const TRANSFORM = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };

/** 夹具：ready 态 editorStore（data 可注入；可选选中片段/播放头） + nodeStore 源节点 + canvasStore projectId */
const ready = (opts?: { data?: ProjectData; selectedClipId?: string; playhead?: number; node?: Record<string, unknown> }) => {
  const d = opts?.data ?? createDefaultProjectData();
  useEditorStore.setState({
    status: 'ready', data: d, projectId: 'p1', sourceNodeId: 'edit1', baseUpdatedAt: 't',
    playhead: opts?.playhead ?? 0, playing: false, preparing: false, selectedClipId: opts?.selectedClipId ?? null,
  });
  useNodeStore.setState({ nodes: (opts?.node ?? {}) as never });
  useCanvasStore.setState({ projectId: 'wf1' } as never);
};

/** 带 sourceNodeId 的视频片段 v1（源节点 vg1） */
const withVideoClip = (d: ProjectData) => {
  d.clips['v1'] = { id: 'v1', trackId: d.tracks[0].id, type: 'video', start: 0, duration: 3, sourceStart: 0, mediaId: 'm1', sourceNodeId: 'vg1', playbackSpeed: 1, transform: TRANSFORM, keyframes: [] } as VideoClip;
  d.tracks[0].clips.push('v1');
  return d;
};

const retakeBtn = () => screen.getByText('片段重拍').closest('button')!;

describe('PreviewPlayer AI 三按钮（Task 11）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.getState().reset();
    useNodeStore.setState({ nodes: {} });
    useCanvasStore.setState({ projectId: null } as never);
    regenMock.mockResolvedValue({ retakeId: 'r1', result: { success: true, errors: [] } });
  });

  it('添加字幕：播放头处建 3s 字幕片段（无字幕轨时先建轨）', () => {
    const d = createDefaultProjectData();
    d.tracks = d.tracks.filter(t => t.type !== 'subtitle'); // 夹具无 subtitle 轨
    ready({ data: d, playhead: 1.5 });
    render(<PreviewPlayer />);
    expect(useEditorStore.getState().data!.tracks.filter(t => t.type === 'subtitle')).toHaveLength(0);
    fireEvent.click(screen.getByText('添加字幕'));
    const after = useEditorStore.getState().data!;
    const subTracks = after.tracks.filter(t => t.type === 'subtitle');
    expect(subTracks).toHaveLength(1); // 先建轨
    const subClip = Object.values(after.clips).find(c => c.type === 'subtitle')!;
    expect(subClip.trackId).toBe(subTracks[0].id);
    expect(subClip.start).toBe(1.5); // 播放头处
    expect(subClip.duration).toBe(3);
  });

  it('生成音频恒置灰（决策 3 登记偏离）', () => {
    ready();
    render(<PreviewPlayer />);
    expect((screen.getByTestId('gen-audio-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('片段重拍直连真实节点（批5 删信箱）：积分确认 → regenerateNode 上送 retakeId（intentRecord 范式）——无影子链路', async () => {
    ready({ data: withVideoClip(createDefaultProjectData()), selectedClipId: 'v1', node: { vg1: { id: 'vg1', type: 'videoGen', position: { x: 0, y: 0 }, data: { label: '源视频', status: 'done', fileId: 'f0' } } } });
    render(<PreviewPlayer />);
    expect((retakeBtn() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByText('片段重拍'));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1)); // 积分明示确认
    expect(confirmMock.mock.calls[0][0].content).toContain('积分');
    await waitFor(() => expect(regenMock).toHaveBeenCalledTimes(1));
    const arg = regenMock.mock.calls[0][0];
    expect(arg).toMatchObject({ workflowId: 'wf1', sourceNodeId: 'vg1', kind: 'video' });
    expect(typeof arg.retakeId).toBe('string');
    expect(arg.retakeId.length).toBeGreaterThanOrEqual(8); // newIntentId（crypto.randomUUID）客户端生成——服务端幂等键
    expect(messageError).not.toHaveBeenCalled(); // result.success=true 无早失败
  });

  it('Y0b-2 T6：恒手势 held 复用（失败重试同 token）→ done 投影轮换 → 下一击新 token（regen-token 范式）', async () => {
    ready({ data: withVideoClip(createDefaultProjectData()), selectedClipId: 'v1', node: { vg1: { id: 'vg1', type: 'videoGen', position: { x: 0, y: 0 }, data: { label: '源视频', status: 'done', fileId: 'f0' } } } });
    const { unmount } = render(<PreviewPlayer />);
    // 首轮早失败（execute 结果 success=false——扣费/校验失败在 HTTP 往返内已 emit，直读 result 反馈）
    // Y0b-2 T5（Z95）：errors 结构化 {nodeId,status,error}——message 读 e.error 文案
    regenMock.mockResolvedValueOnce({ retakeId: 'x', result: { success: false, errors: [{ nodeId: 'vg1', status: 'error' as const, error: '扣费失败', errorCode: 'CREDIT_INSUFFICIENT' }] } });
    fireEvent.click(screen.getByText('片段重拍'));
    await waitFor(() => expect(regenMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(messageError).toHaveBeenCalledWith(expect.stringContaining('扣费失败')));
    const id1 = regenMock.mock.calls[0][0].retakeId;
    expect(id1).toMatch(/^[0-9a-f-]{36}$/); // 恒手势铸造（retakeId=手势 token）
    // 重试：held 复用同 token（免费 rearm 不双扣——sessionStorage 跨组件实例存活）
    regenMock.mockResolvedValueOnce({ retakeId: 'x', result: { success: true, errors: [] } });
    fireEvent.click(screen.getByText('片段重拍'));
    await waitFor(() => expect(regenMock).toHaveBeenCalledTimes(2));
    expect(regenMock.mock.calls[1][0].retakeId).toBe(id1);
    // 成功后轮换=投影单源：源节点 execStatus done ⇒ useEffect 丢弃 held（键=wf1 夹具 projectId）
    useNodeStore.setState({ execStatus: new Map<string, ExecStatusEntry>([['vg1', { status: 'done', attempts: 1 }]]) });
    await waitFor(() => {
      expect(sessionStorage.getItem('flowweb:regen:wf1:vg1')).toBeNull();
    });
    unmount();
    useNodeStore.setState({ execStatus: new Map() }); // 清投影——下一轮渲染回到可重拍态
    render(<PreviewPlayer />);
    fireEvent.click(screen.getByText('片段重拍'));
    await waitFor(() => expect(regenMock).toHaveBeenCalledTimes(3));
    expect(regenMock.mock.calls[2][0].retakeId).not.toBe(id1); // 新手势 token（新重拍照常扣费）
  });

  it('重拍在途 busy 判据走 exec 合并视图（真实节点 loading 置灰——shadowJobs 随信箱删除）', async () => {
    ready({ data: withVideoClip(createDefaultProjectData()), selectedClipId: 'v1', node: { vg1: { id: 'vg1', type: 'videoGen', position: { x: 0, y: 0 }, data: { label: '源视频', status: 'done', fileId: 'f0' } } } });
    render(<PreviewPlayer />);
    expect((retakeBtn() as HTMLButtonElement).disabled).toBe(false);
    // 服务端 exec map 投影 loading（retake 直连真实节点——execute 写 exec map → projectExecToStore）
    useNodeStore.setState({ execStatus: new Map<string, ExecStatusEntry>([['vg1', { status: 'loading' }]]) });
    await waitFor(() => expect((retakeBtn() as HTMLButtonElement).disabled).toBe(true));
    // exec 条目 GC → 回落 data.status='done'（execStatusView 合并视图语义）
    useNodeStore.setState({ execStatus: new Map() });
    await waitFor(() => expect((retakeBtn() as HTMLButtonElement).disabled).toBe(false));
  });

  it('选中图片片段（imageGen 源）→ 片段重拍置灰', () => {
    const d = createDefaultProjectData();
    d.clips['v1'] = { id: 'v1', trackId: d.tracks[0].id, type: 'image', start: 0, duration: 5, mediaId: 'm1', sourceNodeId: 'ig1', transform: TRANSFORM, keyframes: [] } as never;
    d.tracks[0].clips.push('v1');
    ready({ data: d, selectedClipId: 'v1', node: { ig1: { id: 'ig1', type: 'imageGen', position: { x: 0, y: 0 }, data: { fileId: 'f0' } } } });
    render(<PreviewPlayer />);
    expect((retakeBtn() as HTMLButtonElement).disabled).toBe(true); // canRetake false
  });

  it('源是产物节点（videoGen + origin=video-edit）→ 片段重拍置灰（R4-7：产物节点是终点不参与重拍——后端只校验类型会放行空 prompt 生成）', () => {
    ready({ data: withVideoClip(createDefaultProjectData()), selectedClipId: 'v1', node: { vg1: { id: 'vg1', type: 'videoGen', position: { x: 0, y: 0 }, data: { origin: 'video-edit', fileId: 'f', label: 'x' } } } });
    render(<PreviewPlayer />);
    expect((retakeBtn() as HTMLButtonElement).disabled).toBe(true); // 同型 videoGen 但 origin 排除
  });
});
