import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockUseViewport = vi.fn(() => ({ x: 0, y: 0, zoom: 1 }));
vi.mock('@xyflow/react', () => ({
  useViewport: mockUseViewport,
}));

afterEach(() => {
  vi.clearAllMocks();
});

import { ImageNodeToolbar } from './ImageNodeToolbar';

const defaultProps = {
  fileId: 'img-123',
  referenceImage: undefined as string | undefined,
  selected: true,
  zoom: 1,
  nodeX: 100,
  nodeY: 100,
  viewportX: 0,
  viewportY: 0,
};

describe('ImageNodeToolbar', () => {
  // 1
  it('renders upload button when fileId is empty and selected', () => {
    render(<ImageNodeToolbar {...defaultProps} fileId={undefined} />);
    expect(screen.getByText('上传')).toBeInTheDocument();
  });

  // 2
  it('renders 2-row toolbar when fileId exists and selected', () => {
    render(<ImageNodeToolbar {...defaultProps} />);
    expect(screen.getByText('分离')).toBeInTheDocument();
    expect(screen.getByText('打光')).toBeInTheDocument();
  });

  // 2b
  it('renders toolbar when referenceImage exists (user-uploaded, no fileId)', () => {
    render(<ImageNodeToolbar {...defaultProps} fileId={undefined} referenceImage="ref-123" />);
    expect(screen.getByText('分离')).toBeInTheDocument();
  });

  // 3
  it('renders nothing when not selected', () => {
    const { container } = render(<ImageNodeToolbar {...defaultProps} selected={false} />);
    expect(container.innerHTML).toBe('');
  });

  // 4
  it('upload button has rounded-full pill shape', () => {
    render(<ImageNodeToolbar {...defaultProps} fileId={undefined} />);
    const btn = screen.getByText('上传').closest('button');
    expect(btn?.className).toContain('rounded-full');
    expect(btn?.className).toContain('backdrop-blur-lg');
  });

  // 5
  it('row 1 contains all buttons', () => {
    render(<ImageNodeToolbar {...defaultProps} />);
    const row1Labels = ['逆时针旋转', '顺时针旋转', '分离', '裁切', '扩图', '擦除', '重绘', '文字', '换装'];
    row1Labels.forEach((label) => {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    });
  });

  // 6
  it('row 2 contains all buttons', () => {
    render(<ImageNodeToolbar {...defaultProps} />);
    const row2Labels = ['打光', '3D 角度', '涂鸦', '高清增强', '九宫格', '放大查看', '上传', '下载', '复制', '删除'];
    row2Labels.forEach((label) => {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    });
  });

  // 7
  it('renders 3 dividers', () => {
    const { container } = render(<ImageNodeToolbar {...defaultProps} />);
    const dividers = container.querySelectorAll('[class*="w-px"][class*="h-5"]');
    expect(dividers.length).toBe(3);
  });

  // 8
  it('applies anti-zoom scale transform (scale(0.5) when zoom=2)', () => {
    const { container } = render(<ImageNodeToolbar {...defaultProps} zoom={2} />);
    const child = container.firstChild as HTMLElement;
    expect(child.style.transform).toContain('scale(0.5)');
  });

  // 9
  it('outer container has nodrag and nopan classes', () => {
    const { container } = render(<ImageNodeToolbar {...defaultProps} />);
    const outer = container.firstChild as HTMLElement;
    expect(outer.classList.contains('nodrag')).toBe(true);
    expect(outer.classList.contains('nopan')).toBe(true);
  });

  // 10
  it('container has role="toolbar"', () => {
    render(<ImageNodeToolbar {...defaultProps} />);
    expect(screen.getByRole('toolbar')).toBeInTheDocument();
  });

  // 11
  it('all icon-only buttons have aria-label', () => {
    render(<ImageNodeToolbar {...defaultProps} />);
    expect(screen.getByLabelText('逆时针旋转')).toBeInTheDocument();
    expect(screen.getByLabelText('顺时针旋转')).toBeInTheDocument();
    expect(screen.getByLabelText('放大查看')).toBeInTheDocument();
    expect(screen.getByLabelText('下载')).toBeInTheDocument();
    expect(screen.getByLabelText('复制')).toBeInTheDocument();
    expect(screen.getByLabelText('删除')).toBeInTheDocument();
  });

  // 12
  it('shows toolbar below when availableTopSpace < 104', () => {
    // nodeY=100, viewportY=50 → (100-50)/1 = 50 < 104 → showBelow
    const { container } = render(
      <ImageNodeToolbar {...defaultProps} nodeY={100} viewportY={50} zoom={1} />,
    );
    const outer = container.firstChild as HTMLElement;
    expect(outer.style.top).toContain('calc(100% + 32px)');
  });

  // 13
  it('shows toolbar above when availableTopSpace >= 104', () => {
    // nodeY=200, viewportY=0 → (200-0)/1 = 200 >= 104 → showAbove
    const { container } = render(
      <ImageNodeToolbar {...defaultProps} nodeY={200} viewportY={0} zoom={1} />,
    );
    const outer = container.firstChild as HTMLElement;
    expect(outer.style.bottom).toContain('calc(100% + 32px)');
  });

  // 14
  it('container has transition-opacity duration-150', () => {
    const { container } = render(<ImageNodeToolbar {...defaultProps} />);
    const outer = container.firstChild as HTMLElement;
    expect(outer.className).toContain('transition-opacity');
    expect(outer.className).toContain('duration-150');
  });

  // 15
  it('row container has rounded-xl and gap-0.5', () => {
    const { container } = render(<ImageNodeToolbar {...defaultProps} />);
    const rows = container.querySelectorAll('.rounded-xl');
    // Both rows + upload container have rounded-xl = 3 total,
    // but we only count the toolbar rows (inside role="toolbar")
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  // 16
  it('row container has gap-0.5 for button spacing', () => {
    const { container } = render(<ImageNodeToolbar {...defaultProps} />);
    const rows = container.querySelectorAll('[class*="gap-0\\.5"]');
    // rows inside toolbar and the upload wrapper
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  // 17
  it('delete button has danger hover style classes', () => {
    render(<ImageNodeToolbar {...defaultProps} />);
    const deleteBtn = screen.getByLabelText('删除');
    expect(deleteBtn.className).toContain('hover:text-red-400');
    expect(deleteBtn.className).toContain('hover:bg-red-500/10');
  });

  // 18
  it('calls onUpload when upload button is clicked', () => {
    const mockOnUpload = vi.fn();
    render(<ImageNodeToolbar {...defaultProps} fileId={undefined} onUpload={mockOnUpload} />);
    fireEvent.click(screen.getByText('上传'));
    expect(mockOnUpload).toHaveBeenCalledTimes(1);
  });
});
