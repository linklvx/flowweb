import { memo, useState, useEffect, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useViewport, useInternalNode } from '@xyflow/react';

interface ImageNodeToolbarProps {
  nodeId: string;
  fileId?: string;
  referenceImage?: string;
  selected: boolean;
  onUpload?: () => void;
  onRotateMirror?: () => void;
}

// ── Custom SVG icons ───────────────────────────────────

const ExpandImageIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="6" width="12" height="12" rx="1" />
    <path d="M6 2v2" /><path d="M6 20v2" /><path d="M18 2v2" /><path d="M18 20v2" />
    <path d="M2 6h2" /><path d="M20 6h2" /><path d="M2 18h2" /><path d="M20 18h2" />
  </svg>
);

const SunIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" /><path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" /><path d="M20 12h2" />
    <path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
  </svg>
);

const Camera3DIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
    <circle cx="12" cy="13" r="3" />
    <text x="12" y="22" fontSize="6" fontWeight="bold" textAnchor="middle" fill="currentColor" stroke="none">3D</text>
  </svg>
);

const HDIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <text x="12" y="15" fontSize="8" fontWeight="bold" textAnchor="middle" fill="currentColor" stroke="none">HD</text>
  </svg>
);

const Grid3x3Icon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="5" height="5" rx="1" /><rect x="10" y="3" width="5" height="5" rx="1" /><rect x="17" y="3" width="5" height="5" rx="1" />
    <rect x="3" y="10" width="5" height="5" rx="1" /><rect x="10" y="10" width="5" height="5" rx="1" /><rect x="17" y="10" width="5" height="5" rx="1" />
    <rect x="3" y="17" width="5" height="5" rx="1" /><rect x="10" y="17" width="5" height="5" rx="1" /><rect x="17" y="17" width="5" height="5" rx="1" />
  </svg>
);

// ── Lucide icon SVGs ───────────────────────────────────

const RotateMirrorIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
    <path d="M5.63281 1.33594C5.85359 1.3361 6.03223 1.51551 6.03223 1.73633V2.13574C6.03223 2.35656 5.85359 2.53597 5.63281 2.53613H3.11914C2.66617 2.53614 2.29884 2.90348 2.29883 3.35645V12.6494C2.29886 13.1024 2.66619 13.4697 3.11914 13.4697H5.63281C5.85359 13.4699 6.03223 13.6493 6.03223 13.8701V14.2695C6.03223 14.4903 5.85359 14.6698 5.63281 14.6699H3.11914C2.03849 14.6699 1.15597 13.821 1.10156 12.7539L1.09863 12.6494V3.35645C1.09864 2.24073 2.00343 1.33595 3.11914 1.33594H5.63281ZM9.52246 3.14746C9.67867 2.99125 9.93168 2.99125 10.0879 3.14746L14.5195 7.5791C14.7537 7.81339 14.7537 8.19248 14.5195 8.42676L10.0879 12.8584C9.93168 13.0146 9.67867 13.0146 9.52246 12.8584L9.23926 12.5752C9.08313 12.419 9.08308 12.1659 9.23926 12.0098L12.6455 8.60352H5.5332C5.31229 8.60352 5.13281 8.42404 5.13281 8.20312V7.80273C5.13281 7.58182 5.31229 7.40234 5.5332 7.40234H12.6455L9.23926 3.99609C9.08309 3.83993 9.08318 3.58688 9.23926 3.43066L9.52246 3.14746Z" fill="currentColor" />
  </svg>
);

const LayersIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" /><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" /><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
  </svg>
);

const CropIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" />
  </svg>
);

const EraserIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21" /><path d="m5.082 11.09 8.828 8.828" />
  </svg>
);

const PaintbrushIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m14.622 17.897-10.68-2.913" /><path d="M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z" /><path d="M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15" />
  </svg>
);

const TypeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 4v16" /><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" /><path d="M9 20h6" />
  </svg>
);

const ShirtIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" />
  </svg>
);

const PenLineIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 21h8" /><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
  </svg>
);

const ExpandIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m15 15 6 6" /><path d="m15 9 6-6" /><path d="M21 16v5h-5" /><path d="M21 8V3h-5" /><path d="M3 16v5h5" /><path d="m3 21 6-6" /><path d="M3 8V3h5" /><path d="M9 9 3 3" />
  </svg>
);

const UploadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12" /><path d="m17 8-5-5-5 5" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
  </svg>
);

const DownloadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 15V3" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" />
  </svg>
);

const CopyIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
);

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 11v6" /><path d="M14 11v6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

// ── Sub-components ─────────────────────────────────────

const BTN_BG = 'rgb(38, 38, 38)';
const BTN_BG_HOVER = 'rgb(78, 78, 78)';
const BTN_CLASS = 'img-toolbar-btn';
const ICON_COLOR = 'rgb(160, 160, 160)';
const TEXT_COLOR = 'rgb(180, 180, 180)';
const BAR_BG = 'rgb(38, 38, 38)';
const BAR_BORDER = 'rgb(54, 54, 54)';
const DIVIDER_COLOR = 'rgb(54, 54, 54)';

function IconButton({ icon, ariaLabel, onClick, disabled, className = '' }: {
  icon: ReactNode;
  ariaLabel: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      tabIndex={0}
      disabled={disabled}
      onClick={onClick}
      className={`${BTN_CLASS} flex items-center justify-center border-0 rounded-lg p-1.5 transition-colors disabled:opacity-50 disabled:pointer-events-none ${className}`}
      style={{ backgroundColor: BTN_BG, color: ICON_COLOR }}
    >
      {icon}
    </button>
  );
}

