import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NodePalette } from './NodePalette';
import { ReactFlowProvider } from '@xyflow/react';

describe('NodePalette', () => {
  const renderPalette = () =>
    render(
      <ReactFlowProvider>
        <NodePalette />
      </ReactFlowProvider>
    );

  it('should render three node types', () => {
    renderPalette();
    expect(screen.getByText('文本输入')).toBeInTheDocument();
    expect(screen.getByText('图片生成')).toBeInTheDocument();
    expect(screen.getByText('视频生成')).toBeInTheDocument();
  });

  it('should render draggable items', () => {
    renderPalette();
    const items = screen.getAllByText(/输入|生成/);
    items.forEach((item) => {
      // Each label is inside a draggable div
      const parent = item.closest('[draggable]');
      expect(parent).toBeTruthy();
    });
  });

  it('should render panel title', () => {
    renderPalette();
    expect(screen.getByText('节点面板')).toBeInTheDocument();
  });
});
