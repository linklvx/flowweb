import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const renderFrameAt = vi.fn(async (..._a: unknown[]) => {}); // rest 形参——转发 spread 不触发 TS2556
vi.mock('../renderer/render-frame', () => ({ renderFrameAt: (...a: unknown[]) => renderFrameAt(...a) }));

import { usePreviewPlayback } from './usePreviewPlayback';
import { useEditorStore } from '../store/editorStore';

// R7-P3：真实参数——现签名 usePreviewPlayback(canvasRef) 纯形参，测试以真实 canvas 元素接入
// （document.createElement + prototype.getContext stub，先例 PreviewPlayer.test.tsx:109-126；
// .ts 文件无 JSX，用 createElement 代替包装组件——hook 收真实 ref、effect 触真实 canvas）
const canvasRef = { current: null as HTMLCanvasElement | null };

const imageClip = (id: string, mediaId: string, duration: number) => ({
  id, trackId: 'tv', type: 'image' as const, start: 0, duration, mediaId,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
});

let getContextOrig: typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  renderFrameAt.mockClear();
  canvasRef.current = document.createElement('canvas');
  getContextOrig = HTMLCanvasElement.prototype.getContext;
  // jsdom canvas.getContext 默认 null 须 stub（EraseCanvas/PreviewPlayer 先例）——伪 2d ctx 只过 `if (!ctx)`
  // 守卫与 makeFrameDeps 装配，renderFrameAt 已 mock 不触达 ctx 方法
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ __fake: true })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  useEditorStore.setState({
    status: 'ready', playing: false, playhead: 0,
    data: { version: 1, fps: 30, tracks: [{ id: 'tv', type: 'video', name: 'v', muted: false, hidden: false, clips: ['a'] }], clips: { a: imageClip('a', 'mi', 5) } },
    mediaInfo: { mi: { name: 'i', durationSec: 5 } }, // 无 url——层跳过在 render-frame 内部（已 mock）
  });
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = getContextOrig; // try/finally 同款防污染（R3 五-5）
});

describe('usePreviewPlayback（暂停态单帧渲染）', () => {
  it('遗留②：暂停态 mediaInfo 变化（url 回填）触发补帧渲染', async () => {
    renderHook(() => usePreviewPlayback(canvasRef));
    expect(renderFrameAt).toHaveBeenCalledTimes(1); // 首帧（无 url 也渲——层跳过在 render-frame 内部）
    await act(async () => {}); // R2-N1：冲刷首个 mock promise——否则 pendingRef=true 期间 setState 被去重吞掉（确定性红非 flaky）
    await act(async () => {
      useEditorStore.setState((s) => ({ mediaInfo: { ...s.mediaInfo, mi: { name: 'i', durationSec: 5, url: 'http://x/i.png' } } }));
    });
    expect(renderFrameAt).toHaveBeenCalledTimes(2); // mediaInfo 进 deps + 代数尾追（renderLatest 升级）→ 补帧
  });
});
