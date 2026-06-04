# Audio Waveform V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 替换 wavesurfer.js 渲染层为自定义 Canvas（250固定采样点+播放头居中+波形滚动），保留 wavesurfer 音频引擎。

**Architecture:** 混合模式 — wavesurfer.js 处理音频解码/播放/seek，3 个新 hooks（useWaveformPeaks / useCanvasRenderer / useDragSeek）各自负责峰值计算、Canvas 2D 渲染、拖拽 Seek，AudioWaveform.tsx 组装一切。

**Tech Stack:** React 18, TypeScript strict, wavesurfer.js 7.x, Canvas 2D API, Vitest + @testing-library/react, Zustand 4.x

---

## File Structure

| 文件 | 类型 | 职责 |
|---|---|---|
| `apps/web/src/hooks/useWaveformPeaks.ts` | 新建 | 从 AudioBuffer 计算 250 个归一化峰值，LRU 缓存 |
| `apps/web/src/hooks/useWaveformPeaks.test.ts` | 新建 | 峰值计算、缓存、归一化、静音兜底测试 |
| `apps/web/src/hooks/useCanvasRenderer.ts` | 新建 | Canvas 2D 绘制波形条 + rAF 滚动循环 |
| `apps/web/src/hooks/useCanvasRenderer.test.ts` | 新建 | Canvas 尺寸、rAF 生命周期、进度变化检测测试 |
| `apps/web/src/hooks/useDragSeek.ts` | 新建 | 拖拽 Seek + 捕获阶段事件隔离 |
| `apps/web/src/hooks/useDragSeek.test.ts` | 新建 | 拖拽交互、边界锁定、window 事件清理测试 |
| `apps/web/src/pages/canvas/components/nodes/AudioWaveform.tsx` | 重写 | Canvas+DOM 组装，保持 Phase 1 props 接口 |
| `apps/web/src/pages/canvas/components/nodes/AudioWaveform.test.tsx` | 重写 | 渲染、播放头、控件、错误兜底集成测试 |
| `apps/web/src/pages/canvas/components/nodes/AudioGenNode.tsx` | 修改 | NODE_HEIGHT: 260 → 180 |

---

### Task 1: useWaveformPeaks Hook

**Files:**
- Create: `apps/web/src/hooks/useWaveformPeaks.ts`
- Create: `apps/web/src/hooks/useWaveformPeaks.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/src/hooks/useWaveformPeaks.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWaveformPeaks } from './useWaveformPeaks';

// Helper: create a fake AudioBuffer-like object
function createFakeWavesurfer(channelData: Float32Array[]): any {
  return {
    getDecodedData: vi.fn(() => ({
      getChannelData: (ch: number) => channelData[ch] ?? channelData[0],
      length: channelData[0]?.length ?? 0,
      numberOfChannels: channelData.length,
      sampleRate: 44100,
    })),
  };
}

describe('useWaveformPeaks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Basic functionality ───

  it('should return empty array when wavesurfer is null', () => {
    const { result } = renderHook(() => useWaveformPeaks(null, 'test-url'));
    expect(result.current).toEqual([]);
  });

  it('should compute 250 peaks from audio data', () => {
    // Create a simple sine wave: 44100 samples (~1 second)
    const samples = new Float32Array(44100);
    for (let i = 0; i < 44100; i++) {
      samples[i] = Math.sin(2 * Math.PI * 440 * i / 44100);
    }
    const ws = createFakeWavesurfer([samples]);
    const { result } = renderHook(() => useWaveformPeaks(ws, 'test-url', 250));
    expect(result.current).toHaveLength(250);
  });

  // ─── Normalization ───

  it('should normalize peaks to 0~1 range', () => {
    const samples = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) {
      samples[i] = (i % 2 === 0) ? 0.5 : -0.5; // alternating values
    }
    const ws = createFakeWavesurfer([samples]);
    const { result } = renderHook(() => useWaveformPeaks(ws, 'test-url', 250));
    for (const peak of result.current) {
      expect(peak).toBeGreaterThanOrEqual(0);
      expect(peak).toBeLessThanOrEqual(1);
    }
  });

  // ─── Silent audio fallback ───

  it('should floor silent audio to 0.05 minimum', () => {
    const samples = new Float32Array(1000); // all zeros
    const ws = createFakeWavesurfer([samples]);
    const { result } = renderHook(() => useWaveformPeaks(ws, 'test-url', 250));
    for (const peak of result.current) {
      expect(peak).toBeGreaterThanOrEqual(0.05);
    }
  });

  // ─── Cache ───

  it('should cache peaks by audioUrl and not recalculate', () => {
    const samples = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) samples[i] = 0.5;
    const ws = createFakeWavesurfer([samples]);

    const { result: r1, rerender: rr1 } = renderHook(
      ({ url }) => useWaveformPeaks(ws, url, 250),
      { initialProps: { url: 'cache-test-url' } }
    );
    expect(r1.current).toHaveLength(250);

    // Rerender with same URL — should not call getDecodedData again
    const firstCallCount = ws.getDecodedData.mock.calls.length;
    rr1({ url: 'cache-test-url' });
    expect(ws.getDecodedData.mock.calls.length).toBe(firstCallCount);
  });

  it('should recalculate when audioUrl changes', () => {
    const samples = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) samples[i] = 0.5;
    const ws = createFakeWavesurfer([samples]);

    const { rerender } = renderHook(
      ({ url }) => useWaveformPeaks(ws, url, 250),
      { initialProps: { url: 'url-1' } }
    );

    const firstCallCount = ws.getDecodedData.mock.calls.length;
    rerender({ url: 'url-2' });
    expect(ws.getDecodedData.mock.calls.length).toBeGreaterThan(firstCallCount);
  });

  // ─── Custom count ───

  it('should support custom peak count', () => {
    const samples = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) samples[i] = 0.3;
    const ws = createFakeWavesurfer([samples]);
    const { result } = renderHook(() => useWaveformPeaks(ws, 'test-url', 100));
    expect(result.current).toHaveLength(100);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd D:\flowweb\apps\web && npx vitest run src/hooks/useWaveformPeaks.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the minimal implementation**

```typescript
// apps/web/src/hooks/useWaveformPeaks.ts
import { useMemo, useRef } from 'react';
import type WaveSurfer from 'wavesurfer.js';

