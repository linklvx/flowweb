import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

export function ConnectionLine({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <BaseEdge
      path={edgePath}
      style={{
        ...style,
        stroke: '#4ade80',
        strokeWidth: 2.5,
      }}
    />
  );
}
