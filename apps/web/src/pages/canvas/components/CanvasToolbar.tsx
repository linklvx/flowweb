import { memo } from 'react';

interface Props {
  zoom: number;
  onFitView: () => void;
}

function CanvasToolbarComponent({ zoom, onFitView }: Props) {
  const pct = Math.round(zoom * 100);

  return (
    <div className="absolute bottom-3 left-3 flex gap-2 z-10">
      <div className="bg-[#1a1a1a] border border-[#333] rounded-md px-3 py-1.5 text-[10px] text-[#ccc]">
        {`🔍 ${pct}%`}
      </div>
      <button
        onClick={onFitView}
        className="bg-[#1a1a1a] border border-[#333] rounded-md px-3 py-1.5 text-[10px] text-[#ccc] cursor-pointer hover:bg-[#252525]"
      >
        ⊞ 适应
      </button>
    </div>
  );
}

export const CanvasToolbar = memo(CanvasToolbarComponent);
