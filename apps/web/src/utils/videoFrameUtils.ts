/**
 * Pure DOM/Canvas video frame utilities.
 * Zero API dependencies, zero side effects, independently reusable.
 */

// ── Drawing ───────────────────────────────────────────────

export function drawFullFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): void {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
}

export function drawCover(video: HTMLVideoElement, canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')!;
  const cw = canvas.width;
  const ch = canvas.height;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.max(cw / vw, ch / vh);
  const sourceW = cw / scale;
  const sourceH = ch / scale;
  const sourceX = (vw - sourceW) / 2;
  const sourceY = (vh - sourceH) / 2;
  ctx.drawImage(video, sourceX, sourceY, sourceW, sourceH, 0, 0, cw, ch);
}

// ── Video element management ──────────────────────────────

export function createHiddenVideo(src: string): HTMLVideoElement {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.src = src;
  return video;
}

export function releaseVideo(video: HTMLVideoElement): void {
  video.pause();
  video.src = '';
  video.load();
}

// ── Async video events ────────────────────────────────────

export function waitForMetadata(video: HTMLVideoElement, timeoutMs = 5000): Promise<void> {
  // Already loaded (e.g. reused from cache)
  if (video.readyState >= 1) return Promise.resolve();

  return Promise.race([
    new Promise<void>((resolve) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    }),
    new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs);
    }),
  ]);
}

export function waitForSeeked(video: HTMLVideoElement, timeoutMs = 3000): Promise<void> {
  return Promise.race([
    new Promise<void>((resolve) => {
      video.addEventListener('seeked', () => resolve(), { once: true });
    }),
    new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('视频帧加载超时')), timeoutMs);
    }),
  ]);
}

// ── Capture ───────────────────────────────────────────────

export function videoFrameToBlob(
  video: HTMLVideoElement,
  options: { type?: string; quality?: number } = {},
): Promise<Blob> {
  const { type = 'image/jpeg', quality = 0.92 } = options;
  const canvas = document.createElement('canvas');
  drawFullFrame(video, canvas);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob returned null'))),
      type,
      quality,
    );
  });
}
