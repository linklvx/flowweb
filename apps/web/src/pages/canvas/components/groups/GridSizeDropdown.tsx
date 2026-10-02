import { memo, useState, useCallback } from 'react';

interface Props {
  rows: number;
  cols: number;
  onChange: (rows: number, cols: number) => void;
  executing?: boolean;
}

const PRESETS: { label: string; rows: number; cols: number }[] = [
  { label: '2×2', rows: 2, cols: 2 },
  { label: '3×3', rows: 3, cols: 3 },
  { label: '4×4', rows: 4, cols: 4 },
  { label: '5×5', rows: 5, cols: 5 },
];

const btn = (disabled?: boolean): React.CSSProperties => ({
  background: 'none', border: 'none', color: disabled ? 'var(--canvas-controls-icon)' : 'var(--canvas-controls-text)',
  padding: '6px 10px', borderRadius: 6, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer',
});

const inputStyle: React.CSSProperties = {
  width: 60, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--canvas-controls-border)',
  background: 'var(--canvas-controls-bg)', color: 'var(--canvas-controls-text)', fontSize: 13, textAlign: 'center',
};

function GridSizeDropdownComponent({ rows, cols, onChange, executing }: Props) {
  const [open, setOpen] = useState(false);
  const [customRows, setCustomRows] = useState(rows);
  const [customCols, setCustomCols] = useState(cols);
  const [showCustom, setShowCustom] = useState(false);

  const handlePreset = useCallback((r: number, c: number) => {
    onChange(r, c);
    setOpen(false);
  }, [onChange]);

  const handleCustomConfirm = useCallback(() => {
    const clamp = (v: number) => Math.max(1, Math.min(10, v));
    onChange(clamp(customRows), clamp(customCols));
    setOpen(false);
    setShowCustom(false);
  }, [customRows, customCols, onChange]);

  const handleToggleCustom = useCallback(() => {
    setShowCustom((v) => !v);
  }, []);

  return (
    <div className="relative">
      <button
        disabled={executing}
        onClick={() => setOpen((v) => !v)}
        style={btn(executing)}
      >
        宫格 {rows}×{cols} ▾
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-30"
          style={{ background: 'var(--canvas-controls-bg)', border: '1px solid var(--canvas-controls-border)', borderRadius: 6, minWidth: 140, padding: '8px 0' }}>
          {!showCustom ? (
            <>
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  disabled={executing}
                  onClick={() => handlePreset(preset.rows, preset.cols)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                    background: 'none', border: 'none',
                    color: executing ? 'var(--canvas-controls-icon)' : 'var(--canvas-controls-text)',
                    cursor: executing ? 'not-allowed' : 'pointer',
                  }}
                >
                  {preset.label}
                </button>
              ))}
              <button
                disabled={executing}
                onClick={handleToggleCustom}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                  background: 'none', border: 'none',
                  color: 'var(--canvas-controls-icon)',
                  cursor: executing ? 'not-allowed' : 'pointer',
                }}
              >
                自定义...
              </button>
            </>
          ) : (
            <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ color: 'var(--canvas-controls-icon)', fontSize: 13 }}>行:</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={customRows}
                  disabled={executing}
                  onChange={(e) => setCustomRows(Number(e.target.value))}
                  style={inputStyle}
                />
                <label style={{ color: 'var(--canvas-controls-icon)', fontSize: 13 }}>列:</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={customCols}
                  disabled={executing}
                  onChange={(e) => setCustomCols(Number(e.target.value))}
                  style={inputStyle}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  disabled={executing}
                  onClick={handleCustomConfirm}
                  style={{
                    flex: 1, padding: '6px 12px', borderRadius: 4, border: 'none',
                    background: executing ? 'var(--canvas-controls-bg)' : 'var(--fw-accent)', color: 'var(--fw-on-accent)',
                    cursor: executing ? 'not-allowed' : 'pointer',
                    fontSize: 13,
                  }}
                >
                  确定
                </button>
                <button
                  disabled={executing}
                  onClick={handleToggleCustom}
                  style={{
                    padding: '6px 12px', borderRadius: 4, border: '1px solid var(--canvas-controls-border)',
                    background: 'none', color: executing ? 'var(--canvas-controls-icon)' : 'var(--canvas-controls-text)',
                    cursor: executing ? 'not-allowed' : 'pointer',
                    fontSize: 13,
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const GridSizeDropdown = memo(GridSizeDropdownComponent);
