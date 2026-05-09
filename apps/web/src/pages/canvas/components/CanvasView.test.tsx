import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CanvasView } from './CanvasView';
import { ReactFlowProvider } from '@xyflow/react';

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: vi.fn((selector?: any) => {
    const state = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      onNodesChange: vi.fn(),
      onEdgesChange: vi.fn(),
      onConnect: vi.fn(),
      updateViewport: vi.fn(),
      addNode: vi.fn(),
    };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
}));

describe('CanvasView', () => {
  it('should render ReactFlow container', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    expect(container.querySelector('.react-flow')).toBeInTheDocument();
  });

  it('should render without errors', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    expect(container).toBeTruthy();
  });
});
