import { memo, useState, useEffect } from 'react';

export interface RatioOption {
  label: string;
  w: number;
  h: number;
}

interface RatioResolutionPopoverProps {
  ratioOptions: RatioOption[];
  ratio: string;
  resolution: string;
  onRatioChange: (ratio: string) => void;
  onResolutionChange: (resolution: string) => void;
}

const POPUP_BASE_CLASS = 'absolute bottom-full mb-2 z-[300] rounded-2xl p-3 border border-[#363636] shadow-[0_4px_10px_rgba(0,0,0,0.25),0_2px_4px_rgba(0,0,0,0.3)]';
const POPUP_BASE_STYLE: React.CSSProperties = {
  backgroundColor: 'oklab(0.26861 0.0000122264 0.00000536442 / 0.95)',
  backdropFilter: 'blur(32px)',
};

function ratioIcon(r: string, options: RatioOption[]) {
  const found = options.find((o) => o.label === r);
  return found ? { w: found.w, h: found.h } : { w: 12, h: 12 };
}

function RatioResolutionPopoverComponent({ ratioOptions, ratio, resolution, onRatioChange, onResolutionChange }: RatioResolutionPopoverProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const icon = ratioIcon(ratio, ratioOptions);

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="canvas-node-image-ratio-select"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors focus-visible:outline-none disabled:opacity-50 h-9 gap-1 hover:bg-white/10 active:bg-white/[0.1] px-2 py-1 text-sm rounded-lg text-[#f5f5f5] border-none bg-transparent cursor-pointer"
      >
        <div className="flex items-center justify-center shrink-0" style={{ width: 16, height: 16 }}>
          <div className="rounded-[2px]" style={{ width: icon.w, height: icon.h, border: '1.5px solid currentColor' }} />
        </div>
        <span className="whitespace-nowrap text-xs">{ratio} · {resolution}</span>
      </button>
      {open && (
        <div
          className={`${POPUP_BASE_CLASS} left-0 w-[340px] flex flex-col gap-2`}
          style={POPUP_BASE_STYLE}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-sm font-medium text-[#999]"><span>分辨率</span></div>
            <div className="flex gap-2">
              {['2K', '4K'].map((res) => (
                <button
                  key={res}
                  type="button"
                  onClick={() => onResolutionChange(res)}
                  className={`flex h-8 flex-1 items-center justify-center rounded-lg border border-solid text-[13px] transition-colors duration-200 cursor-pointer ${
                    resolution === res ? 'border-[#4a4a4a] bg-white/10 text-[#f5f5f5]' : 'border-[#363636] text-[#999] bg-transparent'
                  }`}
                >{res}</button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-sm font-medium text-[#999]"><span>比例</span></div>
            <div className="grid grid-cols-5 gap-2">
              {ratioOptions.map((r) => (
                <button
                  key={r.label}
                  type="button"
                  onClick={() => onRatioChange(r.label)}
                  className={`flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-solid px-1 py-3 transition-colors duration-200 cursor-pointer ${
                    ratio === r.label ? 'border-[#4a4a4a] bg-white/10 text-[#f5f5f5]' : 'border-[#363636] text-[#999] bg-transparent'
                  }`}
                >
                  <span className="flex size-[17px] items-center justify-center">
                    <span className="flex-none rounded-[2px] border-[1.5px] border-solid border-current" style={{ width: r.w, height: r.h }} />
                  </span>
                  <span className="text-xs">{r.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const RatioResolutionPopover = memo(RatioResolutionPopoverComponent);
