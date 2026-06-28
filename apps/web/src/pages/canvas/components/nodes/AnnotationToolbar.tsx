import { memo, useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useViewport, useInternalNode } from '@xyflow/react';
import { Tooltip } from 'antd';
import { useNodeStore } from '@/stores/nodeStore';

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

const LineIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 16 16" className="h-4 w-4 opacity-60">
    <path fill="currentColor" d="M15.5 2.5a2 2 0 0 1 2 2v3h-1.3v-3a.7.7 0 0 0-.7-.7h-4.85v12.4H15v1.3H5v-1.3h4.35V3.8H4.5a.7.7 0 0 0-.7.7v3H2.5v-3a2 2 0 0 1 2-2z" />
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

const BAR_BG = 'rgb(38, 38, 38)';
const BAR_BORDER = 'rgb(54, 54, 54)';
const TEXT_COLOR = 'rgb(247, 247, 247)';
const TOOLBAR_HEIGHT = 48; // single row
const GAP = 16;

const COLOR_PRESETS = ['#000000', '#FFFFFF', '#FF0000', '#FFD700', '#0066FF', '#00AA55'];

// ── Props ─────────────────────────────────────────────

export interface AnnotationToolbarProps {
  nodeId: string;
  onToolChange: (t: 'pen' | 'rect' | 'line') => void;
  onColorChange: (c: string) => void;
  onLineWidthChange: (w: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  nodeWidth?: number;
}

// ── Component ─────────────────────────────────────────

function AnnotationToolbarComponent({
  nodeId,
  onToolChange,
  onColorChange,
  onLineWidthChange,
  onUndo,
  onRedo,
  onSave,
  onCancel,
  isSaving,
}: AnnotationToolbarProps) {
  const { x: vpX, y: vpY, zoom } = useViewport();
  const internalNode = useInternalNode(nodeId);

  // ★ 直接订阅 store（响应式），避免从父组件 getState() 读取的 stale props
  const tool = useNodeStore(s => s.annotationState?.tool ?? 'pen');
  const color = useNodeStore(s => s.annotationState?.color ?? '#FF0000');
  const lineWidth = useNodeStore(s => s.annotationState?.lineWidth ?? 4);
  const canUndo = useNodeStore(s => (s.annotationState?.history?.length ?? 0) > 0);
  const canRedo = useNodeStore(s => (s.annotationState?.redoStack?.length ?? 0) > 0);

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

  const ACTIVE_BG = 'rgba(255,255,255,0.1)';

  const position = useMemo(() => {
    if (!internalNode) return null;
    const nodeX = internalNode.position?.x ?? 0;
    const nodeY = internalNode.position?.y ?? 0;
    const nodeWidth = internalNode.measured?.width;
    const nodeHeight = internalNode.measured?.height;

    if (nodeWidth == null || nodeHeight == null) return null;
    const viewCenterX = (nodeX + nodeWidth / 2) * zoom + vpX;
    const viewTopY = nodeY * zoom + vpY;
    return {
      toolbarLeft: viewCenterX,
      toolbarTop: viewTopY - TOOLBAR_HEIGHT - GAP,
    };
  }, [internalNode, vpX, vpY, zoom, windowSize.width, windowSize.height]);

  if (!position) return null;

  const portalRoot = document.getElementById('node-toolbar-portal');
  if (!portalRoot) return null;

  const toolBtnClass =
    'inline-flex select-none items-center justify-center rounded-lg transition-colors h-7 w-7 min-w-7 gap-0 p-1 hover:bg-[rgba(255,255,255,0.08)] active:bg-[rgba(255,255,255,0.1)] cursor-pointer border-0';

  const colorInputRef = useRef<HTMLInputElement>(null);

  // Slider track: 64px wide, thumb: 12px (same as EditToolbar PaintToolbar)
  const trackW = 64;
  const thumbW = 12;
  const effectiveTrack = trackW - thumbW;
  const sliderRatio = (lineWidth - 1) / (40 - 1);
  const fillWidth = Math.round(thumbW / 2 + sliderRatio * effectiveTrack);
  const thumbLeft = Math.round(fillWidth - thumbW / 2);

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
      <div
        className="flex w-fit items-center gap-2 rounded-xl p-1.5"
        style={{
          backgroundColor: BAR_BG,
          border: `0.444px solid ${BAR_BORDER}`,
          boxShadow: 'rgba(0, 0, 0, 0.1) 0px 4px 6px -1px',
          color: TEXT_COLOR,
        }}
      >
        {/* Exit / Label */}
        <button
          type="button"
          className="inline-flex select-none items-center justify-center rounded-lg transition-colors h-7 gap-1 px-3 py-1.5 hover:bg-[rgba(255,255,255,0.08)] active:bg-[rgba(255,255,255,0.1)] cursor-pointer border-0"
          style={{ backgroundColor: 'transparent', color: TEXT_COLOR }}
          onClick={onCancel}
          disabled={isSaving}
        >
          <SmallArrowLeftIcon />
          <span className="text-[13px] leading-[1.4]">标注</span>
        </button>

        <div style={{ backgroundColor: BAR_BORDER, width: 1, height: 20 }} className="shrink-0" />

        {/* Tool buttons */}
        <Tooltip title="画笔">
          <button
            type="button"
            aria-label="画笔工具"
            className={toolBtnClass}
            style={{ backgroundColor: tool === 'pen' ? ACTIVE_BG : 'transparent', color: TEXT_COLOR }}
            onClick={() => onToolChange('pen')}
            disabled={isSaving}
          >
            <BrushIcon />
          </button>
        </Tooltip>
        <Tooltip title="矩形">
          <button
            type="button"
            aria-label="矩形工具"
            className={toolBtnClass}
            style={{ backgroundColor: tool === 'rect' ? ACTIVE_BG : 'transparent', color: TEXT_COLOR }}
            onClick={() => onToolChange('rect')}
            disabled={isSaving}
          >
            <RectSelectIcon />
          </button>
        </Tooltip>
        <Tooltip title="直线">
          <button
            type="button"
            aria-label="直线工具"
            className={toolBtnClass}
            style={{ backgroundColor: tool === 'line' ? ACTIVE_BG : 'transparent', color: TEXT_COLOR }}
            onClick={() => onToolChange('line')}
            disabled={isSaving}
          >
            <LineIcon />
          </button>
        </Tooltip>

        <div style={{ backgroundColor: BAR_BORDER, width: 1, height: 20 }} className="shrink-0" />

        {/* Color presets + ColorPicker */}
        {COLOR_PRESETS.map((preset) => (
          <Tooltip key={preset} title={preset}>
            <button
              type="button"
              aria-label={`颜色 ${preset}`}
              className="h-4 w-4 rounded-full cursor-pointer border border-solid shrink-0"
              style={{
                backgroundColor: preset,
                borderColor: color === preset ? TEXT_COLOR : 'rgba(255,255,255,0.2)',
                outline: color === preset ? `1px solid ${TEXT_COLOR}` : 'none',
                outlineOffset: 1,
              }}
              onClick={() => onColorChange(preset)}
            />
          </Tooltip>
        ))}
        {/* Custom color input — hidden native picker triggered by the color button */}
        <input
          ref={colorInputRef}
          type="color"
          value={color}
          onChange={(e) => onColorChange(e.target.value)}
          disabled={isSaving}
          style={{
            position: 'absolute',
            visibility: 'hidden',
            width: 0,
            height: 0,
          }}
        />
        <button
          type="button"
          className="h-4 w-4 rounded-full border border-solid border-white/20 cursor-pointer shrink-0"
          style={{ backgroundColor: color }}
          onClick={() => colorInputRef.current?.click()}
          disabled={isSaving}
        />

        <div style={{ backgroundColor: BAR_BORDER, width: 1, height: 20 }} className="shrink-0" />

        {/* Line width slider — native range input (same pattern as EditToolbar PaintToolbar) */}
        <div className="inline-flex h-7 items-center justify-center rounded-lg border-0 bg-transparent gap-1 px-3 py-1.5" style={{ color: 'rgb(163, 163, 163)' }}>
          <Tooltip title="线宽">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 h-4 w-4" xmlns="http://www.w3.org/2000/svg">
              <circle cx="8" cy="8" r={Math.max(3, Math.min(7, lineWidth / 6 + 2))} fill="currentColor" />
            </svg>
          </Tooltip>
          <div className="relative flex h-3 w-16 shrink-0 items-center">
            <div className="pointer-events-none absolute inset-x-0 h-1 rounded-full" style={{ backgroundColor: 'rgb(82, 82, 82)' }} />
            <div
              className="pointer-events-none absolute left-0 h-1 rounded-full"
              style={{ width: fillWidth, backgroundColor: 'rgb(96, 165, 250)' }}
            />
            <div
              className="pointer-events-none absolute top-0 h-3 w-3 rounded-full border border-neutral-100 bg-white"
              style={{ left: thumbLeft }}
            />
            <input
              aria-label="线宽"
              min={1}
              max={40}
              step={1}
              type="range"
              value={lineWidth}
              onChange={(e) => onLineWidthChange(Number(e.target.value))}
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

        {/* Undo / Redo */}
        <Tooltip title="撤销 (Ctrl+Z)">
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
        </Tooltip>
        <Tooltip title="重做 (Ctrl+Shift+Z)">
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
        </Tooltip>

        <div style={{ backgroundColor: BAR_BORDER, width: 1, height: 20 }} className="shrink-0" />

        {/* Save button */}
        <button
          type="button"
          aria-label="保存标注"
          className="h-7 cursor-pointer rounded-lg px-4 text-[13px] font-medium transition-colors border-0 disabled:cursor-not-allowed disabled:opacity-70 whitespace-nowrap"
          style={{ backgroundColor: 'white', color: 'rgb(23, 23, 23)' }}
          disabled={isSaving}
          onClick={onSave}
        >
          {isSaving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>,
    portalRoot,
  );
}

export const AnnotationToolbar = memo(AnnotationToolbarComponent);
