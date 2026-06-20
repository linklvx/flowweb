import { type ViewMode } from '../../engine/LightingEngine';

interface ViewToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export function ViewToggle({ value, onChange }: ViewToggleProps) {
  return (
    <div className="flex rounded-lg bg-white/5 p-0.5" role="radiogroup" aria-label="视图切换">
      <button
        type="button"
        role="radio"
        aria-checked={value === 'perspective'}
        className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
          value === 'perspective'
            ? 'bg-white/10 text-white'
            : 'text-neutral-400 hover:text-neutral-200'
        }`}
        onClick={() => onChange('perspective')}
      >
        透视
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === 'front'}
        className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
          value === 'front'
            ? 'bg-white/10 text-white'
            : 'text-neutral-400 hover:text-neutral-200'
        }`}
        onClick={() => onChange('front')}
      >
        正面
      </button>
    </div>
  );
}
