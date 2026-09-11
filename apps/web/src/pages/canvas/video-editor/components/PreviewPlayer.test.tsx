import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { PreviewPlayer } from './PreviewPlayer';
import { useEditorStore } from '../store/editorStore';
import { createDefaultProjectData, type ProjectData } from '../types';
import { togglePlayback, stopPlayback, seekPlayback, scrubBegin, scrubMove, scrubEnd } from '../hooks/playback';
import * as playback from '../hooks/playback'; // 守护用例 spy 模块导出用（组件经命名导入取用——vite-node 下动态属性访问，spy 可拦截）
import { audioEngine } from '../audio-engine/engine';
import { useVideoEditorStore } from '@/stores/videoEditorStore';

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

const ready = (data?: ProjectData) => {
  const d = data ?? createDefaultProjectData();
  d.clips['v1'] = { id: 'v1', trackId: d.tracks[0].id, type: 'video', start: 0, duration: 3, sourceStart: 0, mediaId: 'm1', playbackSpeed: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] };
  d.tracks[0].clips.push('v1');
  useEditorStore.setState({ status: 'ready', data: d, projectId: 'p1', sourceNodeId: 'edit1', baseUpdatedAt: 't', playhead: 0, playing: false, preparing: false });
};

describe('playback 状态机（togglePlayback/stopPlayback/seekPlayback）', () => {
  beforeEach(() => { vi.clearAllMocks(); useEditorStore.getState().reset(); });

  it('toggle：prepare 完成后才 setPlaying(true)（音画同起点，决策 14 流程）', async () => {
    ready();
    await togglePlayback();
    expect(audioEngine.prepare).toHaveBeenCalled();
    expect(useEditorStore.getState().playing).toBe(true);
    expect(useEditorStore.getState().preparing).toBe(false);
  });
  it('toggle 期间再 toggle 被 preparing 门卫挡住', async () => {
    ready();
    let resolvePrepare!: () => void;
    (audioEngine.prepare as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise<void>(r => { resolvePrepare = r; }));
    const first = togglePlayback();
    expect(useEditorStore.getState().preparing).toBe(true);
    await togglePlayback(); // preparing 中——直接返回
    expect(audioEngine.prepare).toHaveBeenCalledTimes(1);
    resolvePrepare();
    await first;
    expect(useEditorStore.getState().playing).toBe(true);
    // 偏离登记（计划笔误补丁）：本用例的 mockImplementation（永挂 promise）经 clearAllMocks 不重置、
    // 会泄漏到后续用例使 prepare 永不 resolve——用毕显式还原 factory 的 async no-op 实现
    (audioEngine.prepare as ReturnType<typeof vi.fn>).mockImplementation(async () => { });
  });
  it('stop：engine.stop + playing=false', async () => {
    ready();
    await togglePlayback();
    stopPlayback();
    expect(audioEngine.stop).toHaveBeenCalled();
    expect(useEditorStore.getState().playing).toBe(false);
  });
  it('seek 播放中：setPlayhead + playFrom 重调度；暂停中只 setPlayhead', async () => {
    ready();
    await togglePlayback();
    seekPlayback(1.5);
    expect(useEditorStore.getState().playhead).toBe(1.5);
    expect(audioEngine.playFrom).toHaveBeenCalled();
    stopPlayback();
    vi.clearAllMocks();
    seekPlayback(2);
    expect(useEditorStore.getState().playhead).toBe(2);
    expect(audioEngine.playFrom).not.toHaveBeenCalled();
  });
});

