import { memo, useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useViewport, useInternalNode } from '@xyflow/react';

export interface EditToolbarProps {
  nodeId: string;
  editMode: 'crop' | 'outpaint' | 'erase' | 'redraw';
  isSaving: boolean;
  errorMessage: string | null;
  onSave?: () => void;
  onCancel: () => void;
  onUndo?: () => void;
  onClear?: () => void;
  onGenerate?: () => void;
  onSaveAsVariant?: () => void;
  // 扩图专用
  outpaintRect?: { x: number; y: number; width: number; height: number };
  onOutpaintRatioChange?: (rect: { x: number; y: number; width: number; height: number }) => void;
  imageW?: number;
  imageH?: number;
}

// ── Icons ─────────────────────────────────────────────

const ArrowLeftIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
    <path d="M5.63281 1.33594C5.85359 1.3361 6.03223 1.51551 6.03223 1.73633V2.13574C6.03223 2.35656 5.85359 2.53597 5.63281 2.53613H3.11914C2.66617 2.53614 2.29884 2.90348 2.29883 3.35645V12.6494C2.29886 13.1024 2.66619 13.4697 3.11914 13.4697H5.63281C5.85359 13.4699 6.03223 13.6493 6.03223 13.8701V14.2695C6.03223 14.4903 5.85359 14.6698 5.63281 14.6699H3.11914C2.03849 14.6699 1.15597 13.821 1.10156 12.7539L1.09863 12.6494V3.35645C1.09864 2.24073 2.00343 1.33595 3.11914 1.33594H5.63281ZM9.52246 3.14746C9.67867 2.99125 9.93168 2.99125 10.0879 3.14746L14.5195 7.5791C14.7537 7.81339 14.7537 8.19248 14.5195 8.42676L10.0879 12.8584C9.93168 13.0146 9.67867 13.0146 9.52246 12.8584L9.23926 12.5752C9.08313 12.419 9.08308 12.1659 9.23926 12.0098L12.6455 8.60352H5.5332C5.31229 8.60352 5.13281 8.42404 5.13281 8.20312V7.80273C5.13281 7.58182 5.31229 7.40234 5.5332 7.40234H12.6455L9.23926 3.99609C9.08309 3.83993 9.08318 3.58688 9.23926 3.43066L9.52246 3.14746Z" fill="currentColor" />
  </svg>
);

// ── Constants ─────────────────────────────────────────

const BAR_BG = 'rgb(38, 38, 38)';
const BAR_BORDER = 'rgb(54, 54, 54)';
const TEXT_COLOR = 'rgb(247, 247, 247)';
const HOVER_BG = 'rgba(255,255,255,0.08)';
const TOOLBAR_HEIGHT = 56;
const GAP = 16;
const VIEWPORT_PADDING = 10;

// ── Main component ─────────────────────────────────────

