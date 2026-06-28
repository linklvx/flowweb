import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle, useMemo } from 'react';
import { useNodeStore, type DrawOp, ANNOTATION_DEFAULTS } from '@/stores/nodeStore';

export interface AnnotationCanvasHandle {
  hasContent: () => boolean;
  getAnnotatedBlob: () => Promise<Blob>;
}

interface Props {
  displayWidth: number;
  displayHeight: number;
  naturalWidth: number;
  naturalHeight: number;
  offsetX: number;
  offsetY: number;
  imageRef: React.RefObject<HTMLImageElement | null>;
  imageUrl?: string;
  disabled: boolean;
}

interface Point {
  x: number;
  y: number;
}

// ── drawOpToCanvas: 统一绘制函数 ──
// scale: 显示层传 dpr，离屏层传 naturalScale

function drawOpToCanvas(
  ctx: CanvasRenderingContext2D,
  op: DrawOp,
  scale: number,
): void {
  ctx.save();
  ctx.strokeStyle = op.color;
  ctx.lineWidth = Math.max(0.5, op.lineWidth * scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (op.type === 'pen') {
    const effectiveWidth = Math.max(0.5, op.lineWidth * op.effectivePressure * scale);
    const pts = op.points;
    if (pts.length === 1) {
      const x = pts[0].x * scale;
      const y = pts[0].y * scale;
      ctx.beginPath();
      ctx.arc(x, y, (effectiveWidth * 0.5), 0, Math.PI * 2);
      ctx.fill();
    } else if (pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x * scale, pts[0].y * scale);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x * scale, pts[i].y * scale);
      }
      ctx.stroke();
    }
  } else if (op.type === 'rect') {
    const x = Math.min(op.x1, op.x2) * scale;
    const y = Math.min(op.y1, op.y2) * scale;
    const w = Math.abs(op.x2 - op.x1) * scale;
    const h = Math.abs(op.y2 - op.y1) * scale;
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.stroke();
  } else if (op.type === 'line') {
    ctx.beginPath();
    ctx.moveTo(op.x1 * scale, op.y1 * scale);
    ctx.lineTo(op.x2 * scale, op.y2 * scale);
    ctx.stroke();
  }
  ctx.restore();
}

