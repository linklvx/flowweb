export type SelectionMode = 'rect' | 'brush';

export interface RedrawState {
  mode: SelectionMode;
  prompt: string;
  strength: number;
}

interface RedrawPanelProps {
  state: RedrawState;
  onChange: (state: RedrawState) => void;
}

export function RedrawPanel({ state, onChange }: RedrawPanelProps) {
  const { mode, prompt, strength } = state;

  return (
    <div className="nodrag nopan absolute bottom-0 left-0 right-0 z-10 flex flex-col gap-2 p-3"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
      <div className="flex items-center gap-1">
        {(['rect', 'brush'] as SelectionMode[]).map((m) => (
          <button key={m} type="button"
            onClick={(e) => { e.stopPropagation(); onChange({ ...state, mode: m }); }}
            style={{
              padding: '4px 10px', borderRadius: 6, border: '1px solid rgb(54,54,54)',
              fontSize: 12, color: '#ccc', cursor: 'pointer',
              backgroundColor: mode === m ? 'rgb(59,130,246)' : 'rgb(38,38,38)',
            }}>{m === 'rect' ? '矩形' : '画笔'}</button>
        ))}
      </div>
      <input type="text" placeholder="描述你希望生成的内容" value={prompt}
        onChange={(e) => onChange({ ...state, prompt: e.target.value })}
        onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
        style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid rgb(54,54,54)', backgroundColor: 'rgb(28,28,28)', color: '#ccc', fontSize: 12 }} />
      <div className="flex items-center gap-2">
        <span style={{ color: '#999', fontSize: 11 }}>强度</span>
        <input type="range" min="0" max="100" step="1" value={strength}
          onChange={(e) => onChange({ ...state, strength: parseInt(e.target.value) })}
          onMouseDown={(e) => e.stopPropagation()} style={{ flex: 1 }} />
        <span style={{ color: '#ccc', fontSize: 11, minWidth: 24 }}>{strength}</span>
      </div>
    </div>
  );
}
