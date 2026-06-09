import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { mockUseViewport, mockUseInternalNode } = vi.hoisted(() => ({
  mockUseViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
  mockUseInternalNode: vi.fn(() => ({
    position: { x: 100, y: 200 },
    measured: { width: 300, height: 250 },
  })),
}));

vi.mock('@xyflow/react', () => ({
  useViewport: mockUseViewport,
  useInternalNode: mockUseInternalNode,
}));

afterEach(() => {
  vi.clearAllMocks();
  mockUseViewport.mockReturnValue({ x: 0, y: 0, zoom: 1 });
  mockUseInternalNode.mockReturnValue({
    position: { x: 100, y: 200 },
    measured: { width: 300, height: 250 },
  });
});

import { TransformToolbar } from './TransformToolbar';

const defaultProps = {
  nodeId: 'node-xform',
  rotation: 0 as 0 | 90 | 180 | 270,
  flipH: false,
  flipV: false,
  selected: true,
  isSaving: false,
  onRotate: vi.fn(),
  onFlipH: vi.fn(),
  onFlipV: vi.fn(),
  onSave: vi.fn(),
  onCancel: vi.fn(),
};

function setupPortalTarget() {
  const el = document.createElement('div');
  el.id = 'node-toolbar-portal';
  document.body.appendChild(el);
  return el;
}

function cleanupPortalTarget() {
  const el = document.getElementById('node-toolbar-portal');
  if (el) document.body.removeChild(el);
}

describe('TransformToolbar', () => {
  afterEach(() => {
    vi.clearAllMocks();
    cleanupPortalTarget();
  });

  it('renders nothing when not selected', () => {
    const { container } = render(<TransformToolbar {...defaultProps} selected={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders "旋转与镜像" cancel button', () => {
    setupPortalTarget();
    render(<TransformToolbar {...defaultProps} />);
    expect(screen.getByText('旋转与镜像')).toBeInTheDocument();
  });

  it('renders angle display "90°"', () => {
    setupPortalTarget();
    render(<TransformToolbar {...defaultProps} />);
    expect(screen.getByText('°')).toBeInTheDocument();
  });

  it('renders rotate 90° button', () => {
    setupPortalTarget();
    render(<TransformToolbar {...defaultProps} />);
    const rotateBtn = screen.getByLabelText('顺时针旋转90°');
    expect(rotateBtn).toBeInTheDocument();
  });

  it('renders horizontal mirror button', () => {
    setupPortalTarget();
    render(<TransformToolbar {...defaultProps} />);
    const mirrorHBtn = screen.getByLabelText('水平镜像');
    expect(mirrorHBtn).toBeInTheDocument();
  });

  it('renders vertical mirror button', () => {
    setupPortalTarget();
    render(<TransformToolbar {...defaultProps} />);
    const mirrorVBtn = screen.getByLabelText('垂直镜像');
    expect(mirrorVBtn).toBeInTheDocument();
  });

  it('renders save button', () => {
    setupPortalTarget();
    render(<TransformToolbar {...defaultProps} />);
    expect(screen.getByText('保存')).toBeInTheDocument();
  });

  it('calls onRotate when rotate button is clicked', () => {
    setupPortalTarget();
    const onRotate = vi.fn();
    render(<TransformToolbar {...defaultProps} onRotate={onRotate} />);
    fireEvent.click(screen.getByLabelText('顺时针旋转90°'));
    expect(onRotate).toHaveBeenCalledTimes(1);
  });

  it('calls onFlipH when horizontal mirror is clicked', () => {
    setupPortalTarget();
    const onFlipH = vi.fn();
    render(<TransformToolbar {...defaultProps} onFlipH={onFlipH} />);
    fireEvent.click(screen.getByLabelText('水平镜像'));
    expect(onFlipH).toHaveBeenCalledTimes(1);
  });

  it('calls onFlipV when vertical mirror is clicked', () => {
    setupPortalTarget();
    const onFlipV = vi.fn();
    render(<TransformToolbar {...defaultProps} onFlipV={onFlipV} />);
    fireEvent.click(screen.getByLabelText('垂直镜像'));
    expect(onFlipV).toHaveBeenCalledTimes(1);
  });

  it('calls onSave when save button is clicked', () => {
    setupPortalTarget();
    const onSave = vi.fn();
    render(<TransformToolbar {...defaultProps} onSave={onSave} />);
    fireEvent.click(screen.getByText('保存'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when "旋转与镜像" button is clicked', () => {
    setupPortalTarget();
    const onCancel = vi.fn();
    render(<TransformToolbar {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('旋转与镜像'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables save button when isSaving is true', () => {
    setupPortalTarget();
    render(<TransformToolbar {...defaultProps} isSaving={true} />);
    const saveBtn = screen.getByText('保存中...');
    expect(saveBtn).toBeDisabled();
  });

  it('renders via Portal with nodrag nopan classes', () => {
    setupPortalTarget();
    const { container } = render(<TransformToolbar {...defaultProps} />);
    expect(container.innerHTML).toBe('');
    const portalRoot = document.getElementById('node-toolbar-portal')!;
    const toolbar = portalRoot.querySelector('.nodrag') as HTMLElement;
    expect(toolbar).toBeTruthy();
    expect(toolbar.classList.contains('nodrag')).toBe(true);
    expect(toolbar.classList.contains('nopan')).toBe(true);
  });

  it('uses the same positioning constants as ImageNodeToolbar', () => {
    setupPortalTarget();
    render(<TransformToolbar {...defaultProps} />);
    const portalRoot = document.getElementById('node-toolbar-portal')!;
    const toolbar = portalRoot.querySelector('[style*="translateX(-50%)"]') as HTMLElement;
    expect(toolbar).toBeTruthy();
    expect(toolbar.style.transform).toContain('translateX(-50%)');
  });
});