export const AnnotationCanvas = forwardRef<AnnotationCanvasHandle, Props>(
  function AnnotationCanvas({
    displayWidth,
    displayHeight,
    naturalWidth,
    naturalHeight,
    offsetX,
    offsetY,
    imageRef,
    imageUrl,
    disabled,
  }, ref) {
    const displayCanvasRef = useRef<HTMLCanvasElement>(null);
    const offscreenRef = useRef<HTMLCanvasElement | null>(null);
    const isDrawing = useRef(false);
    const currentPoints = useRef<Point[]>([]);
    const pressureSum = useRef(0);
    const pressureCount = useRef(0);
    const rectStart = useRef<{ x: number; y: number } | null>(null);
    const rectEnd = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const lineStart = useRef<{ x: number; y: number } | null>(null);
    const lineEnd = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

    // ★ 参数快照 — pointerdown 时冻结本次绘制参数
    const toolSnap = useRef<'pen' | 'rect' | 'line'>('pen');
    const colorSnap = useRef<string>(ANNOTATION_DEFAULTS.color);
    const lineWidthSnap = useRef<number>(ANNOTATION_DEFAULTS.lineWidth);

    const dpr = useMemo(() => window.devicePixelRatio || 1, []);

    const canvasWidth = displayWidth * dpr;
    const canvasHeight = displayHeight * dpr;
    const naturalScale = naturalWidth / displayWidth;

    // ── Store selector ──
    const history = useNodeStore(state => state.annotationState?.history ?? []);
    const tool = useNodeStore(state => state.annotationState?.tool ?? 'pen');
    const color = useNodeStore(state => state.annotationState?.color ?? ANNOTATION_DEFAULTS.color);
    const lineWidth = useNodeStore(state => state.annotationState?.lineWidth ?? ANNOTATION_DEFAULTS.lineWidth);

    // ── 离屏 Canvas 管理 ──
    const getOffscreen = useCallback((): HTMLCanvasElement => {
      if (!offscreenRef.current) {
        offscreenRef.current = document.createElement('canvas');
        offscreenRef.current.width = naturalWidth;
        offscreenRef.current.height = naturalHeight;
      }
      return offscreenRef.current;
    }, [naturalWidth, naturalHeight]);

    // ── 重绘全部历史 → 显示层 + 离屏层 ──
    const redrawAll = useCallback(() => {
      const dCanvas = displayCanvasRef.current;
      if (!dCanvas) return;
      const dCtx = dCanvas.getContext('2d');
      if (!dCtx) return;

      dCtx.setTransform(1, 0, 0, 1, 0, 0);
      dCtx.clearRect(0, 0, canvasWidth, canvasHeight);
      for (const op of history) {
        drawOpToCanvas(dCtx, op, dpr);
      }

      const offscreen = getOffscreen();
      const oCtx = offscreen.getContext('2d')!;
      oCtx.clearRect(0, 0, naturalWidth, naturalHeight);
      for (const op of history) {
        drawOpToCanvas(oCtx, op, naturalScale);
      }
    }, [history, dpr, displayWidth, displayHeight, naturalWidth, naturalHeight, naturalScale, getOffscreen]);

    // ── history 变更 → 全量重绘 ──
    useEffect(() => {
      if (!displayCanvasRef.current) return;
      redrawAll();
    }, [history, redrawAll]);

    // ── 尺寸变化时离屏重建 ──
    const prevNaturalSize = useRef({ w: naturalWidth, h: naturalHeight });
    useEffect(() => {
      if (prevNaturalSize.current.w !== naturalWidth || prevNaturalSize.current.h !== naturalHeight) {
        prevNaturalSize.current = { w: naturalWidth, h: naturalHeight };
        if (offscreenRef.current) {
          offscreenRef.current.width = 0;
          offscreenRef.current.height = 0;
          offscreenRef.current = null;
        }
        redrawAll();
      }
    }, [naturalWidth, naturalHeight, redrawAll]);

    // ★ 参数变更中断绘制 → 重绘显示层（仅 history，无 temp shape）
    useEffect(() => {
      if (isDrawing.current) {
        isDrawing.current = false;
        currentPoints.current = [];
        pressureSum.current = 0;
        pressureCount.current = 0;
        rectStart.current = null;
        rectEnd.current = { x: 0, y: 0 };
        lineStart.current = null;
        lineEnd.current = { x: 0, y: 0 };
        redrawAll();
      }
    }, [tool, color, lineWidth, redrawAll]);

    // ── 坐标换算 ──
    const getLogicalCoords = useCallback((e: React.PointerEvent): { logicalX: number; logicalY: number; pressure: number } => {
      const canvas = displayCanvasRef.current;
      if (!canvas) return { logicalX: 0, logicalY: 0, pressure: 0.5 };
      const rect = canvas.getBoundingClientRect();
      const ratioX = canvas.width / rect.width;
      const ratioY = canvas.height / rect.height;
      const physicalX = (e.clientX - rect.left) * ratioX;
      const physicalY = (e.clientY - rect.top) * ratioY;
      const logicalX = physicalX / (canvas.width / displayWidth);
      const logicalY = physicalY / (canvas.height / displayHeight);
      const pressure = e.pressure || ANNOTATION_DEFAULTS.mousePressure;
      return {
        logicalX: Math.max(0, Math.min(displayWidth, logicalX)),
        logicalY: Math.max(0, Math.min(displayHeight, logicalY)),
        pressure: Math.max(ANNOTATION_DEFAULTS.pressureMin, pressure),
      };
    }, [displayWidth, displayHeight]);

    // ── 获取显示 Canvas 上下文（已 reset transform） ──
    const getDisplayCtx = useCallback(() => {
      const dCanvas = displayCanvasRef.current;
      if (!dCanvas) return null;
      const ctx = dCanvas.getContext('2d');
      if (!ctx) return null;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return ctx;
    }, []);

    // ── Pointer events ──

    const handlePointerDown = useCallback((e: React.PointerEvent) => {
      if (disabled) return;
      e.stopPropagation();
      e.preventDefault();
      useNodeStore.getState().setEditOverlayDragging(true);

      const canvas = displayCanvasRef.current;
      if (!canvas) return;
      canvas.setPointerCapture(e.pointerId);

      const { logicalX, logicalY, pressure } = getLogicalCoords(e);

      toolSnap.current = tool;
      colorSnap.current = color;
      lineWidthSnap.current = lineWidth;

      isDrawing.current = true;

      if (tool === 'pen') {
        currentPoints.current = [{ x: logicalX, y: logicalY }];
        pressureSum.current = pressure;
        pressureCount.current = 1;
      } else if (tool === 'rect') {
        rectStart.current = { x: logicalX, y: logicalY };
        rectEnd.current = { x: logicalX, y: logicalY };
      } else if (tool === 'line') {
        lineStart.current = { x: logicalX, y: logicalY };
        lineEnd.current = { x: logicalX, y: logicalY };
      }
    }, [disabled, getLogicalCoords, tool, color, lineWidth]);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
      if (!isDrawing.current || disabled) return;
      e.stopPropagation();
      e.preventDefault();

      const { logicalX, logicalY, pressure } = getLogicalCoords(e);
      const t = toolSnap.current;

      // Update shape state
      if (t === 'pen') {
        currentPoints.current.push({ x: logicalX, y: logicalY });
        pressureSum.current += pressure;
        pressureCount.current += 1;
      } else if (t === 'rect') {
        rectEnd.current = { x: logicalX, y: logicalY };
      } else if (t === 'line') {
        lineEnd.current = { x: logicalX, y: logicalY };
      }

      // Build temporary DrawOp for preview
      let tempOp: DrawOp | null = null;
      const col = colorSnap.current;
      const lw = lineWidthSnap.current;

      if (t === 'pen' && currentPoints.current.length > 0) {
        tempOp = {
          type: 'pen',
          points: currentPoints.current.map(p => ({ x: p.x, y: p.y })),
          color: col,
          lineWidth: lw,
          effectivePressure: 1,
        };
      } else if (t === 'rect' && rectStart.current) {
        tempOp = {
          type: 'rect',
          x1: rectStart.current.x, y1: rectStart.current.y,
          x2: rectEnd.current.x, y2: rectEnd.current.y,
          color: col,
          lineWidth: lw,
        };
      } else if (t === 'line' && lineStart.current) {
        tempOp = {
          type: 'line',
          x1: lineStart.current.x, y1: lineStart.current.y,
          x2: lineEnd.current.x, y2: lineEnd.current.y,
          color: col,
          lineWidth: lw,
        };
      }

      // Redraw: clear → history → temp shape
      const dCtx = getDisplayCtx();
      if (!dCtx) return;
      dCtx.clearRect(0, 0, canvasWidth, canvasHeight);
      const currentHistory = useNodeStore.getState().annotationState?.history ?? [];
      for (const op of currentHistory) {
        drawOpToCanvas(dCtx, op, dpr);
      }
      if (tempOp) {
        drawOpToCanvas(dCtx, tempOp, dpr);
      }
    }, [disabled, getLogicalCoords, getDisplayCtx, dpr, canvasWidth, canvasHeight]);

    const handlePointerUp = useCallback((e: React.PointerEvent) => {
      if (!isDrawing.current) return;
      e.stopPropagation();
      e.preventDefault();
      const t = toolSnap.current;
      const col = colorSnap.current;
      const lw = lineWidthSnap.current;

      let op: DrawOp | null = null;

      if (t === 'pen' && currentPoints.current.length > 0) {
        const avgPressure = pressureCount.current > 0
          ? pressureSum.current / pressureCount.current
          : ANNOTATION_DEFAULTS.mousePressure;
        op = {
          type: 'pen',
          points: currentPoints.current.map(p => ({ x: p.x, y: p.y })),
          color: col,
          lineWidth: lw,
          effectivePressure: Math.max(ANNOTATION_DEFAULTS.pressureMin, avgPressure),
        };
      } else if (t === 'rect' && rectStart.current) {
        op = {
          type: 'rect',
          x1: rectStart.current.x,
          y1: rectStart.current.y,
          x2: rectEnd.current.x,
          y2: rectEnd.current.y,
          color: col,
          lineWidth: lw,
        };
      } else if (t === 'line' && lineStart.current) {
        op = {
          type: 'line',
          x1: lineStart.current.x,
          y1: lineStart.current.y,
          x2: lineEnd.current.x,
          y2: lineEnd.current.y,
          color: col,
          lineWidth: lw,
        };
      }

      isDrawing.current = false;
      currentPoints.current = [];
      pressureSum.current = 0;
      pressureCount.current = 0;
      rectStart.current = null;
      lineStart.current = null;
      useNodeStore.getState().setEditOverlayDragging(false);

      if (op) {
        useNodeStore.getState().pushDrawOp(op);
      }
    }, []);

    // ── Imperative handle ──

    useImperativeHandle(ref, () => ({
      hasContent: () => history.length > 0,
      getAnnotatedBlob: async (): Promise<Blob> => {
        let img: HTMLImageElement | null = imageRef?.current ?? null;

        if (!img && imageUrl) {
          img = new Image();
          img.crossOrigin = 'anonymous';
          img.src = imageUrl;
          await new Promise<void>((resolve, reject) => {
            img!.onload = () => resolve();
            img!.onerror = () => reject(new Error('图片加载失败'));
          });
        }

        if (!img) throw new Error('无可用的图片源');
        if (!img.complete) throw new Error('图片尚未加载完成');

        const trueW = img.naturalWidth || naturalWidth;
        const trueH = img.naturalHeight || naturalHeight;

        const MAX = 16384;
        let exportW = trueW;
        let exportH = trueH;
        if (exportW > MAX || exportH > MAX) {
          const ratio = Math.min(MAX / exportW, MAX / exportH);
          exportW = Math.round(exportW * ratio);
          exportH = Math.round(exportH * ratio);
        }

        const composite = document.createElement('canvas');
        composite.width = exportW;
        composite.height = exportH;
        const ctx = composite.getContext('2d')!;

        ctx.drawImage(img, 0, 0, exportW, exportH);

        const offscreen = getOffscreen();
        if (offscreen.width === exportW && offscreen.height === exportH) {
          ctx.drawImage(offscreen, 0, 0);
        } else {
          const trueScale = exportW / displayWidth;
          for (const op of history) {
            drawOpToCanvas(ctx, op, trueScale);
          }
        }

        return new Promise((resolve, reject) => {
          composite.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('标注导出失败'));
          }, 'image/png');
        });
      },
    }), [history, imageRef, imageUrl, naturalWidth, naturalHeight, displayWidth, getOffscreen]);

    // ── 组件卸载清理 ──
    useEffect(() => {
      return () => {
        if (offscreenRef.current) {
          offscreenRef.current.width = 0;
          offscreenRef.current.height = 0;
          offscreenRef.current = null;
        }
      };
    }, []);

    return (
      <div
        className="nopan"
        style={{
          position: 'absolute',
          left: offsetX,
          top: offsetY,
          width: displayWidth,
          height: displayHeight,
          zIndex: 5,
          userSelect: 'none',
        }}
      >
        <canvas
          ref={displayCanvasRef}
          width={canvasWidth}
          height={canvasHeight}
          className="nopan"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: displayWidth,
            height: displayHeight,
            cursor: disabled ? 'default' : 'crosshair',
            touchAction: 'none',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      </div>
    );
  },
);
