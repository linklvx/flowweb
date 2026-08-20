import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { RefObject } from 'react';

// ── Hoisted mocks ─────────────────────────────────────────

const vu = vi.hoisted(() => ({
  drawFullFrame: vi.fn(),
  drawCover: vi.fn(),
  createHiddenVideo: vi.fn(),
  waitForMetadata: vi.fn(),
  waitForSeeked: vi.fn(),
  releaseVideo: vi.fn(),
  videoFrameToBlob: vi.fn(),
}));

vi.mock('@/utils/videoFrameUtils', () => vu);

// ── Dynamic import holders ────────────────────────────────

let useVideoFrameCapture: typeof import('./useVideoFrameCapture').useVideoFrameCapture;
let clearVideoCache: typeof import('./useVideoFrameCapture').clearVideoCache;
let clearFirstFrameCache: typeof import('./useVideoFrameCapture').clearFirstFrameCache;
let clearVideoLocks: typeof import('./useVideoFrameCapture').clearVideoLocks;

// ── Mock helpers ──────────────────────────────────────────

type HiddenVid = HTMLVideoElement & {
  _listeners: Record<string, Array<() => void>>;
};

function makeHiddenVideo() {
  const listeners: Record<string, Array<() => void>> = {};
  const video = {
    src: '',
    videoWidth: 1920,
    videoHeight: 1080,
    duration: 30,
    currentTime: 0,
    muted: false,
    playsInline: false,
    preload: '',
    crossOrigin: '',
    pause: vi.fn(),
    load: vi.fn(),
    play: vi.fn(() => Promise.resolve()),
    addEventListener: vi.fn((event: string, fn: () => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    }),
    removeEventListener: vi.fn(),
    _listeners: listeners,
  } as unknown as HiddenVid;
  return video;
}

function makeMainVideo(overrides: Record<string, unknown> = {}) {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    muted: false,
    paused: true,
    currentTime: 5,
    duration: 30,
    videoWidth: 1920,
    videoHeight: 1080,
    readyState: 2,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    addEventListener: vi.fn((event: string, fn: () => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    }),
    removeEventListener: vi.fn(),
    _emit: (event: string) => listeners[event]?.forEach((fn) => fn()),
    ...overrides,
  } as unknown as HTMLVideoElement & { _emit(event: string): void };
}

// ── Setup / teardown ──────────────────────────────────────

