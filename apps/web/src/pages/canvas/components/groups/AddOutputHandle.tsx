// apps/web/src/pages/canvas/components/groups/AddOutputHandle.tsx
// B6-2（Spec B 需求 6 / 撞车② B 案）：+号输出按钮——多选框/普通组的批量连线入口。
// 渲染层与 GroupToolbar 同构：portal 至 #node-toolbar-portal（屏幕坐标层，天然屏幕空间——
// 与反缩放层 transform:scale(1/zoom) 等价[终裁 19]：尺寸与偏移均屏幕 px 不随 zoom）；
// 组框 rect 读 cs（v3.16 终裁 57②：useCanvasStore 订阅组帧三字段+useViewport，不读 RF internals）。
// 拖线层 BatchConnectLines 同 portal；松手/点击语义（batchConnect/点击建点）归 B6-3——
// 经 onGestureEnd 载荷缝送达（前向引用禁令：本片不引用 B6-3 未建符号）。
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useViewport } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeStore } from '@/stores/nodeStore';
import { selectIsLocked } from '@/stores/canvasLock';
import { canEdit } from '@/stores/syncStatus';
import { DRAG_THRESHOLD_PX } from '@/utils/handleMenu';
import { ADD_OUTPUT_HANDLE } from './selectionTokens';
import { BatchConnectLines } from './BatchConnectLines';
import {
  resolveAddOutputTarget, addOutputFrameFlow, addOutputSourceIds, addOutputSourceAnchorsScreen,
  resolveBatchDropTarget, type BatchConnectGestureEnd,
} from './addOutput';

interface Props {
  /** B6-3 缝：手势终态载荷（<阈值=点击 / ≥阈值=拖线松手）——B6-2 只送达不执行语义 */
  onGestureEnd?: (end: BatchConnectGestureEnd) => void;
}

interface DragState {
  startClient: { x: number; y: number };
  /** portal 原点（client 系）——client↔portal 屏幕坐标换算基准，手势期视口不可平移（指针占用） */
  portalOrigin: { x: number; y: number };
  pointerLocal: { x: number; y: number };
  /** 位移 ≥ DRAG_THRESHOLD_PX 进拖线态（B6-1 补导出=B6-3 点击/连线唯一阈值） */
  active: boolean;
  sourceIds: string[];
  anchorClient: { x: number; y: number };
  vp: { x: number; y: number; zoom: number };
}

