import { memo, useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useViewport, useInternalNode } from '@xyflow/react';

interface TransformToolbarProps {
  nodeId: string;
  rotation: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  selected: boolean;
  isSaving: boolean;
  errorMessage?: string | null;
  onRotate: () => void;
  onFlipH: () => void;
  onFlipV: () => void;
  onSave: () => void;
  onCancel: () => void;
}

// ── Icons ─────────────────────────────────────────────

const ArrowLeftIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
    <path d="M5.63281 1.33594C5.85359 1.3361 6.03223 1.51551 6.03223 1.73633V2.13574C6.03223 2.35656 5.85359 2.53597 5.63281 2.53613H3.11914C2.66617 2.53614 2.29884 2.90348 2.29883 3.35645V12.6494C2.29886 13.1024 2.66619 13.4697 3.11914 13.4697H5.63281C5.85359 13.4699 6.03223 13.6493 6.03223 13.8701V14.2695C6.03223 14.4903 5.85359 14.6698 5.63281 14.6699H3.11914C2.03849 14.6699 1.15597 13.821 1.10156 12.7539L1.09863 12.6494V3.35645C1.09864 2.24073 2.00343 1.33595 3.11914 1.33594H5.63281ZM9.52246 3.14746C9.67867 2.99125 9.93168 2.99125 10.0879 3.14746L14.5195 7.5791C14.7537 7.81339 14.7537 8.19248 14.5195 8.42676L10.0879 12.8584C9.93168 13.0146 9.67867 13.0146 9.52246 12.8584L9.23926 12.5752C9.08313 12.419 9.08308 12.1659 9.23926 12.0098L12.6455 8.60352H5.5332C5.31229 8.60352 5.13281 8.42404 5.13281 8.20312V7.80273C5.13281 7.58182 5.31229 7.40234 5.5332 7.40234H12.6455L9.23926 3.99609C9.08309 3.83993 9.08318 3.58688 9.23926 3.43066L9.52246 3.14746Z" fill="currentColor" />
  </svg>
);

const Rotate90Icon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="h-4 w-4">
    <g clipPath="url(#rotate-90-clip)">
      <path fillRule="evenodd" clipRule="evenodd" d="M6.41301 5.22999C7.19401 4.44912 8.46011 4.44917 9.24114 5.22999L12.5322 8.52003C13.3129 9.30092 13.3126 10.5671 12.5322 11.3482L9.24114 14.6392C8.46012 15.4198 7.19397 15.4199 6.41301 14.6392L3.12298 11.3482C2.34215 10.5671 2.34208 9.30102 3.12298 8.52003L6.41301 5.22999ZM8.29876 6.17238C8.03857 5.9124 7.6167 5.91262 7.35637 6.17238L4.06536 9.46339C3.80539 9.7237 3.80531 10.1455 4.06536 10.4058L7.35637 13.6958C7.61671 13.956 8.03846 13.956 8.29876 13.6958L11.5888 10.4058C11.849 10.1455 11.8489 9.72372 11.5888 9.46339L8.29876 6.17238ZM4.05559 2.13234C6.13834 0.049593 9.51575 0.049683 11.5986 2.13234L13.8085 4.3423V3.29933C13.8088 2.93133 14.1075 2.63331 14.4755 2.63331C14.8434 2.63354 15.1413 2.93148 15.1415 3.29933V5.83253C15.1414 6.27422 14.7834 6.63326 14.3417 6.63331H11.8085C11.4403 6.63331 11.1415 6.33451 11.1415 5.96632C11.1416 5.59818 11.4404 5.29933 11.8085 5.29933H12.8798L10.6552 3.07472C9.09321 1.51324 6.56093 1.51321 4.99895 3.07472L1.81731 6.25636C1.55703 6.5164 1.13519 6.51645 0.874929 6.25636C0.614607 5.99604 0.614607 5.57332 0.874929 5.313L4.05559 2.13234Z" fill="currentColor" />
    </g>
    <defs>
      <clipPath id="rotate-90-clip">
        <rect width="16" height="16" fill="white" />
      </clipPath>
    </defs>
  </svg>
);

const MirrorHIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="h-4 w-4">
    <path fillRule="evenodd" clipRule="evenodd" d="M8.60059 15.3301H7.40039V0.664062H8.60059V15.3301ZM1.32617 5.32031C1.32617 4.71616 2.01658 4.37029 2.5 4.73242L6.14453 7.4668L6.21289 7.52441C6.51253 7.8112 6.51255 8.29527 6.21289 8.58203L6.14453 8.63965L2.5 11.373C2.01659 11.7355 1.32623 11.3903 1.32617 10.7861V5.32031ZM13.5244 4.62109C14.0078 4.25853 14.6982 4.60376 14.6982 5.20801V10.6738C14.6982 11.2781 14.0078 11.6241 13.5244 11.2617L9.87988 8.52734L9.81152 8.46973C9.51202 8.18295 9.51196 7.69885 9.81152 7.41211L9.87988 7.35449L13.5244 4.62109ZM2.52734 9.85352L4.92773 8.05273L2.52734 6.25293V9.85352ZM11.0977 7.94141L13.498 9.74121V6.14062L11.0977 7.94141Z" fill="currentColor" />
  </svg>
);

const MirrorVIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="h-4 w-4">
    <path fillRule="evenodd" clipRule="evenodd" d="M7.47168 9.71289C7.77881 9.39195 8.31181 9.41475 8.58691 9.78125L11.3203 13.4258C11.6826 13.9091 11.3374 14.5994 10.7334 14.5996H5.2666C4.66259 14.5994 4.31743 13.9091 4.67969 13.4258L7.41309 9.78125L7.47168 9.71289ZM6.2002 13.3984H9.7998L8 10.998L6.2002 13.3984ZM15.333 8.59961H0.666992V7.39844H15.333V8.59961ZM10.7334 1.39844C11.3374 1.39868 11.6826 2.08892 11.3203 2.57227L8.58691 6.2168C8.29358 6.60758 7.70642 6.60759 7.41309 6.2168L4.67969 2.57227C4.31743 2.08892 4.66259 1.39869 5.2666 1.39844H10.7334ZM8 4.99902L9.7998 2.59961H6.2002L8 4.99902Z" fill="currentColor" />
  </svg>
);

// ── Constants ─────────────────────────────────────────

const BAR_BG = 'var(--canvas-controls-bg)';
const BAR_BORDER = 'var(--canvas-controls-border)';
const CONTROLS_TEXT = 'var(--canvas-controls-text)';
const CONTROLS_HOVER = 'var(--fw-overlay-2)';
const CONTROLS_ACTIVE = 'var(--fw-overlay-2)';
const CONTROLS_BORDER = 'var(--canvas-controls-border)';
const TOOLBAR_HEIGHT = 56;
const GAP = 16;

// ── Main component ─────────────────────────────────────

