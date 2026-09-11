import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const renderFrameAt = vi.fn(async (..._a: unknown[]) => {}); // rest 形参——转发 spread 不触发 TS2556
vi.mock('../renderer/render-frame', () => ({ renderFrameAt: (...a: unknown[]) => renderFrameAt(...a) }));

import { usePreviewPlayback, applyCanvasSize } from './usePreviewPlayback';
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
  it('代数尾追：首帧在途（pending）期间 mediaInfo 变化 → finally 后以最新状态补渲（防退化回仅比 t）', async () => {
    // 不冲刷首帧——deferred 钉住首帧 promise，保证 pendingRef=true 的窗口真实存在
    // （若用默认已 resolve 的 mock，微任务冲刷后 pendingRef 已复位，只会走到上一用例的直接 run 分支）
    let resolveFirst!: () => void;
    renderFrameAt.mockImplementationOnce(() => new Promise<void>((r) => { resolveFirst = r; }));
    renderHook(() => usePreviewPlayback(canvasRef));
    expect(renderFrameAt).toHaveBeenCalledTimes(1); // 首帧在途
    // pending 期间 setState url 回填：act 内 effect 同步重跑 → renderLatest 记新代数（reqRef+1）但 pendingRef=true 直接 return
    await act(async () => {
      useEditorStore.setState((s) => ({ mediaInfo: { ...s.mediaInfo, mi: { name: 'i', durationSec: 5, url: 'http://x/i.png' } } }));
    });
    expect(renderFrameAt).toHaveBeenCalledTimes(1); // in-flight 去重——同 t 的新请求未立即发起
    resolveFirst(); // 首帧完成 → finally 发现 reqRef 已变 → 以 latestRef 最新状态追渲
    await act(async () => {});
    expect(renderFrameAt).toHaveBeenCalledTimes(2); // finally 尾追补帧
    // 同 t 的第二次渲染 = 代数判据（含同 t 的 mediaInfo 变化）区别于"仅比 t"（吞同 t 则本行红）的实证
    expect(renderFrameAt.mock.calls[1][1]).toBe(renderFrameAt.mock.calls[0][1]);
  });
});

describe('applyCanvasSize（canvas.width 赋值清空画布并重置 2D 上下文——属性与守卫必须同源走此函数）', () => {
  it('尺寸不同：赋值并返回 true；尺寸相同：不触碰画布（幂等防每帧重设闪黑）返回 false', () => {
    const c = document.createElement('canvas');
    c.width = 1920; c.height = 1080;
    expect(applyCanvasSize(c, 1280, 720)).toBe(true);
    expect(c.width).toBe(1280);
    expect(c.height).toBe(720);
    expect(applyCanvasSize(c, 1280, 720)).toBe(false); // 幂等——不重赋值
    expect(c.width).toBe(1280); // 仍为已设值（未被重置）
  });
});
