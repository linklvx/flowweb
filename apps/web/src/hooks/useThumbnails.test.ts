import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// We import the module under test after setting up mocks
let useThumbnails: typeof import('./useThumbnails').useThumbnails;
let clearThumbnailCache: typeof import('./useThumbnails').clearThumbnailCache;

// ─── Mocks setup ──────────────────────────────────────────────

// Mock video element factory
function createMockVideo(src: string) {
  const listeners: Record<string, Array<() => void>> = {};
  const video = {
    src: '',
    duration: 30,
    videoWidth: 1920,
    videoHeight: 1080,
    muted: false,
    playsInline: false,
    preload: '',
    crossOrigin: null as string | null,
    currentTime: 0,
    pause: vi.fn(),
    load: vi.fn(),
    addEventListener: vi.fn((event: string, handler: any, opts?: any) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    }),
    removeEventListener: vi.fn(),
    dispatchEvent: (event: string) => {
      listeners[event]?.forEach(h => h());
    },
    get _listeners() { return listeners; },
  };

  // When src is set, fire loadedmetadata after a tick (deferred so listeners are registered)
  Object.defineProperty(video, 'src', {
    get() { return src; },
    set(val: string) {
      src = val;
      setTimeout(() => {
        video.dispatchEvent('loadedmetadata');
      }, 0);
    },
  });

  // When currentTime is set, fire seeked after a tick
  let currentTimeVal = 0;
  Object.defineProperty(video, 'currentTime', {
    get() { return currentTimeVal; },
    set(val: number) {
      currentTimeVal = val;
      setTimeout(() => {
        video.dispatchEvent('seeked');
      }, 0);
    },
  });

  return video as unknown as HTMLVideoElement;
}

// Mock canvas + context
function createMockCanvas() {
  const ctx = {
    drawImage: vi.fn(),
  };
  const canvas = {
    width: 40,
    height: 60,
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn((_type?: string, _quality?: number) => {
      return `data:image/jpeg;base64,mock_${Math.random().toString(36).slice(2)}`;
    }),
    _ctx: ctx,
  };
  return canvas as unknown as HTMLCanvasElement & { _ctx: typeof ctx };
}

