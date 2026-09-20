import { memo } from 'react';

export interface ModelInfo {
  id: string;
  name: string;
}

interface ModelSelectorProps {
  models: ModelInfo[];
  selectedId?: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

function ModelSelectorComponent({ models, selectedId, onSelect, disabled }: ModelSelectorProps) {
  const selectedModel = models.find((m) => m.id === selectedId);

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="canvas-node-image-model-select"
        disabled={disabled}
        className="inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors focus-visible:outline-none disabled:opacity-50 h-9 gap-1 hover:bg-overlay-2 active:bg-overlay-2 px-2 py-1 text-sm rounded-lg text-[#f5f5f5]"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0">
          <path d="M8.99805 2.38477C9.53893 3.90621 10.4105 5.29349 11.5566 6.44238L11.5586 6.44336C12.5481 7.43013 13.7171 8.21841 15.0029 8.76562C15.2029 8.8518 15.4064 8.9289 15.6113 9.00195C14.0914 9.54303 12.7055 10.4153 11.5576 11.5605L11.5566 11.5615C10.412 12.7102 9.5406 14.0963 8.99902 15.6162C8.45764 14.0958 7.58633 12.7095 6.44043 11.5615L6.43945 11.5605L6.17578 11.3066C5.08059 10.2858 3.78911 9.50275 2.38281 9.00195C3.90333 8.45997 5.29032 7.58857 6.43945 6.44336L6.44043 6.44238C7.58587 5.29322 8.45678 3.90579 8.99805 2.38477Z" stroke="#A3A3A3" strokeWidth="1.33" />
        </svg>
        <span className="whitespace-nowrap text-xs">{selectedModel?.name || '选择模型'}</span>
      </button>
    </div>
  );
}

export const ModelSelector = memo(ModelSelectorComponent);
