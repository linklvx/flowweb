export type Direction = 'top' | 'bottom' | 'left' | 'right' | 'all';

export interface OutpaintState {
  direction: Direction;
  scale: number;
  prompt: string;
}

interface OutpaintPanelProps {
  state: OutpaintState;
  onChange: (state: OutpaintState) => void;
  imageW: number;
  imageH: number;
  naturalW: number;
  naturalH: number;
}

const directions: { label: string; value: Direction }[] = [
  { label: '上', value: 'top' },
  { label: '下', value: 'bottom' },
  { label: '左', value: 'left' },
  { label: '右', value: 'right' },
  { label: '全部', value: 'all' },
];

function computeOutpaintDims(direction: Direction, scale: number, naturalW: number, naturalH: number) {
  if (direction === 'all') {
    return { w: Math.round(naturalW * scale), h: Math.round(naturalH * scale) };
  }
  if (direction === 'top' || direction === 'bottom') {
    return { w: naturalW, h: Math.round(naturalH * scale) };
  }
  return { w: Math.round(naturalW * scale), h: naturalH };
}

export function OutpaintPanel({ state, onChange, imageW, imageH, naturalW, naturalH }: OutpaintPanelProps) {
  const { direction, scale, prompt } = state;
  const dims = computeOutpaintDims(direction, scale, naturalW, naturalH);

  return (
    <div
      className="nodrag nopan absolute bottom-0 left-0 right-0 z-10 flex flex-col gap-2 p-3"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
    >
      <div className="flex items-center gap-1">
        {directions.map((d) => (
          <button
            key={d.value}
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onChange({ ...state, direction: d.value })}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid rgb(54,54,54)',
              fontSize: 12,
              color: '#ccc',
              cursor: 'pointer',
              backgroundColor: direction === d.value ? 'rgb(59,130,246)' : 'rgb(38,38,38)',
            }}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span style={{ color: '#999', fontSize: 11 }}>比例</span>
        <input
          type="range"
          min="1.1"
          max="2.0"
          step="0.1"
          value={scale}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => onChange({ ...state, scale: parseFloat(e.target.value) })}
          style={{ flex: 1 }}
        />
        <span style={{ color: '#ccc', fontSize: 11, minWidth: 32 }}>{scale}x</span>
      </div>

      <input
        type="text"
        placeholder="描述扩图区域的内容（可选）"
        value={prompt}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => onChange({ ...state, prompt: e.target.value })}
        style={{
          padding: '6px 8px',
          borderRadius: 6,
          border: '1px solid rgb(54,54,54)',
          backgroundColor: 'rgb(28,28,28)',
          color: '#ccc',
          fontSize: 12,
        }}
      />

      <div style={{ color: '#888', fontSize: 11, textAlign: 'right' }}>
        原图 {naturalW}×{naturalH} → 扩图后 {dims.w}×{dims.h}
      </div>
    </div>
  );
}
