import { memo, useState, useEffect } from 'react';

interface GenerateCountSelectorProps {
  count: number;
  options?: number[];
  onChange: (count: number) => void;
  disabled?: boolean;
}

function GenerateCountSelectorComponent({ count, options = [1, 2, 4, 8], onChange, disabled }: GenerateCountSelectorProps) {
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
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="group relative inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium text-[#f5f5f5] transition-all active:bg-white/[0.1] hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={`Generate ${count} variations`}
        disabled={disabled}
      >
        <span className="count-tooltip absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs font-normal text-white bg-[#3a3a3a] rounded-md whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">生成数量</span>
        <span>{count}×</span>
      </button>
      {open && (
        <div
          className="absolute bottom-full mb-1 right-0 bg-[#2a2a2a] border border-white/[0.1] rounded-lg py-1 shadow-xl z-50 min-w-[80px]"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {options.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => { onChange(n); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-white/10 bg-transparent text-[#ccc] ${n === count ? 'bg-white/10' : ''}`}
            >
              {n}×
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const GenerateCountSelector = memo(GenerateCountSelectorComponent);
