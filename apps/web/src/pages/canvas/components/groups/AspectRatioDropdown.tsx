import { memo, useState, useCallback } from 'react';
import type { AspectRatio } from '@/types/group';

interface Props {
  value: AspectRatio;
  onChange: (value: AspectRatio) => void;
  executing?: boolean;
}

const OPTIONS: { label: string; value: AspectRatio }[] = [
  { label: '21:9', value: '21:9' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '3:4', value: '3:4' },
  { label: '4:3', value: '4:3' },
  { label: '1:1', value: '1:1' },
];

const btn = (disabled?: boolean): React.CSSProperties => ({
  background: 'none', border: 'none', color: disabled ? '#666' : '#fff',
  padding: '6px 10px', borderRadius: 6, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer',
});

function AspectRatioDropdownComponent({ value, onChange, executing }: Props) {
  const [open, setOpen] = useState(false);

  const handleSelect = useCallback((v: AspectRatio) => {
    onChange(v);
    setOpen(false);
  }, [onChange]);

  return (
    <div className="relative">
      <button
        disabled={executing}
        onClick={() => setOpen((v) => !v)}
        style={btn(executing)}
      >
        比例 {value} ▾
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-30"
          style={{ background: 'var(--canvas-controls-bg)', border: '1px solid var(--canvas-controls-border)', borderRadius: 6, minWidth: 100 }}>
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              disabled={executing}
              onClick={() => handleSelect(opt.value)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                background: 'none', border: 'none',
                color: executing ? '#666' : '#fff',
                cursor: executing ? 'not-allowed' : 'pointer',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const AspectRatioDropdown = memo(AspectRatioDropdownComponent);
