import { useRef } from 'react';
import { useAngle3DEngine } from '../../hooks/useAngle3DEngine';
import { type Angle3DParams } from '@flowweb/shared';

interface Angle3DPreviewProps {
  imageUrl: string | null;
  params: Angle3DParams;
  imageLoaded: boolean;
  imageFailed: boolean;
  onParamsChange: (params: Partial<Angle3DParams>) => void;
  onReset: () => void;
}

export function Angle3DPreview({
  imageUrl,
  params,
  imageLoaded,
  imageFailed,
  onParamsChange,
  onReset,
}: Angle3DPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { reset } = useAngle3DEngine({
    containerRef,
    imageUrl,
    params,
    onParamsChange,
  });

  const handleReset = () => {
    reset();
    onReset();
  };

  return (
    <div className="relative flex-1 min-w-0 bg-[#0a0e1a] rounded-lg overflow-hidden">
      {/* Main 3D canvas container */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Loading overlay */}
      {!imageLoaded && !imageFailed && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0e1a]/80 z-10">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-neutral-400">加载图片...</span>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {imageFailed && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0e1a]/80 z-10">
          <span className="text-sm text-neutral-400">图片加载失败</span>
        </div>
      )}

      {/* Bottom-left: hint + reset */}
      <div className="absolute bottom-3 left-3 flex items-center gap-3 z-10">
        <span className="text-xs text-neutral-500">拖拽旋转视角 · 滚轮缩放</span>
        <button
          type="button"
          className="text-xs px-2 py-1 rounded bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-neutral-200 transition-colors border-0 shadow-none outline-none"
          onClick={handleReset}
        >
          重置
        </button>
      </div>
    </div>
  );
}
