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
  pressure: number;
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
    const pts = op.points;
    if (pts.length === 1) {
      const x = pts[0].x * scale;
      const y = pts[0].y * scale;
      ctx.beginPath();
      ctx.arc(x, y, (op.lineWidth * scale * 0.5), 0, Math.PI * 2);
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
    const historyCanvasRef = useRef<HTMLCanvasElement>(null);
    const tempCanvasRef = useRef<HTMLCanvasElement>(null);
    const offscreenRef = useRef<HTMLCanvasElement | null>(null);
    const isDrawing = useRef(false);
    const currentPoints = useRef<Point[]>([]);
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

    // ── 重绘全部历史 ──
    const redrawAll = useCallback(() => {
      const hCanvas = historyCanvasRef.current;
      if (!hCanvas) return;
      const hCtx = hCanvas.getContext('2d');
      if (!hCtx) return;

      // 显示层：不设 setTransform（避免与 drawOpToCanvas 内 scale 叠加）
      // 直接用物理像素清除 + 坐标 × dpr 绘制
      hCtx.setTransform(1, 0, 0, 1, 0, 0);
      hCtx.clearRect(0, 0, canvasWidth, canvasHeight);
      for (const op of history) {
        drawOpToCanvas(hCtx, op, dpr);
      }

      // 离屏层
      const offscreen = getOffscreen();
      const oCtx = offscreen.getContext('2d')!;
      oCtx.clearRect(0, 0, naturalWidth, naturalHeight);
      for (const op of history) {
        drawOpToCanvas(oCtx, op, naturalScale);
      }
    }, [history, dpr, displayWidth, displayHeight, naturalWidth, naturalHeight, naturalScale, getOffscreen]);

    // ── history 变更 → 全量重绘 ──
    useEffect(() => {
      if (!historyCanvasRef.current) return;
      redrawAll();
    }, [history, redrawAll]);

    // ── 组件挂载：canvas DOM 就位后首次恢复 ──
    useEffect(() => {
      redrawAll();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── 尺寸变化时离屏重建 ──
    const prevNaturalSize = useRef({ w: naturalWidth, h: naturalHeight });
    useEffect(() => {
      if (prevNaturalSize.current.w !== naturalWidth || prevNaturalSize.current.h !== naturalHeight) {
        prevNaturalSize.current = { w: naturalWidth, h: naturalHeight };
        // 销毁旧离屏
        if (offscreenRef.current) {
          offscreenRef.current.width = 0;
          offscreenRef.current.height = 0;
          offscreenRef.current = null;
        }
        // 重建后重绘
        redrawAll();
      }
    }, [naturalWidth, naturalHeight, redrawAll]);

    // ★ 参数变更中断绘制
    useEffect(() => {
      if (isDrawing.current) {
        // 清空临时层
        const tCanvas = tempCanvasRef.current;
        if (tCanvas) {
          const ctx = tCanvas.getContext('2d');
          if (ctx) ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        }
        isDrawing.current = false;
        currentPoints.current = [];
        rectStart.current = null;
        rectEnd.current = { x: 0, y: 0 };
        lineStart.current = null;
        lineEnd.current = { x: 0, y: 0 };
      }
    }, [tool, color, lineWidth, canvasWidth, canvasHeight]);

    // ── 坐标换算 ──
    // canvas.width = displayWidth × dpr（物理像素）
    // rect.width  = 实际 CSS 渲染宽度（受 React Flow zoom 影响）
    // ratio = 物理像素 / CSS 像素 = 综合了 dpr + zoom
    // logicalX = (clientX - rect.left) × ratio → 物理像素位置 → 映射到 CSS 逻辑坐标需要除以 (canvas.width / displayWidth)
    const getLogicalCoords = useCallback((e: React.PointerEvent): { logicalX: number; logicalY: number; pressure: number } => {
      const canvas = historyCanvasRef.current;
      if (!canvas) return { logicalX: 0, logicalY: 0, pressure: 0.5 };
      const rect = canvas.getBoundingClientRect();
      // ★ 使用 canvas 物理像素尺寸与 CSS 渲染尺寸的比值（而非 window.devicePixelRatio）
      const ratioX = canvas.width / rect.width;
      const ratioY = canvas.height / rect.height;
      // 物理像素 = (client - rect偏移) × ratio
      const physicalX = (e.clientX - rect.left) * ratioX;
      const physicalY = (e.clientY - rect.top) * ratioY;
      // CSS 逻辑坐标 = 物理像素 / (canvas物理宽 / displayCSS宽)
      const logicalX = physicalX / (canvas.width / displayWidth);
      const logicalY = physicalY / (canvas.height / displayHeight);
      const pressure = e.pressure || ANNOTATION_DEFAULTS.mousePressure;
      return {
        logicalX: Math.max(0, Math.min(displayWidth, logicalX)),
        logicalY: Math.max(0, Math.min(displayHeight, logicalY)),
        pressure: Math.max(ANNOTATION_DEFAULTS.pressureMin, pressure),
      };
    }, [displayWidth, displayHeight]);

    // ── 临时层绘制 ──
    const clearTempCanvas = useCallback(() => {
      const tCanvas = tempCanvasRef.current;
      if (!tCanvas) return;
      const ctx = tCanvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    }, [canvasWidth, canvasHeight]);

    const getTempCtx = useCallback(() => {
      const tCanvas = tempCanvasRef.current;
      if (!tCanvas) return null;
      const ctx = tCanvas.getContext('2d');
      if (!ctx) return null;
      // ★ 不设 setTransform，由各 drawTemp* 函数通过坐标 × dpr 处理缩放
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return ctx;
    }, []);

    const drawTempPen = useCallback((points: Point[]) => {
      const ctx = getTempCtx();
      if (!ctx) return;
      ctx.strokeStyle = colorSnap.current;
      ctx.lineWidth = Math.max(0.5, lineWidthSnap.current * dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (points.length === 1) {
        ctx.beginPath();
        ctx.arc(points[0].x * dpr, points[0].y * dpr, (lineWidthSnap.current * dpr * 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else if (points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(points[0].x * dpr, points[0].y * dpr);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x * dpr, points[i].y * dpr);
        }
        ctx.stroke();
      }
    }, [getTempCtx, dpr]);

    const drawTempRect = useCallback((start: { x: number; y: number }, end: { x: number; y: number }) => {
      const ctx = getTempCtx();
      if (!ctx) return;
      ctx.strokeStyle = colorSnap.current;
      ctx.lineWidth = Math.max(0.5, lineWidthSnap.current * dpr);
      const x = Math.min(start.x, end.x) * dpr;
      const y = Math.min(start.y, end.y) * dpr;
      const w = Math.abs(end.x - start.x) * dpr;
      const h = Math.abs(end.y - start.y) * dpr;
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.stroke();
    }, [getTempCtx, dpr]);

    const drawTempLine = useCallback((start: { x: number; y: number }, end: { x: number; y: number }) => {
      const ctx = getTempCtx();
      if (!ctx) return;
      ctx.strokeStyle = colorSnap.current;
      ctx.lineWidth = Math.max(0.5, lineWidthSnap.current * dpr);
      ctx.beginPath();
      ctx.moveTo(start.x * dpr, start.y * dpr);
      ctx.lineTo(end.x * dpr, end.y * dpr);
      ctx.stroke();
    }, [getTempCtx, dpr]);

    // ── Pointer events ──

    const handlePointerDown = useCallback((e: React.PointerEvent) => {
      if (disabled) return;
      e.stopPropagation();
      e.preventDefault();
      useNodeStore.getState().setEditOverlayDragging(true);

      const canvas = historyCanvasRef.current;
      if (!canvas) return;
      canvas.setPointerCapture(e.pointerId);

      const { logicalX, logicalY, pressure } = getLogicalCoords(e);

      // ★ 快照当前参数
      toolSnap.current = tool;
      colorSnap.current = color;
      lineWidthSnap.current = lineWidth;

      isDrawing.current = true;

      if (tool === 'pen') {
        currentPoints.current = [{ x: logicalX, y: logicalY, pressure }];
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

      const { logicalX, logicalY, pressure } = getLogicalCoords(e);
      const t = toolSnap.current;

      clearTempCanvas();

      if (t === 'pen') {
        currentPoints.current.push({ x: logicalX, y: logicalY, pressure });
        drawTempPen(currentPoints.current);
      } else if (t === 'rect') {
        rectEnd.current = { x: logicalX, y: logicalY };
        drawTempRect(rectStart.current!, rectEnd.current);
      } else if (t === 'line') {
        lineEnd.current = { x: logicalX, y: logicalY };
        drawTempLine(lineStart.current!, lineEnd.current);
      }
    }, [disabled, getLogicalCoords, clearTempCanvas, drawTempPen, drawTempRect, drawTempLine]);

    const handlePointerUp = useCallback(() => {
      if (!isDrawing.current) return;
      const t = toolSnap.current;
      const col = colorSnap.current;
      const lw = lineWidthSnap.current;

      let op: DrawOp | null = null;

      if (t === 'pen' && currentPoints.current.length > 0) {
        op = {
          type: 'pen',
          points: currentPoints.current.map(p => ({ x: p.x, y: p.y, pressure: p.pressure })),
          color: col,
          lineWidth: lw,
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
      rectStart.current = null;
      lineStart.current = null;
      clearTempCanvas();
      useNodeStore.getState().setEditOverlayDragging(false);

      if (op) {
        useNodeStore.getState().pushDrawOp(op);
      }
    }, [clearTempCanvas]);

    // ── Imperative handle ──

    useImperativeHandle(ref, () => ({
      hasContent: () => history.length > 0,
      getAnnotatedBlob: async (): Promise<Blob> => {
        // ★ 优先使用已加载的 DOM 元素
        let img: HTMLImageElement | null = imageRef?.current ?? null;

        // 兜底：URL 加载
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

        // ★ 使用图片元素真实自然分辨率（可能 > naturalWidth prop 的 fallback 值）
        const trueW = img.naturalWidth || naturalWidth;
        const trueH = img.naturalHeight || naturalHeight;

        // 尺寸上限检查
        const MAX = 16384;
        let exportW = trueW;
        let exportH = trueH;
        if (exportW > MAX || exportH > MAX) {
          const ratio = Math.min(MAX / exportW, MAX / exportH);
          exportW = Math.round(exportW * ratio);
          exportH = Math.round(exportH * ratio);
        }

        // 创建临时合成画布
        const composite = document.createElement('canvas');
        composite.width = exportW;
        composite.height = exportH;
        const ctx = composite.getContext('2d')!;

        // 1. 绘制原图（使用图片真实分辨率）
        ctx.drawImage(img, 0, 0, exportW, exportH);

        // 2. 叠加标注层
        // 如果离屏 canvas 尺寸与导出尺寸一致，直接叠加
        const offscreen = getOffscreen();
        if (offscreen.width === exportW && offscreen.height === exportH) {
          ctx.drawImage(offscreen, 0, 0);
        } else {
          // 尺寸不一致时：按导出尺寸重新绘制标注（使用正确缩放比）
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
        }}
      >
        {/* 底层：历史 Canvas */}
        <canvas
          ref={historyCanvasRef}
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
        {/* 顶层：临时 Canvas（pointer-events: none） */}
        <canvas
          ref={tempCanvasRef}
          width={canvasWidth}
          height={canvasHeight}
          className="nopan"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: displayWidth,
            height: displayHeight,
            pointerEvents: 'none',
            touchAction: 'none',
          }}
        />
      </div>
    );
  },
);