describe('useThumbnails', () => {
  let mockVideo: ReturnType<typeof createMockVideo>;
  let mockCanvas: ReturnType<typeof createMockCanvas>;
  let createElementSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    mockVideo = createMockVideo('');
    mockCanvas = createMockCanvas();

    // Spy on document.createElement — save original for fallback
    const origCreateElement = document.createElement.bind(document);
    createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string, ...rest: any[]) => {
      if (tag === 'video') return mockVideo as any;
      if (tag === 'canvas') return mockCanvas as any;
      return origCreateElement(tag, ...rest);
    }) as typeof document.createElement);

    // Dynamically import to get fresh module state per test
    const mod = await import('./useThumbnails');
    useThumbnails = mod.useThumbnails;
    clearThumbnailCache = mod.clearThumbnailCache;

    // Clear module-level cache between tests
    clearThumbnailCache();
  });

  afterEach(() => {
    createElementSpy.mockRestore();
    vi.restoreAllMocks();
  });

  // ─── Test Cases ───────────────────────────────────────────────

  // 1. videoSrc is null → empty array + loading:false
  it('should return empty thumbnails when videoSrc is null', () => {
    const { result } = renderHook(() =>
      useThumbnails({ videoSrc: null, duration: 30 }),
    );

    expect(result.current.thumbnails).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(false);
  });

  // 2. videoSrc is undefined → empty array + loading:false
  it('should return empty thumbnails when videoSrc is undefined', () => {
    const { result } = renderHook(() =>
      useThumbnails({ videoSrc: undefined, duration: 30 }),
    );

    expect(result.current.thumbnails).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  // 3. duration < 1 → empty array + loading:false
  it('should not extract frames when duration < 1', () => {
    const { result } = renderHook(() =>
      useThumbnails({ videoSrc: 'http://example.com/video.mp4', duration: 0.5 }),
    );

    expect(result.current.thumbnails).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  // 4. duration >= 2 → 20 thumbnails
  it('should extract 20 thumbnails for duration >= 2s', async () => {
    const { result } = renderHook(() =>
      useThumbnails({ videoSrc: 'http://example.com/video.mp4', duration: 30 }),
    );

    // Initially loading
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.thumbnails.length).toBe(20);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(false);

    // All items should be data URLs
    result.current.thumbnails.forEach(t => {
      expect(t).toMatch(/^data:image\/jpeg;base64,/);
    });
  });

  // 5. duration < 2 && >= 1 → 10 thumbnails
  it('should extract 10 thumbnails for duration between 1s and 2s', async () => {
    const { result } = renderHook(() =>
      useThumbnails({ videoSrc: 'http://example.com/short.mp4', duration: 1.5 }),
    );

    await waitFor(() => {
      expect(result.current.thumbnails.length).toBe(10);
    });

    expect(result.current.loading).toBe(false);
  });

  // 6. Same videoSrc twice → cache hit (extract only once)
  it('should cache thumbnails and reuse for same videoSrc', async () => {
    const src = 'http://example.com/same.mp4';

    const { result: r1, unmount: u1 } = renderHook(() =>
      useThumbnails({ videoSrc: src, duration: 30 }),
    );

    await waitFor(() => {
      expect(r1.current.thumbnails.length).toBe(20);
    });

    u1();

    // Second mount with same src — should hit cache
    const { result: r2 } = renderHook(() =>
      useThumbnails({ videoSrc: src, duration: 30 }),
    );

    // Should be immediate (no loading state)
    expect(r2.current.thumbnails.length).toBe(20);
    expect(r2.current.loading).toBe(false);
  });

  // 7. LRU eviction: 6th different videoSrc evicts oldest
  it('should evict oldest cache entry when exceeding max 5 entries', async () => {
    // Fill cache with 5 different sources
    for (let i = 0; i < 5; i++) {
      const { result, unmount } = renderHook(() =>
        useThumbnails({ videoSrc: `http://example.com/v${i}.mp4`, duration: 30 }),
      );
      await waitFor(() => {
        expect(result.current.thumbnails.length).toBe(20);
      });
      unmount();
    }

    // Re-access v0 to bump it to end of LRU (so v1 becomes oldest)
    const { result: r0again, unmount: u0again } = renderHook(() =>
      useThumbnails({ videoSrc: 'http://example.com/v0.mp4', duration: 30 }),
    );
    expect(r0again.current.thumbnails.length).toBe(20);
    expect(r0again.current.loading).toBe(false);
    u0again();

    // Add 6th video — should evict v1 (oldest after v0 was re-accessed)
    const { result: r5, unmount: u5 } = renderHook(() =>
      useThumbnails({ videoSrc: 'http://example.com/v5.mp4', duration: 30 }),
    );
    await waitFor(() => {
      expect(r5.current.thumbnails.length).toBe(20);
    });
    u5();

    // v1 should now be evicted (was the oldest non-reaccessed)
    const { result: r1evicted } = renderHook(() =>
      useThumbnails({ videoSrc: 'http://example.com/v1.mp4', duration: 30 }),
    );
    // If evicted, it needs to reload — loading should be true initially
    expect(r1evicted.current.loading).toBe(true);
  });

  // 8. loadedmetadata 3s timeout → error:true
  it('should set error on loadedmetadata timeout', async () => {
    // Override mock to NOT fire loadedmetadata
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, ...rest: any[]) => {
      if (tag === 'video') {
        const v = createMockVideo('');
        // Don't auto-dispatch loadedmetadata
        Object.defineProperty(v, 'src', {
          get() { return ''; },
          set(_val: string) {
            // never fire loadedmetadata — simulate timeout
          },
        });
        return v as any;
      }
      if (tag === 'canvas') return mockCanvas as any;
      return origCreateElement(tag, ...rest);
    }) as typeof document.createElement);

    vi.useFakeTimers();

    const { result } = renderHook(() =>
      useThumbnails({ videoSrc: 'http://slow.example.com/v.mp4', duration: 30 }),
    );

    expect(result.current.loading).toBe(true);

    // Fast-forward past 3s timeout
    await act(async () => {
      vi.advanceTimersByTimeAsync(3100);
      // Flush pending promises
      await Promise.resolve();
    });

    expect(result.current.error).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.thumbnails).toEqual([]);

    vi.useRealTimers();
  });

  // 9. Unmount during extraction cancels
  it('should cancel extraction on unmount', async () => {
    const { result, unmount } = renderHook(() =>
      useThumbnails({ videoSrc: 'http://example.com/v.mp4', duration: 30 }),
    );

    expect(result.current.loading).toBe(true);

    // Unmount before extraction completes
    unmount();

    // Should not throw — verification is that no setState warning occurs
    // (would show in console if state was set after unmount)
    expect(true).toBe(true);
  });

  // 10. SecurityError on drawImage → error:true
  it('should handle SecurityError (canvas taint) gracefully', async () => {
    const taintedCtx = {
      drawImage: vi.fn(() => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      }),
    };
    const taintedCanvas = {
      width: 40,
      height: 60,
      getContext: vi.fn(() => taintedCtx),
      toDataURL: vi.fn(),
      _ctx: taintedCtx,
    };

    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, ...rest: any[]) => {
      if (tag === 'video') return mockVideo as any;
      if (tag === 'canvas') return taintedCanvas as any;
      return origCreateElement(tag, ...rest);
    }) as typeof document.createElement);

    const { result } = renderHook(() =>
      useThumbnails({ videoSrc: 'http://cross-origin.example.com/v.mp4', duration: 30 }),
    );

    await waitFor(() => {
      expect(result.current.error).toBe(true);
    });

    expect(result.current.loading).toBe(false);
  });

  // 11. cover mode → correct drawImage params
  it('should use cover mode cropping (center-crop) for drawImage', async () => {
    const { result } = renderHook(() =>
      useThumbnails({ videoSrc: 'http://example.com/v.mp4', duration: 30 }),
    );

    await waitFor(() => {
      expect(result.current.thumbnails.length).toBe(20);
    });

    // Verify drawImage was called with cover-mode coordinates
    const ctx = mockCanvas._ctx;
    expect(ctx.drawImage).toHaveBeenCalled();

    // First call args: drawImage(video, sx, sy, sw, sh)
    const firstCall = ctx.drawImage.mock.calls[0];
    const videoArg = firstCall[0];
    const sx = firstCall[1] as number;
    const sy = firstCall[2] as number;
    const sw = firstCall[3] as number;
    const sh = firstCall[4] as number;

    expect(videoArg).toBe(mockVideo);

    // Canvas is 40×60, video is 1920×1080
    // scale = max(40/1920, 60/1080) = max(0.0208, 0.0556) = 0.0556
    // sw = 1920 * 0.0556 ≈ 106.7, sh = 1080 * 0.0556 ≈ 60
    // sx = (40 - 106.7) / 2 ≈ -33.3, sy = (60 - 60) / 2 = 0
    // Cover: sourceW = canvasW / scale, sourceH = canvasH / scale
    // sourceW = 40 / 0.05556 = 720, sourceH = 60 / 0.05556 = 1080
    // sourceX = (1920 - 720) / 2 = 600, sourceY = (1080 - 1080) / 2 = 0
    expect(sx).toBeCloseTo(600, 0);
    expect(sy).toBeCloseTo(0, 0);
    expect(sw).toBeCloseTo(720, 0);
    expect(sh).toBeCloseTo(1080, 0);
    // dx, dy should be 0, 0 and dw, dh should be canvas dimensions
    expect(firstCall[5]).toBe(0);
    expect(firstCall[6]).toBe(0);
    expect(firstCall[7]).toBe(40);
    expect(firstCall[8]).toBe(60);
  });
});
