import { useState, useEffect, useRef, useCallback } from 'react';
import {
  createHiddenVideo,
  waitForMetadata,
  waitForSeeked,
  releaseVideo,
  videoFrameToBlob,
} from '@/utils/videoFrameUtils';

// ── Types ─────────────────────────────────────────────────

export interface UseVideoFrameCaptureOptions {
  videoSrc: string | null | undefined;
  duration: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export interface UseVideoFrameCaptureResult {
  captureCurrent: () => Promise<Blob>;
  captureFirst: () => Promise<Blob>;
  captureLast: () => Promise<Blob>;
  loading: boolean;
  error: string | null;
}

// ── Module-level LRU caches ───────────────────────────────

const videoCache = new Map<string, HTMLVideoElement>();
const MAX_VIDEO_CACHE = 5;

const firstFrameCache = new Map<string, Blob>();
const MAX_FIRST_FRAME_CACHE = 5;

const videoLocks = new Map<HTMLVideoElement, Promise<void>>();

export function clearVideoCache(): void { videoCache.clear(); }
export function clearFirstFrameCache(): void { firstFrameCache.clear(); }
export function clearVideoLocks(): void { videoLocks.clear(); }

const METADATA_TIMEOUT_MS = 15000;

function clampTime(time: number, duration: number): number {
  return Math.max(0, Math.min(time, duration));
}

function getFirstFrameCacheKey(src: string, duration: number): string {
  return `${src}::${duration}`;
}

// ── Hidden video cache (LRU) ──────────────────────────────

function getOrCreateHiddenVideo(src: string): HTMLVideoElement {
  if (videoCache.has(src)) {
    const video = videoCache.get(src)!;
    videoCache.delete(src);
    videoCache.set(src, video);
    return video;
  }
  if (videoCache.size >= MAX_VIDEO_CACHE) {
    const firstKey = videoCache.keys().next().value as string;
    const oldVideo = videoCache.get(firstKey)!;
    releaseVideo(oldVideo);
    videoLocks.delete(oldVideo); // prevent lock Map leak
    videoCache.delete(firstKey);
  }
  const video = createHiddenVideo(src);
  videoCache.set(src, video);
  return video;
}

// ── First frame cache (LRU) ───────────────────────────────

function getCachedFirstFrame(key: string): Blob | undefined {
  const blob = firstFrameCache.get(key);
  if (blob) {
    firstFrameCache.delete(key);
    firstFrameCache.set(key, blob);
  }
  return blob;
}

function setCachedFirstFrame(key: string, blob: Blob): void {
  if (firstFrameCache.has(key)) {
    firstFrameCache.delete(key);
  } else if (firstFrameCache.size >= MAX_FIRST_FRAME_CACHE) {
    const firstKey = firstFrameCache.keys().next().value as string;
    firstFrameCache.delete(firstKey);
  }
  firstFrameCache.set(key, blob);
}

// ── Video lock (exception-safe) ───────────────────────────

function acquireVideoLock(video: HTMLVideoElement): Promise<void> {
  return new Promise<void>((resolve) => {
    const existing = videoLocks.get(video);
    if (existing) {
      existing.then(resolve);
    } else {
      resolve();
    }
  });
}

function setVideoLock(video: HTMLVideoElement): { release: () => void } {
  let releaseLock: () => void;
  const lock = new Promise<void>((resolve) => { releaseLock = resolve; });
  videoLocks.set(video, lock);
  return { release: () => { releaseLock(); videoLocks.delete(video); } };
}

async function withVideoLock<T>(video: HTMLVideoElement, fn: () => Promise<T>): Promise<T> {
  await acquireVideoLock(video);
  const { release } = setVideoLock(video);
  try {
    return await fn();
  } finally {
    release();
  }
}

// ── Hook ──────────────────────────────────────────────────

export function useVideoFrameCapture({
  videoSrc,
  duration,
  videoRef,
}: UseVideoFrameCaptureOptions): UseVideoFrameCaptureResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const isCapturingRef = useRef(false);
  const isPrefetchingRef = useRef(false);
  const prefetchPromiseRef = useRef<Promise<void> | null>(null);
  const prefetchGenerationRef = useRef(0);

  // ── captureCurrent ──────────────────────────────────────

