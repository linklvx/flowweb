import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';

export interface EraseCanvasHandle {
  hasContent: () => boolean;
  clear: () => void;
  undo: () => void;
  redo: () => void;
  canRedo: () => boolean;
  getMaskBlob: (naturalW: number, naturalH: number) => Promise<Blob>;
}

export type EraseTool = 'brush' | 'rect' | 'eraser';

interface Props {
  width: number;
  height: number;
  brushSize: number;
  tool: EraseTool;
}

function createCheckerboardPattern(size = 8) {
  const canvas = document.createElement('canvas');
  canvas.width = size * 2;
  canvas.height = size * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillRect(size, size, size, size);
  ctx.fillStyle = '#d0d0d0';
  ctx.fillRect(size, 0, size, size);
  ctx.fillRect(0, size, size, size);
  return ctx.createPattern(canvas, 'repeat')!;
}

export const EraseCanvas = forwardRef<EraseCanvasHandle, Props>(
  function EraseCanvas({ width, height, brushSize, tool }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDrawing = useRef(false);
    const strokes = useRef<ImageData[]>([]);
    const redoStack = useRef<ImageData[]>([]);
    const rectStart = useRef<{ x: number; y: number } | null>(null);
    const previewRestore = useRef<ImageData | null>(null);
    const strokePoints = useRef<{ x: number; y: number }[]>([]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d', { willReadFrequently: true });
    }, [width, height]);

    const saveStroke = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d')!;
      strokes.current.push(ctx.getImageData(0, 0, width, height));
      redoStack.current = [];
    }, [width, height]);

    const setupBrushContext = useCallback((ctx: CanvasRenderingContext2D) => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = createCheckerboardPattern();
      ctx.strokeStyle = createCheckerboardPattern();
    }, []);

    const setupEraserContext = useCallback((ctx: CanvasRenderingContext2D) => {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    }, []);

    const drawStrokePath = useCallback((points: { x: number; y: number }[], isEraser: boolean) => {
      const canvas = canvasRef.current;
      if (!canvas || points.length === 0) return;
      const ctx = canvas.getContext('2d')!;
      if (isEraser) setupEraserContext(ctx);
      else setupBrushContext(ctx);

      ctx.beginPath();
      if (points.length === 1) {
        ctx.arc(points[0].x, points[0].y, brushSize / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
    }, [brushSize, setupBrushContext, setupEraserContext]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
      e.stopPropagation();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      const ctx = canvas.getContext('2d')!;

      if (tool === 'brush' || tool === 'eraser') {
        saveStroke();
        previewRestore.current = ctx.getImageData(0, 0, width, height);
        strokePoints.current = [{ x, y }];
        drawStrokePath(strokePoints.current, tool === 'eraser');
        isDrawing.current = true;
      } else if (tool === 'rect') {
        saveStroke();
        previewRestore.current = ctx.getImageData(0, 0, width, height);
        rectStart.current = { x, y };
        isDrawing.current = true;
      }
    }, [tool, saveStroke, drawStrokePath, width, height]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
      if (!isDrawing.current) return;
      e.stopPropagation();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      const ctx = canvas.getContext('2d')!;

      if (tool === 'brush' || tool === 'eraser') {
        if (previewRestore.current) {
          ctx.putImageData(previewRestore.current, 0, 0);
        }
        strokePoints.current.push({ x, y });
        drawStrokePath(strokePoints.current, tool === 'eraser');
      } else if (tool === 'rect') {
        // Restore to pre-preview state and draw fresh preview
        if (previewRestore.current) {
          ctx.putImageData(previewRestore.current, 0, 0);
        }
        const start = rectStart.current;
        if (!start) return;
        setupBrushContext(ctx);
        ctx.beginPath();
        ctx.rect(
          Math.min(start.x, x),
          Math.min(start.y, y),
          Math.abs(x - start.x),
          Math.abs(y - start.y),
        );
        ctx.fill();
      }
    }, [tool, drawStrokePath, width, height]);

    const handleMouseUp = useCallback(() => {
      isDrawing.current = false;
      rectStart.current = null;
      previewRestore.current = null;
      strokePoints.current = [];
    }, []);

    useImperativeHandle(ref, () => ({
      hasContent: () => strokes.current.length > 0,
      clear: () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, width, height);
        strokes.current = [];
        redoStack.current = [];
      },
      undo: () => {
        const canvas = canvasRef.current;
        if (!canvas || strokes.current.length === 0) return;
        const ctx = canvas.getContext('2d')!;
        const current = ctx.getImageData(0, 0, width, height);
        redoStack.current.push(current);
        const prev = strokes.current.pop()!;
        ctx.putImageData(prev, 0, 0);
      },
      redo: () => {
        const canvas = canvasRef.current;
        if (!canvas || redoStack.current.length === 0) return;
        const ctx = canvas.getContext('2d')!;
        const current = ctx.getImageData(0, 0, width, height);
        strokes.current.push(current);
        const next = redoStack.current.pop()!;
        ctx.putImageData(next, 0, 0);
      },
      canRedo: () => redoStack.current.length > 0,
      getMaskBlob: (naturalW: number, naturalH: number): Promise<Blob> => {
        return new Promise((resolve, reject) => {
          const canvas = canvasRef.current;
          if (!canvas) { reject(new Error('No canvas')); return; }

          const maskCanvas = document.createElement('canvas');
          maskCanvas.width = naturalW;
          maskCanvas.height = naturalH;
          const maskCtx = maskCanvas.getContext('2d')!;

          const scaleX = naturalW / width;
          const scaleY = naturalH / height;
          maskCtx.scale(scaleX, scaleY);

          const imageData = canvas.getContext('2d')!.getImageData(0, 0, width, height);
          const data = imageData.data;
          for (let i = 0; i < data.length; i += 4) {
            const hasContent = data[i + 3] > 0;
            data[i] = hasContent ? 255 : 0;
            data[i + 1] = hasContent ? 255 : 0;
            data[i + 2] = hasContent ? 255 : 0;
            data[i + 3] = 255;
          }

          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = width;
          tempCanvas.height = height;
          const tempCtx = tempCanvas.getContext('2d')!;
          tempCtx.putImageData(imageData, 0, 0);
          maskCtx.drawImage(tempCanvas, 0, 0);

          maskCtx.filter = 'blur(3px)';
          maskCtx.drawImage(maskCanvas, 0, 0);
          maskCtx.filter = 'none';

          maskCanvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Mask export failed'));
          }, 'image/png', 1.0);
        });
      },
    }), [width, height]);

    useEffect(() => {
      const handleGlobalUp = () => {
        isDrawing.current = false;
        rectStart.current = null;
        previewRestore.current = null;
        strokePoints.current = [];
      };
      window.addEventListener('mouseup', handleGlobalUp);
      return () => window.removeEventListener('mouseup', handleGlobalUp);
    }, []);

    return (
      <canvas
        ref={canvasRef}
        className="nodrag nopan absolute top-0 left-0"
        style={{ width, height, cursor: 'crosshair', zIndex: 5 }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      />
    );
  },
);
