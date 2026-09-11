// apps/web/src/pages/canvas/video-editor/components/ExportModal.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// mock：videoProjectApi.exportPrecheck / client runExportJob / capabilities / upload 与 product-node
// （后两者已在 Task 9 建成——mock 仅为组件测试隔离上传/上画布副作用，真实行为在 Task 9 自测）
const precheckApi = vi.fn();
vi.mock('@/api/videoProjectApi', () => ({ exportPrecheck: (...a: unknown[]) => precheckApi(...a) }));
vi.mock('../export/upload', () => ({ uploadExportedProduct: vi.fn().mockResolvedValue({ mediaId: 'uuid-1' }) }));
vi.mock('../export/product-node', () => ({ createProductNode: vi.fn() }));
const runJob = vi.fn();
const pickSave = vi.fn();
vi.mock('../export/client', () => ({
  runExportJob: (...a: unknown[]) => runJob(...a),
  pickSaveFile: (...a: unknown[]) => pickSave(...a),
  ExportJobError: class extends Error { constructor(public category: string, m: string) { super(m); } },
}));
const detectCaps = vi.fn();
vi.mock('../capabilities', async (orig) => ({
  ...(await orig<typeof import('../capabilities')>()),
  detectExportCapabilities: () => detectCaps(),
}));

import { ExportModal } from './ExportModal';
import { useEditorStore } from '../store/editorStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useVideoEditorStore } from '@/stores/videoEditorStore'; // R4-1：startExport 三 getter 真值守卫的上下文

const clip = (id: string, mediaId: string, duration: number) => ({
  id, trackId: 'tv', type: 'video' as const, start: 0, duration, sourceStart: 0, mediaId, playbackSpeed: 1 as const,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
});

beforeEach(() => {
  precheckApi.mockResolvedValue({ ok: true });
  detectCaps.mockResolvedValue({ video: true, audio: true });
  pickSave.mockResolvedValue(null); // jsdom 无 FSA
  runJob.mockImplementation((_p, cb) => {
    cb.onProgress('mix', 1);
    cb.onProgress('encode', 0.5);
    return { promise: Promise.resolve({ blob: new Blob(['x']), fsa: false }), cancel: vi.fn() };
  });
  useEditorStore.setState({
    status: 'ready',
    data: { version: 1, fps: 30, tracks: [{ id: 'tv', type: 'video', name: 'v', muted: false, hidden: false, clips: ['a'] }], clips: { a: clip('a', 'm1', 2) } },
    mediaInfo: { m1: { name: 'v', durationSec: 2, url: 'http://x' } },
    projectId: 'vp1', title: '多轨剪辑', // R4-1：startExport 守卫三 getter 的取值来源（缺这三处 → 静默 return → runJob 用例必红）
  } as never);
  useCanvasStore.setState({ projectId: 'wf1' } as never);
  useVideoEditorStore.setState({ sourceNodeId: 'edit1' } as never);
});

describe('ExportModal', () => {
  it('渲染选档（720p/1080p）+ 体积估算 + 校验通过态', async () => {
    render(<ExportModal open onClose={vi.fn()} />);
    expect(await screen.findByText(/720p/)).toBeTruthy();
    expect(screen.getByText(/预计体积/)).toBeTruthy();
    // R4-10：/720p/ 是 Radio 静态文本先于 caps 到达——not.toBeDisabled 必须等 caps 落地后断言（包 waitFor 防竞态）
    await waitFor(() => expect(screen.getByRole('button', { name: /开始导出/ })).not.toBeDisabled());
  });

  it('素材缺失（mediaInfo 无该 mediaId）→ 开始导出禁用 + 缺失提示', async () => {
    useEditorStore.setState({ mediaInfo: {} } as never);
    render(<ExportModal open onClose={vi.fn()} />);
    // R8-1：实现文案是"素材 m1 缺失或未加载（…）"——/素材缺失/ 要求两词相邻永不匹配（findByText 超时红，R1 起漏网）
    expect(await screen.findByText(/缺失或未加载/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: /开始导出/ })).toBeDisabled()); // R8-1②：caps 未落地时按钮天然禁用——包 waitFor 防假绿
  });

  it('配额预检失败（exportPrecheck reject）→ 禁用 + 配额提示', async () => {
    precheckApi.mockRejectedValue(new Error('存储配额不足'));
    render(<ExportModal open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/存储配额/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /开始导出/ })).toBeDisabled();
  });

  it('开始导出：调 runExportJob（params 含 data/resolution/mediaUrls）并展示两段进度', async () => {
    render(<ExportModal open onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /开始导出/ }));
    await waitFor(() => expect(runJob).toHaveBeenCalledTimes(1));
    const params = runJob.mock.calls[0][0];
    expect(params.resolution).toBe('720p'); // 默认档
    expect(params.mediaUrls).toEqual({ m1: 'http://x' });
    expect(await screen.findByTestId('export-progress')).toBeTruthy();
  });

  it('编码器不支持（detectExportCapabilities video=false）→ 拦截提示', async () => {
    detectCaps.mockResolvedValue({ video: false, audio: true });
    render(<ExportModal open onClose={vi.fn()} />);
    expect(await screen.findByText(/不支持 H.264/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /开始导出/ })).toBeDisabled();
  });
});
