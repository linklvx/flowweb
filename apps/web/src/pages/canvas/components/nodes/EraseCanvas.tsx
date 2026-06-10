import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';

export interface EraseCanvasHandle {
  hasContent: () => boolean;
  clear: () => void;
  undo: () => void;
  getMaskBlob: (naturalW: number, naturalH: number) => Promise<Blob>;
}

interface Props {
  width: number;
  height: number;
  brushSize: number;
}

export const EraseCanvas = forwardRef<EraseCanvasHandle, Props>(
  function EraseCanvas({ width, height, brushSize }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDrawing = useRef(false);
    const strokes = useRef<ImageData[]>([]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = width;
      canvas.height = height;
    }, [width, height]);

    const saveStroke = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d')!;
      strokes.current.push(ctx.getImageData(0, 0, width, height));
    }, [width, height]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
      e.stopPropagation();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      saveStroke();

      const ctx = canvas.getContext('2d')!;
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 0, 0, 0.4)';
      ctx.fill();
      isDrawing.current = true;
    }, [brushSize, saveStroke]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
      if (!isDrawing.current) return;
      e.stopPropagation();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const ctx = canvas.getContext('2d')!;
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 0, 0, 0.4)';
      ctx.fill();
    }, [brushSize]);

    const handleMouseUp = useCallback(() => {
      isDrawing.current = false;
    }, []);

    useImperativeHandle(ref, () => ({
      hasContent: () => strokes.current.length > 0,
      clear: () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, width, height);
        strokes.current = [];
      },
      undo: () => {
        const canvas = canvasRef.current;
        if (!canvas || strokes.current.length === 0) return;
        const ctx = canvas.getContext('2d')!;
        const prev = strokes.current.pop()!;
        ctx.putImageData(prev, 0, 0);
      },
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
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = width;
          tempCanvas.height = height;
          const tempCtx = tempCanvas.getContext('2d')!;
          tempCtx.putImageData(imageData, 0, 0);

          const data = imageData.data;
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const isRed = r > 200 && g < 100 && b < 100;
            data[i] = isRed ? 255 : 0;
            data[i + 1] = isRed ? 255 : 0;
            data[i + 2] = isRed ? 255 : 0;
          }
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
      const handleGlobalUp = () => { isDrawing.current = false; };
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
