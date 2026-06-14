import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BaseEdge,
  getBezierPath,
  EdgeLabelRenderer,
  useStore,
  type EdgeProps,
} from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';
import { EdgeFlowParticles } from './EdgeFlowParticles';

export function ConnectionLine({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isActive = useStore((state) => {
    const sourceSelected = state.nodeInternals.get(source)?.selected ?? false;
    const targetSelected = state.nodeInternals.get(target)?.selected ?? false;
    return sourceSelected || targetSelected;
  });

  const [visible, setVisible] = useState(false);
  const [isFadeIn, setIsFadeIn] = useState(false);
  const unmountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (isActive) {
      setVisible(true);
      if (unmountTimerRef.current) {
        clearTimeout(unmountTimerRef.current);
        unmountTimerRef.current = null;
      }
      // Delay one frame before adding is-active class, so DOM mounts with opacity:0 first
      rafRef.current = requestAnimationFrame(() => {
        setIsFadeIn(true);
      });
    } else {
      setIsFadeIn(false);
      unmountTimerRef.current = setTimeout(() => setVisible(false), 300);
    }
    return () => {
      if (unmountTimerRef.current) {
        clearTimeout(unmountTimerRef.current);
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isActive]);

  const onDeleteEdge = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      useCanvasStore.getState().onEdgesChange([{ type: 'remove', id }]);
    },
    [id],
  );

  const containerClassName = `edge-flow-particles${isFadeIn ? ' is-active' : ''}`;

  return (
    <>
      <BaseEdge
        path={edgePath}
        style={{
          ...style,
          stroke: selected ? '#f59e0b' : '#888',
          strokeWidth: selected ? 3 : 2,
        }}
      />
      {isActive && !selected && (
        <path
          d={edgePath}
          fill="none"
          stroke="var(--edge-highlight-color)"
          strokeWidth={2}
          style={{ pointerEvents: 'none' }}
        />
      )}
      {visible && (
        <g className={containerClassName}>
          <EdgeFlowParticles pathD={edgePath} direction="outward" />
          <EdgeFlowParticles pathD={edgePath} direction="inward" />
        </g>
      )}
      {selected && (
        <EdgeLabelRenderer>
          <button
            onClick={onDeleteEdge}
            className="absolute text-[10px] bg-[#333] text-[#ccc] rounded-full w-5 h-5 flex items-center justify-center border border-[#555] cursor-pointer hover:bg-[#ef4444] hover:text-white hover:border-[#ef4444] transition-colors"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
          >
            ×
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
