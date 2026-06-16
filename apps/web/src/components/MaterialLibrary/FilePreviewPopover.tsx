import { useState, useEffect, useRef, useCallback } from 'react';
import type { MaterialFile } from '@flowweb/shared';

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = d.getHours().toString().padStart(2, '0');
  const min = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${y}/${m}/${day} ${h}:${min}:${s}`;
}

interface FilePreviewPopoverProps {
  file: MaterialFile;
  onApplyToCanvas: (file: MaterialFile) => void;
}

// ─── Error Placeholder ───

function ErrorPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center gap-1">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/40">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <line x1="9" y1="9" x2="15" y2="15" />
        <line x1="15" y1="9" x2="9" y2="15" />
      </svg>
      <span className="text-xs text-white/40">加载失败</span>
    </div>
  );
}

// ─── Image Preview ───

function ImagePreview({ file }: { file: MaterialFile }) {
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    // Reset all state on file change
    setLoadError(false);
    setOriginalUrl(null);
    setImageLoaded(false);
    // Release previous objectURL
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    if (!file.url) {
      setLoadError(true);
      return;
    }

    const controller = new AbortController();

    fetch(file.url, { signal: controller.signal })
      .then((res) => res.blob())
      .then((blob) => {
        if (controller.signal.aborted) return;
        const objUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objUrl;
        setOriginalUrl(objUrl);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setLoadError(true);
      });

    return () => {
      controller.abort();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [file.url]);

  if (loadError) return <ErrorPlaceholder />;

  return (
    <>
      {file.thumbnailUrl && (
        <img
          src={file.thumbnailUrl}
          alt=""
          className="z-0 max-h-full max-w-full object-contain absolute inset-0"
        />
      )}
      {originalUrl && (
        <img
          src={originalUrl}
          alt=""
          className={`relative z-10 max-h-full max-w-full object-contain transition-opacity duration-150 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setImageLoaded(true)}
        />
      )}
    </>
  );
}

// ─── Video Preview ───

function VideoPreview({ file }: { file: MaterialFile }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    setLoadError(false);

    const video = videoRef.current;
    if (!video || !file.url) {
      setLoadError(true);
      return;
    }

    video.src = file.url;

    return () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [file.url]);

  if (loadError) return <ErrorPlaceholder />;

  return (
    <video
      ref={videoRef}
      poster={file.thumbnailUrl}
      preload="metadata"
      autoPlay
      loop
      muted
      playsInline
      disablePictureInPicture
      onError={() => setLoadError(true)}
      onCanPlay={(e) => { e.currentTarget.play().catch(() => {}); }}
      className="relative z-10 max-h-full max-w-full object-contain"
    />
  );
}

// ─── Play Icon SVG ───

const PlayIcon = () => (
  <svg width="16" height="16" viewBox="-3 0 13 10" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0 text-white/40">
    <path d="M4.75886e-08 1.11137C-5.64416e-05 0.915876 0.050179 0.72383 0.145634 0.554621C0.241089 0.385411 0.378384 0.24503 0.543656 0.147651C0.708928 0.0502717 0.896326 -0.000657228 1.08693 6.40356e-06C1.27753 0.000670035 1.46458 0.0529028 1.62921 0.151431L8.12708 4.03895C8.29106 4.13655 8.4272 4.27657 8.52189 4.44504C8.61658 4.61351 8.6665 4.80451 8.66667 4.99897C8.66683 5.19342 8.61723 5.38451 8.52283 5.55315C8.42843 5.72178 8.29252 5.86205 8.12871 5.95994L1.62921 9.84857C1.46458 9.9471 1.27753 9.99933 1.08693 9.99999C0.896326 10.0007 0.708928 9.94973 0.543656 9.85235C0.378384 9.75497 0.241089 9.61459 0.145634 9.44538C0.050179 9.27617 -5.64416e-05 9.08412 4.75886e-08 8.88863V1.11137Z" fill="currentColor" />
  </svg>
);

// ─── Main Component ───

export default function FilePreviewPopoverContent({ file, onApplyToCanvas }: FilePreviewPopoverProps) {
  const [loading, setLoading] = useState(false);

  const handleApply = useCallback(() => {
    setLoading(true);
    onApplyToCanvas(file);
  }, [file, onApplyToCanvas]);

  return (
    <div className="w-[280px] max-h-[calc(100vh-32px)] flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#262626] shadow-2xl">
      <div className="relative flex min-h-0 w-full flex-1 basis-[225px] items-center justify-center overflow-hidden bg-[#0F0F0F]">
        {file.mimeType?.startsWith('image/') && <ImagePreview file={file} />}
        {file.mimeType?.startsWith('video/') && <VideoPreview file={file} />}
      </div>
      <div className="flex shrink-0 flex-col gap-2 p-2">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-white/90" title={file.originalName}>
              {file.originalName}
            </span>
            {file.mimeType?.startsWith('video/') && <PlayIcon />}
          </div>
          <span className="text-sm text-white/40">
            创建于 {formatDate(file.createdAt)}
          </span>
        </div>
        <button
          type="button"
          className="flex h-10 w-full items-center justify-center rounded-lg bg-[#646464] text-sm font-semibold text-[#FAFAFA] hover:bg-[#757575] transition-colors disabled:opacity-60"
          onClick={handleApply}
          disabled={loading}
        >
          {loading ? '处理中...' : '应用到画布'}
        </button>
      </div>
    </div>
  );
}
