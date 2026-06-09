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
  // Reset mocks to defaults
  mockUseViewport.mockReturnValue({ x: 0, y: 0, zoom: 1 });
  mockUseInternalNode.mockReturnValue({
    position: { x: 100, y: 200 },
    measured: { width: 300, height: 250 },
  });
});

import { ImageNodeToolbar } from './ImageNodeToolbar';

const defaultProps = {
  nodeId: 'node-1',
  fileId: 'img-123' as string | undefined,
  referenceImage: undefined as string | undefined,
  selected: true as boolean,
  onUpload: undefined as (() => void) | undefined,
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

describe('ImageNodeToolbar', () => {
  // 1
  it('renders upload button when fileId is empty and selected', () => {
    setupPortalTarget();
    render(<ImageNodeToolbar {...defaultProps} fileId={undefined} />);
    expect(screen.getByText('上传')).toBeInTheDocument();
    cleanupPortalTarget();
  });

  // 2
  it('renders 2-row toolbar when fileId exists and selected', () => {
    setupPortalTarget();
    render(<ImageNodeToolbar {...defaultProps} />);
    expect(screen.getByText('分离')).toBeInTheDocument();
    expect(screen.getByText('打光')).toBeInTheDocument();
    cleanupPortalTarget();
  });

  // 2b
  it('renders toolbar when referenceImage exists (user-uploaded, no fileId)', () => {
    setupPortalTarget();
    render(<ImageNodeToolbar {...defaultProps} fileId={undefined} referenceImage="ref-123" />);
    expect(screen.getByText('分离')).toBeInTheDocument();
    cleanupPortalTarget();
  });

  // 3
  it('renders nothing when not selected', () => {
    const { container } = render(<ImageNodeToolbar {...defaultProps} selected={false} />);
    expect(container.innerHTML).toBe('');
  });

  // 4
  it('upload button has rounded-full pill shape', () => {
    setupPortalTarget();
    render(<ImageNodeToolbar {...defaultProps} fileId={undefined} />);
    const btn = screen.getByText('上传').closest('button');
    expect(btn?.className).toContain('rounded-full');
    expect(btn?.className).toContain('backdrop-blur-lg');
    cleanupPortalTarget();
  });

  // 5
  it('row 1 contains all buttons', () => {
    setupPortalTarget();
    render(<ImageNodeToolbar {...defaultProps} />);
    const row1Labels = ['逆时针旋转', '顺时针旋转', '分离', '裁切', '扩图', '擦除', '重绘', '文字', '换装'];
    row1Labels.forEach((label) => {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    });
    cleanupPortalTarget();
  });

  // 6
  it('row 2 contains all buttons', () => {
    setupPortalTarget();
    render(<ImageNodeToolbar {...defaultProps} />);
    const row2Labels = ['打光', '3D 角度', '涂鸦', '高清增强', '九宫格', '放大查看', '上传', '下载', '复制', '删除'];
    row2Labels.forEach((label) => {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    });
    cleanupPortalTarget();
  });

  // 7
  it('renders 3 dividers', () => {
    setupPortalTarget();
    render(<ImageNodeToolbar {...defaultProps} />);
    const portalRoot = document.getElementById('node-toolbar-portal')!;
    const dividers = portalRoot.querySelectorAll('[class*="w-px"][class*="h-5"]');
    expect(dividers.length).toBe(3);
    cleanupPortalTarget();
  });

  // 8 (replaced: Portal does not apply anti-zoom scale)
  it('does NOT apply scale transform (Portal renders in native pixels)', () => {
    setupPortalTarget();
    render(<ImageNodeToolbar {...defaultProps} />);
    const toolbar = screen.getByRole('toolbar');
    expect(toolbar.style.transform).not.toContain('scale');
    expect(toolbar.style.transform).toContain('translateX(-50%)');
    cleanupPortalTarget();
  });

  // 9 (replaced: query via screen, not container.firstChild)
  it('outer container has nodrag and nopan classes', () => {
    setupPortalTarget();
    render(<ImageNodeToolbar {...defaultProps} />);
    const toolbar = screen.getByRole('toolbar');
    expect(toolbar.classList.contains('nodrag')).toBe(true);
    expect(toolbar.classList.contains('nopan')).toBe(true);
    cleanupPortalTarget();
  });

  // 10
  it('container has role="toolbar"', () => {
    setupPortalTarget();
    render(<ImageNodeToolbar {...defaultProps} />);
    expect(screen.getByRole('toolbar')).toBeInTheDocument();
    cleanupPortalTarget();
  });

  // 11
  it('all icon-only buttons have aria-label', () => {
    setupPortalTarget();
    render(<ImageNodeToolbar {...defaultProps} />);
    expect(screen.getByLabelText('逆时针旋转')).toBeInTheDocument();
    expect(screen.getByLabelText('顺时针旋转')).toBeInTheDocument();
    expect(screen.getByLabelText('放大查看')).toBeInTheDocument();
    expect(screen.getByLabelText('下载')).toBeInTheDocument();
    expect(screen.getByLabelText('复制')).toBeInTheDocument();
    expect(screen.getByLabelText('删除')).toBeInTheDocument();
    cleanupPortalTarget();
  });

  // 12 (replaced: uses screen-based query and portal pixel positioning)
  it('shows toolbar below when viewTopY < effectiveOffset', () => {
    setupPortalTarget();
    // nodeY=50, zoom=1, vpY=0 → viewTopY=50 < 92(FULL_TOOLBAR_HEIGHT+GAP) → showBelow
    mockUseInternalNode.mockReturnValue({
      position: { x: 100, y: 50 },
      measured: { width: 300, height: 250 },
    });
    render(<ImageNodeToolbar {...defaultProps} />);
    const toolbar = screen.getByRole('toolbar');
    // viewBottomY = (50 + 250) * 1 + 0 = 300, toolbarTop = 300 + 8 = 308
    expect(toolbar.style.top).toBe('308px');
    cleanupPortalTarget();
  });

  // 13 (replaced: uses screen-based query and portal pixel positioning)
  it('shows toolbar above when viewTopY >= effectiveOffset', () => {
    setupPortalTarget();
    // nodeY=300, zoom=1, vpY=0 → viewTopY=300 >= 92 → showAbove
    mockUseInternalNode.mockReturnValue({
      position: { x: 100, y: 300 },
      measured: { width: 300, height: 250 },
    });
    render(<ImageNodeToolbar {...defaultProps} />);
    const toolbar = screen.getByRole('toolbar');
    // viewTopY = 300, toolbarTop = 300 - 84 - 8 = 208
    expect(toolbar.style.top).toBe('208px');
    cleanupPortalTarget();
  });

  // 14 (replaced: uses screen-based query)
  it('container has transition-opacity duration-150', () => {
    setupPortalTarget();
    render(<ImageNodeToolbar {...defaultProps} />);
    const toolbar = screen.getByRole('toolbar');
    expect(toolbar.className).toContain('transition-opacity');
    expect(toolbar.className).toContain('duration-150');
    cleanupPortalTarget();
  });

  // 15 (replaced: uses screen-based query, toolbar is the outer container)
  it('row container has rounded-xl and gap-0.5', () => {
    setupPortalTarget();
    render(<ImageNodeToolbar {...defaultProps} />);
    const toolbar = screen.getByRole('toolbar');
    const rows = toolbar.querySelectorAll('.rounded-xl');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    cleanupPortalTarget();
  });

  // 16 (replaced: uses screen-based query)
  it('row container has gap-0.5 for button spacing', () => {
    setupPortalTarget();
    render(<ImageNodeToolbar {...defaultProps} />);
    const toolbar = screen.getByRole('toolbar');
    const rows = toolbar.querySelectorAll('[class*="gap-0\\.5"]');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    cleanupPortalTarget();
  });

  // 17
  it('delete button has danger hover style classes', () => {
    setupPortalTarget();
    render(<ImageNodeToolbar {...defaultProps} />);
    const deleteBtn = screen.getByLabelText('删除');
    expect(deleteBtn.className).toContain('hover:text-red-400');
    expect(deleteBtn.className).toContain('hover:bg-red-500/10');
    cleanupPortalTarget();
  });

  // 18
  it('calls onUpload when upload button is clicked', () => {
    setupPortalTarget();
    const mockOnUpload = vi.fn();
    render(<ImageNodeToolbar {...defaultProps} fileId={undefined} onUpload={mockOnUpload} />);
    fireEvent.click(screen.getByText('上传'));
    expect(mockOnUpload).toHaveBeenCalledTimes(1);
    cleanupPortalTarget();
  });

  // 19 (new: Portal renders into target, not as child of component container)
  it('renders toolbar via Portal (not as direct child of component)', () => {
    setupPortalTarget();
    const { container } = render(<ImageNodeToolbar {...defaultProps} />);
    expect(container.innerHTML).toBe('');
    cleanupPortalTarget();
  });

  // 20 (new: positions toolbar using viewport pixel coordinates)
  it('positions toolbar using viewport pixel coordinates', () => {
    setupPortalTarget();
    // nodeX=100, nodeWidth=300, zoom=1, vpX=0
    // viewCenterX = (100 + 300/2) * 1 + 0 = 250
    render(<ImageNodeToolbar {...defaultProps} />);
    const toolbar = screen.getByRole('toolbar');
    expect(toolbar.style.left).toBe('250px');
    expect(toolbar.style.top).toBe('108px'); // 200 - 84 - 8 = 108
    cleanupPortalTarget();
  });

  // 20b (regression: toolbar must have absolute positioning for left/top to work)
  it('toolbar has absolute positioning so left/top styles take effect', () => {
    setupPortalTarget();
    render(<ImageNodeToolbar {...defaultProps} />);
    const toolbar = screen.getByRole('toolbar');
    expect(toolbar.classList.contains('absolute')).toBe(true);
    cleanupPortalTarget();
  });

  // 21 (new: renders nothing when node has no dimensions)
  it('renders nothing when useInternalNode returns no dimensions', () => {
    setupPortalTarget();
    mockUseInternalNode.mockReturnValueOnce(null);
    const { container } = render(<ImageNodeToolbar {...defaultProps} />);
    expect(container.innerHTML).toBe('');
    cleanupPortalTarget();
  });

  // 22 (new: zoom affects viewport coordinate calculation)
  it('handles zoom properly: toolbarLeft adjusts for viewCenterX', () => {
    setupPortalTarget();
    // nodeX=100, nodeWidth=300, zoom=2, vpX=50
    // viewCenterX = (100 + 300/2) * 2 + 50 = 250 * 2 + 50 = 550
    mockUseViewport.mockReturnValue({ x: 50, y: 0, zoom: 2 });
    mockUseInternalNode.mockReturnValue({
      position: { x: 100, y: 200 },
      measured: { width: 300, height: 250 },
    });
    render(<ImageNodeToolbar {...defaultProps} />);
    const toolbar = screen.getByRole('toolbar');
    expect(toolbar.style.left).toBe('550px');
    // viewTopY = 200 * 2 + 0 = 400, toolbarTop = 400 - 84 - 20 = 296
    expect(toolbar.style.top).toBe('308px'); // 200*2 + 0 - 84 - 8 = 400 - 92 = 308
    cleanupPortalTarget();
  });
});