  const captureCurrent = useCallback(async (): Promise<Blob> => {
    if (!isMountedRef.current) throw new Error('组件已卸载');
    if (isCapturingRef.current) throw new Error('截帧进行中');

    isCapturingRef.current = true;
    try {
      const video = videoRef.current;
      if (!video || !video.duration) throw new Error('视频未就绪');
      if (video.readyState < 2) throw new Error('视频未加载完成，无法截取');

      const wasPaused = video.paused;
      video.pause();

      try {
        const blob = await videoFrameToBlob(video);
        if (isMountedRef.current) {
          setLoading(false);
          setError(null);
        }
        return blob;
      } finally {
        if (!wasPaused) {
          video.play();
        }
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message);
        setLoading(false);
      }
      throw err;
    } finally {
      isCapturingRef.current = false;
    }
  }, [videoRef]);

  // ── captureFirst ────────────────────────────────────────

  const captureFirst = useCallback(async (): Promise<Blob> => {
    if (!isMountedRef.current) throw new Error('组件已卸载');
    if (isCapturingRef.current) throw new Error('截帧进行中');

    isCapturingRef.current = true;
    try {
      const cacheKey = getFirstFrameCacheKey(videoSrc!, duration);
      const cached = getCachedFirstFrame(cacheKey);
      if (cached) {
        if (isMountedRef.current) { setLoading(false); setError(null); }
        return cached;
      }

      // If prefetch is in progress, wait for it
      if (isPrefetchingRef.current && prefetchPromiseRef.current) {
        await prefetchPromiseRef.current;
        const afterPrefetch = getCachedFirstFrame(cacheKey);
        if (afterPrefetch) {
          if (isMountedRef.current) { setLoading(false); setError(null); }
          return afterPrefetch;
        }
      }

      const time = clampTime(Math.min(0.1, duration / 2), duration);
      const video = getOrCreateHiddenVideo(videoSrc!);
      await waitForMetadata(video, METADATA_TIMEOUT_MS);

      const blob = await withVideoLock(video, async () => {
        video.currentTime = time;
        await waitForSeeked(video);
        return videoFrameToBlob(video);
      });

      setCachedFirstFrame(cacheKey, blob);

      if (isMountedRef.current) {
        setLoading(false);
        setError(null);
      }
      return blob;
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message);
        setLoading(false);
      }
      throw err;
    } finally {
      isCapturingRef.current = false;
    }
  }, [videoSrc, duration]);

  // ── captureLast ─────────────────────────────────────────

  const captureLast = useCallback(async (): Promise<Blob> => {
    if (!isMountedRef.current) throw new Error('组件已卸载');
    if (isCapturingRef.current) throw new Error('截帧进行中');

    isCapturingRef.current = true;
    try {
      const time = clampTime(Math.max(0.1, duration - 0.1), duration);
      const video = getOrCreateHiddenVideo(videoSrc!);
      await waitForMetadata(video, METADATA_TIMEOUT_MS);

      const blob = await withVideoLock(video, async () => {
        video.currentTime = time;
        await waitForSeeked(video);
        return videoFrameToBlob(video);
      });

      if (isMountedRef.current) {
        setLoading(false);
        setError(null);
      }
      return blob;
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message);
        setLoading(false);
      }
      throw err;
    } finally {
      isCapturingRef.current = false;
    }
  }, [videoSrc, duration]);

  // ── Prefetch first frame ────────────────────────────────

  const prefetchFirstFrame = useCallback(async (generation: number) => {
    const cacheKey = getFirstFrameCacheKey(videoSrc!, duration);
    if (firstFrameCache.has(cacheKey)) return;
    if (isPrefetchingRef.current) return;

    isPrefetchingRef.current = true;

    const promise = (async () => {
      try {
        const time = clampTime(Math.min(0.1, duration / 2), duration);
        const video = getOrCreateHiddenVideo(videoSrc!);
        await waitForMetadata(video, METADATA_TIMEOUT_MS);
        if (generation !== prefetchGenerationRef.current) return;

        const blob = await withVideoLock(video, async () => {
          if (generation !== prefetchGenerationRef.current) return null;
          video.currentTime = time;
          await waitForSeeked(video);
          if (generation !== prefetchGenerationRef.current) return null;
          return videoFrameToBlob(video);
        });

        if (blob && generation === prefetchGenerationRef.current) {
          setCachedFirstFrame(cacheKey, blob);
        }
      } catch (err) {
        // Silent failure for prefetch — don't update user-facing error state
        console.debug('[FrameCapture] prefetch failed', err);
      } finally {
        isPrefetchingRef.current = false;
        prefetchPromiseRef.current = null;
      }
    })();

    prefetchPromiseRef.current = promise;
    await promise;
  }, [videoSrc, duration]);

  // ── Prefetch useEffect ──────────────────────────────────

  useEffect(() => {
    isMountedRef.current = true;
    if (videoSrc && duration > 0) {
      prefetchGenerationRef.current += 1;
      const gen = prefetchGenerationRef.current;
      prefetchFirstFrame(gen);
    }
    return () => {
      isMountedRef.current = false;
      prefetchGenerationRef.current += 1; // invalidate in-flight prefetch
    };
  }, [videoSrc, duration, prefetchFirstFrame]);

  return {
    captureCurrent,
    captureFirst,
    captureLast,
    loading,
    error,
  };
}
