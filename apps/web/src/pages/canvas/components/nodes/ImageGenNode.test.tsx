import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImageGenNode } from './ImageGenNode';
import { ReactFlowProvider } from '@xyflow/react';

let mockNodeData: any = {
  type: 'image', status: 'idle', style: '写实', model: 'SD XL', resolution: '1024×1024', count: 1, extraPrompt: '', resultUrl: undefined,
};

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: vi.fn((selector?: any) => {
    const state = {
      nodes: { 'img1': mockNodeData },
    };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
}));

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: vi.fn((selector?: any) => {
    const state = { selectedId: null, selectNode: vi.fn() };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
}));

describe('ImageGenNode', () => {
  const renderNode = (selected = false) =>
    render(
      <ReactFlowProvider>
        <ImageGenNode id="img1" data={{}} selected={selected} type="imageGen" draggable={true} dragging={false} selectable={true} deletable={true} zIndex={0} {...{} as any} />
      </ReactFlowProvider>
    );

  it('should render node title', () => {
    renderNode();
    expect(screen.getByText(/图片生成节点/i)).toBeInTheDocument();
  });

  it('should render preview area when no result', () => {
    renderNode();
    expect(screen.getByText(/图片预览区/i)).toBeInTheDocument();
  });

  it('should render loading state', () => {
    mockNodeData = { ...mockNodeData, status: 'loading' };
    renderNode();
    expect(screen.getByText(/生成中/i)).toBeInTheDocument();
  });

  it('should render result image when available', () => {
    mockNodeData = { ...mockNodeData, status: 'done', resultUrl: '/cat.jpg' };
    renderNode();
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', '/cat.jpg');
  });

  it('should have 2 handles (input + output)', () => {
    // Reset to default
    mockNodeData = { type: 'image', status: 'idle', style: '写实', model: 'SD XL', resolution: '1024×1024', count: 1, extraPrompt: '', resultUrl: undefined };
    const { container } = renderNode();
    expect(container.querySelectorAll('.react-flow__handle').length).toBe(2);
  });
});
