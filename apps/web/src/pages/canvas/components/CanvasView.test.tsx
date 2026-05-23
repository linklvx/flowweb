import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { CanvasView } from './CanvasView';
import { ReactFlowProvider } from '@xyflow/react';

const mockZoomIn = vi.fn();
const mockZoomOut = vi.fn();
const mockFitView = vi.fn();

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual('@xyflow/react');
  return {
    ...actual,
    useReactFlow: () => ({
      ...(actual as any).useReactFlow?.(),
      zoomIn: mockZoomIn,
      zoomOut: mockZoomOut,
      fitView: mockFitView,
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

  it('should use fitView from React Flow on fit view click', () => {
    render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const fitBtn = document.querySelector('[aria-label="整理画布"]');
    fireEvent.click(fitBtn!);
    expect(mockFitView).toHaveBeenCalled();
  });

  it('should render MiniMap with visible dark theme when toggled', () => {
    render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    // Initially MiniMap should not be present
    expect(document.querySelector('.react-flow__minimap')).toBeNull();
    // Click minimap toggle
    fireEvent.click(document.querySelector('[aria-label="切换小地图"]')!);
    // MiniMap should be rendered with lighter background
    const minimap = document.querySelector('.react-flow__minimap')!;
    expect(minimap).toBeInTheDocument();
    const styleAttr = minimap.getAttribute('style') || '';
    expect(styleAttr).toContain('background');
    // Background should be lighter than the old rgb(28,28,28) — use rgb(50,50,50)
    expect(styleAttr).toContain('rgb(50, 50, 50)');
  });

  it('should enable snap to grid when snap button toggled', () => {
    render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    // Click snap toggle
    fireEvent.click(document.querySelector('[aria-label="网格吸附"]')!);
    // Verify the snap button reflects enabled state
    expect(document.querySelector('[aria-label="网格吸附"]')!.getAttribute('aria-pressed')).toBe('true');
  });
});