const peaksCache = new Map<string, number[]>();
const MAX_CACHE_SIZE = 50;

/**
 * Extract fixed-count (default 250) normalized peaks from wavesurfer's decoded AudioBuffer.
 * Returns 0~1 values with minimum 0.05 for silent regions.
 * Cached by audioUrl with LRU eviction (max 50 entries).
 */
export function useWaveformPeaks(
  wavesurfer: WaveSurfer | null,
  audioUrl: string,
  count: number = 250,
): number[] {
  const lastUrlRef = useRef<string>('');

  return useMemo(() => {
    if (!wavesurfer) return [];

    // Cache hit: return cached peaks
    const cached = peaksCache.get(audioUrl);
    if (cached) return cached;

    // Cache miss: compute peaks from decoded data
    const decoded = wavesurfer.getDecodedData();
    if (!decoded) return [];

    const channelData = decoded.getChannelData(0);
    const totalSamples = channelData.length;
    if (totalSamples === 0) return new Array(count).fill(0.05);

    const segmentSize = Math.floor(totalSamples / count);
    if (segmentSize === 0) return new Array(count).fill(0.05); // extreme short audio fallback

    // Find global max for normalization
    let globalMax = 0;
    for (let i = 0; i < totalSamples; i++) {
      const abs = Math.abs(channelData[i]);
      if (abs > globalMax) globalMax = abs;
    }

    const peaks: number[] = new Array(count);
    for (let i = 0; i < count; i++) {
      const start = i * segmentSize;
      const end = start + segmentSize;
      let max = 0;
      for (let j = start; j < end; j++) {
        const abs = Math.abs(channelData[j]);
        if (abs > max) max = abs;
      }
      // Normalize and floor to minimum
      peaks[i] = globalMax > 0 ? Math.max(max / globalMax, 0.05) : 0.05;
    }

    // LRU eviction
    if (peaksCache.size >= MAX_CACHE_SIZE) {
      const firstKey = peaksCache.keys().next().value;
      if (firstKey !== undefined) peaksCache.delete(firstKey);
    }
    peaksCache.set(audioUrl, peaks);

    return peaks;
  }, [wavesurfer, audioUrl, count]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd D:\flowweb\apps\web && npx vitest run src/hooks/useWaveformPeaks.test.ts`
Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/useWaveformPeaks.ts apps/web/src/hooks/useWaveformPeaks.test.ts
git commit -m "feat: add useWaveformPeaks hook with LRU-cached normalized peak computation"
```

---

### Task 2: useCanvasRenderer Hook

**Files:**
- Create: `apps/web/src/hooks/useCanvasRenderer.ts`
- Create: `apps/web/src/hooks/useCanvasRenderer.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/src/hooks/useCanvasRenderer.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCanvasRenderer } from './useCanvasRenderer';

// Mock canvas context
function createMockContext(): any {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: '',
    scale: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    roundRect: vi.fn(),
  };
}

function createMockCanvas(ctx: any): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'getContext', {
    value: vi.fn(() => ctx),
  });
  // Mock devicePixelRatio
  Object.defineProperty(window, 'devicePixelRatio', {
    value: 2,
    writable: true,
  });
  return canvas;
}

// Mock requestAnimationFrame
let rafCallbacks: Array<() => void> = [];
const originalRAF = globalThis.requestAnimationFrame;
const originalCAF = globalThis.cancelAnimationFrame;

beforeEach(() => {
  rafCallbacks = [];
  globalThis.requestAnimationFrame = vi.fn((cb: () => void) => {
    const id = rafCallbacks.length + 1;
    rafCallbacks.push(cb);
    return id;
  });
  globalThis.cancelAnimationFrame = vi.fn((id: number) => {
    // noop
  });
  vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2);
});

afterEach(() => {
  globalThis.requestAnimationFrame = originalRAF;
  globalThis.cancelAnimationFrame = originalCAF;
  vi.restoreAllMocks();
});

describe('useCanvasRenderer', () => {
  // ─── Canvas sizing ───

  it('should set canvas dimensions for high DPI', () => {
    const ctx = createMockContext();
    const canvas = createMockCanvas(ctx);
    const canvasRef = { current: canvas };

    const peaks = new Array(250).fill(0.5);

    renderHook(() =>
      useCanvasRenderer(canvasRef, peaks, null, false, 0, 340)
    );

    // Canvas raw size = CSS size × devicePixelRatio (2)
    expect(canvas.width).toBe(2000);
    expect(canvas.height).toBe(240);
    // CSS display size
    expect(canvas.style.width).toBe('1000px');
    expect(canvas.style.height).toBe('120px');
    // scale called for retina
    expect(ctx.scale).toHaveBeenCalledWith(2, 2);
  });

  // ─── rAF lifecycle ───

  it('should start rAF loop when playing starts', () => {
    const ctx = createMockContext();
    const canvas = createMockCanvas(ctx);
    const canvasRef = { current: canvas };
    const peaks = new Array(250).fill(0.5);
    const wavesurfer = { getCurrentTime: vi.fn(() => 0) };

    const { rerender } = renderHook(
      ({ isPlaying }) =>
        useCanvasRenderer(canvasRef, peaks, wavesurfer as any, isPlaying, 120, 340),
      { initialProps: { isPlaying: false } }
    );

    expect(requestAnimationFrame).not.toHaveBeenCalled();

    rerender({ isPlaying: true });
    expect(requestAnimationFrame).toHaveBeenCalled();
  });

  it('should cancel rAF when paused', () => {
    const ctx = createMockContext();
    const canvas = createMockCanvas(ctx);
    const canvasRef = { current: canvas };
    const peaks = new Array(250).fill(0.5);
    const wavesurfer = { getCurrentTime: vi.fn(() => 0) };

    const { rerender } = renderHook(
      ({ isPlaying }) =>
        useCanvasRenderer(canvasRef, peaks, wavesurfer as any, isPlaying, 120, 340),
      { initialProps: { isPlaying: true } }
    );

    rerender({ isPlaying: false });
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it('should cancel rAF on unmount', () => {
    const ctx = createMockContext();
    const canvas = createMockCanvas(ctx);
    const canvasRef = { current: canvas };
    const peaks = new Array(250).fill(0.5);
    const wavesurfer = { getCurrentTime: vi.fn(() => 0) };

    const { unmount } = renderHook(() =>
      useCanvasRenderer(canvasRef, peaks, wavesurfer as any, true, 120, 340)
    );

    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  // ─── Progress-change detection ───

  it('should redraw when progress changes significantly', () => {
    const ctx = createMockContext();
    const canvas = createMockCanvas(ctx);
    const canvasRef = { current: canvas };
    const peaks = new Array(250).fill(0.5);
    let currentTime = 0;
    const wavesurfer = {
      getCurrentTime: vi.fn(() => currentTime),
    };

    renderHook(() =>
      useCanvasRenderer(canvasRef, peaks, wavesurfer as any, true, 120, 340)
    );

    const initialCalls = ctx.clearRect.mock.calls.length;

    // Simulate rAF callback — progress changed significantly
    currentTime = 10; // ~8.3% for 120s duration
    rafCallbacks[0]?.();

    // clearRect should have been called at least once more
    expect(ctx.clearRect.mock.calls.length).toBeGreaterThan(initialCalls);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd D:\flowweb\apps\web && npx vitest run src/hooks/useCanvasRenderer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/web/src/hooks/useCanvasRenderer.ts
import { useEffect, useRef, type RefObject } from 'react';
import type WaveSurfer from 'wavesurfer.js';

const BAR_WIDTH = 3;
const BAR_GAP = 1;
const BAR_RADIUS = 2;
const TOTAL_BAR_STEP = BAR_WIDTH + BAR_GAP; // 4px
const CANVAS_CSS_WIDTH = 1000;
const CANVAS_CSS_HEIGHT = 120;

export function useCanvasRenderer(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  peaks: number[],
  wavesurfer: WaveSurfer | null,
  isPlaying: boolean,
  duration: number,
  visibleWidth: number,
): void {
  const rafRef = useRef<number | null>(null);
  const lastProgressRef = useRef(-1);
  const dprRef = useRef(1);

  // Initialize canvas dimensions
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    dprRef.current = window.devicePixelRatio || 1;
    canvas.width = CANVAS_CSS_WIDTH * dprRef.current;
    canvas.height = CANVAS_CSS_HEIGHT * dprRef.current;
    canvas.style.width = `${CANVAS_CSS_WIDTH}px`;
    canvas.style.height = `${CANVAS_CSS_HEIGHT}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(dprRef.current, dprRef.current);
  }, [canvasRef]);

  // Draw waveform + rAF scroll loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const currentTime = wavesurfer?.getCurrentTime() ?? 0;
      const progress = duration > 0 ? currentTime / duration : 0;

      // Skip redraw if progress hasn't changed significantly
      if (Math.abs(progress - lastProgressRef.current) < 0.001) {
        if (isPlaying && wavesurfer) {
          rafRef.current = requestAnimationFrame(draw);
        }
        return;
      }
      lastProgressRef.current = progress;

      // Bar at progress position aligns with viewport center
      // barPosition + translateX = visibleWidth / 2 → translateX = visibleWidth/2 - progress * totalBarsWidth
      const totalBarsWidth = peaks.length * TOTAL_BAR_STEP;
      const translateX = visibleWidth / 2 - progress * totalBarsWidth;

      ctx.save();
      ctx.clearRect(0, 0, CANVAS_CSS_WIDTH, CANVAS_CSS_HEIGHT);
      ctx.translate(translateX, 0);

      // Color split: bars to the left of viewport center = played (cyan), right = unplayed (white)
      const centerLine = visibleWidth / 2 - translateX;
      for (let i = 0; i < peaks.length; i++) {
        const x = i * TOTAL_BAR_STEP;
        const peak = peaks[i];
        const barHeight = Math.max(peak * CANVAS_CSS_HEIGHT * 0.85, 2); // min 2px
        const y = (CANVAS_CSS_HEIGHT - barHeight) / 2; // vertical center

        // Color: left of playhead = played (cyan), right = unplayed (white)
        ctx.fillStyle = x < centerLine ? '#38bdf8' : '#ffffff';
        ctx.beginPath();
        ctx.roundRect(x, y, BAR_WIDTH, barHeight, BAR_RADIUS);
        ctx.fill();
      }

      ctx.restore();

      if (isPlaying && wavesurfer) {
        rafRef.current = requestAnimationFrame(draw);
      }
    };

    // Start drawing
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [canvasRef, peaks, wavesurfer, isPlaying, duration, visibleWidth]);

  // Pause cleanup: cancel rAF when not playing
  useEffect(() => {
    if (!isPlaying && rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, [isPlaying]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd D:\flowweb\apps\web && npx vitest run src/hooks/useCanvasRenderer.test.ts`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/useCanvasRenderer.ts apps/web/src/hooks/useCanvasRenderer.test.ts
git commit -m "feat: add useCanvasRenderer hook with high-DPI canvas + rAF scroll loop"
```

---

### Task 3: useDragSeek Hook

**Files:**
- Create: `apps/web/src/hooks/useDragSeek.ts`
- Create: `apps/web/src/hooks/useDragSeek.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/src/hooks/useDragSeek.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDragSeek } from './useDragSeek';

describe('useDragSeek', () => {
  let canvas: HTMLCanvasElement;
  let wavesurfer: { seekTo: ReturnType<typeof vi.fn> };
  let windowAddSpy: ReturnType<typeof vi.spyOn>;
  let windowRemoveSpy: ReturnType<typeof vi.spyOn>;
  let windowListeners: Map<string, EventListener>;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'offsetWidth', { value: 1000 });
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: vi.fn(() => ({ left: 50, top: 100, width: 1000, height: 120 })),
    });

    wavesurfer = {
      seekTo: vi.fn(),
    };

    windowListeners = new Map();
    windowAddSpy = vi.spyOn(window, 'addEventListener').mockImplementation(
      (event: string, handler: EventListener) => {
        windowListeners.set(event, handler);
      }
    );
    windowRemoveSpy = vi.spyOn(window, 'removeEventListener').mockImplementation(
      (event: string) => {
        windowListeners.delete(event);
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── mousedown starts drag ───

  it('should set isDragging true on mousedown', () => {
    const canvasRef = { current: canvas };
    const { result } = renderHook(() =>
      useDragSeek(canvasRef, wavesurfer as any, true, 120)
    );

    // Simulate capture-phase mousedown
    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        clientX: 250,
      }));
    });

    expect(result.current.isDragging).toBe(true);
  });

  // ─── mousemove seeks ───

  it('should seek on mousemove during drag', () => {
    const canvasRef = { current: canvas };
    renderHook(() => useDragSeek(canvasRef, wavesurfer as any, true, 120));

    // Start drag: click at 250px offset (250/1000 = 25% progress)
    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        clientX: 250 + 50, // clientX = canvasLeft + offsetX
      }));
    });

    // Simulate mousemove to 500px offset (50% progress)
    expect(windowListeners.has('mousemove')).toBe(true);
    act(() => {
      const handler = windowListeners.get('mousemove') as EventListener;
      handler(new MouseEvent('mousemove', {
        bubbles: true,
        clientX: 500 + 50,
      }));
    });

    expect(wavesurfer.seekTo).toHaveBeenCalledWith(0.5);
  });

  // ─── mouseup stops drag ───

  it('should set isDragging false on mouseup', () => {
    const canvasRef = { current: canvas };
    const { result } = renderHook(() =>
      useDragSeek(canvasRef, wavesurfer as any, true, 120)
    );

    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        clientX: 250,
      }));
    });
    expect(result.current.isDragging).toBe(true);

    act(() => {
      const handler = windowListeners.get('mouseup') as EventListener;
      handler(new MouseEvent('mouseup', { bubbles: true }));
    });
    expect(result.current.isDragging).toBe(false);
  });

  // ─── Boundary clamp ───

  it('should clamp seek to 0% minimum', () => {
    const canvasRef = { current: canvas };
    renderHook(() => useDragSeek(canvasRef, wavesurfer as any, true, 120));

    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        clientX: 250 + 50,
      }));
    });

    // Drag left of canvas (negative offset)
    act(() => {
      const handler = windowListeners.get('mousemove') as EventListener;
      handler(new MouseEvent('mousemove', {
        bubbles: true,
        clientX: 0 + 50, // offsetX = -50
      }));
    });

    expect(wavesurfer.seekTo).toHaveBeenCalledWith(0);
  });

  it('should clamp seek to 100% maximum', () => {
    const canvasRef = { current: canvas };
    renderHook(() => useDragSeek(canvasRef, wavesurfer as any, true, 120));

    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        clientX: 250 + 50,
      }));
    });

    // Drag right past canvas
    act(() => {
      const handler = windowListeners.get('mousemove') as EventListener;
      handler(new MouseEvent('mousemove', {
        bubbles: true,
        clientX: 2000 + 50,
      }));
    });

    expect(wavesurfer.seekTo).toHaveBeenCalledWith(1);
  });

  // ─── window.blur stops drag ───

  it('should stop dragging on window blur', () => {
    const canvasRef = { current: canvas };
    const { result } = renderHook(() =>
      useDragSeek(canvasRef, wavesurfer as any, true, 120)
    );

    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        clientX: 250,
      }));
    });
    expect(result.current.isDragging).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(result.current.isDragging).toBe(false);
  });

  // ─── Cleanup on unmount ───

  it('should remove window event listeners on unmount', () => {
    const canvasRef = { current: canvas };
    const { unmount } = renderHook(() =>
      useDragSeek(canvasRef, wavesurfer as any, true, 120)
    );

    unmount();

    // Check that removeEventListener was called for mouseup and mousemove
    const calls = windowRemoveSpy.mock.calls.map((c) => c[0]);
    expect(calls).toContain('mousemove');
    expect(calls).toContain('mouseup');
    expect(calls).toContain('blur');
  });

  // ─── 10ms throttle ───

  it('should throttle mousemove to ~10ms', async () => {
    vi.useFakeTimers();
    const canvasRef = { current: canvas };
    renderHook(() => useDragSeek(canvasRef, wavesurfer as any, true, 120));

    // Start drag
    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        clientX: 250 + 50,
      }));
    });

    const handler = windowListeners.get('mousemove') as EventListener;

    // Fire two rapid mousemoves within 10ms
    act(() => {
      handler(new MouseEvent('mousemove', { bubbles: true, clientX: 300 + 50 }));
    });
    act(() => {
      handler(new MouseEvent('mousemove', { bubbles: true, clientX: 400 + 50 }));
    });

    // Only the first should trigger seekTo (second is throttled)
    // Actually with fake timers and throttle, only first goes through
    // The second call within 10ms is dropped
    expect(wavesurfer.seekTo).toHaveBeenCalledTimes(1);

    // Advance time past throttle window
    act(() => {
      vi.advanceTimersByTime(20);
    });

    // Now another move should trigger
    act(() => {
      handler(new MouseEvent('mousemove', { bubbles: true, clientX: 500 + 50 }));
    });
    expect(wavesurfer.seekTo).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd D:\flowweb\apps\web && npx vitest run src/hooks/useDragSeek.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/web/src/hooks/useDragSeek.ts
import { useEffect, useRef, useState, useCallback, type RefObject } from 'react';
import type WaveSurfer from 'wavesurfer.js';

/**
 * Manual throttle (no lodash dependency). Returns a throttled version of fn.
 */
function throttle<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let lastTime = 0;
  return ((...args: any[]) => {
    const now = Date.now();
    if (now - lastTime >= delay) {
      lastTime = now;
      fn(...args);
    }
  }) as T;
}

export function useDragSeek(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  wavesurfer: WaveSurfer | null,
  isReady: boolean,
  duration: number,
): { isDragging: boolean } {
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);

  const stopDrag = useCallback(() => {
    isDraggingRef.current = false;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleSeek = (e: MouseEvent) => {
      if (!wavesurfer || !isReady || duration <= 0) return;
      const rect = canvas.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const canvasWidth = rect.width;
      const progress = Math.max(0, Math.min(1, offsetX / canvasWidth));
      wavesurfer?.seekTo(progress);
    };

    const throttledSeek = throttle(handleSeek, 10);

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      throttledSeek(e);
    };

    const onMouseUp = () => {
      if (isDraggingRef.current) {
        stopDrag();
      }
    };

    const onBlur = () => {
      if (isDraggingRef.current) {
        stopDrag();
      }
    };

    // Capture-phase mousedown: prevent React Flow from receiving the event
    const onMouseDown = (e: MouseEvent) => {
      e.stopPropagation();
      isDraggingRef.current = true;
      setIsDragging(true);

      // Also seek to initial click position
      handleSeek(e);

      // Bind window-level events
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('blur', onBlur);
    };

    canvas.addEventListener('mousedown', onMouseDown, true); // capture phase

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [canvasRef, wavesurfer, duration, stopDrag]);

  return { isDragging };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd D:\flowweb\apps\web && npx vitest run src/hooks/useDragSeek.test.ts`
Expected: 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/useDragSeek.ts apps/web/src/hooks/useDragSeek.test.ts
git commit -m "feat: add useDragSeek hook with capture-phase isolation + throttle + boundary clamp"
```

---

### Task 4: Rewrite AudioWaveform.tsx

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/AudioWaveform.tsx`
- Modify: `apps/web/src/pages/canvas/components/nodes/AudioWaveform.test.tsx`

- [ ] **Step 1: Write the failing tests (rewriting the test file)**

```typescript
// apps/web/src/pages/canvas/components/nodes/AudioWaveform.test.tsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { AudioWaveform } from './AudioWaveform';
import { useAudioStore } from '@/stores/audioStore';

// Hoisted mocks
const { mockUseWavesurferReturn } = vi.hoisted(() => ({
  mockUseWavesurferReturn: {
    wavesurfer: {
      on: vi.fn(),
      getDuration: vi.fn(() => 120),
      getCurrentTime: vi.fn(() => 0),
      getDecodedData: vi.fn(() => ({
        getChannelData: vi.fn(() => new Float32Array(44100).fill(0.5)),
        length: 44100,
        numberOfChannels: 1,
        sampleRate: 44100,
      })),
    },
    isReady: true,
    isPlaying: false,
    currentTime: 0,
  },
}));

vi.mock('@wavesurfer/react', () => ({
  useWavesurfer: vi.fn(() => mockUseWavesurferReturn),
}));

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual('@xyflow/react');
  return {
    ...actual,
    useViewport: vi.fn(() => ({ zoom: 1, x: 0, y: 0 })),
  };
});

describe('AudioWaveform', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useAudioStore.setState({
      nodes: new Map(),
      activeNodeId: null,
      isGlobalPlaying: false,
    });
    useAudioStore.getState().registerNode('test-node');
    mockUseWavesurferReturn.wavesurfer = {
      on: vi.fn(),
      getDuration: vi.fn(() => 120),
      getCurrentTime: vi.fn(() => 0),
      getDecodedData: vi.fn(() => ({
        getChannelData: vi.fn((ch: number) => {
          const arr = new Float32Array(44100);
          for (let i = 0; i < 44100; i++) arr[i] = 0.5;
          return arr;
        }),
        length: 44100,
        numberOfChannels: 1,
        sampleRate: 44100,
      })),
    };
    mockUseWavesurferReturn.isReady = true;
    mockUseWavesurferReturn.isPlaying = false;
    mockUseWavesurferReturn.currentTime = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  const renderComponent = (props?: Partial<{ audioUrl: string; nodeId: string }>) =>
    render(<AudioWaveform nodeId="test-node" audioUrl="http://example.com/audio.mp3" {...props} />);

  // ─── Rendering ───

  it('should render the waveform container with background', () => {
    const { container } = renderComponent();
    const waveformDiv = container.querySelector('[style*="background-color"]');
    expect(waveformDiv).toBeTruthy();
  });

  // ─── Canvas element ───

  it('should render a canvas element', () => {
    const { container } = renderComponent();
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();
    expect(canvas?.className).toContain('nodrag');
  });

  // ─── Loading state ───

  it('should show loading overlay when wavesurfer is not ready', () => {
    mockUseWavesurferReturn.isReady = false;
    mockUseWavesurferReturn.wavesurfer = {
      on: vi.fn(),
      getDuration: vi.fn(() => 0),
      getCurrentTime: vi.fn(() => 0),
      getDecodedData: vi.fn(() => null),
    };
    renderComponent();
    expect(screen.getByTestId('waveform-loading')).toBeTruthy();
  });

  // ─── Playhead DOM elements ───

  it('should render playhead container', () => {
    const { container } = renderComponent();
    const playhead = container.querySelector('[class*="playhead"]');
    expect(playhead).toBeTruthy();
    // pointer-events: none
    expect(playhead?.getAttribute('style')).toContain('pointer-events');
  });

  it('should render playhead triangle SVG', () => {
    const { container } = renderComponent();
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  // ─── Play/Pause button ───

  it('should render play button when paused', () => {
    mockUseWavesurferReturn.isPlaying = false;
    renderComponent();
    expect(screen.getByLabelText('播放')).toBeTruthy();
  });

  it('should render pause button when playing', () => {
    mockUseWavesurferReturn.isPlaying = true;
    renderComponent();
    expect(screen.getByLabelText('暂停')).toBeTruthy();
  });

  // ─── Time display ───

  it('should display formatted currentTime and duration', () => {
    mockUseWavesurferReturn.currentTime = 65;
    renderComponent();
    expect(screen.getByText('01:05 / 02:00')).toBeTruthy();
  });

  // ─── Edge fades ───

  it('should render left and right edge fade overlays', () => {
    const { container } = renderComponent();
    const fades = container.querySelectorAll('[style*="linear-gradient"]');
    expect(fades.length).toBeGreaterThanOrEqual(2);
  });

  // ─── Event isolation ───

  it('should stop propagation on mouse events', () => {
    const { container } = renderComponent();
    const root = container.firstChild as HTMLElement;
    const stopPropagation = vi.spyOn(Event.prototype, 'stopPropagation');

    ['mousedown', 'mousemove', 'mouseup'].forEach((eventType) => {
      root.dispatchEvent(new MouseEvent(eventType, { bubbles: true }));
    });

    expect(stopPropagation).toHaveBeenCalledTimes(3);
    stopPropagation.mockRestore();
  });

  it('should stop propagation on touch events', () => {
    const { container } = renderComponent();
    const root = container.firstChild as HTMLElement;
    const stopPropagation = vi.spyOn(Event.prototype, 'stopPropagation');

    ['touchstart', 'touchmove', 'touchend'].forEach((eventType) => {
      root.dispatchEvent(new TouchEvent(eventType, { bubbles: true, cancelable: true }));
    });

    expect(stopPropagation).toHaveBeenCalledTimes(3);
    stopPropagation.mockRestore();
  });

  // ─── Error fallback ───

  it('should render fallback audio element on wavesurfer error event', async () => {
    let errorHandler: ((err: unknown) => void) | undefined;
    const mockWs = {
      on: vi.fn((event: string, handler: (err: unknown) => void) => {
        if (event === 'error') errorHandler = handler;
        return vi.fn();
      }),
      getDuration: vi.fn(() => 120),
      getCurrentTime: vi.fn(() => 0),
      getDecodedData: vi.fn(() => {
        const arr = new Float32Array(44100);
        for (let i = 0; i < 44100; i++) arr[i] = 0.5;
        return { getChannelData: () => arr, length: 44100, numberOfChannels: 1, sampleRate: 44100 };
      }),
    };
    mockUseWavesurferReturn.wavesurfer = mockWs;
    mockUseWavesurferReturn.isReady = true;

    renderComponent();

    await act(async () => {
      errorHandler!(new Error('Decode failed'));
    });

    await waitFor(() => {
      const audioEl = document.querySelector('audio');
      expect(audioEl).toBeTruthy();
      expect(audioEl).toHaveAttribute('src', 'http://example.com/audio.mp3');
    });
  });

  // ─── Register/unregister node ───

  it('should register the node on mount', () => {
    useAudioStore.getState().unregisterNode('test-node');
    expect(useAudioStore.getState().nodes.has('test-node')).toBe(false);
    renderComponent();
    expect(useAudioStore.getState().nodes.has('test-node')).toBe(true);
  });

  it('should unregister the node on unmount', () => {
    const { unmount } = renderComponent();
    expect(useAudioStore.getState().nodes.has('test-node')).toBe(true);
    unmount();
    expect(useAudioStore.getState().nodes.has('test-node')).toBe(false);
  });

  // ─── Finish event ───

  it('should reset isPlaying on finish event', () => {
    let finishHandler: (() => void) | undefined;
    const mockWs = {
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'finish') finishHandler = handler;
        return vi.fn();
      }),
      getDuration: vi.fn(() => 120),
      getCurrentTime: vi.fn(() => 0),
      getDecodedData: vi.fn(() => {
        const arr = new Float32Array(44100);
        for (let i = 0; i < 44100; i++) arr[i] = 0.5;
        return { getChannelData: () => arr, length: 44100, numberOfChannels: 1, sampleRate: 44100 };
      }),
    };
    mockUseWavesurferReturn.wavesurfer = mockWs;
    mockUseWavesurferReturn.isReady = true;
    mockUseWavesurferReturn.isPlaying = true;

    renderComponent();
    finishHandler!();
    expect(useAudioStore.getState().nodes.get('test-node')?.isPlaying).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd D:\flowweb\apps\web && npx vitest run src/pages/canvas/components/nodes/AudioWaveform.test.tsx`
Expected: FAIL — canvas/nodrag/playhead assertions not found (old component doesn't have these)

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/web/src/pages/canvas/components/nodes/AudioWaveform.tsx
import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useWavesurfer } from '@wavesurfer/react';
import { useViewport } from '@xyflow/react';
import { useAudioStore } from '@/stores/audioStore';
import { formatDuration } from '@/utils/date';
import { useWaveformPeaks } from '@/hooks/useWaveformPeaks';
import { useCanvasRenderer } from '@/hooks/useCanvasRenderer';
import { useDragSeek } from '@/hooks/useDragSeek';

export interface AudioWaveformProps {
  nodeId: string;
  audioUrl: string;
  waveformUrl?: string; // Phase 2: pre-generated peaks URL
  onError?: (error: Error) => void;
}

export function AudioWaveform({ nodeId, audioUrl, waveformUrl: _waveformUrl, onError }: AudioWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { registerNode, unregisterNode, setWavesurfer, togglePlay, updateNodeState } = useAudioStore();
  const viewport = useViewport();
  const [useFallback, setUseFallback] = useState(false);

  // Register/unregister lifecycle
  useEffect(() => {
    registerNode(nodeId);
    return () => { unregisterNode(nodeId); };
  }, [nodeId, registerNode, unregisterNode]);

  const { wavesurfer, isReady, isPlaying, currentTime } = useWavesurfer({
    container: containerRef,
    url: audioUrl,
    waveColor: '#ffffff',
    progressColor: '#38bdf8',
    cursorColor: '#38bdf8',
    cursorWidth: 2,
    barWidth: 3,
    barGap: 1,
    barRadius: 2,
    height: 120,
    backend: 'WebAudio',
    normalize: true,
    autoplay: false,
    autoScroll: false,
    mediaControls: false,
    interact: false, // Disable wavesurfer interaction — we handle it via useDragSeek
  });

  // Store wavesurfer instance
  useEffect(() => {
    if (wavesurfer) {
      setWavesurfer(nodeId, wavesurfer);
    }
  }, [wavesurfer, nodeId, setWavesurfer]);

  const duration = wavesurfer?.getDuration() ?? 0;

  // Sync playback state to store
  useEffect(() => {
    updateNodeState(nodeId, { isPlaying, currentTime, duration });
  }, [isPlaying, currentTime, duration, nodeId, updateNodeState]);

  // Resize on viewport zoom change
  useEffect(() => {
    if (wavesurfer && containerRef.current) {
      (wavesurfer as any).resize?.();
    }
  }, [viewport.zoom, wavesurfer]);

  // Finish event
  useEffect(() => {
    if (!wavesurfer) return;
    const unsub = wavesurfer.on('finish', () => {
      useAudioStore.getState().updateNodeState(nodeId, { isPlaying: false });
    });
    return () => { (unsub as (() => void) | undefined)?.(); };
  }, [wavesurfer, nodeId]);

  // Error handling
  useEffect(() => {
    if (!wavesurfer) return;
    const unsub = wavesurfer.on('error', (err: unknown) => {
      console.error('AudioWaveform load error:', nodeId, err);
      setUseFallback(true);
      onError?.(err instanceof Error ? err : new Error(String(err)));
    });
    return () => { (unsub as (() => void) | undefined)?.(); };
  }, [wavesurfer, nodeId, onError]);

  // Custom hooks
  const peaks = useWaveformPeaks(wavesurfer, audioUrl, 250);

  // visibleWidth from CSS variable — default 340px
  const [visibleWidth, setVisibleWidth] = useState(340);
  const waveformAreaRef = useRef<HTMLDivElement>(null);
  // Dynamic visible width from container, fallback 340
  useEffect(() => {
    const el = waveformAreaRef.current;
    if (el) setVisibleWidth(el.clientWidth * 0.85);
  }, []);

  useCanvasRenderer(canvasRef, peaks, wavesurfer, isPlaying, duration, visibleWidth);
  const { isDragging } = useDragSeek(canvasRef, wavesurfer, isReady, duration);

  // Play/pause handler
  const handleTogglePlay = useCallback(() => {
    if (!isReady) return;
    togglePlay(nodeId);
  }, [isReady, togglePlay, nodeId]);

  // Event isolation for React Flow canvas
  const stopEvent = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
  }, []);

  // Fallback: native audio element
  if (useFallback) {
    return (
      <audio controls src={audioUrl} className="w-full h-full" />
    );
  }

  // Playhead hover state for line width + tooltip visibility
  const [isPlayheadHovered, setIsPlayheadHovered] = useState(false);

  return (
    <div
      className="w-full h-full flex flex-col select-none"
      onMouseDown={stopEvent}
      onMouseMove={stopEvent}
      onMouseUp={stopEvent}
      onMouseLeave={stopEvent}
      onTouchStart={stopEvent}
      onTouchMove={stopEvent}
      onTouchEnd={stopEvent}
    >
      {/* Waveform area */}
      <div className="flex-1 flex items-center justify-center px-4">
        <div
          ref={waveformAreaRef}
          className="w-full relative"
          style={{
            backgroundColor: '#1f1f1f',
            borderRadius: 12,
            height: 120,
            boxSizing: 'border-box',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* Hidden wavesurfer container (audio engine only, not visible) */}
          <div ref={containerRef} style={{ display: 'none' }} />

          {/* Waveform canvas */}
          <canvas
            ref={canvasRef}
            className="nodrag"
            style={{
              cursor: isDragging ? 'grabbing' : 'grab',
              position: 'absolute',
              top: 0,
              left: 0,
            }}
          />

          {/* Left edge fade: gradient to right */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: '10%',
              background: 'linear-gradient(to right, #1f1f1f 0%, transparent 100%)',
              pointerEvents: 'none',
              zIndex: 20,
              borderRadius: '12px 0 0 12px',
            }}
          />

          {/* Right edge fade: gradient to left */}
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              width: '10%',
              background: 'linear-gradient(to left, #1f1f1f 0%, transparent 100%)',
              pointerEvents: 'none',
              zIndex: 20,
              borderRadius: '0 12px 12px 0',
            }}
          />

          {/* Playhead (DOM overlay, pointer-events: none) */}
          <div
            className="playhead"
            style={{
              position: 'absolute',
              left: '50%',
              top: 0,
              bottom: 0,
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              pointerEvents: 'none',
              zIndex: 30,
            }}
            onMouseEnter={() => setIsPlayheadHovered(true)}
            onMouseLeave={() => setIsPlayheadHovered(false)}
          >
            {/* Triangle arrow */}
            <svg width="10" height="6" className="shrink-0" style={{ pointerEvents: 'none' }}>
              <path d="M0 0h10L5 6z" fill="#38bdf8" />
            </svg>

            {/* Vertical line */}
            <div
              className="playhead-line"
              style={{
                width: isPlayheadHovered ? 4 : 2,
                flex: 1,
                backgroundColor: '#38bdf8',
                borderRadius: 1,
                transition: 'width 150ms cubic-bezier(0.25, 0.1, 0.25, 1)',
              }}
            />

            {/* Time tooltip (hover) */}
            <div
              className="playhead-tooltip"
              style={{
                position: 'absolute',
                top: '100%',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                opacity: isPlayheadHovered ? 1 : 0,
                transition: 'opacity 150ms',
                pointerEvents: 'none',
                marginTop: 4,
              }}
            >
              <svg width="8" height="4" style={{ marginBottom: -1 }}>
                <path d="M0 4L4 0l4 4z" fill="#38bdf8" />
              </svg>
              <span
                style={{
                  backgroundColor: '#38bdf8',
                  color: '#0f172a',
                  fontSize: 10,
                  fontWeight: 500,
                  padding: '2px 6px',
                  borderRadius: 4,
                  whiteSpace: 'nowrap',
                }}
              >
                {formatDuration(currentTime)}/{formatDuration(duration)}
              </span>
            </div>
          </div>

          {/* Loading overlay */}
          {(!isReady) && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800/70 rounded-[12px] z-40">
              <span data-testid="waveform-loading" className="text-xs text-gray-400 animate-pulse">
                loading
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Controls: play/pause + time */}
      <div className="flex items-center justify-center gap-3 py-1.5">
        <button
          aria-label={isPlaying ? '暂停' : '播放'}
          className="text-white hover:text-[#38bdf8] transition-colors"
          style={{ fontSize: 40, lineHeight: '40px', width: 40, height: 40 }}
          onClick={handleTogglePlay}
        >
          {isPlaying ? (
            <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
      </div>
      <div className="text-xs text-gray-400 text-center pb-1">
        {formatDuration(currentTime)} / {formatDuration(duration)}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd D:\flowweb\apps\web && npx vitest run src/pages/canvas/components/nodes/AudioWaveform.test.tsx`
Expected: 16 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/AudioWaveform.tsx apps/web/src/pages/canvas/components/nodes/AudioWaveform.test.tsx
git commit -m "feat: rewrite AudioWaveform with custom Canvas rendering + DOM playhead overlay"
```

---

### Task 5: Update AudioGenNode Height

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/AudioGenNode.tsx`
- Modify: `apps/web/src/pages/canvas/components/nodes/AudioGenNode.test.tsx`

- [ ] **Step 1: Update NODE_HEIGHT constant**

```typescript
// apps/web/src/pages/canvas/components/nodes/AudioGenNode.tsx:12
const NODE_HEIGHT = 180; // was 260
```

- [ ] **Step 2: Update tests**

```typescript
// apps/web/src/pages/canvas/components/nodes/AudioGenNode.test.tsx
// Change 260 → 180 in height assertions
```

- [ ] **Step 3: Run all tests to verify nothing breaks**

Run: `cd D:\flowweb\apps\web && npx vitest run`
Expected: All tests PASS (AudioGenNode tests updated for new height)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/AudioGenNode.tsx apps/web/src/pages/canvas/components/nodes/AudioGenNode.test.tsx
git commit -m "feat: reduce AudioGenNode height 260→180 for waveform V2 layout"
```

---

### Task 6: Integration Verification

- [ ] **Step 1: Run all tests**

Run: `cd D:\flowweb\apps\web && npx vitest run`
Expected: All tests PASS (audioStore, AudioGenNode, AudioWaveform, useWaveformPeaks, useCanvasRenderer, useDragSeek)

- [ ] **Step 2: Run TypeScript type check**

Run: `cd D:\flowweb\apps\web && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "chore: verify all tests pass for waveform V2 integration"
```
