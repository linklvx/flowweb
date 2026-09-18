import { AnglePresetButtons } from './AnglePresetButtons';
import { PromptInput } from '../Lighting/PromptInput';
import { type Angle3DParams, type Angle3DPresetKey, type Angle3DTaskStatus } from '@flowweb/shared';

interface ControlPanelProps {
  params: Angle3DParams;
  taskStatus: Angle3DTaskStatus;
  estimatedCredits: number;
  disabled: boolean;
  onPresetSelect: (key: Angle3DPresetKey) => void;
  onParamsChange: (params: Partial<Angle3DParams>) => void;
  onGenerate: () => void;
}

export function ControlPanel({
  params,
  taskStatus,
  estimatedCredits,
  disabled,
  onPresetSelect,
  onParamsChange,
  onGenerate,
}: ControlPanelProps) {
  const isProcessing = taskStatus === 'processing' || taskStatus === 'pending';

  return (
    <div className="w-[320px] shrink-0 bg-[#141820] flex flex-col gap-5 p-5 overflow-y-auto">
      {/* Angle presets */}
      <div>
        <label className="text-xs font-medium text-neutral-400 block mb-2">多角度</label>
        <AnglePresetButtons
          currentParams={params}
          disabled={disabled}
          onSelect={onPresetSelect}
        />
      </div>

      {/* Horizontal angle slider */}
      <div>
        <label className="text-xs font-medium text-neutral-400 block mb-2">
          → 水平角度 · {params.horizontalAngle}°
        </label>
        <input
          type="range"
          min={-90}
          max={90}
          value={params.horizontalAngle}
          disabled={disabled}
          onChange={(e) => onParamsChange({ horizontalAngle: Number(e.target.value) })}
          className="w-full h-1.5 bg-overlay-2 rounded-full appearance-none cursor-pointer accent-blue-500"
        />
      </div>

      {/* Vertical angle slider */}
      <div>
        <label className="text-xs font-medium text-neutral-400 block mb-2">
          ↨ 垂直角度 · {params.verticalAngle}°
        </label>
        <input
          type="range"
          min={-60}
          max={60}
          value={params.verticalAngle}
          disabled={disabled}
          onChange={(e) => onParamsChange({ verticalAngle: Number(e.target.value) })}
          className="w-full h-1.5 bg-overlay-2 rounded-full appearance-none cursor-pointer accent-blue-500"
        />
      </div>

      {/* Zoom slider */}
      <div>
        <label className="text-xs font-medium text-neutral-400 block mb-2">
          🔍 缩放 · {params.zoom}
        </label>
        <input
          type="range"
          min={0}
          max={10}
          step={0.1}
          value={params.zoom}
          disabled={disabled}
          onChange={(e) => onParamsChange({ zoom: Number(e.target.value) })}
          className="w-full h-1.5 bg-overlay-2 rounded-full appearance-none cursor-pointer accent-blue-500"
        />
      </div>

      {/* Prompt input */}
      <PromptInput
        value={params.customPrompt ?? ''}
        onChange={(value) => onParamsChange({ customPrompt: value })}
      />

      {/* Generate button */}
      <button
        type="button"
        disabled={isProcessing || disabled}
        className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-colors border-0 shadow-none outline-none ${
          isProcessing
            ? 'bg-blue-500/50 text-text-dim-2 cursor-not-allowed'
            : 'bg-blue-500 hover:bg-blue-600 text-text'
        }`}
        onClick={onGenerate}
      >
        {isProcessing ? '生成中...' : `${estimatedCredits} ⚡ 生成`}
      </button>
    </div>
  );
}
