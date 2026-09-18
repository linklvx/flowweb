import { ANGLE3D_PRESETS, PRESET_MATCH_THRESHOLDS, type Angle3DParams, type Angle3DPresetKey } from '@flowweb/shared';

interface AnglePresetButtonsProps {
  currentParams: Angle3DParams;
  disabled: boolean;
  onSelect: (key: Angle3DPresetKey) => void;
}

function isMatchingPreset(
  params: Angle3DParams,
  preset: (typeof ANGLE3D_PRESETS)[number],
): boolean {
  return (
    Math.abs(params.horizontalAngle - preset.horizontalAngle) <= PRESET_MATCH_THRESHOLDS.horizontalAngle &&
    Math.abs(params.verticalAngle - preset.verticalAngle) <= PRESET_MATCH_THRESHOLDS.verticalAngle &&
    Math.abs(params.zoom - preset.zoom) <= PRESET_MATCH_THRESHOLDS.zoom
  );
}

export function AnglePresetButtons({ currentParams, disabled, onSelect }: AnglePresetButtonsProps) {
  const matchedPreset = ANGLE3D_PRESETS.find((p) => isMatchingPreset(currentParams, p));

  return (
    <div className="grid grid-cols-3 gap-2">
      {ANGLE3D_PRESETS.map((preset) => {
        const isActive = matchedPreset?.key === preset.key;
        return (
          <button
            key={preset.key}
            type="button"
            disabled={disabled}
            className={`text-xs px-2 py-1.5 rounded-lg border transition-colors truncate ${
              isActive
                ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                : 'bg-overlay-1 text-neutral-400 border-transparent hover:bg-overlay-2 hover:text-neutral-200'
            }`}
            onClick={() => onSelect(preset.key)}
          >
            {preset.label}
          </button>
        );
      })}
      <span
        className={`text-xs px-2 py-1.5 rounded-lg text-center truncate ${
          matchedPreset ? 'text-neutral-600' : 'text-blue-400 bg-blue-500/10'
        }`}
      >
        自定义
      </span>
    </div>
  );
}
