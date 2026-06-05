import { Handle, Position } from '@xyflow/react';
import './NodeHandle.css';

interface NodeHandleProps {
  type: 'source' | 'target';
  testId?: string;
}

export function NodeHandle({ type, testId }: NodeHandleProps) {
  const position = type === 'target' ? Position.Left : Position.Right;

  return (
    <Handle type={type} position={position} data-testid={testId}>
      <div className="handle-hit-area" />
      <svg
        className={`handle-icon handle-icon-${type}`}
        viewBox="0 0 20 20"
        fill="none"
      >
        <circle
          cx="10" cy="10" r="9"
          stroke="var(--canvas-handle-bg)"
          strokeWidth="2"
          fill="transparent"
        />
        <path
          d="M10 6V14M6 10H14"
          stroke="var(--canvas-handle-icon)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </Handle>
  );
}
