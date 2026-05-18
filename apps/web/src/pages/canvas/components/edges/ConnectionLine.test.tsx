import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ConnectionLine } from './ConnectionLine';
import { ReactFlowProvider } from '@xyflow/react';

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: {
    getState: () => ({
      onEdgesChange: vi.fn(),
    }),
  },
}));

const defaultProps = {
  id: 'e1',
  sourceX: 0,
  sourceY: 100,
  targetX: 200,
  targetY: 100,
  sourcePosition: 'right' as const,
  targetPosition: 'left' as const,
  selected: false,
};

describe('ConnectionLine', () => {
  it('should render edge path', () => {
    const { container } = render(
      <ReactFlowProvider>
        <svg>
          <ConnectionLine {...defaultProps} />
        </svg>
      </ReactFlowProvider>
    );
    expect(container.querySelector('path')).toBeInTheDocument();
  });

  it('should render without crash when selected', () => {
    const { container } = render(
      <ReactFlowProvider>
        <svg>
          <ConnectionLine {...defaultProps} selected={true} />
        </svg>
      </ReactFlowProvider>
    );
    expect(container.querySelector('path')).toBeInTheDocument();
  });

  it('should have amber stroke when selected', () => {
    const { container } = render(
      <ReactFlowProvider>
        <svg>
          <ConnectionLine {...defaultProps} selected={true} />
        </svg>
      </ReactFlowProvider>
    );
    const path = container.querySelector('path')!;
    expect(path.getAttribute('style')).toContain('#f59e0b');
  });

  it('should have gray stroke when not selected', () => {
    const { container } = render(
      <ReactFlowProvider>
        <svg>
          <ConnectionLine {...defaultProps} selected={false} />
        </svg>
      </ReactFlowProvider>
    );
    const path = container.querySelector('path')!;
    expect(path.getAttribute('style')).toContain('#888');
  });
});
