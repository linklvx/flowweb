import { memo, useState, useCallback } from 'react';
import type { StitchResolution } from '@/types/group';

interface Props {
  groupId: string;
  resolution: StitchResolution;
  onResolutionChange: (value: StitchResolution) => void;
  running?: boolean;
}

const RESOLUTIONS: { label: string; value: StitchResolution }[] = [
  { label: '2K', value: '2K' },
  { label: '4K', value: '4K' },
];

const btn = (disabled?: boolean): React.CSSProperties => ({
  background: 'none', border: 'none', color: disabled ? '#666' : '#fff',
  padding: '6px 10px', borderRadius: 6, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer',
});

function StitchButtonComponent({ groupId, resolution, onResolutionChange, running }: Props) {
  const [open, setOpen] = useState(false);

  const handleResolutionChange = useCallback((value: StitchResolution) => {
    onResolutionChange(value);
    setOpen(false);
  }, [onResolutionChange]);

  const handleStitch = useCallback(() => {
    // Task 21 实现拼接行为
    console.log(`[StitchButton] 拼接分镜组 ${groupId}，分辨率: ${resolution}`);
  }, [groupId, resolution]);

  return (
    <div className="relative" style={{ display: 'flex', gap: 2 }}>
      <button
        disabled={running}
        onClick={() => setOpen((v) => !v)}
        style={{ ...btn(running), padding: '6px 8px', minWidth: 50 }}
      >
        {resolution} ▾
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-30"
          style={{ background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, minWidth: 80 }}>
          {RESOLUTIONS.map((res) => (
            <button
              key={res.value}
              disabled={running}
              onClick={() => handleResolutionChange(res.value)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                background: 'none', border: 'none',
                color: running ? '#666' : '#fff',
                cursor: running ? 'not-allowed' : 'pointer',
              }}
            >
              {res.label}
            </button>
          ))}
        </div>
      )}
      <button
        disabled={running}
        onClick={handleStitch}
        style={btn(running)}
      >
        拼接({resolution})
      </button>
    </div>
  );
}

export const StitchButton = memo(StitchButtonComponent);
