import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VideoGenNode } from './VideoGenNode';
import { ReactFlowProvider } from '@xyflow/react';

describe('VideoGenNode', () => {
  const defaultProps = { id: 'v1', data: {}, selected: false } as any;

  const renderNode = (props = {}) =>
    render(
      <ReactFlowProvider>
        <VideoGenNode {...defaultProps} {...props} />
      </ReactFlowProvider>
    );

  it('should render node title', () => {
    renderNode();
    expect(screen.getByText(/视频生成节点/i)).toBeInTheDocument();
  });

  it('should render Phase 3 placeholder', () => {
    renderNode();
    expect(screen.getByText(/Phase 3/i)).toBeInTheDocument();
  });

  it('should have 2 handles', () => {
    const { container } = renderNode();
    const handles = container.querySelectorAll('.react-flow__handle');
    expect(handles.length).toBe(2);
  });

  it('should show purple border when selected', () => {
    const { container } = renderNode({ selected: true });
    const node = container.firstElementChild;
    expect(node?.className).toContain('border-[#c084fc]');
  });
});
