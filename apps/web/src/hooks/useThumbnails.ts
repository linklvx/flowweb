import { useState, useEffect, useRef } from 'react';
import { drawCover, waitForMetadata, releaseVideo } from '@/utils/videoFrameUtils';

export interface UseThumbnailsOptions {
  videoSrc: string | null | undefined;
  duration: number;
}

export interface UseThumbnailsResult {
  thumbnails: string[];
  loading: boolean;
  error: boolean;
}

// ─── Constants ─────────────────────────────────────────────────

const CANVAS_H = 60;
const TIMEOUT_MS = 3000;
const MAX_CACHE = 5;

// ─── Module-level LRU cache ────────────────────────────────────

const cache = new Map<string, string[]>();

function getCached(src: string): string[] | undefined {
  const entry = cache.get(src);
  if (entry) {
    // Hit: re-insert at end (Map keys iterate in insertion order)
    cache.delete(src);
    cache.set(src, entry);
  }
  return entry;
}

function setCache(src: string, thumbnails: string[]): void {
  if (cache.has(src)) {
    cache.delete(src);
  } else if (cache.size >= MAX_CACHE) {
    // Evict oldest (first key in Map)
    const firstKey = cache.keys().next().value as string;
    cache.delete(firstKey);
  }
  cache.set(src, thumbnails);
}

export function clearThumbnailCache(): void {
  cache.clear();
}

// ─── Hook ──────────────────────────────────────────────────────

export function useThumbnails({
  videoSrc,
  duration,
}: UseThumbnailsOptions): UseThumbnailsResult {
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    // Reset state on inputs change
    isMountedRef.current = true;

    // Guard: invalid src or too short
    if (!videoSrc || duration < 1) {
      setThumbnails([]);
      setLoading(false);
      setError(false);
      return;
    }

    // Check cache
    const cached = getCached(videoSrc);
    if (cached) {
      setThumbnails(cached);
      setLoading(false);
      setError(false);
      return;
    }

    // Start extraction
    setLoading(true);
    setError(false);

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.src = videoSrc;

    const canvas = document.createElement('canvas');
    canvas.height = CANVAS_H;

    const frameCount = duration < 2 ? 10 : 20;
    let cancelled = false;

    async function extract() {
      try {
        // Wait for metadata
        await waitForMetadata(video, TIMEOUT_MS);

        // Size canvas: 50% center crop for landscape, min 40px for portrait/square
        const aspectRatio = video.videoWidth / video.videoHeight;
        canvas.width = Math.max(40, Math.round(CANVAS_H * 0.5 * aspectRatio));
        canvas.height = CANVAS_H;

        const collected: string[] = [];

        for (let i = 0; i < frameCount; i++) {
          if (cancelled || !isMountedRef.current) break;

          // Seek to middle of each segment
          const targetTime = ((i + 0.5) * duration) / frameCount;
          video.currentTime = targetTime;

          // Wait for seek
          await new Promise<void>((resolve) => {
            video.addEventListener('seeked', () => resolve(), { once: true });
          });

          if (cancelled || !isMountedRef.current) break;

          // Draw cover-mode thumbnail
          try {
            drawCover(video, canvas);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
            collected.push(dataUrl);

            // Progressive update
            if (isMountedRef.current) {
              setThumbnails([...collected]);
            }
          } catch (drawErr) {
            if (drawErr instanceof DOMException && drawErr.name === 'SecurityError') {
              if (isMountedRef.current) {
                setError(true);
                setLoading(false);
              }
              return;
            }
            // Other draw errors: skip this frame, continue
          }
        }

        if (!cancelled && isMountedRef.current && collected.length > 0) {
          setCache(videoSrc!, collected);
          setThumbnails(collected);
          setLoading(false);
        }
      } catch (_err) {
        // Timeout or other failure
        if (!cancelled && isMountedRef.current) {
          setError(true);
          setLoading(false);
        }
      } finally {
        releaseVideo(video);
      }
    }

    extract();

    return () => {
      cancelled = true;
      isMountedRef.current = false;
      releaseVideo(video);
    };
  }, [videoSrc, duration]);

  return { thumbnails, loading, error };
}