function AddOutputHandleComponent({ onGestureEnd }: Props) {
  const { x: vpX, y: vpY, zoom } = useViewport();
  const nodes = useCanvasStore((s) => s.nodes);
  const marqueeSelecting = useCanvasStore((s) => s.marqueeSelecting);
  const localCollapsed = useCanvasStore((s) => s.localCollapsed);
  const editable = useCanvasStore((s) => canEdit(s));

  const [drag, setDrag] = useState<DragState | null>(null);
  // 监听器读 ref 防闭包旧值（effect 仅随 gestureLive 挂卸一次）
  const dragRef = useRef<DragState | null>(null);
  const endRef = useRef(onGestureEnd);
  endRef.current = onGestureEnd;

  const geo = useMemo(() => {
    const target = resolveAddOutputTarget(nodes, { marqueeSelecting, canEdit: editable, localCollapsed });
    if (!target) return null;
    const frame = addOutputFrameFlow(nodes, target);
    if (!frame) return null;
    const right = (frame.x + frame.w) * zoom + vpX;
    const vcy = (frame.y + frame.h / 2) * zoom + vpY;
    return {
      hitLeft: right,
      hitTop: vcy - ADD_OUTPUT_HANDLE.hitHeight / 2,
      anchor: { x: right + ADD_OUTPUT_HANDLE.offset, y: vcy },
      target,
    };
  }, [nodes, marqueeSelecting, localCollapsed, editable, zoom, vpX, vpY]);

  const setDragState = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation(); // 撞车①b：RF 不平移不拖拽（与 nodrag/nopan class 双保险）
    if (e.button !== 0) return; // B6-3（B6-2 移交项）：仅左键启手势——右/中键零载荷零拖线
    if (!geo) return;
    if (selectIsLocked(useNodeStore.getState())) return; // F10：isLocked 态不响应
    const s = useCanvasStore.getState();
    const t = resolveAddOutputTarget(s.nodes, {
      marqueeSelecting: s.marqueeSelecting, canEdit: canEdit(s), localCollapsed: s.localCollapsed,
    });
    const rect = document.getElementById('node-toolbar-portal')?.getBoundingClientRect();
    const origin = { x: rect?.left ?? 0, y: rect?.top ?? 0 };
    setDragState({
      startClient: { x: e.clientX, y: e.clientY },
      portalOrigin: origin,
      pointerLocal: { x: e.clientX - origin.x, y: e.clientY - origin.y },
      active: false,
      sourceIds: t ? addOutputSourceIds(s.nodes, t) : [],
      anchorClient: { x: origin.x + geo.anchor.x, y: origin.y + geo.anchor.y },
      vp: { x: vpX, y: vpY, zoom },
    });
  }, [geo, setDragState, vpX, vpY, zoom]);

  const gestureLive = drag !== null;
  useEffect(() => {
    if (!gestureLive) return;
    const onMove = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      if (e.buttons === 0) { setDragState(null); return; } // 窗外松手兜底（useMarqueeSelectionGuard 同通道）
      const dist = Math.hypot(e.clientX - cur.startClient.x, e.clientY - cur.startClient.y);
      const next: DragState = {
        ...cur,
        pointerLocal: { x: e.clientX - cur.portalOrigin.x, y: e.clientY - cur.portalOrigin.y },
        active: cur.active || dist >= DRAG_THRESHOLD_PX,
      };
      dragRef.current = next;
      setDrag(next);
    };
    const onUp = (e: PointerEvent) => {
      const cur = dragRef.current;
      setDragState(null);
      if (!cur) return;
      if (!cur.active) {
        endRef.current?.({ kind: 'click', sourceIds: cur.sourceIds, anchorClient: cur.anchorClient });
        return;
      }
      const local = { x: e.clientX - cur.portalOrigin.x, y: e.clientY - cur.portalOrigin.y };
      const flowPoint = { x: (local.x - cur.vp.x) / cur.vp.zoom, y: (local.y - cur.vp.y) / cur.vp.zoom };
      endRef.current?.({
        kind: 'drop',
        sourceIds: cur.sourceIds,
        clientPoint: { x: e.clientX, y: e.clientY },
        flowPoint,
        hitNodeId: resolveBatchDropTarget(useCanvasStore.getState().nodes, flowPoint, cur.sourceIds),
      });
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setDragState(null); };
    const onCancel = () => setDragState(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [gestureLive, setDragState]);

  const portalRoot = document.getElementById('node-toolbar-portal');
  if (!geo || !portalRoot) return null;

  const lineSources = drag
    ? addOutputSourceAnchorsScreen(nodes, drag.sourceIds, { x: vpX, y: vpY, zoom })
    : [];

  return createPortal(
    <>
      {drag?.active && <BatchConnectLines sources={lineSources} pointer={drag.pointerLocal} />}
      <button
        type="button"
        aria-label="批量连线"
        data-testid="add-output-handle"
        className="nodrag nopan"
        onPointerDown={onPointerDown}
        style={{
          position: 'absolute',
          left: geo.hitLeft,
          top: geo.hitTop,
          width: ADD_OUTPUT_HANDLE.hitWidth,
          height: ADD_OUTPUT_HANDLE.hitHeight,
          display: 'flex', alignItems: 'center',
          padding: 0, background: 'transparent', border: 'none',
          pointerEvents: 'auto', zIndex: 42, cursor: 'crosshair',
        }}
      >
        {/* 圆形指示器：圆心=框右缘外移 offset(12)；offset−半径=0 ⇒ 左缘贴框右缘（命中区只向框外展开） */}
        <span
          style={{
            position: 'absolute',
            left: ADD_OUTPUT_HANDLE.offset - ADD_OUTPUT_HANDLE.diameter / 2,
            top: (ADD_OUTPUT_HANDLE.hitHeight - ADD_OUTPUT_HANDLE.diameter) / 2,
            width: ADD_OUTPUT_HANDLE.diameter,
            height: ADD_OUTPUT_HANDLE.diameter,
            borderRadius: '50%',
            background: 'var(--canvas-controls-bg)',
            border: '0.5px solid var(--canvas-controls-border)',
            color: 'var(--fw-text-strong)',
            boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg
            width={ADD_OUTPUT_HANDLE.iconSize}
            height={ADD_OUTPUT_HANDLE.iconSize}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </span>
      </button>
    </>,
    portalRoot,
  );
}

export const AddOutputHandle = memo(AddOutputHandleComponent);