function TextIconButton({ icon, ariaLabel, text, onClick, disabled, className = '' }: {
  icon: ReactNode;
  ariaLabel: string;
  text: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      tabIndex={0}
      disabled={disabled}
      onClick={onClick}
      className={`${BTN_CLASS} relative flex items-center gap-1.5 border-0 rounded-lg px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 disabled:pointer-events-none ${className}`}
      style={{ backgroundColor: BTN_BG, color: TEXT_COLOR }}
    >
      <span className="flex-shrink-0">{icon}</span>
      <span className="font-medium whitespace-nowrap">{text}</span>
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-5 w-px" style={{ backgroundColor: DIVIDER_COLOR }} />;
}

// ── Main component ─────────────────────────────────────

const FULL_TOOLBAR_HEIGHT = 84; // 2-row toolbar
const UPLOAD_BTN_OFFSET = 64;   // single upload button (matches video node 28px gap)
const GAP = 32;                 // 距离节点顶部的间距，确保不遮挡标题
const VIEWPORT_PADDING = 10;

function ImageNodeToolbarComponent({
  nodeId,
  fileId,
  referenceImage,
  selected,
  onUpload = () => {},
  onRotateMirror,
}: ImageNodeToolbarProps) {
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

  const hasImage = !!fileId || !!referenceImage;

  const position = useMemo(() => {
    if (nodeWidth == null || nodeHeight == null) return null;

    const viewCenterX = (nodeX + nodeWidth / 2) * zoom + vpX;
    const viewTopY = nodeY * zoom + vpY;
    const viewBottomY = (nodeY + nodeHeight) * zoom + vpY;

    // 上传按钮用较小偏移（匹配视频节点 28px 间距），完整工具条用实际高度
    const effectiveOffset = hasImage ? FULL_TOOLBAR_HEIGHT + GAP : UPLOAD_BTN_OFFSET;

    const toolbarTop = viewTopY - effectiveOffset;

    const toolbarLeft = Math.max(
      VIEWPORT_PADDING,
      Math.min(viewCenterX, windowWidth - VIEWPORT_PADDING),
    );

    const isVisible =
      viewBottomY > -nodeHeight * zoom &&
      viewTopY < windowHeight + nodeHeight * zoom;

    return { toolbarLeft, toolbarTop, isVisible };
  }, [nodeX, nodeY, nodeWidth, nodeHeight, vpX, vpY, zoom, windowWidth, windowHeight, hasImage]);

  if (!selected) return null;

  if (!position) return null;

  if (!position.isVisible) return null;

  const portalRoot = document.getElementById('node-toolbar-portal');
  if (!portalRoot) return null;

  if (!hasImage) {
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
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-full border border-white/10 bg-[#222222]/80 backdrop-blur-lg text-[#ccc] px-3 py-2"
          onClick={onUpload}
        >
          <UploadIcon />
          <span className="text-sm">上传</span>
        </button>
      </div>,
      portalRoot,
    );
  }

  return createPortal(
    <div
      className="nodrag nopan absolute flex flex-col items-center gap-1 transition-opacity duration-150 pointer-events-auto"
      role="toolbar"
      style={{
        left: position.toolbarLeft,
        top: position.toolbarTop,
        transform: 'translateX(-50%)',
        zIndex: 10000,
        willChange: 'left, top',
      }}
    >
      <style>{`
        .${BTN_CLASS}:hover {
          background-color: ${BTN_BG_HOVER} !important;
        }
      `}</style>

      {/* Row 1 */}
      <div
        className="flex items-center gap-0.5 rounded-xl px-1 py-1"
        style={{
          backgroundColor: BAR_BG,
          border: `0.5px solid ${BAR_BORDER}`,
          backdropFilter: 'blur(8px)',
        }}
      >
        <TextIconButton icon={<RotateMirrorIcon />} ariaLabel="旋转与镜像" text="旋转与镜像" onClick={onRotateMirror} disabled={!onRotateMirror} />
        <Divider />
        <TextIconButton icon={<LayersIcon />} ariaLabel="分离" text="分离" />
        <TextIconButton icon={<CropIcon />} ariaLabel="裁切" text="裁切" />
        <TextIconButton icon={<ExpandImageIcon />} ariaLabel="扩图" text="扩图" />
        <TextIconButton icon={<EraserIcon />} ariaLabel="擦除" text="擦除" />
        <TextIconButton icon={<PaintbrushIcon />} ariaLabel="重绘" text="重绘" />
        <TextIconButton icon={<TypeIcon />} ariaLabel="文字" text="文字" />
        <TextIconButton icon={<ShirtIcon />} ariaLabel="换装" text="换装" />
      </div>

      {/* Row 2 */}
      <div
        className="flex items-center gap-0.5 rounded-xl px-1 py-1"
        style={{
          backgroundColor: BAR_BG,
          border: `0.5px solid ${BAR_BORDER}`,
          backdropFilter: 'blur(8px)',
        }}
      >
        <TextIconButton icon={<SunIcon />} ariaLabel="打光" text="打光" />
        <TextIconButton icon={<Camera3DIcon />} ariaLabel="3D 角度" text="3D 角度" />
        <TextIconButton icon={<PenLineIcon />} ariaLabel="涂鸦" text="涂鸦" />
        <TextIconButton icon={<HDIcon />} ariaLabel="高清增强" text="高清增强" />
        <TextIconButton icon={<Grid3x3Icon />} ariaLabel="九宫格" text="九宫格" />
        <Divider />
        <IconButton icon={<ExpandIcon />} ariaLabel="放大查看" />
        <IconButton icon={<UploadIcon />} ariaLabel="上传" />
        <IconButton icon={<DownloadIcon />} ariaLabel="下载" />
        <Divider />
        <IconButton icon={<CopyIcon />} ariaLabel="复制" />
        <IconButton
          icon={<TrashIcon />}
          ariaLabel="删除"
          className="hover:text-red-400 hover:bg-red-500/10"
        />
      </div>
    </div>,
    portalRoot,
  );
}

export const ImageNodeToolbar = memo(ImageNodeToolbarComponent);
