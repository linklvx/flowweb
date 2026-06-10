import { useState, useCallback, useRef, useEffect } from 'react';
import { useViewport } from '@xyflow/react';

export interface OutpaintRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  imageVpX: number;
  imageVpY: number;
  imageVpW: number;
  imageVpH: number;
  value: OutpaintRect;
  onChange: (rect: OutpaintRect) => void;
}

const MIN_SIZE = 100;
const CORNER_SIZE = 24;
const CORNER_THICKNESS = 3;
const EDGE_HANDLE_SIZE = 12;

type DragHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move' | null;

export function OutpaintSelectionOverlay({
  imageVpX,
  imageVpY,
  imageVpW,
  imageVpH,
  value,
  onChange,
}: Props) {
  const { zoom } = useViewport();
  const [isHovering, setIsHovering] = useState(false);
  const [dragging, setDragging] = useState<DragHandle>(null);
  const dragStart = useRef({ x: 0, y: 0, rect: value });

  // Image bounds in viewport pixels
  const imgL = imageVpX;
  const imgT = imageVpY;
  const imgR = imageVpX + imageVpW;
  const imgB = imageVpY + imageVpH;

  // Selection frame bounds in viewport pixels
  const frameL = imgL + value.x * zoom;
  const frameT = imgT + value.y * zoom;
  const frameW = value.width * zoom;
  const frameH = value.height * zoom;
  const frameR = frameL + frameW;
  const frameB = frameT + frameH;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, handle: DragHandle) => {
      e.stopPropagation();
      e.preventDefault();
      setDragging(handle);
      dragStart.current = { x: e.clientX / zoom, y: e.clientY / zoom, rect: { ...value } };
    },
    [value, zoom],
  );

  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (e: MouseEvent) => {
      const dx = (e.clientX / zoom) - dragStart.current.x;
      const dy = (e.clientY / zoom) - dragStart.current.y;
      const start = dragStart.current.rect;

      let newRect = { ...start };
      switch (dragging) {
        case 'nw':
          newRect.x = start.x + dx;
          newRect.y = start.y + dy;
          newRect.width = start.width - dx;
          newRect.height = start.height - dy;
          break;
        case 'n':
          newRect.y = start.y + dy;
          newRect.height = start.height - dy;
          break;
        case 'ne':
          newRect.y = start.y + dy;
          newRect.width = start.width + dx;
          newRect.height = start.height - dy;
          break;
        case 'e':
          newRect.width = start.width + dx;
          break;
        case 'se':
          newRect.width = start.width + dx;
          newRect.height = start.height + dy;
          break;
        case 's':
          newRect.height = start.height + dy;
          break;
        case 'sw':
          newRect.x = start.x + dx;
          newRect.width = start.width - dx;
          newRect.height = start.height + dy;
          break;
        case 'w':
          newRect.x = start.x + dx;
          newRect.width = start.width - dx;
          break;
        case 'move':
          newRect.x = start.x + dx;
          newRect.y = start.y + dy;
          break;
      }

      if (newRect.width < MIN_SIZE) newRect.width = MIN_SIZE;
      if (newRect.height < MIN_SIZE) newRect.height = MIN_SIZE;

      // Clamp: image must always stay within the selection frame
      const imgW = imageVpW / zoom;
      const imgH = imageVpH / zoom;
      if (newRect.x > 0) newRect.x = 0;
      if (newRect.y > 0) newRect.y = 0;
      if (newRect.x + newRect.width < imgW) newRect.width = imgW - newRect.x;
      if (newRect.y + newRect.height < imgH) newRect.height = imgH - newRect.y;

      onChange(newRect);
    };

    const onMouseUp = () => setDragging(null);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging, zoom, onChange]);

  return (
    <div
      className="nodrag nopan absolute"
      style={{
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        zIndex: 5000,
        pointerEvents: 'none',
      }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* Selection frame */}
      <div
        data-testid="outpaint-frame"
        className="absolute"
        style={{
          left: frameL,
          top: frameT,
          width: frameW,
          height: frameH,
          border: '1px solid rgba(255, 255, 255, 0.5)',
          cursor: 'move',
          pointerEvents: 'auto',
        }}
        onMouseDown={(e) => handleMouseDown(e, 'move')}
      >
        {/* 9-grid guidelines */}
        <div
          data-testid="outpaint-grid"
          className="absolute inset-0 pointer-events-none transition-opacity duration-200"
          style={{ opacity: isHovering ? 1 : 0 }}
        >
          <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/30" />
          <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/30" />
          <div className="absolute top-1/3 left-0 right-0 h-px bg-white/30" />
          <div className="absolute top-2/3 left-0 right-0 h-px bg-white/30" />
        </div>

        {/* Corner L-handles */}
        <div data-handle="nw" className="absolute z-10" style={{ top: -2, left: -2, width: CORNER_SIZE, height: CORNER_SIZE, cursor: 'nwse-resize', pointerEvents: 'auto' }} onMouseDown={(e) => handleMouseDown(e, 'nw')}>
          <div className="absolute top-0 left-0 w-full" style={{ height: CORNER_THICKNESS, backgroundColor: 'white' }} />
          <div className="absolute top-0 left-0 h-full" style={{ width: CORNER_THICKNESS, backgroundColor: 'white' }} />
        </div>
        <div data-handle="ne" className="absolute z-10" style={{ top: -2, right: -2, width: CORNER_SIZE, height: CORNER_SIZE, cursor: 'nesw-resize', pointerEvents: 'auto' }} onMouseDown={(e) => handleMouseDown(e, 'ne')}>
          <div className="absolute top-0 right-0 w-full" style={{ height: CORNER_THICKNESS, backgroundColor: 'white' }} />
          <div className="absolute top-0 right-0 h-full" style={{ width: CORNER_THICKNESS, backgroundColor: 'white' }} />
        </div>
        <div data-handle="sw" className="absolute z-10" style={{ bottom: -2, left: -2, width: CORNER_SIZE, height: CORNER_SIZE, cursor: 'nesw-resize', pointerEvents: 'auto' }} onMouseDown={(e) => handleMouseDown(e, 'sw')}>
          <div className="absolute bottom-0 left-0 w-full" style={{ height: CORNER_THICKNESS, backgroundColor: 'white' }} />
          <div className="absolute bottom-0 left-0 h-full" style={{ width: CORNER_THICKNESS, backgroundColor: 'white' }} />
        </div>
        <div data-handle="se" className="absolute z-10" style={{ bottom: -2, right: -2, width: CORNER_SIZE, height: CORNER_SIZE, cursor: 'nwse-resize', pointerEvents: 'auto' }} onMouseDown={(e) => handleMouseDown(e, 'se')}>
          <div className="absolute bottom-0 right-0 w-full" style={{ height: CORNER_THICKNESS, backgroundColor: 'white' }} />
          <div className="absolute bottom-0 right-0 h-full" style={{ width: CORNER_THICKNESS, backgroundColor: 'white' }} />
        </div>

        {/* Edge handles */}
        <div data-handle="n" className="absolute z-10 flex items-center justify-center" style={{ top: -2, left: CORNER_SIZE, right: CORNER_SIZE, height: EDGE_HANDLE_SIZE, marginTop: -5, cursor: 'ns-resize', pointerEvents: 'auto' }} onMouseDown={(e) => handleMouseDown(e, 'n')}>
          <div className="w-8 rounded-full" style={{ height: CORNER_THICKNESS, backgroundColor: 'white' }} />
        </div>
        <div data-handle="s" className="absolute z-10 flex items-center justify-center" style={{ bottom: -2, left: CORNER_SIZE, right: CORNER_SIZE, height: EDGE_HANDLE_SIZE, marginBottom: -5, cursor: 'ns-resize', pointerEvents: 'auto' }} onMouseDown={(e) => handleMouseDown(e, 's')}>
          <div className="w-8 rounded-full" style={{ height: CORNER_THICKNESS, backgroundColor: 'white' }} />
        </div>
        <div data-handle="w" className="absolute z-10 flex items-center justify-center" style={{ left: -2, top: CORNER_SIZE, bottom: CORNER_SIZE, width: EDGE_HANDLE_SIZE, marginLeft: -5, cursor: 'ew-resize', pointerEvents: 'auto' }} onMouseDown={(e) => handleMouseDown(e, 'w')}>
          <div className="h-8 rounded-full" style={{ width: CORNER_THICKNESS, backgroundColor: 'white' }} />
        </div>
        <div data-handle="e" className="absolute z-10 flex items-center justify-center" style={{ right: -2, top: CORNER_SIZE, bottom: CORNER_SIZE, width: EDGE_HANDLE_SIZE, marginRight: -5, cursor: 'ew-resize', pointerEvents: 'auto' }} onMouseDown={(e) => handleMouseDown(e, 'e')}>
          <div className="h-8 rounded-full" style={{ width: CORNER_THICKNESS, backgroundColor: 'white' }} />
        </div>
      </div>
    </div>
  );
}