function TransformToolbarComponent({
  nodeId,
  selected,
  isSaving,
  errorMessage,
  onRotate,
  onFlipH,
  onFlipV,
  onSave,
  onCancel,
}: TransformToolbarProps) {
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

  const position = useMemo(() => {
    if (nodeWidth == null || nodeHeight == null) return null;

    const viewCenterX = (nodeX + nodeWidth / 2) * zoom + vpX;
    const viewTopY = nodeY * zoom + vpY;
    const viewBottomY = (nodeY + nodeHeight) * zoom + vpY;

    const effectiveOffset = TOOLBAR_HEIGHT + GAP;

    const toolbarTop = viewTopY - effectiveOffset;

    const toolbarLeft = viewCenterX;

    const isVisible =
      viewBottomY > -nodeHeight * zoom &&
      viewTopY < windowHeight + nodeHeight * zoom;

    return { toolbarLeft, toolbarTop, isVisible };
  }, [nodeX, nodeY, nodeWidth, nodeHeight, vpX, vpY, zoom, windowWidth, windowHeight]);

  if (!selected) return null;
  if (!position) return null;
  if (!position.isVisible) return null;

  const portalRoot = document.getElementById('node-toolbar-portal');
  if (!portalRoot) return null;

  const btnBaseClass = 'flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] transition-colors border-0';
  const iconBtnClass = 'flex items-center justify-center rounded-lg transition-colors h-8 w-8 p-2 border-0';

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
        .xform-btn:hover { background-color: ${CONTROLS_HOVER} !important; }
        .xform-btn:active { background-color: ${CONTROLS_ACTIVE} !important; }
        .xform-tooltip { position: relative; }
        .xform-tooltip::after {
          content: attr(data-tooltip);
          position: absolute;
          bottom: calc(100% + 6px);
          left: 50%;
          transform: translateX(-50%);
          padding: 4px 8px;
          border-radius: 6px;
          background: rgba(0,0,0,0.85);
          color: #fff;
          font-size: 12px;
          line-height: 1.4;
          white-space: nowrap;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.15s;
          z-index: 10001;
        }
        .xform-tooltip:hover::after { opacity: 1; }
      `}</style>

      <div
        className="flex items-center gap-2 rounded-xl p-2"
        style={{
          backgroundColor: BAR_BG,
          border: `0.444px solid ${BAR_BORDER}`,
          boxShadow: 'rgba(0, 0, 0, 0.25) 0px 4px 10px 0px, rgba(0, 0, 0, 0.3) 0px 2px 4px 0px',
          color: CONTROLS_TEXT,
          backdropFilter: 'blur(8px)',
        }}
      >
        {/* Cancel button */}
        <button
          type="button"
          className={`${btnBaseClass} xform-btn`}
          style={{ backgroundColor: 'transparent', color: CONTROLS_TEXT }}
          onClick={onCancel}
          disabled={isSaving}
        >
          <ArrowLeftIcon />
          <span style={{ lineHeight: '1.4' }}>退出</span>
        </button>

        <div style={{ backgroundColor: CONTROLS_BORDER, width: 1, height: 32 }} />

        {/* Angle display */}
        <div
          className="flex items-center gap-1 px-2 text-[13px]"
          style={{ color: CONTROLS_TEXT }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 20.9004 20.9004" fill="currentColor" className="shrink-0">
            <path d="M1.40039 0C1.6213 0 1.80078 0.179477 1.80078 0.400391V8.02637C2.8886 8.17848 3.95534 8.46749 4.97461 8.88965C6.55179 9.54296 7.98525 10.5009 9.19238 11.708C10.3995 12.9151 11.3575 14.3486 12.0107 15.9258C12.4329 16.9451 12.7219 18.0118 12.874 19.0996H20.5C20.7209 19.0996 20.9004 19.2791 20.9004 19.5V20.5C20.9004 20.7209 20.7209 20.9004 20.5 20.9004H0V0.400391C0 0.179477 0.179477 0 0.400391 0H1.40039ZM1.80078 19.0996H11.0518C10.9132 18.2488 10.6791 17.4144 10.3477 16.6143C9.78484 15.2555 8.95985 14.0204 7.91992 12.9805C6.87994 11.9405 5.64493 11.1156 4.28613 10.5527C3.48598 10.2213 2.65161 9.98628 1.80078 9.84766V19.0996Z" />
          </svg>
          <div className="flex min-w-0 items-baseline gap-0.5">
            <input
              inputMode="numeric"
              autoComplete="off"
              aria-label="旋转角度（0–360 整数）"
              className="w-6 min-w-0 border-0 bg-transparent p-0 text-right text-[13px] rounded-sm outline-none"
              style={{ color: CONTROLS_TEXT }}
              type="text"
              value="90"
              readOnly
            />
            <span className="shrink-0 select-none">°</span>
          </div>
        </div>

        <div style={{ backgroundColor: CONTROLS_BORDER, width: 1, height: 32 }} />

        {/* Rotate 90° */}
        <button type="button" className={`${iconBtnClass} xform-btn xform-tooltip`} data-tooltip="顺时针旋转90°" style={{ backgroundColor: 'transparent', color: CONTROLS_TEXT }} onClick={onRotate} aria-label="顺时针旋转90°" disabled={isSaving}>
          <Rotate90Icon />
        </button>

        {/* Horizontal mirror */}
        <button type="button" className={`${iconBtnClass} xform-btn xform-tooltip`} data-tooltip="水平镜像" style={{ backgroundColor: 'transparent', color: CONTROLS_TEXT }} onClick={onFlipH} aria-label="水平镜像" disabled={isSaving}>
          <MirrorHIcon />
        </button>

        {/* Vertical mirror */}
        <button type="button" className={`${iconBtnClass} xform-btn xform-tooltip`} data-tooltip="垂直镜像" style={{ backgroundColor: 'transparent', color: CONTROLS_TEXT }} onClick={onFlipV} aria-label="垂直镜像" disabled={isSaving}>
          <MirrorVIcon />
        </button>

        {/* Save */}
        <button
          type="button"
          aria-label="保存旋转"
          className="h-8 rounded-lg px-4 text-[13px] font-medium transition-colors border-0 disabled:cursor-not-allowed disabled:opacity-70"
          style={{ backgroundColor: 'white', color: 'rgb(23, 23, 23)' }}
          disabled={isSaving}
          onClick={onSave}
        >
          {isSaving ? '保存中...' : '保存'}
        </button>
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

export const TransformToolbar = memo(TransformToolbarComponent);
