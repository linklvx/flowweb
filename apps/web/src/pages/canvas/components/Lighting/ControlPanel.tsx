import { ViewToggle } from './ViewToggle';
import { LightPresetButtons } from './LightPresetButtons';
import { PromptInput } from './PromptInput';
import { type LightingParams } from '@flowweb/shared';

type LightingTaskStatus = 'pending' | 'processing' | 'success' | 'failed';

const TS = {
  PENDING: 'pending' as LightingTaskStatus,
  PROCESSING: 'processing' as LightingTaskStatus,
  SUCCESS: 'success' as LightingTaskStatus,
  FAILED: 'failed' as LightingTaskStatus,
} as const;
import { type ViewMode } from '../../engine/LightingEngine';

interface ControlPanelProps {
  params: LightingParams;
  viewMode: ViewMode;
  taskStatus: LightingTaskStatus;
  estimatedCredits: number;
  onViewModeChange: (mode: ViewMode) => void;
  onParamsChange: (params: Partial<LightingParams>) => void;
  onPresetSelect: (x: number, y: number, z: number) => void;
  onGenerate: () => void;
}

export function ControlPanel({
  params,
  viewMode,
  taskStatus,
  estimatedCredits,
  onViewModeChange,
  onParamsChange,
  onPresetSelect,
  onGenerate,
}: ControlPanelProps) {
  const isGenerating = taskStatus === TS.PROCESSING;

  return (
    <div className="w-[320px] shrink-0 bg-[#141820] flex flex-col gap-5 p-5 overflow-y-auto">
      {/* View toggle */}
      <div>
        <label className="text-xs font-medium text-neutral-400 block mb-2">视图</label>
        <ViewToggle value={viewMode} onChange={onViewModeChange} />
      </div>

      {/* Light presets */}
      <div>
        <label className="text-xs font-medium text-neutral-400 block mb-2">光源预设</label>
        <LightPresetButtons
          currentPosition={params.position}
          onSelect={onPresetSelect}
        />
      </div>

      {/* Brightness slider */}
      <div>
        <label className="text-xs font-medium text-neutral-400 block mb-2">
          ☀ 亮度 · {params.brightness}
        </label>
        <input
          type="range"
          min={0}
          max={100}
          value={params.brightness}
          onChange={(e) => onParamsChange({ brightness: Number(e.target.value) })}
          className="w-full h-1.5 bg-overlay-2 rounded-full appearance-none cursor-pointer accent-blue-500"
        />
      </div>

      {/* Color temperature slider */}
      <div>
        <label className="text-xs font-medium text-neutral-400 block mb-2">
          🔥 色温 · {params.colorTemperature}K
        </label>
        <input
          type="range"
          min={2000}
          max={10000}
          step={100}
          value={params.colorTemperature}
          onChange={(e) => onParamsChange({ colorTemperature: Number(e.target.value) })}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-blue-500"
          style={{
            background: 'linear-gradient(to right, #ff8c00, #fff5e6, #e6f0ff, #b3d9ff)',
          }}
        />
      </div>

      {/* Rim light toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-neutral-400">轮廓光</span>
          <span className="text-neutral-600 cursor-help border-0 shadow-none" title="为图片边缘添加高亮描边">?</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={params.rimLight}
          className={`w-9 h-5 rounded-full transition-colors border-0 shadow-none outline-none ${
            params.rimLight ? 'bg-blue-500' : 'bg-overlay-2'
          }`}
          onClick={() => onParamsChange({ rimLight: !params.rimLight })}
        >
          <div
            className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
              params.rimLight ? 'translate-x-[14px]' : '-translate-x-[3px]'
            }`}
          />
        </button>
      </div>

      {/* Prompt input */}
      <PromptInput
        value={params.customPrompt ?? ''}
        onChange={(value) => onParamsChange({ customPrompt: value })}
      />

      {/* Generate button */}
      <button
        type="button"
        disabled={isGenerating}
        className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-colors border-0 shadow-none outline-none ${
          isGenerating
            ? 'bg-blue-500/50 text-text-dim-2 cursor-not-allowed'
            : 'bg-blue-500 hover:bg-blue-600 text-text'
        }`}
        onClick={onGenerate}
      >
        {isGenerating ? '生成中...' : `${estimatedCredits} ⚡ 生成`}
      </button>
    </div>
  );
}
