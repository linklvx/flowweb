import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VideoGenNode } from './VideoGenNode';
import { ReactFlowProvider } from '@xyflow/react';

let mockNodeData: any = { type: 'video', videoUrl: undefined, status: 'idle' };

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: vi.fn((selector?: any) => {
    const state = {
      nodes: { 'v1': mockNodeData },
    };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
}));

vi.mock('./VideoConfigPanel', () => ({
  VideoConfigPanel: () => <div>config panel</div>,
}));

describe('VideoGenNode', () => {
  const renderNode = (selected = false) =>
    render(<ReactFlowProvider><VideoGenNode id="v1" data={{}} selected={selected} /></ReactFlowProvider>);

  it('should render node title', () => {
    renderNode();
    expect(screen.getByText(/视频生成节点/i)).toBeInTheDocument();
  });

  it('should render preview placeholder when no video', () => {
    renderNode();
    expect(screen.getByText(/视频预览区/i)).toBeInTheDocument();
  });

  it('should render video element when videoUrl exists', () => {
    mockNodeData = { type: 'video', videoUrl: '/test.mp4', status: 'done' };
    renderNode();
    const sourceEl = document.querySelector('source');
    expect(sourceEl).toBeTruthy();
  });

  it('should have 2 handles', () => {
    mockNodeData = { type: 'video', videoUrl: undefined, status: 'idle' };
    const { container } = renderNode();
    expect(container.querySelectorAll('.react-flow__handle').length).toBe(2);
  });

  it('should show config panel when selected', () => {
    renderNode(true);
    expect(screen.getByText('config panel')).toBeInTheDocument();
  });
});
