import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { CanvasView } from './CanvasView';
import { ReactFlowProvider } from '@xyflow/react';

const mockZoomIn = vi.fn();
const mockZoomOut = vi.fn();

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual('@xyflow/react');
  return {
    ...actual,
    useReactFlow: () => ({
      ...(actual as any).useReactFlow?.(),
      zoomIn: mockZoomIn,
      zoomOut: mockZoomOut,
      screenToFlowPosition: (p: { x: number; y: number }) => p,
    }),
  };
});

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
      selectNode: vi.fn(),
    };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
}));

describe('CanvasView', () => {
  beforeEach(() => {
    mockZoomIn.mockClear();
    mockZoomOut.mockClear();
  });

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

  it('should zoom in on Ctrl+wheel up (deltaY < 0)', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const wrapper = container.firstElementChild!;
    fireEvent.wheel(wrapper, { deltaY: -100, ctrlKey: true });
    expect(mockZoomIn).toHaveBeenCalled();
  });

  it('should zoom out on Ctrl+wheel down (deltaY > 0)', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const wrapper = container.firstElementChild!;
    fireEvent.wheel(wrapper, { deltaY: 100, ctrlKey: true });
    expect(mockZoomOut).toHaveBeenCalled();
  });

  it('should zoom on Cmd+wheel (Mac compatibility)', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const wrapper = container.firstElementChild!;
    fireEvent.wheel(wrapper, { deltaY: -100, metaKey: true });
    expect(mockZoomIn).toHaveBeenCalled();
  });

  it('should NOT zoom on regular wheel without modifier', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const wrapper = container.firstElementChild!;
    fireEvent.wheel(wrapper, { deltaY: -100 });
    expect(mockZoomIn).not.toHaveBeenCalled();
    expect(mockZoomOut).not.toHaveBeenCalled();
  });
});
