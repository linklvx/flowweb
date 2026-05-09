import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CanvasPage } from './page';

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: Object.assign(
    vi.fn((selector?: any) => {
      const state = {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        selectedId: null,
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
    {
      subscribe: vi.fn(() => vi.fn()),
      getState: vi.fn(() => ({
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        updateViewport: vi.fn(),
        onNodesChange: vi.fn(),
        onEdgesChange: vi.fn(),
      })),
      setState: vi.fn(),
    }
  ),
}));

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: Object.assign(
    vi.fn((selector?: any) => {
      const state = { nodes: {} };
      if (typeof selector === 'function') return selector(state);
      return state;
    }),
    {
      subscribe: vi.fn(() => vi.fn()),
      setState: vi.fn(),
    }
  ),
}));

vi.mock('react-router', () => ({
  useParams: () => ({}),
}));

describe('CanvasPage', () => {
  it('should render NodePalette items', () => {
    render(<CanvasPage />);
    expect(screen.getByText('文本输入')).toBeInTheDocument();
    expect(screen.getByText('图片生成')).toBeInTheDocument();
    expect(screen.getByText('视频生成')).toBeInTheDocument();
  });

  it('should render ReactFlow canvas', () => {
    const { container } = render(<CanvasPage />);
    expect(container.querySelector('.react-flow')).toBeInTheDocument();
  });
});