describe('PreviewPlayer（控制条）', () => {
  beforeEach(() => { vi.clearAllMocks(); useEditorStore.getState().reset(); });

  it('渲染 16:9 画布与控制条：播放/时间码/撤销/重做/分割/删除/音量/全屏/缩放滑杆', () => {
    ready();
    render(<PreviewPlayer />);
    expect(screen.getByTestId('preview-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('preview-play-btn')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '撤销' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重做' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '分割' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument();
    expect(screen.getByTestId('volume-slider')).toBeInTheDocument();
    expect(screen.getByTestId('zoom-slider')).toBeInTheDocument();
    expect(screen.getByText(/0:03/)).toBeInTheDocument(); // 总长 3s
  });
  it('播放按钮 → togglePlayback；playing 态文案切换', async () => {
    ready();
    render(<PreviewPlayer />);
    fireEvent.click(screen.getByTestId('preview-play-btn'));
    await waitFor(() => expect(useEditorStore.getState().playing).toBe(true));
    expect(screen.getByTestId('preview-play-btn').textContent).toBe('⏸');
  });
  it('删除按钮删选中片段（控制条迁移后行为不丢）', () => {
    ready();
    useEditorStore.getState().selectClip('v1');
    render(<PreviewPlayer />);
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(useEditorStore.getState().data!.tracks[0].clips).toHaveLength(0);
  });

  it('撤销/重做/分割/删除为图标按钮（原生 title 含快捷键——不用 antd Tooltip）', () => {
    ready();
    render(<PreviewPlayer />);
    const undo = screen.getByRole('button', { name: '撤销' }); // name 匹配 aria-label
    expect(undo.querySelector('svg')).toBeTruthy(); // 图标
    expect(undo.getAttribute('title')).toContain('Ctrl+Z'); // 原生 title 属性
    expect(screen.getByRole('button', { name: '重做' }).querySelector('svg')).toBeTruthy();
    expect(screen.getByRole('button', { name: '分割' }).getAttribute('title')).toContain('S');
    expect(screen.getByRole('button', { name: '删除' }).querySelector('svg')).toBeTruthy();
    expect(screen.getByRole('button', { name: '删除' }).getAttribute('title')).toContain('Delete');
  });

  it('暂停态：playhead 变化触发单帧渲染（G1/N5——R2 补测；jsdom canvas.getContext 默认 null 须 stub，EraseCanvas 先例）', async () => {
    const orig = HTMLCanvasElement.prototype.getContext;
    // 偏离登记（计划笔误补丁）：返回 cast 成 CanvasRenderingContext2D 与 getContext 联合重载（bitmaprenderer）冲突 TS2322——
    // cast 移到函数整体，运行时行为不变（返回 { __fake: true } 原对象）；EraseCanvas.test 先例同因以 any 返回过检
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ __fake: true })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    try { // R3 五-5：try/finally 恢复——用例失败不污染同文件后续用例
      ready();
      const { unmount } = render(<PreviewPlayer />);
      const { renderFrameAt } = await import('../renderer/render-frame');
      vi.mocked(renderFrameAt).mockClear();
      act(() => { useEditorStore.getState().setPlayhead(1); });
      await waitFor(() => expect(renderFrameAt).toHaveBeenCalled());
      expect(vi.mocked(renderFrameAt).mock.lastCall?.[1]).toBe(1); // (data, t, deps) 的 t 取最新 playhead
      unmount();
    } finally {
      HTMLCanvasElement.prototype.getContext = orig;
    }
  });
  it('空格键 toggle（useEditorKeyboard 挂载在 TimelinePanel 且需 videoEditorStore.open 门卫放行——R1 审核 B4）', async () => {
    ready();
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' }); // hook 首行 open 门卫（Plan 2 既有行为）
    const { TimelinePanel } = await import('./timeline/TimelinePanel');
    render(<><PreviewPlayer /><TimelinePanel /></>);
    fireEvent.keyDown(document, { key: ' ' });
    await waitFor(() => expect(useEditorStore.getState().playing).toBe(true));
  });

  it('预览 canvas 自适应 contain：无 width:100%/aspectRatio 内联样式（靠替换元素内在尺寸，spec 4.1）', () => {
    ready();
    render(<PreviewPlayer />);
    const canvas = screen.getByTestId('preview-canvas') as HTMLCanvasElement;
    const style = canvas.getAttribute('style') ?? '';
    expect(style).not.toContain('width');        // 无内联 width:100%（强制铺满容器）
    expect(style).not.toContain('aspect-ratio'); // 无内联 aspect-ratio（强制 16:9 变形非 16:9 素材）
    expect(canvas.className).toContain('max-w-full');
    expect(canvas.className).toContain('max-h-full');
  });

  it('删内联样式后画布点击 seek 绑定仍在（守护——重写防 onClick 静默丢失；jsdom 无布局 rect 全 0，勿断言 playhead 具体值）', () => {
    ready();
    const seekSpy = vi.spyOn(playback, 'seekPlayback');
    render(<PreviewPlayer />);
    fireEvent.click(screen.getByTestId('preview-canvas'), { clientX: 10 });
    expect(seekSpy).toHaveBeenCalled();
  });
});

describe('scrub 三段式（G4/决策 6②：静音拖拽——down 停音频退 rAF，move 只动播放头，up 才恢复）', () => {
  beforeEach(() => { vi.clearAllMocks(); useEditorStore.getState().reset(); scrubEnd(); /* 模块级 scrub 状态复位 */ });

  it('scrubBegin 播放中：stop 音频 + playing=false + playhead 到位', async () => {
    ready();
    await togglePlayback();
    (audioEngine.stop as ReturnType<typeof vi.fn>).mockClear();
    scrubBegin(1.5);
    expect(audioEngine.stop).toHaveBeenCalled();
    expect(useEditorStore.getState().playing).toBe(false);
    expect(useEditorStore.getState().playhead).toBe(1.5);
  });
  it('scrubMove：active 时只动 playhead 不碰引擎；未 begin 时 no-op', async () => {
    ready();
    await togglePlayback();
    scrubBegin(0);
    // 偏离登记（计划笔误补丁）：原稿 clearAllMocks 在 scrubBegin 之前——而 scrubBegin 播放中必调 stop
    // （playback.ts 静音拖拽），其后断言 stop 未被调恒假失败；清桩移到 begin 后 move 前，精确验证「move 本身不碰引擎」
    vi.clearAllMocks();
    scrubMove(2);
    expect(useEditorStore.getState().playhead).toBe(2);
    expect(audioEngine.playFrom).not.toHaveBeenCalled();
    expect(audioEngine.stop).not.toHaveBeenCalled();
    scrubEnd();
    vi.clearAllMocks();
    scrubMove(3); // 未 begin——no-op
    expect(useEditorStore.getState().playhead).toBe(2);
  });
  it('scrubEnd：wasPlaying=true 恢复播放；wasPlaying=false 保持暂停', async () => {
    ready();
    await togglePlayback();
    scrubBegin(0);
    scrubEnd();
    expect(useEditorStore.getState().playing).toBe(true); // 恢复
    stopPlayback();
    scrubBegin(1);
    scrubEnd();
    expect(useEditorStore.getState().playing).toBe(false); // 本就暂停——不恢复
  });
  it('scrubBegin 暂停态：不停音频，只动播放头', () => {
    ready();
    scrubBegin(0.5);
    expect(audioEngine.stop).not.toHaveBeenCalled();
    expect(useEditorStore.getState().playing).toBe(false);
    expect(useEditorStore.getState().playhead).toBe(0.5);
    scrubEnd();
  });
});
