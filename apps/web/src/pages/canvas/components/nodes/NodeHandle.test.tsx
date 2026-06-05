import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { NodeHandle } from './NodeHandle';

describe('NodeHandle', () => {
  const renderHandle = (type: 'source' | 'target') =>
    render(
      <ReactFlowProvider>
        <NodeHandle type={type} testId={`${type}-handle`} />
      </ReactFlowProvider>
    );

  it('should render a source handle with SVG circle-plus icon', () => {
    const { container } = renderHandle('source');
    const handle = container.querySelector('.react-flow__handle');
    expect(handle).not.toBeNull();
    expect(handle?.getAttribute('data-testid')).toBe('source-handle');
    expect(handle?.getAttribute('data-handlepos')).toBe('right');
    // SVG icon
    const svg = handle?.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.classList.contains('handle-icon')).toBe(true);
    expect(svg?.classList.contains('handle-icon-source')).toBe(true);
    // SVG contains circle + plus path
    expect(svg?.querySelector('circle')).not.toBeNull();
    expect(svg?.querySelector('path')).not.toBeNull();
    // Hit area
    expect(handle?.querySelector('.handle-hit-area')).not.toBeNull();
  });

  it('should render a target handle with SVG circle-plus icon', () => {
    const { container } = renderHandle('target');
    const handle = container.querySelector('.react-flow__handle');
    expect(handle).not.toBeNull();
    expect(handle?.getAttribute('data-testid')).toBe('target-handle');
    expect(handle?.getAttribute('data-handlepos')).toBe('left');
    // SVG icon
    const svg = handle?.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.classList.contains('handle-icon')).toBe(true);
    expect(svg?.classList.contains('handle-icon-target')).toBe(true);
    // Hit area
    expect(handle?.querySelector('.handle-hit-area')).not.toBeNull();
  });

  it('should set type attribute correctly', () => {
    const { container: c1 } = renderHandle('source');
    expect(c1.querySelector('.react-flow__handle')?.getAttribute('data-handlepos')).toBe('right');

    const { container: c2 } = renderHandle('target');
    expect(c2.querySelector('.react-flow__handle')?.getAttribute('data-handlepos')).toBe('left');
  });
});
