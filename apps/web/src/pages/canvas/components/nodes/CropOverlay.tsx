import { useState, useCallback, useRef, useEffect, useId } from 'react';
import type { CropRect } from '@/utils/imageCrop';

interface CropOverlayProps {
  containerWidth: number;
  containerHeight: number;
  imageDisplayWidth: number;
  imageDisplayHeight: number;
  imageNaturalWidth: number;
  imageNaturalHeight: number;
  onCropChange: (rect: CropRect) => void;
}

const MIN_CROP_SIZE = 50;
const HANDLE_SIZE = 8;

interface DragState {
  x: number;
  y: number;
  rect: CropRect;
  handleType: string;
}

function clampCrop(rect: CropRect, displayW: number, displayH: number): CropRect {
  const minW = MIN_CROP_SIZE / displayW;
  const minH = MIN_CROP_SIZE / displayH;
  let { x, y, width, height } = rect;
  if (width < minW) width = minW;
  if (height < minH) height = minH;
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x + width > 1) x = 1 - width;
  if (y + height > 1) y = 1 - height;
  return { x, y, width, height };
}

function toDisplayPx(r: CropRect, displayW: number, displayH: number) {
  return {
    left: Math.round(r.x * displayW),
    top: Math.round(r.y * displayH),
    width: Math.round(r.width * displayW),
    height: Math.round(r.height * displayH),
  };
}

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

const CURSOR_MAP: Record<string, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

const HANDLE_POSITIONS: Record<string, React.CSSProperties> = {
  nw: { top: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 },
  n: { top: -HANDLE_SIZE / 2, left: 'calc(50% - 4px)' },
  ne: { top: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 },
  e: { top: 'calc(50% - 4px)', right: -HANDLE_SIZE / 2 },
  se: { bottom: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 },
  s: { bottom: -HANDLE_SIZE / 2, left: 'calc(50% - 4px)' },
  sw: { bottom: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 },
  w: { top: 'calc(50% - 4px)', left: -HANDLE_SIZE / 2 },
};

export function CropOverlay({
  containerWidth,
  containerHeight,
  imageDisplayWidth,
  imageDisplayHeight,
  imageNaturalWidth,
  imageNaturalHeight,
  onCropChange,
}: CropOverlayProps) {
  const [cropRect, setCropRect] = useState<CropRect>({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
  const [dragging, setDragging] = useState<'move' | 'resize' | null>(null);
  const dragStart = useRef<DragState>({ x: 0, y: 0, rect: { x: 0, y: 0, width: 0, height: 0 }, handleType: '' });
  const maskId = useId();
  const onCropChangeRef = useRef(onCropChange);
  onCropChangeRef.current = onCropChange;

  useEffect(() => {
    onCropChangeRef.current(cropRect);
  }, [cropRect]);

  const updateRect = useCallback((newRect: CropRect) => {
    const clamped = clampCrop(newRect, imageDisplayWidth, imageDisplayHeight);
    setCropRect(clamped);
  }, [imageDisplayWidth, imageDisplayHeight]);

  const px = toDisplayPx(cropRect, imageDisplayWidth, imageDisplayHeight);
  const cropW = Math.round(cropRect.width * imageNaturalWidth);
  const cropH = Math.round(cropRect.height * imageNaturalHeight);

  const handleMoveStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDragging('move');
    dragStart.current = { x: e.clientX, y: e.clientY, rect: { ...cropRect }, handleType: '' };
  };

  const handleResizeStart = (e: React.MouseEvent, handle: string) => {
    e.stopPropagation();
    e.preventDefault();
    setDragging('resize');
    dragStart.current = { x: e.clientX, y: e.clientY, rect: { ...cropRect }, handleType: handle };
  };

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: MouseEvent) => {
      const dx = (e.clientX - dragStart.current.x) / imageDisplayWidth;
      const dy = (e.clientY - dragStart.current.y) / imageDisplayHeight;
      const start = dragStart.current.rect;

      if (dragging === 'move') {
        updateRect({ ...start, x: start.x + dx, y: start.y + dy });
        return;
      }

      // Resize
      const h = dragStart.current.handleType;
      let { x, y, width, height } = start;
      if (h.includes('e')) { width = start.width + dx; }
      if (h.includes('w')) { x = start.x + dx; width = start.width - dx; }
      if (h.includes('s')) { height = start.height + dy; }
      if (h.includes('n')) { y = start.y + dy; height = start.height - dy; }
      updateRect({ x, y, width, height });
    };

    const handleUp = () => setDragging(null);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragging, imageDisplayWidth, imageDisplayHeight, updateRect]);

  return (
    <div
      data-testid="crop-overlay"
      className="nodrag nopan absolute inset-0"
      style={{ width: containerWidth, height: containerHeight }}
    >
      {/* Dark overlay with transparent cutout via SVG mask */}
      <svg width={containerWidth} height={containerHeight} style={{ position: 'absolute', top: 0, left: 0 }}>
        <defs>
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="white" />
            <rect x={px.left} y={px.top} width={px.width} height={px.height} fill="black" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.5)" mask={`url(#${maskId})`} />
      </svg>

      {/* Crop frame */}
      <div
        style={{
          position: 'absolute',
          left: px.left,
          top: px.top,
          width: px.width,
          height: px.height,
          border: '1px dashed white',
          cursor: 'move',
        }}
        onMouseDown={handleMoveStart}
      >
        {HANDLES.map((h) => (
          <div
            key={h}
            data-testid="crop-handle"
            style={{
              position: 'absolute',
              width: HANDLE_SIZE,
              height: HANDLE_SIZE,
              backgroundColor: 'rgb(59,130,246)',
              border: '1px solid white',
              cursor: CURSOR_MAP[h],
              ...HANDLE_POSITIONS[h],
            }}
            onMouseDown={(e) => handleResizeStart(e, h)}
          />
        ))}
      </div>

      {/* Size display */}
      <div
        className="nodrag nopan"
        style={{
          position: 'absolute',
          left: px.left,
          bottom: px.top - 4,
          transform: 'translateY(-100%)',
          backgroundColor: 'rgba(0,0,0,0.75)',
          color: 'white',
          padding: '2px 6px',
          borderRadius: 4,
          fontSize: 11,
          fontFamily: 'monospace',
        }}
      >
        {cropW} x {cropH}
      </div>
    </div>
  );
}
