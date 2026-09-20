import { memo, useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useViewport, useInternalNode } from '@xyflow/react';

export interface EditToolbarProps {
  nodeId: string;
  editMode: 'crop' | 'outpaint' | 'erase' | 'redraw' | 'annotate';
  isSaving: boolean;
  errorMessage: string | null;
  onSave?: () => void;
  onCancel: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onClear?: () => void;
  onGenerate?: () => void;
  // 画笔
  brushSize?: number;
  onBrushSizeChange?: (size: number) => void;
  eraseTool?: string;
  onEraseToolChange?: (tool: string) => void;
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

const SmallArrowLeftIcon = () => (
  <svg width="20" height="20" viewBox="0 0 16 16" fill="none" className="h-4 w-4 shrink-0">
    <path d="M5.63281 1.33594C5.85359 1.3361 6.03223 1.51551 6.03223 1.73633V2.13574C6.03223 2.35656 5.85359 2.53597 5.63281 2.53613H3.11914C2.66617 2.53614 2.29884 2.90348 2.29883 3.35645V12.6494C2.29886 13.1024 2.66619 13.4697 3.11914 13.4697H5.63281C5.85359 13.4699 6.03223 13.6493 6.03223 13.8701V14.2695C6.03223 14.4903 5.85359 14.6698 5.63281 14.6699H3.11914C2.03849 14.6699 1.15597 13.821 1.10156 12.7539L1.09863 12.6494V3.35645C1.09864 2.24073 2.00343 1.33595 3.11914 1.33594H5.63281ZM9.52246 3.14746C9.67867 2.99125 9.93168 2.99125 10.0879 3.14746L14.5195 7.5791C14.7537 7.81339 14.7537 8.19248 14.5195 8.42676L10.0879 12.8584C9.93168 13.0146 9.67867 13.0146 9.52246 12.8584L9.23926 12.5752C9.08313 12.419 9.08308 12.1659 9.23926 12.0098L12.6455 8.60352H5.5332C5.31229 8.60352 5.13281 8.42404 5.13281 8.20312V7.80273C5.13281 7.58182 5.31229 7.40234 5.5332 7.40234H12.6455L9.23926 3.99609C9.08309 3.83993 9.08318 3.58688 9.23926 3.43066L9.52246 3.14746Z" fill="currentColor" />
  </svg>
);

// Tool icons — from reference design
const BrushIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 16 16" className="h-4 w-4 opacity-60">
    <path fill="currentColor" d="M9.287 2.31a3.083 3.083 0 0 1 4.47-.144l.114.119a3.023 3.023 0 0 1-.28 4.333l-5.527 4.719a3.35 3.35 0 0 1-.985 2.086l-.132.117c-1.45 1.173-5.59 1.067-5.61 1.066-.001-.033-.213-4.497 1.094-5.794a3.4 3.4 0 0 1 1.954-.96zm-3.01 7.296c-.795-.788-2.135-.8-2.994.051-.102.1-.266.378-.413.92-.139.509-.226 1.115-.278 1.72-.033.389-.048.764-.056 1.093.319-.014.68-.038 1.053-.077.598-.062 1.199-.16 1.704-.305.537-.154.823-.321.934-.431.859-.852.846-2.182.05-2.97m6.628-6.595a1.87 1.87 0 0 0-2.713.087l-4.326 4.89c.463.152.898.409 1.264.773.341.338.588.735.745 1.158l4.928-4.207c.82-.7.866-1.943.102-2.701" />
  </svg>
);

const RectSelectIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 16 16" className="h-4 w-4 opacity-60">
    <path fill="currentColor" d="M2.133 10.999c.22 0 .4.18.4.4v1.213c0 .472.382.854.854.854H4.6c.22 0 .4.18.4.4v.4a.4.4 0 0 1-.4.4H3.387a2.054 2.054 0 0 1-2.051-1.948l-.003-.106V11.4c0-.22.18-.4.4-.4zm7.134 2.467c.22 0 .4.18.4.4v.4a.4.4 0 0 1-.4.4H6.733a.4.4 0 0 1-.4-.4v-.4c0-.22.18-.4.4-.4zm5-2.467c.22 0 .4.18.4.4v1.213l-.003.106a2.054 2.054 0 0 1-1.945 1.945l-.106.003H11.4a.4.4 0 0 1-.4-.4v-.4c0-.22.18-.4.4-.4h1.213a.854.854 0 0 0 .854-.854V11.4c0-.22.18-.4.4-.4zM2.133 6.332c.22 0 .4.18.4.4v2.534a.4.4 0 0 1-.4.4h-.4a.4.4 0 0 1-.4-.4V6.732c0-.22.18-.4.4-.4zm12.134 0c.22 0 .4.18.4.4v2.534a.4.4 0 0 1-.4.4h-.4a.4.4 0 0 1-.4-.4V6.732c0-.22.18-.4.4-.4zm-9.667-5c.22 0 .4.18.4.4v.4a.4.4 0 0 1-.4.4H3.387a.854.854 0 0 0-.854.854v1.213a.4.4 0 0 1-.4.4h-.4a.4.4 0 0 1-.4-.4V3.386c0-1.134.92-2.054 2.054-2.054zm8.119.003a2.054 2.054 0 0 1 1.948 2.05V4.6a.4.4 0 0 1-.4.4h-.4a.4.4 0 0 1-.4-.4V3.386a.854.854 0 0 0-.854-.854H11.4a.4.4 0 0 1-.4-.4v-.4c0-.22.18-.4.4-.4h1.213zm-3.452-.003c.22 0 .4.18.4.4v.4a.4.4 0 0 1-.4.4H6.733a.4.4 0 0 1-.4-.4v-.4c0-.22.18-.4.4-.4z" />
  </svg>
);

const LassoIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 16 16" className="h-4 w-4 opacity-60">
    <path fill="currentColor" d="M7.607 1.622c.84-.84 2.201-.84 3.041 0l3.383 3.382c.84.84.84 2.203 0 3.042l-5.934 5.935h6.936a.3.3 0 0 1 .3.3v.4a.3.3 0 0 1-.3.3H6.358a2.15 2.15 0 0 1-1.68-.624l-3.382-3.383a2.15 2.15 0 0 1-.077-2.96l.077-.08zM2.003 8.64a1.15 1.15 0 0 0 0 1.627l3.382 3.383c.205.205.469.315.737.333v-.002h.197c.253-.026.5-.136.694-.33l1.308-1.309-5.01-5.01zM9.94 2.33a1.15 1.15 0 0 0-1.627 0L4.018 6.626l5.01 5.01 4.297-4.297a1.15 1.15 0 0 0-.001-1.628z" />
  </svg>
);

const EraserIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 16 16" className="h-4 w-4 opacity-60">
    <path fill="currentColor" d="M10.8 1.2a1.5 1.5 0 0 1 2.12 0l1.88 1.88a1.5 1.5 0 0 1 0 2.12L7.7 12.3a1 1 0 0 1-.71.29H3.5a.5.5 0 0 1-.5-.5v-3.5a1 1 0 0 1 .29-.71zM4.21 7.09l4.7 4.7 2.8-2.8a.5.5 0 0 0 0-.7l-1.88-1.88a.5.5 0 0 0-.7 0z" />
    <path fill="currentColor" d="M1.5 14.5a.5.5 0 0 1 .5-.5h12a.5.5 0 0 1 0 1H2a.5.5 0 0 1-.5-.5" />
  </svg>
);

const BrushSizeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 16 16" className="h-4 w-4 shrink-0">
    <path fill="currentColor" d="M8.631 1.304c.394-.142.802-.22 1.196-.168.409.054.774.245 1.058.583.334.397.374.874.273 1.32-.098.43-.335.875-.622 1.305-.576.863-1.473 1.834-2.324 2.763-.872.95-1.699 1.857-2.21 2.641-.257.393-.406.715-.458.963-.047.231-.004.354.073.443.093.108.191.149.345.14.184-.012.443-.1.78-.293.672-.385 1.462-1.076 2.285-1.844.799-.745 1.632-1.566 2.33-2.128.348-.28.7-.527 1.027-.668.288-.125.706-.23 1.078 0l.073.05.129.106c.286.256.46.57.519.926.064.388-.017.778-.149 1.136-.26.702-.794 1.463-1.283 2.153-.513.724-.985 1.384-1.235 1.964-.252.58-.197.872.004 1.07a.58.58 0 0 0 .38.187c.137.01.312-.025.532-.124.451-.203.946-.61 1.442-1.056l.348.387.348.386c-.49.44-1.093.953-1.71 1.232-.315.142-.668.239-1.035.212a1.62 1.62 0 0 1-1.037-.485c-.672-.665-.53-1.52-.227-2.222.304-.703.855-1.465 1.342-2.152.511-.722.953-1.366 1.156-1.913.098-.268.12-.464.097-.606a.54.54 0 0 0-.216-.344.6.6 0 0 0-.143.047q-.293.127-.789.524c-.658.53-1.435 1.299-2.272 2.08-.814.759-1.686 1.531-2.477 1.984-.394.227-.817.402-1.234.428a1.41 1.41 0 0 1-1.198-.5c-.34-.396-.395-.874-.301-1.329.09-.437.32-.887.604-1.322.569-.871 1.463-1.847 2.315-2.776.873-.952 1.704-1.857 2.226-2.638.262-.391.416-.711.473-.958.052-.23.01-.342-.054-.419a.6.6 0 0 0-.4-.221c-.172-.023-.405.006-.707.114-.612.22-1.365.712-2.199 1.382C5.116 5.005 3.326 6.88 1.911 8.206l-.711-.76c1.347-1.262 3.226-3.22 4.933-4.592.854-.687 1.717-1.27 2.498-1.55" />
  </svg>
);

const UndoIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 15 14" className="h-4 w-4 opacity-60">
    <path fill="currentColor" d="M5.66.871 2.358 4.173h7.969a4.673 4.673 0 0 1 0 9.346H7.449v-1.231h2.878a3.442 3.442 0 0 0 0-6.883h-7.97l3.303 3.3-.871.872L0 4.789 4.789 0z" />
  </svg>
);

const RedoIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="8.6 9.4 14.8 13.4" className="h-4 w-4 opacity-60">
    <path fill="currentColor" d="m17.771 10.34 3.218 3.217h-7.767a4.555 4.555 0 0 0 0 9.11h2.806v-1.2h-2.806a3.355 3.355 0 0 1 0-6.71h7.767l-3.218 3.218.85.85 4.667-4.667L18.62 9.49z" />
  </svg>
);

// ── Constants ─────────────────────────────────────────

const BAR_BG = 'var(--canvas-controls-bg)';
const BAR_BORDER = 'var(--canvas-controls-border)';
const TEXT_COLOR = 'var(--canvas-controls-text)';
const HOVER_BG = 'var(--fw-overlay-2)';
const TOOLBAR_HEIGHT = 56;
const GAP = 16;

// ── Paint toolbar sub-component ────────────────────────

interface PaintToolbarProps {
  editMode: 'erase' | 'redraw';
  isSaving: boolean;
  brushSize: number;
  onBrushSizeChange?: (size: number) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onCancel: () => void;
  eraseTool?: string;
  onEraseToolChange?: (tool: string) => void;
}

