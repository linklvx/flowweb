import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  drawFullFrame,
  drawCover,
  createHiddenVideo,
  waitForMetadata,
  waitForSeeked,
  releaseVideo,
  videoFrameToBlob,
} from './videoFrameUtils';

// ── Mock video element factory ─────────────────────────────

function createMockVideo(overrides: Record<string, unknown> = {}) {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    muted: false,
    playsInline: false,
    preload: '',
    crossOrigin: '',
    src: '',
    videoWidth: 1920,
    videoHeight: 1080,
    paused: true,
    currentTime: 0,
    duration: 10,
    readyState: 0,
    addEventListener: vi.fn((event: string, fn: () => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    }),
    removeEventListener: vi.fn(),
    emit: (event: string) => {
      listeners[event]?.forEach((fn) => fn());
    },
    pause: vi.fn(),
    play: vi.fn(() => Promise.resolve()),
    load: vi.fn(),
    ...overrides,
  } as unknown as HTMLVideoElement & { emit: (e: string) => void, listeners: Record<string, Array<() => void>> };
}

function createMockCanvas() {
  const ctx = { drawImage: vi.fn() };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toBlob: vi.fn((cb: (b: Blob | null) => void, type?: string, _quality?: number) => {
      cb(new Blob(['frame'], { type: type || 'image/jpeg' }));
    }),
  };
  return { canvas, ctx };
}

// ── Tests ──────────────────────────────────────────────────

describe('videoFrameUtils', () => {
  // ── drawFullFrame ──────────────────────────────────────

  describe('drawFullFrame', () => {
    it('should set canvas size to video resolution and draw full frame', () => {
      const { canvas, ctx } = createMockCanvas();
      const video = createMockVideo({ videoWidth: 1280, videoHeight: 720 });

      drawFullFrame(video, canvas as unknown as HTMLCanvasElement);

      expect(canvas.width).toBe(1280);
      expect(canvas.height).toBe(720);
      expect(canvas.getContext).toHaveBeenCalledWith('2d');
      expect(ctx.drawImage).toHaveBeenCalledWith(video, 0, 0, 1280, 720);
    });

    it('should maintain aspect ratio identical to video', () => {
      const { canvas } = createMockCanvas();
      const video = createMockVideo({ videoWidth: 1920, videoHeight: 1080 });

      drawFullFrame(video, canvas as unknown as HTMLCanvasElement);

      expect(canvas.width / canvas.height).toBe(1920 / 1080);
    });
  });

  // ── drawCover ──────────────────────────────────────────

  describe('drawCover', () => {
    it('should draw with center-crop cover mode', () => {
      const { canvas, ctx } = createMockCanvas();
      canvas.width = 40;
      canvas.height = 60;
      const video = createMockVideo({ videoWidth: 1920, videoHeight: 1080 });

      drawCover(video, canvas as unknown as HTMLCanvasElement);

      expect(ctx.drawImage).toHaveBeenCalled();
      // canvas dimensions unchanged (cover crops to fill fixed canvas)
      expect(canvas.width).toBe(40);
      expect(canvas.height).toBe(60);
    });
  });

  // ── createHiddenVideo ──────────────────────────────────

  describe('createHiddenVideo', () => {
    it('should create video element with correct attributes', () => {
      const video = createHiddenVideo('https://example.com/video.mp4');

      expect(video.muted).toBe(true);
      expect(video.playsInline).toBe(true);
      expect(video.preload).toBe('auto');
      expect(video.crossOrigin).toBe('anonymous');
      expect(video.src).toBe('https://example.com/video.mp4');
    });
  });

  // ── waitForMetadata ────────────────────────────────────

  describe('waitForMetadata', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should resolve when loadedmetadata fires', async () => {
      const video = createMockVideo();

      const promise = waitForMetadata(video as unknown as HTMLVideoElement);
      video.emit('loadedmetadata');
      await expect(promise).resolves.toBeUndefined();
    });

    it('should reject after timeout (default 5000ms)', async () => {
      const video = createMockVideo();

      const promise = waitForMetadata(video as unknown as HTMLVideoElement);
      vi.advanceTimersByTime(5000);
      await expect(promise).rejects.toThrow('TIMEOUT');
    });

    it('should reject after custom timeout', async () => {
      const video = createMockVideo();

      const promise = waitForMetadata(video as unknown as HTMLVideoElement, 1000);
      vi.advanceTimersByTime(1000);
      await expect(promise).rejects.toThrow('TIMEOUT');
    });
  });

  // ── waitForSeeked ──────────────────────────────────────

  describe('waitForSeeked', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should resolve when seeked fires', async () => {
      const video = createMockVideo();

      const promise = waitForSeeked(video as unknown as HTMLVideoElement);
      video.emit('seeked');
      await expect(promise).resolves.toBeUndefined();
    });

    it('should reject with 视频帧加载超时 after default 3000ms', async () => {
      const video = createMockVideo();

      const promise = waitForSeeked(video as unknown as HTMLVideoElement);
      vi.advanceTimersByTime(3000);
      await expect(promise).rejects.toThrow('视频帧加载超时');
    });

    it('should reject after custom timeout', async () => {
      const video = createMockVideo();

      const promise = waitForSeeked(video as unknown as HTMLVideoElement, 1000);
      vi.advanceTimersByTime(1000);
      await expect(promise).rejects.toThrow('视频帧加载超时');
    });
  });

  // ── releaseVideo ───────────────────────────────────────

  describe('releaseVideo', () => {
    it('should pause, clear src, and call load', () => {
      const video = createMockVideo();

      releaseVideo(video as unknown as HTMLVideoElement);

      expect(video.pause).toHaveBeenCalled();
      expect(video.src).toBe('');
      expect(video.load).toHaveBeenCalled();
    });
  });

  // ── videoFrameToBlob ───────────────────────────────────

  describe('videoFrameToBlob', () => {
    it('should return a JPEG Blob from the video frame', async () => {
      const video = createMockVideo({ videoWidth: 640, videoHeight: 480 });
      // Override document.createElement for canvas
      const { canvas } = createMockCanvas();
      vi.spyOn(document, 'createElement').mockReturnValue(canvas as any);

      const blob = await videoFrameToBlob(video as unknown as HTMLVideoElement);

      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('image/jpeg');
      expect(blob.size).toBeGreaterThan(0);

      vi.restoreAllMocks();
    });

    it('should reject when canvas.toBlob returns null', async () => {
      const video = createMockVideo();
      const canvasWithNullBlob = {
        width: 0,
        height: 0,
        getContext: vi.fn(() => ({ drawImage: vi.fn() })),
        toBlob: vi.fn((cb: (b: Blob | null) => void) => {
          cb(null);
        }),
      };
      vi.spyOn(document, 'createElement').mockReturnValue(canvasWithNullBlob as any);

      await expect(
        videoFrameToBlob(video as unknown as HTMLVideoElement),
      ).rejects.toThrow('Canvas toBlob returned null');

      vi.restoreAllMocks();
    });

    it('should use custom type and quality when provided', async () => {
      const video = createMockVideo();
      const { canvas } = createMockCanvas();
      vi.spyOn(document, 'createElement').mockReturnValue(canvas as any);

      const blob = await videoFrameToBlob(video as unknown as HTMLVideoElement, {
        type: 'image/png',
        quality: 0.8,
      });

      expect(blob.type).toBe('image/png');
      expect(canvas.toBlob).toHaveBeenCalledWith(
        expect.any(Function),
        'image/png',
        0.8,
      );

      vi.restoreAllMocks();
    });
  });
});
