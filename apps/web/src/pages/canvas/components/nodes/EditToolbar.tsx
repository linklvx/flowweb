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
  frameVpBottom?: number;
  frameVpCenterX?: number;
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
  frameVpBottom,
  frameVpCenterX,
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
  const hasFrameCoords = isOutpaint && frameVpBottom != null && frameVpCenterX != null;

  const position = useMemo(() => {
    if (nodeWidth == null || nodeHeight == null) return null;

    const viewCenterX = (nodeX + nodeWidth / 2) * zoom + vpX;
    const viewTopY = nodeY * zoom + vpY;
    const viewBottomY = (nodeY + nodeHeight) * zoom + vpY;

    const toolbarTop = hasFrameCoords
      ? frameVpBottom! + GAP
      : isOutpaint
        ? viewBottomY + GAP
        : viewTopY - TOOLBAR_HEIGHT - GAP;

    const centerX = hasFrameCoords ? frameVpCenterX! : viewCenterX;
    const toolbarLeft = Math.max(
      VIEWPORT_PADDING,
      Math.min(centerX, windowWidth - VIEWPORT_PADDING),
    );

    return { toolbarLeft, toolbarTop };
  }, [nodeX, nodeY, nodeWidth, nodeHeight, vpX, vpY, zoom, windowWidth, windowHeight, isOutpaint, hasFrameCoords, frameVpBottom, frameVpCenterX]);

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

      {isOutpaint ? (
        /* ── Outpaint toolbar (Win11-style) ── */
        <div
          className="flex items-center justify-between rounded-xl p-2"
          style={{
            width: 440,
            height: 49,
            backgroundColor: BAR_BG,
            border: `0.444px solid ${BAR_BORDER}`,
            boxShadow: 'rgba(0, 0, 0, 0.1) 0px 4px 6px -1px',
            color: TEXT_COLOR,
          }}
        >
          {/* Left group */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="重置扩图"
              className="size-8 cursor-pointer rounded-lg flex items-center justify-center hover:bg-white/10 bg-transparent transition-colors border-0"
              style={{ color: TEXT_COLOR }}
              onClick={() => {
                if (onOutpaintRatioChange && imageW && imageH) {
                  const w = Math.round(imageW * 1.2);
                  const h = Math.round(imageH * 1.2);
                  onOutpaintRatioChange({ x: -(w - imageW) / 2, y: -(h - imageH) / 2, width: w, height: h });
                }
              }}
              disabled={isSaving}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div style={{ backgroundColor: BAR_BORDER, width: 1, height: 32 }} />
            <button
              type="button"
              disabled
              className="h-8 rounded-lg py-1 pl-3 pr-2 flex items-center justify-center gap-1 bg-transparent text-[13px] leading-normal transition-colors cursor-not-allowed border-0"
              style={{ color: 'rgb(115, 115, 115)' }}
            >
              <span className="whitespace-nowrap">PRO</span>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0">
                <path d="M4 6.4L8 10.4L12 6.4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Right group */}
          <div className="flex items-center gap-2">
            {/* Ratio dropdown */}
            {onOutpaintRatioChange && outpaintRect && imageW && imageH && (() => {
              const ratios = [1.2, 1.5, 2.0];
              const currentIdx = ratios.findIndex((r) =>
                Math.abs(outpaintRect.width - Math.round(imageW * r)) < 2 &&
                Math.abs(outpaintRect.height - Math.round(imageH * r)) < 2
              );
              const currentRatio = ratios[currentIdx >= 0 ? currentIdx : 0];
              return (
                <button
                  type="button"
                  className="h-8 rounded-lg py-1 pl-3 pr-2 flex items-center justify-center gap-1 hover:bg-white/10 bg-transparent text-[13px] leading-normal transition-colors text-fg-default cursor-pointer border-0"
                  style={{ color: TEXT_COLOR }}
                  onClick={() => {
                    const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % ratios.length : 1;
                    const ratio = ratios[nextIdx];
                    const newW = Math.round(imageW * ratio);
                    const newH = Math.round(imageH * ratio);
                    onOutpaintRatioChange({ x: -(newW - imageW) / 2, y: -(newH - imageH) / 2, width: newW, height: newH });
                  }}
                  disabled={isSaving}
                >
                  <span className="whitespace-nowrap">{currentRatio.toFixed(1)}x</span>
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0">
                    <path d="M4 6.4L8 10.4L12 6.4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              );
            })()}
            <button
              type="button"
              className="h-8 rounded-lg py-1 pl-3 pr-2 flex items-center justify-center gap-1 hover:bg-white/10 bg-transparent text-[13px] leading-normal transition-colors text-fg-default cursor-pointer border-0"
              style={{ color: TEXT_COLOR }}
            >
              <span className="whitespace-nowrap">2K</span>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0">
                <path d="M4 6.4L8 10.4L12 6.4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              className="h-8 rounded-lg py-1 pl-3 pr-2 flex items-center justify-center gap-1 hover:bg-white/10 bg-transparent text-[13px] leading-normal transition-colors text-fg-default cursor-pointer border-0"
              style={{ color: TEXT_COLOR }}
            >
              <span className="whitespace-nowrap">1张</span>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0">
                <path d="M4 6.4L8 10.4L12 6.4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {/* Credits + Generate */}
            {outpaintRect && imageW && imageH && (
              <div className="flex h-8 items-center gap-2" style={{ color: '#999' }}>
                <span className="flex shrink-0 items-center gap-[2px]" data-testid="outpaint-credits">
                  <svg width="10" height="14" viewBox="0 0 16 24" fill="none" className="shrink-0" style={{ color: '#999', width: 10, height: 14 }}>
                    <path d="M8.67352 4.08105C9.60755 3.00116 10.3727 3.29255 10.3727 4.73242V10.9033H12.9733C14.1511 10.9034 14.4794 11.6402 13.697 12.54L7.32684 19.9199C6.39312 20.9992 5.6269 20.7076 5.62665 19.2686V13.0977H3.02704C1.84902 13.0977 1.52094 12.3598 2.30341 11.46L8.67352 4.08105Z" fill="currentColor" />
                  </svg>
                  <span className="min-w-[13px] text-center text-[12px] font-normal leading-[15px]">
                    {Math.ceil(Math.max(outpaintRect.width / imageW, outpaintRect.height / imageH))}
                  </span>
                </span>
                {onGenerate && (
                  <button
                    type="button"
                    data-testid="outpaint-generate"
                    className="bg-white flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg shadow-sm transition-[filter,opacity] hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 border-0"
                    disabled={isSaving}
                    onClick={onGenerate}
                  >
                    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" style={{ color: 'rgb(23, 23, 23)' }}>
                      <path d="M8.29289 0.292893C8.68342 -0.0976311 9.31658 -0.0976311 9.70711 0.292893L17.7071 8.29289C18.0976 8.68342 18.0976 9.31658 17.7071 9.70711C17.3166 10.0976 16.6834 10.0976 16.2929 9.70711L10 3.41421V17C10 17.5523 9.55229 18 9 18C8.44772 18 8 17.5523 8 17V3.41421L1.70711 9.70711C1.31658 10.0976 0.683418 10.0976 0.292893 9.70711C-0.0976311 9.31658 -0.0976311 8.68342 0.292893 8.29289L8.29289 0.292893Z" fill="currentColor" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── Non-outpaint toolbar (unchanged) ── */
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

          {/* Generate — erase, redraw */}
          {(editMode === 'erase' || editMode === 'redraw') && onGenerate && (
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

          {/* Save as variant — non-outpaint */}
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
      )}

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
