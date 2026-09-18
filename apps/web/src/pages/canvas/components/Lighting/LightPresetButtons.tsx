interface LightPresetButtonsProps {
  currentPosition: { x: number; y: number; z: number };
  onSelect: (x: number, y: number, z: number) => void;
}

interface Preset {
  label: string;
  x: number;
  y: number;
  z: number;
}

const PRESETS: Preset[] = [
  { label: '左侧', x: -6, y: 0, z: 4 },
  { label: '顶部', x: 0, y: 4, z: 4 },
  { label: '右侧', x: 6, y: 0, z: 4 },
  { label: '前方', x: 0, y: 0, z: 6 },
  { label: '底部', x: 0, y: -4, z: 4 },
  { label: '后方', x: 0, y: 0, z: -4 },
];

function isActive(pos: { x: number; y: number; z: number }, preset: Preset): boolean {
  return pos.x === preset.x && pos.y === preset.y && pos.z === preset.z;
}

export function LightPresetButtons({ currentPosition, onSelect }: LightPresetButtonsProps) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {PRESETS.map((preset) => {
        const active = isActive(currentPosition, preset);
        return (
          <button
            key={preset.label}
            type="button"
            className={`rounded-md px-2 py-2 text-xs font-medium transition-colors ${
              active
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                : 'bg-overlay-1 text-neutral-400 hover:bg-overlay-2 hover:text-neutral-200 border border-transparent'
            }`}
            onClick={() => onSelect(preset.x, preset.y, preset.z)}
          >
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}