function EditToolbarComponent({
  nodeId,
  editMode,
  isSaving,
  errorMessage,
  onSave,
  onCancel,
  onUndo,
  onClear,
  onGenerate,
  onSaveAsVariant,
  outpaintRect,
  onOutpaintRatioChange,
  imageW,
  imageH,
}: EditToolbarProps) {
  const { x: vpX, y: vpY, zoom } = useViewport();
  const internalNode = useInternalNode(nodeId);

  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  useEffect(() => {
    const onResize = () =>
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const nodeX = internalNode?.position?.x ?? 0;
  const nodeY = internalNode?.position?.y ?? 0;
  const nodeWidth = internalNode?.measured?.width;
  const nodeHeight = internalNode?.measured?.height;
  const { width: windowWidth, height: windowHeight } = windowSize;

  const isOutpaint = editMode === 'outpaint' && !!outpaintRect;

  const position = useMemo(() => {
    if (nodeWidth == null || nodeHeight == null) return null;

    const viewCenterX = (nodeX + nodeWidth / 2) * zoom + vpX;
    const viewTopY = nodeY * zoom + vpY;
    const viewBottomY = (nodeY + nodeHeight) * zoom + vpY;

    const toolbarTop = isOutpaint
      ? viewBottomY + GAP
      : viewTopY - TOOLBAR_HEIGHT - GAP;

    const toolbarLeft = Math.max(
      VIEWPORT_PADDING,
      Math.min(viewCenterX, windowWidth - VIEWPORT_PADDING),
    );

    return { toolbarLeft, toolbarTop };
  }, [nodeX, nodeY, nodeWidth, nodeHeight, vpX, vpY, zoom, windowWidth, windowHeight, isOutpaint]);

  if (!position || nodeWidth == null || nodeHeight == null) return null;

  const portalRoot = document.getElementById('node-toolbar-portal');
  if (!portalRoot) return null;

  const btnBaseClass = 'flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] transition-colors cursor-pointer border-0';

  const isCrop = editMode === 'crop';
  const isAi = editMode === 'outpaint' || editMode === 'erase' || editMode === 'redraw';
  const isPaint = editMode === 'erase' || editMode === 'redraw';

  return createPortal(
    <div
      className="nodrag nopan absolute flex flex-col items-center gap-1 transition-opacity duration-150 pointer-events-auto"
      style={{
        left: position.toolbarLeft,
        top: position.toolbarTop,
        transform: 'translateX(-50%)',
        zIndex: 10000,
        willChange: 'left, top',
      }}
    >
      <style>{`
        .edit-btn:hover { background-color: ${HOVER_BG} !important; }
      `}</style>

      <div
        className="flex items-center gap-2 rounded-xl p-2"
        style={{
          backgroundColor: BAR_BG,
          border: `0.444px solid ${BAR_BORDER}`,
          boxShadow: 'rgba(0, 0, 0, 0.25) 0px 4px 10px 0px, rgba(0, 0, 0, 0.3) 0px 2px 4px 0px',
          color: TEXT_COLOR,
          backdropFilter: 'blur(8px)',
        }}
      >
        {/* Exit — always shown */}
        <button
          type="button"
          className={`${btnBaseClass} edit-btn`}
          style={{ backgroundColor: 'transparent', color: TEXT_COLOR }}
          onClick={onCancel}
          disabled={isSaving}
        >
          <ArrowLeftIcon />
          <span style={{ lineHeight: '1.4' }}>退出</span>
        </button>

        <div style={{ backgroundColor: BAR_BORDER, width: 1, height: 32 }} />

        {/* Undo / Clear — paint modes only (erase, redraw) */}
        {isPaint && (
          <>
            <button
              type="button"
              className={`${btnBaseClass} edit-btn`}
              style={{ backgroundColor: 'transparent', color: TEXT_COLOR }}
              onClick={onUndo}
              disabled={isSaving}
            >
              <span>撤销</span>
            </button>
            <button
              type="button"
              className={`${btnBaseClass} edit-btn`}
              style={{ backgroundColor: 'transparent', color: TEXT_COLOR }}
              onClick={onClear}
              disabled={isSaving}
            >
              <span>清除</span>
            </button>
            <div style={{ backgroundColor: BAR_BORDER, width: 1, height: 32 }} />
          </>
        )}

        {/* Ratio presets — outpaint mode */}
        {isOutpaint && onOutpaintRatioChange && outpaintRect && imageW && imageH && (
          <>
            <div style={{ backgroundColor: BAR_BORDER, width: 1, height: 32 }} />
            {[1.2, 1.5, 2.0].map((ratio) => {
              const newW = Math.round(imageW * ratio);
              const newH = Math.round(imageH * ratio);
              const isActive = Math.abs(outpaintRect.width - newW) < 2 && Math.abs(outpaintRect.height - newH) < 2;
              return (
                <button
                  key={ratio}
                  type="button"
                  className={`${btnBaseClass} edit-btn`}
                  style={{
                    backgroundColor: isActive ? 'rgb(59,130,246)' : 'transparent',
                    color: isActive ? 'white' : TEXT_COLOR,
                  }}
                  onClick={() => {
                    const newX = -(newW - imageW) / 2;
                    const newY = -(newH - imageH) / 2;
                    onOutpaintRatioChange({ x: newX, y: newY, width: newW, height: newH });
                  }}
                  disabled={isSaving}
                >
                  <span>{ratio.toFixed(1)}x</span>
                </button>
              );
            })}
          </>
        )}

        {/* Credit display — outpaint mode */}
        {isOutpaint && outpaintRect && imageW && imageH && (
          <>
            <div style={{ backgroundColor: BAR_BORDER, width: 1, height: 32 }} />
            <span style={{ color: '#999', fontSize: 12, padding: '0 4px' }}>
              ↓ {Math.ceil(Math.max(outpaintRect.width / imageW, outpaintRect.height / imageH))}
            </span>
          </>
        )}

        {/* Save — crop mode */}
        {isCrop && onSave && (
          <button
            type="button"
            className="h-8 rounded-lg px-4 text-[13px] font-medium transition-colors border-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
            style={{ backgroundColor: 'white', color: 'rgb(23, 23, 23)' }}
            disabled={isSaving}
            onClick={onSave}
          >
            {isSaving ? '保存中...' : '保存'}
          </button>
        )}

        {/* Generate — AI modes (outpaint, erase, redraw) */}
        {isAi && onGenerate && (
          <button
            type="button"
            className="h-8 rounded-lg px-4 text-[13px] font-medium transition-colors border-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
            style={{ backgroundColor: 'white', color: 'rgb(23, 23, 23)' }}
            disabled={isSaving}
            onClick={onGenerate}
          >
            {isSaving ? '生成中...' : '生成'}
          </button>
        )}

        {/* Save as variant — always shown when callback provided */}
        {onSaveAsVariant && (
          <>
            <div style={{ backgroundColor: BAR_BORDER, width: 1, height: 32 }} />
            <button
              type="button"
              className={`${btnBaseClass} edit-btn`}
              style={{ backgroundColor: 'transparent', color: TEXT_COLOR }}
              onClick={onSaveAsVariant}
              disabled={isSaving}
            >
              <span>保存为新变体</span>
            </button>
          </>
        )}
      </div>

      {errorMessage && (
        <div
          className="rounded-lg px-3 py-1.5 text-xs"
          style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#fca5a5' }}
        >
          {errorMessage}
        </div>
      )}
    </div>,
    portalRoot,
  );
}

export const EditToolbar = memo(EditToolbarComponent);
