import { useEffect, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { useLightingStore } from '@/stores/lightingStore';
type LightingTaskStatus = 'pending' | 'processing' | 'success' | 'failed';

const TS = {
  PENDING: 'pending' as LightingTaskStatus,
  PROCESSING: 'processing' as LightingTaskStatus,
  SUCCESS: 'success' as LightingTaskStatus,
  FAILED: 'failed' as LightingTaskStatus,
} as const;
import { ThreePreview } from './ThreePreview';
import { ControlPanel } from './ControlPanel';

const ESTIMATED_CREDITS = 15; // TODO: fetch from backend pricing config

export const LightingModal = memo(function LightingModal() {
  const {
    visible,
    nodeId,
    imageUrl,
    params,
    taskId,
    taskStatus,
    resultUrl,
    errorMessage,
    updateParams,
    resetParams,
    setTaskInfo,
    closeModal,
  } = useLightingStore();

  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const viewMode = 'perspective'; // Combined with store later in Task 7

  // Close on Escape
  useEffect(() => {
    if (!visible) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeModal();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [visible, closeModal]);

  // Focus trap
  useEffect(() => {
    if (visible) {
      closeBtnRef.current?.focus();
    }
  }, [visible]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        closeModal();
      }
    },
    [closeModal],
  );

  const handlePositionChange = useCallback(
    (pos: { x: number; y: number; z: number }) => {
      updateParams({ position: pos });
    },
    [updateParams],
  );

  const handleParamsChange = useCallback(
    (p: Partial<typeof params>) => {
      updateParams(p);
    },
    [updateParams],
  );

  const handlePresetSelect = useCallback(
    (x: number, y: number, z: number) => {
      updateParams({ position: { x, y, z } });
    },
    [updateParams],
  );

  const handleGenerate = useCallback(() => {
    // TODO: HTTP POST /api/image-edit/lighting/tasks
    setTaskInfo({ taskStatus: TS.PROCESSING });
  }, [setTaskInfo]);

  if (!visible) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal
      aria-label="打光"
    >
      <div className="w-full mx-5 max-w-[1400px] h-[calc(100vh-40px)] max-h-[876px] rounded-[16px] bg-[#1C1C1C]/95 border border-white/10 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-base font-semibold text-white">☀ 打光</span>
            <a
              href="#"
              className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
              onClick={(e) => e.preventDefault()}
            >
              使用手册
            </a>
            <span className="text-xs text-neutral-600">Esc 关闭</span>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-neutral-400 hover:text-white transition-colors"
            onClick={closeModal}
            aria-label="关闭打光"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 min-h-0">
          <ThreePreview
            imageUrl={imageUrl}
            params={params}
            viewMode="perspective"
            onPositionChange={handlePositionChange}
            onReset={resetParams}
          />
          <ControlPanel
            params={params}
            viewMode="perspective"
            taskStatus={taskStatus}
            estimatedCredits={ESTIMATED_CREDITS}
            onViewModeChange={() => {}}
            onParamsChange={handleParamsChange}
            onPresetSelect={handlePresetSelect}
            onGenerate={handleGenerate}
          />
        </div>

        {/* Result overlay */}
        {resultUrl && taskStatus === TS.SUCCESS && (
          <ResultOverlay
            resultUrl={resultUrl}
            onConfirm={closeModal}
            onCancel={() => setTaskInfo({ resultUrl: undefined as any })}
          />
        )}

        {/* Error overlay */}
        {taskStatus === TS.FAILED && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-50">
            <div className="bg-[#1C1C1C] border border-white/10 rounded-xl p-6 max-w-sm text-center">
              <p className="text-red-400 text-sm mb-4">{errorMessage || '生成失败，请重试'}</p>
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-blue-500 text-white text-sm hover:bg-blue-600 transition-colors"
                onClick={handleGenerate}
              >
                重试
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
});

function ResultOverlay({
  resultUrl,
  onConfirm,
  onCancel,
}: {
  resultUrl: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-50">
      <div className="bg-[#1C1C1C] border border-white/10 rounded-xl p-6 max-w-lg text-center space-y-4">
        <img src={resultUrl} alt="生成结果" className="max-w-full max-h-64 rounded-lg object-contain" />
        <div className="flex gap-3 justify-center">
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-blue-500 text-white text-sm hover:bg-blue-600 transition-colors"
            onClick={onConfirm}
          >
            确认替换
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-white/10 text-white text-sm hover:bg-white/20 transition-colors"
            onClick={onCancel}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
