import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';

const { mockUseViewport, mockUseInternalNode } = vi.hoisted(() => ({
  mockUseViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
  mockUseInternalNode: vi.fn(() => ({
    position: { x: 100, y: 200 },
    measured: { width: 300, height: 250 },
    internals: { positionAbsolute: { x: 100, y: 200 } },
  })),
}));

vi.mock('@xyflow/react', () => ({
  useViewport: mockUseViewport,
  useInternalNode: mockUseInternalNode,
}));

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: (selector: any) => selector({ annotationState: undefined }),
}));

import { AnnotationToolbar } from './AnnotationToolbar';

const defaultProps = {
  nodeId: 'node-anno',
  onToolChange: vi.fn(),
  onColorChange: vi.fn(),
  onLineWidthChange: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onSave: vi.fn(),
  onCancel: vi.fn(),
  isSaving: false,
};

function setupPortalTarget() {
  const el = document.createElement('div');
  el.id = 'node-toolbar-portal';
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  vi.clearAllMocks();
  mockUseViewport.mockReturnValue({ x: 0, y: 0, zoom: 1 });
  mockUseInternalNode.mockReturnValue({
    position: { x: 100, y: 200 },
    measured: { width: 300, height: 250 },
    internals: { positionAbsolute: { x: 100, y: 200 } },
  });
  document.getElementById('node-toolbar-portal')?.remove();
});

describe('AnnotationToolbar 定位', () => {
  it('常规定位：工具条在节点正上方', () => {
    setupPortalTarget();
    render(<AnnotationToolbar {...defaultProps} />);
    const toolbar = document.getElementById('node-toolbar-portal')!.querySelector('.nodrag') as HTMLElement;
    expect(toolbar.style.left).toBe('250px'); // (100 + 300/2) * 1 + 0
    expect(toolbar.style.top).toBe('136px');  // 200 - 48 - 16
  });

  it('父组坐标系：按 positionAbsolute 定位（打组后不错位）', () => {
    setupPortalTarget();
    mockUseInternalNode.mockReturnValue({
      position: { x: 30, y: 60 },
      measured: { width: 300, height: 250 },
      internals: { positionAbsolute: { x: 600, y: 400 } },
    });
    render(<AnnotationToolbar {...defaultProps} />);
    const toolbar = document.getElementById('node-toolbar-portal')!.querySelector('.nodrag') as HTMLElement;
    expect(toolbar.style.left).toBe('750px'); // (600 + 300/2) * 1 + 0
    expect(toolbar.style.top).toBe('336px');  // 400 - 48 - 16
  });
});