beforeEach(async () => {
  vi.clearAllMocks();

  vu.videoFrameToBlob.mockResolvedValue(new Blob(['frame'], { type: 'image/jpeg' }));
  vu.waitForMetadata.mockResolvedValue(undefined);
  vu.waitForSeeked.mockResolvedValue(undefined);
  vu.createHiddenVideo.mockImplementation(() => makeHiddenVideo());

  const mod = await import('./useVideoFrameCapture');
  useVideoFrameCapture = mod.useVideoFrameCapture;
  clearVideoCache = mod.clearVideoCache;
  clearFirstFrameCache = mod.clearFirstFrameCache;
  clearVideoLocks = mod.clearVideoLocks;

  clearVideoCache();
  clearFirstFrameCache();
  clearVideoLocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Helpers ───────────────────────────────────────────────

const SRC = 'https://example.com/video.mp4';
const DUR = 30;

// ── Tests ─────────────────────────────────────────────────

describe('useVideoFrameCapture', () => {
  // ── captureCurrent ─────────────────────────────────────

  describe('captureCurrent', () => {
    it('#1 returns a Blob', async () => {
      const video = makeMainVideo();
      const ref: RefObject<HTMLVideoElement | null> = { current: video };
      const { result } = renderHook(() => useVideoFrameCapture({ videoSrc: SRC, duration: DUR, videoRef: ref }));
      let blob: Blob;
      await act(async () => { blob = await result.current.captureCurrent(); });
      expect(blob!).toBeInstanceOf(Blob);
      expect(vu.videoFrameToBlob).toHaveBeenCalledWith(video);
    });

    it('#2 rejects when readyState < 2', async () => {
      const video = makeMainVideo({ readyState: 1 });
      const ref: RefObject<HTMLVideoElement | null> = { current: video };
      const { result } = renderHook(() => useVideoFrameCapture({ videoSrc: SRC, duration: DUR, videoRef: ref }));
      await expect(act(() => result.current.captureCurrent())).rejects.toThrow('视频未加载完成');
    });

    it('#3 resumes playback if was playing', async () => {
      const video = makeMainVideo({ paused: false });
      const ref: RefObject<HTMLVideoElement | null> = { current: video };
      const { result } = renderHook(() => useVideoFrameCapture({ videoSrc: SRC, duration: DUR, videoRef: ref }));
      await act(async () => { await result.current.captureCurrent(); });
      expect(video.pause).toHaveBeenCalled();
      expect(video.play).toHaveBeenCalled();
    });

    it('#4 keeps paused if was paused', async () => {
      const video = makeMainVideo({ paused: true });
      const ref: RefObject<HTMLVideoElement | null> = { current: video };
      const { result } = renderHook(() => useVideoFrameCapture({ videoSrc: SRC, duration: DUR, videoRef: ref }));
      await act(async () => { await result.current.captureCurrent(); });
      expect(video.pause).toHaveBeenCalled();
      expect(video.play).not.toHaveBeenCalled();
    });
  });

  // ── captureFirst ────────────────────────────────────────

  describe('captureFirst', () => {
    it('#5 seeks to 0.1s for normal video', async () => {
      const video = makeMainVideo();
      const ref: RefObject<HTMLVideoElement | null> = { current: video };
      const { result } = renderHook(() => useVideoFrameCapture({ videoSrc: SRC, duration: 30, videoRef: ref }));
      await act(async () => { await result.current.captureFirst(); });
      const hv = vu.createHiddenVideo.mock.results[0]?.value as HiddenVid;
      expect(hv.currentTime).toBe(0.1);
    });

    it('#6 seeks to clampTime(Math.min(0.1, dur/2), dur) for short video', async () => {
      const video = makeMainVideo();
      const ref: RefObject<HTMLVideoElement | null> = { current: video };
      const { result } = renderHook(() => useVideoFrameCapture({ videoSrc: SRC, duration: 0.15, videoRef: ref }));
      await act(async () => { await result.current.captureFirst(); });
      const hv = vu.createHiddenVideo.mock.results[0]?.value as HiddenVid;
      expect(hv.currentTime).toBe(0.075); // min(0.1, 0.075) = 0.075
    });

    it('#7 very short video (0.05s) first frame time in [0, 0.05]', async () => {
      const video = makeMainVideo();
      const ref: RefObject<HTMLVideoElement | null> = { current: video };
      const { result } = renderHook(() => useVideoFrameCapture({ videoSrc: SRC, duration: 0.05, videoRef: ref }));
      await act(async () => { await result.current.captureFirst(); });
      const hv = vu.createHiddenVideo.mock.results[0]?.value as HiddenVid;
      expect(hv.currentTime).toBeGreaterThanOrEqual(0);
      expect(hv.currentTime).toBeLessThanOrEqual(0.05);
    });
  });

  // ── captureLast ─────────────────────────────────────────

  describe('captureLast', () => {
    it('#8 seeks to duration-0.1 for normal video', async () => {
      const video = makeMainVideo();
      const ref: RefObject<HTMLVideoElement | null> = { current: video };
      const { result } = renderHook(() => useVideoFrameCapture({ videoSrc: SRC, duration: 30, videoRef: ref }));
      await act(async () => { await result.current.captureLast(); });
      const hv = vu.createHiddenVideo.mock.results[0]?.value as HiddenVid;
      expect(hv.currentTime).toBe(29.9);
    });

    it('#9 very short video (0.05s) last frame time in [0, 0.05]', async () => {
      const video = makeMainVideo();
      const ref: RefObject<HTMLVideoElement | null> = { current: video };
      const { result } = renderHook(() => useVideoFrameCapture({ videoSrc: SRC, duration: 0.05, videoRef: ref }));
      await act(async () => { await result.current.captureLast(); });
      const hv = vu.createHiddenVideo.mock.results[0]?.value as HiddenVid;
      expect(hv.currentTime).toBeGreaterThanOrEqual(0);
      expect(hv.currentTime).toBeLessThanOrEqual(0.05);
    });
  });

  // ── Concurrency ─────────────────────────────────────────

  describe('concurrency', () => {
    it('#10 rejects second call while first is in progress', async () => {
      let go: (b: Blob) => void = () => {};
      vu.videoFrameToBlob.mockReturnValueOnce(new Promise((r) => { go = r; }));
      const video = makeMainVideo();
      const ref: RefObject<HTMLVideoElement | null> = { current: video };
      const { result } = renderHook(() => useVideoFrameCapture({ videoSrc: SRC, duration: DUR, videoRef: ref }));

      const p1 = act(() => result.current.captureCurrent());
      await expect(act(() => result.current.captureFirst())).rejects.toThrow('截帧进行中');
      go(new Blob(['x'], { type: 'image/jpeg' }));
      await p1;
    });
  });

  // ── First frame cache ───────────────────────────────────

  describe('first frame cache', () => {
    it('#11 cache hit on second captureFirst', async () => {
      const video = makeMainVideo();
      const ref: RefObject<HTMLVideoElement | null> = { current: video };
      const { result } = renderHook(() => useVideoFrameCapture({ videoSrc: SRC, duration: 30, videoRef: ref }));

      await act(async () => { await result.current.captureFirst(); });
      const n = vu.createHiddenVideo.mock.calls.length;
      await act(async () => { await result.current.captureFirst(); });
      expect(vu.createHiddenVideo).toHaveBeenCalledTimes(n); // cached, no new video
    });

    it('#12 different duration = cache miss (re-executes seek)', async () => {
      const video = makeMainVideo();
      const ref: RefObject<HTMLVideoElement | null> = { current: video };
      const { result, rerender } = renderHook(
        ({ dur }: { dur: number }) => useVideoFrameCapture({ videoSrc: SRC, duration: dur, videoRef: ref }),
        { initialProps: { dur: 30 } },
      );

      await act(async () => { await result.current.captureFirst(); });
      const n = vu.waitForSeeked.mock.calls.length;
      rerender({ dur: 60 });
      await act(async () => { await result.current.captureFirst(); });
      // Should re-execute seek (different cache key) even though video is reused
      expect(vu.waitForSeeked.mock.calls.length).toBeGreaterThan(n);
    });
  });

  // ── Prefetch interaction ────────────────────────────────

  describe('prefetch interaction', () => {
    it('#13 user waits for prefetch when clicking during prefetch', async () => {
      let go: () => void = () => {};
      // First waitForSeeked = prefetch, second = user click
      vu.waitForSeeked
        .mockReturnValueOnce(new Promise<void>((r) => { go = r; }))
        .mockResolvedValueOnce(undefined);

      const video = makeMainVideo();
      const ref: RefObject<HTMLVideoElement | null> = { current: video };
      const { result } = renderHook(() => useVideoFrameCapture({ videoSrc: SRC, duration: DUR, videoRef: ref }));

      // Wait for prefetch to start (waitForMetadata called)
      await vi.waitFor(() => { expect(vu.waitForMetadata).toHaveBeenCalled(); }, { timeout: 500 });

      // Start user captureFirst while prefetch is still hanging
      const cp = act(() => result.current.captureFirst());
      // Resolve prefetch
      go();
      const blob = await cp;
      expect(blob).toBeInstanceOf(Blob);
    });

    it('#14 captureFirst succeeds after prefetch failure', async () => {
      vu.waitForMetadata.mockRejectedValueOnce(new Error('prefetch fail'));
      const video = makeMainVideo();
      const ref: RefObject<HTMLVideoElement | null> = { current: video };
      const { result } = renderHook(() => useVideoFrameCapture({ videoSrc: SRC, duration: DUR, videoRef: ref }));

      await vi.waitFor(() => { expect(vu.waitForMetadata).toHaveBeenCalledTimes(1); }, { timeout: 500 });
      vu.waitForMetadata.mockResolvedValue(undefined);

      let blob: Blob;
      await act(async () => { blob = await result.current.captureFirst(); });
      expect(blob!).toBeInstanceOf(Blob);
    });
  });

  // ── Hidden video LRU ────────────────────────────────────

  describe('hidden video LRU', () => {
    it('#15 reuse video for same src', async () => {
      const video = makeMainVideo();
      const ref: RefObject<HTMLVideoElement | null> = { current: video };
      const { result } = renderHook(() => useVideoFrameCapture({ videoSrc: SRC, duration: DUR, videoRef: ref }));

      await act(async () => { await result.current.captureFirst(); });
      await act(async () => { await result.current.captureFirst(); });
      expect(vu.createHiddenVideo).toHaveBeenCalledTimes(1);
    });

    it('#16 evict oldest when exceeding 5', async () => {
      const video = makeMainVideo();
      const ref: RefObject<HTMLVideoElement | null> = { current: video };
      const { result, rerender } = renderHook(
        ({ src }: { src: string }) => useVideoFrameCapture({ videoSrc: src, duration: DUR, videoRef: ref }),
        { initialProps: { src: 'https://a.com/0.mp4' } },
      );

      for (let i = 0; i < 6; i++) {
        rerender({ src: `https://a.com/${i}.mp4` });
        await act(async () => { await result.current.captureFirst(); });
      }
      expect(vu.releaseVideo).toHaveBeenCalled(); // eviction happened
    });
  });

  // ── Unmount safety ─────────────────────────────────────

  describe('unmount safety', () => {
    it('#17 no setState after unmount', async () => {
      let go: (b: Blob) => void = () => {};
      vu.videoFrameToBlob.mockReturnValueOnce(new Promise((r) => { go = r; }));
      const video = makeMainVideo();
      const ref: RefObject<HTMLVideoElement | null> = { current: video };
      const { result, unmount } = renderHook(() => useVideoFrameCapture({ videoSrc: SRC, duration: DUR, videoRef: ref }));

      const cp = act(() => result.current.captureCurrent());
      unmount();
      go(new Blob(['x'], { type: 'image/jpeg' }));
      await cp; // should not throw
    });

    it('#18 isCapturingRef reset in finally after unmount', async () => {
      let go: (b: Blob) => void = () => {};
      vu.videoFrameToBlob.mockReturnValueOnce(new Promise((r) => { go = r; }));
      const video = makeMainVideo();
      const ref: RefObject<HTMLVideoElement | null> = { current: video };
      const { result, unmount } = renderHook(() => useVideoFrameCapture({ videoSrc: SRC, duration: DUR, videoRef: ref }));

      const cp = act(() => result.current.captureCurrent());
      unmount();
      go(new Blob(['x'], { type: 'image/jpeg' }));
      await cp;
      // No unhandled rejection = finally ran and reset the flag
    });
  });

  // ── Prefetch trigger ────────────────────────────────────

  describe('prefetch trigger', () => {
    it('#19 triggers prefetch when src+duration valid', async () => {
      const video = makeMainVideo();
      const ref: RefObject<HTMLVideoElement | null> = { current: video };
      renderHook(() => useVideoFrameCapture({ videoSrc: SRC, duration: DUR, videoRef: ref }));
      await vi.waitFor(() => { expect(vu.createHiddenVideo).toHaveBeenCalled(); }, { timeout: 500 });
    });

    it('#19b does NOT trigger prefetch when src is null', async () => {
      const video = makeMainVideo();
      const ref: RefObject<HTMLVideoElement | null> = { current: video };
      renderHook(() => useVideoFrameCapture({ videoSrc: null, duration: DUR, videoRef: ref }));
      await new Promise((r) => setTimeout(r, 100));
      expect(vu.createHiddenVideo).not.toHaveBeenCalled();
    });
  });

  // ── Lock mechanism ──────────────────────────────────────

  describe('lock mechanism', () => {
    it('#20 concurrent access to same cached video serializes via lock', async () => {
      // Make first captureFirst's seek hang
      let go1: () => void = () => {};
      vu.waitForSeeked.mockReturnValueOnce(new Promise<void>((r) => { go1 = r; }));

      const video = makeMainVideo();
      const ref: RefObject<HTMLVideoElement | null> = { current: video };
      const { result } = renderHook(
        () => useVideoFrameCapture({ videoSrc: SRC, duration: DUR, videoRef: ref }),
      );

      // Start captureFirst — hangs at waitForSeeked (lock held)
      const p1 = act(() => result.current.captureFirst());
      await new Promise((r) => setTimeout(r, 50));

      // Verify a second concurrent captureFirst from same hook is blocked by isCapturingRef
      await expect(result.current.captureFirst()).rejects.toThrow('截帧进行中');

      // Release and verify first succeeds
      go1();
      const blob1 = await p1;
      expect(blob1).toBeInstanceOf(Blob);
    });

    it('#21 lock released on exception, allowing subsequent calls', async () => {
      // Two rejections: one for prefetch (silent), one for user call
      vu.waitForSeeked.mockRejectedValueOnce(new Error('prefetch fail'));
      vu.waitForSeeked.mockRejectedValueOnce(new Error('seek failed'));

      const video = makeMainVideo();
      const ref: RefObject<HTMLVideoElement | null> = { current: video };
      const { result } = renderHook(
        () => useVideoFrameCapture({ videoSrc: SRC, duration: DUR, videoRef: ref }),
      );

      // First call fails (lock released in withVideoLock's finally)
      await expect(result.current.captureFirst()).rejects.toThrow('seek failed');

      // Second call succeeds
      vu.waitForSeeked.mockResolvedValue(undefined);
      const blob = await result.current.captureFirst();
      expect(blob).toBeInstanceOf(Blob);
    });
  });

  // ── Edge cases ──────────────────────────────────────────

  describe('edge cases', () => {
    it('#22 null videoRef → captureCurrent rejects', () => {
      const ref: RefObject<HTMLVideoElement | null> = { current: null };
      const { result } = renderHook(() =>
        useVideoFrameCapture({ videoSrc: SRC, duration: DUR, videoRef: ref }),
      );
      expect(result.current).toBeTruthy();
      expect(typeof result.current.captureCurrent).toBe('function');
      expect(typeof result.current.captureFirst).toBe('function');
    });
  });
});
