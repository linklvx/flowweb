import { useRef, useEffect } from 'react';
import { useLightingEngine } from '../../hooks/useLightingEngine';
import { type LightingParams } from '@flowweb/shared';
import { type ViewMode } from '../../engine/LightingEngine';

interface ThreePreviewProps {
  imageUrl: string | null;
  params: LightingParams;
  viewMode: ViewMode;
  onPositionChange: (pos: LightingParams['position']) => void;
  onReset: () => void;
}

export function ThreePreview({
  imageUrl,
  params,
  viewMode,
  onPositionChange,
  onReset,
}: ThreePreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const thumbnailRef = useRef<HTMLCanvasElement | null>(null);

  const { reset } = useLightingEngine({
    containerRef,
    thumbnailRef,
    imageUrl,
    params,
    viewMode,
    onPositionChange,
  });

  // Sync thumbnail canvas size
  useEffect(() => {
    const canvas = thumbnailRef.current;
    if (canvas) {
      canvas.width = 480;
      canvas.height = 360;
    }
  }, []);

  const handleReset = () => {
    reset();
    onReset();
  };

  return (
    <div className="relative flex-1 min-w-0 bg-[#0a0e1a] rounded-lg overflow-hidden">
      {/* Main 3D canvas container */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Thumbnail — top right */}
      <canvas
        ref={thumbnailRef}
        width={480}
        height={360}
        className="absolute top-3 right-3 w-[240px] h-[180px] rounded border border-overlay-2 z-10 opacity-90"
      />

      {/* Bottom-left: hint + reset */}
      <div className="absolute bottom-3 left-3 flex items-center gap-3 z-10">
        <span className="text-xs text-neutral-500">主光源·拖拽移动光源</span>
        <button
          type="button"
          className="text-xs px-2 py-1 rounded bg-overlay-1 text-neutral-400 hover:bg-overlay-2 hover:text-neutral-200 transition-colors"
          onClick={handleReset}
        >
          重置
        </button>
      </div>
    </div>
  );
}
