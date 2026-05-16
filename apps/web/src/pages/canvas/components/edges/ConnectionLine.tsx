import { useCallback } from 'react';
import { BaseEdge, getBezierPath, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';

export function ConnectionLine({
  id,
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

  const onDeleteEdge = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      useCanvasStore.getState().onEdgesChange([{ type: 'remove', id }]);
    },
    [id],
  );

  return (
    <>
      <BaseEdge
        path={edgePath}
        style={{
          ...style,
          stroke: selected ? '#f59e0b' : '#4ade80',
          strokeWidth: selected ? 3 : 2,
        }}
      />
      <EdgeLabelRenderer>
        <button
          onClick={onDeleteEdge}
          className="absolute text-[10px] bg-[#333] text-[#ccc] rounded-full w-5 h-5 flex items-center justify-center border border-[#555] cursor-pointer hover:bg-[#ef4444] hover:text-white hover:border-[#ef4444] transition-colors"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`, pointerEvents: 'all' }}
        >
          ×
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
