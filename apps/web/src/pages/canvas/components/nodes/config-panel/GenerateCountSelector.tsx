import { memo, useState, useEffect } from 'react';

interface GenerateCountSelectorProps {
  count: number;
  options?: number[];
  onChange: (count: number) => void;
  disabled?: boolean;
}

function GenerateCountSelectorComponent({ count, options = [1, 2, 4], onChange, disabled }: GenerateCountSelectorProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="canvas-node-image-count-select"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="group relative inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium text-[#f5f5f5] transition-all active:bg-overlay-2 hover:bg-overlay-2 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={`生成 ${count} 张`}
        disabled={disabled}
      >
        <span className="count-tooltip absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs font-normal text-text bg-[var(--canvas-controls-bg)] rounded-md whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">生成数量</span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0" aria-hidden="true">
          <path fillRule="evenodd" clipRule="evenodd" d="M8.00016 1.33252C8.46405 1.33252 8.89912 1.33708 9.31592 1.34619C9.8305 1.3575 10.3352 1.52823 10.7489 1.84749C11.8025 2.6608 12.5088 3.3675 13.2795 4.35921C13.8428 5.08443 14.1295 5.97534 14.144 6.87614L14.1532 7.99984C14.1532 8.26775 14.1497 8.53448 14.1466 8.79997C14.1472 8.82905 14.1492 8.85832 14.1493 8.88786C14.1492 8.90698 14.1474 8.92593 14.1453 8.9445C14.1301 10.0648 14.0892 11.1624 14.0223 12.2297C13.9442 13.4716 12.9577 14.4593 11.7183 14.5448C10.5426 14.6256 9.40591 14.6678 8.00016 14.6678C6.59439 14.6678 5.45774 14.6256 4.28206 14.5448C3.04244 14.4595 2.05616 13.4717 1.97803 12.2297C1.89234 10.8641 1.84717 9.4489 1.84717 7.99984C1.84717 6.55087 1.89234 5.1361 1.97803 3.77067C2.0561 2.52857 3.04236 1.54082 4.28206 1.45557C5.45772 1.37474 6.59436 1.33252 8.00016 1.33252ZM8.00016 2.33252C6.61687 2.33252 5.50303 2.37436 4.35042 2.45361C3.60933 2.50461 3.0225 3.09414 2.97607 3.83382C2.89173 5.17804 2.84717 6.57158 2.84717 7.99984C2.84717 9.42819 2.89172 10.8222 2.97607 12.1665C3.02256 12.9061 3.60935 13.4957 4.35042 13.5467C5.503 13.626 6.61685 13.6678 8.00016 13.6678C9.38347 13.6678 10.4973 13.626 11.6499 13.5467C12.3909 13.4956 12.9778 12.906 13.0243 12.1665C13.0929 11.0725 13.1333 9.94559 13.1466 8.79411C13.1226 7.74073 12.6935 7.19336 12.1636 6.87549C11.5742 6.52209 10.8001 6.41763 10.1076 6.39762C9.292 6.37398 8.59521 5.73532 8.59521 4.87549V2.33512C8.4021 2.33329 8.20407 2.33252 8.00016 2.33252ZM9.59521 4.87549C9.59521 5.15103 9.81774 5.38838 10.1369 5.39762C10.8715 5.41887 11.8606 5.52796 12.6779 6.01807C12.8208 6.10379 12.9561 6.2013 13.0835 6.30908C12.9907 5.82096 12.7917 5.36183 12.4897 4.97314C11.7717 4.04921 11.1262 3.40183 10.1382 2.63916C9.97871 2.51607 9.7929 2.4304 9.59521 2.3846V4.87549Z" fill="currentColor" />
        </svg>
        <span>{count}张</span>
      </button>
      {open && (
        <div
          data-testid="canvas-node-image-count-menu"
          className="absolute bottom-full mb-1 right-0 bg-[#2a2a2a] border border-overlay-2 rounded-lg py-1 shadow-xl z-50 min-w-[80px]"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {options.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => { onChange(n); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-overlay-2 bg-transparent text-[#ccc] ${n === count ? 'bg-overlay-2' : ''}`}
            >
              {n}张
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const GenerateCountSelector = memo(GenerateCountSelectorComponent);