function PaintToolbar({
  editMode,
  isSaving,
  brushSize,
  onBrushSizeChange,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onCancel,
  eraseTool = 'brush',
  onEraseToolChange,
}: PaintToolbarProps) {
  const ACTIVE_BG = 'var(--fw-overlay-2)';

  const toolBtnClass =
    'inline-flex select-none items-center justify-center rounded-lg transition-colors h-7 w-7 min-w-7 gap-0 p-1 hover:bg-overlay-2 active:bg-overlay-2 border-0';

  // Slider track: 64px wide, thumb: 12px
  const trackW = 64;
  const thumbW = 12;
  const effectiveTrack = trackW - thumbW;
  const sliderRatio = (brushSize - 2) / (80 - 2);
  const fillWidth = Math.round(thumbW / 2 + sliderRatio * effectiveTrack);
  const thumbLeft = Math.round(fillWidth - thumbW / 2);

  return (
    <div
      className="flex w-fit items-center gap-2 rounded-xl p-1.5"
      style={{
        backgroundColor: BAR_BG,
        border: `0.444px solid ${BAR_BORDER}`,
        boxShadow: 'rgba(0, 0, 0, 0.1) 0px 4px 6px -1px',
        color: TEXT_COLOR,
      }}
    >

      {/* Mode label / Exit */}
        <button
          type="button"
          className="inline-flex select-none items-center justify-center rounded-lg transition-colors h-7 gap-1 px-3 py-1.5 hover:bg-overlay-2 active:bg-overlay-2 border-0"
          style={{ backgroundColor: 'transparent', color: TEXT_COLOR }}
          onClick={onCancel}
          disabled={isSaving}
        >
          <SmallArrowLeftIcon />
          <span className="text-[13px] leading-[1.4]">退出</span>
        </button>

      <div style={{ backgroundColor: BAR_BORDER, width: 1, height: 20 }} className="shrink-0" />

      {/* Tool buttons */}
      <button
        type="button"
        aria-label="画笔工具"
        className={toolBtnClass}
        style={{ backgroundColor: eraseTool === 'brush' ? ACTIVE_BG : 'transparent', color: TEXT_COLOR }}
        onClick={() => onEraseToolChange?.('brush')}
        disabled={isSaving}
      >
        <BrushIcon />
      </button>
      <button
        type="button"
        aria-label="矩形工具"
        className={toolBtnClass}
        style={{ backgroundColor: eraseTool === 'rect' ? ACTIVE_BG : 'transparent', color: TEXT_COLOR }}
        onClick={() => onEraseToolChange?.('rect')}
        disabled={isSaving}
      >
        <RectSelectIcon />
      </button>
      <button
        type="button"
        aria-label="橡皮擦工具"
        className={toolBtnClass}
        style={{ backgroundColor: eraseTool === 'eraser' ? ACTIVE_BG : 'transparent', color: TEXT_COLOR }}
        onClick={() => onEraseToolChange?.('eraser')}
        disabled={isSaving}
      >
        <EraserIcon />
      </button>

      <div style={{ backgroundColor: BAR_BORDER, width: 1, height: 20 }} className="shrink-0" />

      {/* Brush size slider */}
      <div className="inline-flex h-7 items-center justify-center rounded-lg border-0 bg-transparent gap-1 px-3 py-1.5" style={{ color: 'rgb(163, 163, 163)' }}>
        <BrushSizeIcon />
        <div className="relative flex h-3 w-16 shrink-0 items-center">
          <div className="absolute inset-x-0 h-1 rounded-full" style={{ backgroundColor: 'rgb(82, 82, 82)' }} />
          <div
            className="absolute left-0 h-1 rounded-full"
            style={{ width: fillWidth, backgroundColor: 'rgb(96, 165, 250)' }}
          />
          <div
            className="absolute top-0 h-3 w-3 rounded-full border border-neutral-100 bg-white"
            style={{ left: thumbLeft }}
          />
          <input
            aria-label="画笔大小"
            min={2}
            max={80}
            step={1}
            type="range"
            value={brushSize}
            onChange={(e) => onBrushSizeChange?.(Number(e.target.value))}
            disabled={isSaving}
            className="absolute inset-0 h-3 w-full cursor-pointer appearance-none bg-transparent opacity-0
              [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:bg-transparent
              [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-neutral-100
              [&::-webkit-slider-thumb]:bg-white"
          />
        </div>
      </div>

      <div style={{ backgroundColor: BAR_BORDER, width: 1, height: 20 }} className="shrink-0" />

      {/* Undo / Redo — disabled state tracks actual availability */}
      <button
        type="button"
        aria-label="撤销"
        className={toolBtnClass}
        style={{ backgroundColor: 'transparent', color: TEXT_COLOR, opacity: !canUndo || isSaving ? 0.5 : 1, cursor: !canUndo || isSaving ? 'not-allowed' : 'pointer' }}
        onClick={onUndo}
        disabled={!canUndo || isSaving}
      >
        <UndoIcon />
      </button>
      <button
        type="button"
        aria-label="重做"
        className={toolBtnClass}
        style={{ backgroundColor: 'transparent', color: TEXT_COLOR, opacity: !canRedo || isSaving ? 0.5 : 1, cursor: !canRedo || isSaving ? 'not-allowed' : 'pointer' }}
        onClick={onRedo}
        disabled={!canRedo || isSaving}
      >
        <RedoIcon />
      </button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────

function EditToolbarComponent({
  nodeId,
  editMode,
  isSaving,
  errorMessage,
  onSave,
  onCancel,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onClear,
  onGenerate,
  brushSize = 20,
  onBrushSizeChange,
  eraseTool,
  onEraseToolChange,
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

  const abs = internalNode?.internals?.positionAbsolute;
  const nodeX = abs?.x ?? 0;
  const nodeY = abs?.y ?? 0;
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
    const toolbarLeft = centerX;

    return { toolbarLeft, toolbarTop };
  }, [nodeX, nodeY, nodeWidth, nodeHeight, vpX, vpY, zoom, windowWidth, windowHeight, isOutpaint, hasFrameCoords, frameVpBottom, frameVpCenterX]);

  if (!position || nodeWidth == null || nodeHeight == null) return null;

  const portalRoot = document.getElementById('node-toolbar-portal');
  if (!portalRoot) return null;

  const btnBaseClass = 'flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] transition-colors border-0';

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
              className="inline-flex select-none items-center justify-center rounded-lg transition-colors h-7 gap-1 px-3 py-1.5 hover:bg-overlay-2 active:bg-overlay-2 border-0"
              style={{ backgroundColor: 'transparent', color: TEXT_COLOR }}
              onClick={onCancel}
              disabled={isSaving}
            >
              <SmallArrowLeftIcon />
              <span className="text-[13px] leading-[1.4]">退出</span>
            </button>
            <button
              type="button"
              aria-label="重置扩图"
              className="size-8 rounded-lg flex items-center justify-center hover:bg-overlay-2 transition-colors border-0"
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
              className="h-8 rounded-lg py-1 pl-3 pr-2 flex items-center justify-center gap-1 text-[13px] leading-normal transition-colors cursor-not-allowed border-0"
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
                  className="h-8 rounded-lg py-1 pl-3 pr-2 flex items-center justify-center gap-1 hover:bg-overlay-2 text-[13px] leading-normal transition-colors border-0"
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
              className="h-8 rounded-lg py-1 pl-3 pr-2 flex items-center justify-center gap-1 hover:bg-overlay-2 text-[13px] leading-normal transition-colors border-0"
              style={{ color: TEXT_COLOR }}
            >
              <span className="whitespace-nowrap">2K</span>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0">
                <path d="M4 6.4L8 10.4L12 6.4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              className="h-8 rounded-lg py-1 pl-3 pr-2 flex items-center justify-center gap-1 hover:bg-overlay-2 text-[13px] leading-normal transition-colors border-0"
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
                    className="bg-white flex size-8 shrink-0 items-center justify-center rounded-lg shadow-sm transition-[filter,opacity] hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 border-0"
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
      ) : isPaint ? (
        /* ── Paint toolbar (erase / redraw) — reference design ── */
        <PaintToolbar
          editMode={editMode}
          isSaving={isSaving}
          brushSize={brushSize}
          onBrushSizeChange={onBrushSizeChange}
          onUndo={onUndo}
          onRedo={onRedo}
          canUndo={canUndo}
          canRedo={canRedo}
          onCancel={onCancel}
          eraseTool={eraseTool}
          onEraseToolChange={onEraseToolChange}
        />
      ) : (
        /* ── Crop toolbar ── */
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

          {onSave && (
            <button
              type="button"
              className="h-8 rounded-lg px-4 text-[13px] font-medium transition-colors border-0 disabled:cursor-not-allowed disabled:opacity-70"
              style={{ backgroundColor: 'white', color: 'rgb(23, 23, 23)' }}
              disabled={isSaving}
              onClick={onSave}
            >
              {isSaving ? '保存中...' : '保存'}
            </button>
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
