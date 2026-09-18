import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { useAngle3DStore } from '@/stores/angle3DStore';
import { Angle3DPreview } from './Angle3DPreview';
import { ControlPanel } from './ControlPanel';
import { type Angle3DPresetKey } from '@flowweb/shared';

export const Angle3DModal = memo(function Angle3DModal() {
  const {
    visible,
    nodeId,
    imageUrl,
    params,
    taskId,
    taskStatus,
    resultUrl,
    errorMessage,
    estimatedCredits,
    updateParams,
    applyPreset,
    resetParams,
    setTaskState,
    closeModal,
    retryTask,
    replaceCurrentNode,
    createNewNode,
  } = useAngle3DStore();

  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  // Track image load state via preload
  useEffect(() => {
    if (!visible || !imageUrl) return;
    setImageLoaded(false);
    setImageFailed(false);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setImageLoaded(true);
    img.onerror = () => setImageFailed(true);
    img.src = imageUrl;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [visible, imageUrl]);

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

  // Prevent wheel events from reaching the underlying canvas
  useEffect(() => {
    if (!visible) return;
    const stopWheel = (e: WheelEvent) => e.stopPropagation();
    const modalEl = modalRef.current;
    modalEl?.addEventListener('wheel', stopWheel, { passive: false });
    return () => {
      modalEl?.removeEventListener('wheel', stopWheel);
    };
  }, [visible]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        closeModal();
      }
    },
    [closeModal],
  );

  const handleParamsChange = useCallback(
    (p: Partial<typeof params>) => {
      updateParams(p);
    },
    [updateParams],
  );

  const handlePresetSelect = useCallback(
    (key: Angle3DPresetKey) => {
      applyPreset(key);
    },
    [applyPreset],
  );

  const handleGenerate = useCallback(() => {
    // TODO: POST /api/image-edit/angle3d/tasks
    setTaskState({ taskStatus: 'processing' });
  }, [setTaskState]);

  const handleReset = useCallback(() => {
    resetParams();
  }, [resetParams]);

  const handleRetry = useCallback(() => {
    retryTask();
    handleGenerate();
  }, [retryTask, handleGenerate]);

  const isProcessing = taskStatus === 'processing' || taskStatus === 'pending';
  const disabled = isProcessing || imageFailed;

  if (!visible) return null;

  return createPortal(
    <div
      ref={modalRef}
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal
      aria-label="3D 角度"
    >
      <div className="w-full mx-5 max-w-[1400px] h-[calc(100vh-40px)] max-h-[876px] rounded-[16px] bg-[#1C1C1C]/95 border border-overlay-2 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-overlay-1 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-base font-semibold text-text">🎥 3D 角度</span>
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
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-overlay-2 text-neutral-400 hover:text-text transition-colors border-0 shadow-none outline-none"
            onClick={closeModal}
            aria-label="关闭3D角度"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 min-h-0">
          <Angle3DPreview
            imageUrl={imageUrl}
            params={params}
            imageLoaded={imageLoaded}
            imageFailed={imageFailed}
            onParamsChange={handleParamsChange}
            onReset={handleReset}
          />
          <ControlPanel
            params={params}
            taskStatus={taskStatus}
            estimatedCredits={estimatedCredits}
            disabled={disabled}
            onPresetSelect={handlePresetSelect}
            onParamsChange={handleParamsChange}
            onGenerate={handleGenerate}
          />
        </div>

        {/* Result overlay */}
        {resultUrl && taskStatus === 'success' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-50">
            <div className="bg-[#1C1C1C] border-0 rounded-xl p-6 max-w-lg text-center space-y-4">
              <img src={resultUrl} alt="生成结果" className="max-w-full max-h-64 rounded-lg object-contain" />
              <div className="flex gap-3 justify-center">
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg bg-blue-500 text-text text-sm hover:bg-blue-600 transition-colors !border-0 !shadow-none !outline-none !ring-0"
                  onClick={() => replaceCurrentNode(resultUrl)}
                >
                  替换当前节点
                </button>
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg bg-overlay-2 text-text text-sm hover:bg-overlay-3 transition-colors !border-0 !shadow-none !outline-none !ring-0"
                  onClick={() => createNewNode(resultUrl)}
                >
                  新建图片节点
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error overlay */}
        {taskStatus === 'failed' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-50">
            <div className="bg-[#1C1C1C] border border-overlay-2 rounded-xl p-6 max-w-sm text-center">
              <p className="text-red-400 text-sm mb-4">{errorMessage || '生成失败，请重试'}</p>
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-blue-500 text-text text-sm hover:bg-blue-600 transition-colors border-0 shadow-none outline-none"
                onClick={handleRetry}
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
