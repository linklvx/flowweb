import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

import { EditToolbar } from './EditToolbar';

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

describe('EditToolbar', () => {
  const baseProps = {
    nodeId: 'n1',
    editMode: 'crop' as const,
    isSaving: false,
    errorMessage: null as string | null,
    onSave: vi.fn(),
    onCancel: vi.fn(),
    onUndo: vi.fn(),
    onClear: vi.fn(),
    onGenerate: vi.fn(),
    onSaveAsVariant: vi.fn(),
  };

  afterEach(() => {
    vi.clearAllMocks();
    cleanupPortalTarget();
  });

  // ── crop mode buttons ──

  it('renders "退出" and "保存" buttons in crop mode', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} />);
    expect(screen.getByText('退出')).toBeInTheDocument();
    expect(screen.getByText('保存')).toBeInTheDocument();
  });

  it('renders "保存为新变体" button in crop mode', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} />);
    expect(screen.getByText('保存为新变体')).toBeInTheDocument();
  });

  it('does not render undo/clear/generate buttons in crop mode', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} />);
    expect(screen.queryByText('撤销')).not.toBeInTheDocument();
    expect(screen.queryByText('清除')).not.toBeInTheDocument();
    expect(screen.queryByText('生成')).not.toBeInTheDocument();
  });

  // ── outpaint mode buttons ──

  it('renders reset button, PRO placeholder, ratio dropdown, and generate in outpaint mode', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="outpaint" outpaintRect={{ x: -51, y: -51, width: 614, height: 614 }} imageW={512} imageH={512} onOutpaintRatioChange={vi.fn()} />);
    // Should NOT render text-based 退出/保存为新变体
    expect(screen.queryByText('退出')).not.toBeInTheDocument();
    expect(screen.queryByText('保存为新变体')).not.toBeInTheDocument();
    // Should have reset (crossed arrows) button
    expect(screen.getByLabelText('重置扩图')).toBeInTheDocument();
    // Should have PRO disabled placeholder
    expect(screen.getByText('PRO')).toBeInTheDocument();
    // Should have ratio dropdown button showing current ratio
    expect(screen.getByText('1.2x')).toBeInTheDocument();
  });

  it('does not render undo/clear/save buttons in outpaint mode', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="outpaint" outpaintRect={{ x: -51, y: -51, width: 614, height: 614 }} imageW={512} imageH={512} />);
    expect(screen.queryByText('撤销')).not.toBeInTheDocument();
    expect(screen.queryByText('清除')).not.toBeInTheDocument();
    expect(screen.queryByText('保存')).not.toBeInTheDocument();
  });

  // ── erase mode buttons ──

  it('renders mode label "退出", brush/rect/eraser tools, slider, undo, and redo in erase mode', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="erase" />);
    // Mode label shows "退出"
    expect(screen.getByText('退出')).toBeInTheDocument();
    // Tool buttons with aria-labels
    expect(screen.getByLabelText('画笔工具')).toBeInTheDocument();
    expect(screen.getByLabelText('矩形工具')).toBeInTheDocument();
    expect(screen.getByLabelText('橡皮擦工具')).toBeInTheDocument();
    // Removed: lasso and fill tools
    expect(screen.queryByLabelText('套索工具')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('填充工具')).not.toBeInTheDocument();
    // Brush size slider
    expect(screen.getByLabelText('画笔大小')).toBeInTheDocument();
    // Undo icon button
    expect(screen.getByLabelText('撤销')).toBeInTheDocument();
    // Redo icon button (disabled, no handler)
    expect(screen.getByLabelText('重做')).toBeInTheDocument();
    expect(screen.getByLabelText('重做')).toBeDisabled();
    // Generate and save-as-variant are NOT in the top paint toolbar
    expect(screen.queryByText('生成')).not.toBeInTheDocument();
    expect(screen.queryByText('保存为新变体')).not.toBeInTheDocument();
    // Should not have crop-specific save button
    expect(screen.queryByText('保存')).not.toBeInTheDocument();
  });

  it('does not render save button in erase mode', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="erase" />);
    expect(screen.queryByText('保存')).not.toBeInTheDocument();
  });

  // ── redraw mode buttons ──

  it('renders mode label "退出", undo, and redo in redraw mode', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="redraw" />);
    // Mode label shows "退出"
    expect(screen.getByText('退出')).toBeInTheDocument();
    // Undo icon button
    expect(screen.getByLabelText('撤销')).toBeInTheDocument();
    // Redo icon button
    expect(screen.getByLabelText('重做')).toBeInTheDocument();
    // Generate and save-as-variant are NOT in the top paint toolbar
    expect(screen.queryByText('生成')).not.toBeInTheDocument();
    expect(screen.queryByText('保存为新变体')).not.toBeInTheDocument();
    // Should not have crop-specific save button
    expect(screen.queryByText('保存')).not.toBeInTheDocument();
  });

  // ── isSaving disabled state ──

  it('shows "保存中..." and disables save button when isSaving in crop mode', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} isSaving={true} />);
    const saveBtn = screen.getByText('保存中...');
    expect(saveBtn).toBeInTheDocument();
    expect(saveBtn).toBeDisabled();
  });

  it('disables generate button when isSaving in outpaint mode', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="outpaint" isSaving={true} outpaintRect={{ x: -51, y: -51, width: 614, height: 614 }} imageW={512} imageH={512} />);
    const genBtn = document.querySelector('[data-testid="outpaint-generate"]') as HTMLButtonElement;
    expect(genBtn).toBeTruthy();
    expect(genBtn.disabled).toBe(true);
  });

  it('disables exit button when isSaving', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} isSaving={true} />);
    expect(screen.getByText('退出').closest('button')).toBeDisabled();
  });

  it('disables undo button when isSaving in erase mode', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="erase" isSaving={true} />);
    expect(screen.getByLabelText('撤销')).toBeDisabled();
  });

  it('disables save-as-variant button when isSaving', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} isSaving={true} />);
    expect(screen.getByText('保存为新变体').closest('button')).toBeDisabled();
  });

  it('does not call onSave when isSaving and save button clicked', () => {
    setupPortalTarget();
    const onSave = vi.fn();
    render(<EditToolbar {...baseProps} isSaving={true} onSave={onSave} />);
    fireEvent.click(screen.getByText('保存中...'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not call onGenerate when isSaving and generate button clicked', () => {
    setupPortalTarget();
    const onGenerate = vi.fn();
    render(<EditToolbar {...baseProps} editMode="outpaint" isSaving={true} onGenerate={onGenerate} outpaintRect={{ x: -51, y: -51, width: 614, height: 614 }} imageW={512} imageH={512} />);
    const genBtn = document.querySelector('[data-testid="outpaint-generate"]') as HTMLButtonElement;
    fireEvent.click(genBtn);
    expect(onGenerate).not.toHaveBeenCalled();
  });

  // ── errorMessage ──

  it('renders error message when errorMessage prop is provided', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} errorMessage="网络错误" />);
    expect(screen.getByText('网络错误')).toBeInTheDocument();
  });

  it('does not render error message when errorMessage is null', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} />);
    const portalRoot = document.getElementById('node-toolbar-portal')!;
    expect(portalRoot.textContent).not.toContain('网络错误');
  });

  // ── callbacks ──

  it('calls onCancel when "退出" button is clicked', () => {
    setupPortalTarget();
    const onCancel = vi.fn();
    render(<EditToolbar {...baseProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('退出'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when exit button is clicked in erase mode', () => {
    setupPortalTarget();
    const onCancel = vi.fn();
    render(<EditToolbar {...baseProps} editMode="erase" onCancel={onCancel} />);
    fireEvent.click(screen.getByText('退出'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onSave when save button is clicked in crop mode', () => {
    setupPortalTarget();
    const onSave = vi.fn();
    render(<EditToolbar {...baseProps} onSave={onSave} />);
    fireEvent.click(screen.getByText('保存'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('calls onGenerate when generate button is clicked in outpaint mode', () => {
    setupPortalTarget();
    const onGenerate = vi.fn();
    render(<EditToolbar {...baseProps} editMode="outpaint" onGenerate={onGenerate} outpaintRect={{ x: -51, y: -51, width: 614, height: 614 }} imageW={512} imageH={512} />);
    const genBtn = document.querySelector('[data-testid="outpaint-generate"]') as HTMLButtonElement;
    fireEvent.click(genBtn);
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it('calls onUndo when undo button is clicked in erase mode', () => {
    setupPortalTarget();
    const onUndo = vi.fn();
    render(<EditToolbar {...baseProps} editMode="erase" onUndo={onUndo} />);
    fireEvent.click(screen.getByLabelText('撤销'));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('does not render "清除" button in erase mode (replaced by redo icon)', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="erase" />);
    expect(screen.queryByText('清除')).not.toBeInTheDocument();
  });

  it('calls onSaveAsVariant when save-as-variant button is clicked', () => {
    setupPortalTarget();
    const onSaveAsVariant = vi.fn();
    render(<EditToolbar {...baseProps} onSaveAsVariant={onSaveAsVariant} />);
    fireEvent.click(screen.getByText('保存为新变体'));
    expect(onSaveAsVariant).toHaveBeenCalledTimes(1);
  });

  // ── portal rendering ──

  it('renders via Portal with nodrag nopan classes', () => {
    setupPortalTarget();
    const { container } = render(<EditToolbar {...baseProps} />);
    expect(container.innerHTML).toBe('');
    const portalRoot = document.getElementById('node-toolbar-portal')!;
    const toolbar = portalRoot.querySelector('.nodrag') as HTMLElement;
    expect(toolbar).toBeTruthy();
    expect(toolbar.classList.contains('nodrag')).toBe(true);
    expect(toolbar.classList.contains('nopan')).toBe(true);
  });

  // ── Outpaint mode extensions ──

  it('renders ratio dropdown showing current ratio when outpaintRect is provided', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="outpaint" outpaintRect={{ x: -51, y: -51, width: 614, height: 614 }} imageW={512} imageH={512} onOutpaintRatioChange={vi.fn()} />);
    // Single ratio dropdown (not three inline buttons)
    expect(screen.getByText('1.2x')).toBeInTheDocument();
    expect(screen.queryByText('1.5x')).not.toBeInTheDocument();
    expect(screen.queryByText('2.0x')).not.toBeInTheDocument();
  });

  it('does not render ratio dropdown in non-outpaint mode', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="crop" />);
    expect(screen.queryByText('1.2x')).not.toBeInTheDocument();
  });

  it('cycles ratio when ratio dropdown clicked', () => {
    setupPortalTarget();
    const onChange = vi.fn();
    render(<EditToolbar {...baseProps} editMode="outpaint" outpaintRect={{ x: 0, y: 0, width: 512, height: 512 }} imageW={512} imageH={512} onOutpaintRatioChange={onChange} />);
    const ratioBtn = screen.getByText('1.2x').closest('button')!;
    // First click: 1.2x → 1.5x
    fireEvent.click(ratioBtn);
    expect(onChange).toHaveBeenCalledWith({ x: -128, y: -128, width: 768, height: 768 });
  });

  it('shows credit count with lightning icon in outpaint mode', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="outpaint" outpaintRect={{ x: -51, y: -51, width: 614, height: 614 }} imageW={512} imageH={512} />);
    // Should show credit count (not old "↓ N" format)
    const creditSpan = document.querySelector('[data-testid="outpaint-credits"]');
    expect(creditSpan).toBeTruthy();
    expect(creditSpan!.textContent).toContain('2');
  });

  it('positions toolbar below selection frame in outpaint mode when frameVpBottom is provided', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="outpaint" outpaintRect={{ x: 0, y: 0, width: 512, height: 512 }} imageW={512} imageH={512} frameVpBottom={400} frameVpCenterX={300} />);
    const portalRoot = document.getElementById('node-toolbar-portal')!;
    const toolbar = portalRoot.querySelector('.nodrag') as HTMLElement;
    const top = parseFloat(toolbar.style.top);
    // Below frame: frameVpBottom + GAP = 400 + 16 = 416
    expect(top).toBe(416);
  });

  // ── PaintToolbar dimensions ──

  describe('PaintToolbar dimensions', () => {
    it('uses h-7 and w-7 for tool buttons instead of h-8 w-8', () => {
      setupPortalTarget();
      render(<EditToolbar {...baseProps} editMode="erase" />);
      const brushBtn = screen.getByLabelText('画笔工具');
      expect(brushBtn.className).toContain('h-7');
      expect(brushBtn.className).toContain('w-7');
      expect(brushBtn.className).not.toContain('h-8');
      expect(brushBtn.className).not.toContain('w-8');
    });

    it('uses h-7 for exit button instead of h-8', () => {
      setupPortalTarget();
      render(<EditToolbar {...baseProps} editMode="erase" />);
      const exitBtn = screen.getByText('退出').closest('button')!;
      expect(exitBtn.className).toContain('h-7');
      expect(exitBtn.className).not.toContain('h-8');
    });

    it('uses p-1.5 container padding instead of p-2', () => {
      setupPortalTarget();
      render(<EditToolbar {...baseProps} editMode="erase" />);
      const portalRoot = document.getElementById('node-toolbar-portal')!;
      const paintBar = portalRoot.querySelector('.rounded-xl') as HTMLElement;
      expect(paintBar.className).toMatch(/\bp-1\.5\b/);
      expect(paintBar.className).not.toMatch(/\bp-2\b/);
    });

    it('uses 20px divider height instead of 24px', () => {
      setupPortalTarget();
      render(<EditToolbar {...baseProps} editMode="erase" />);
      const portalRoot = document.getElementById('node-toolbar-portal')!;
      const dividers = portalRoot.querySelectorAll('[style*="height"]');
      const divider = Array.from(dividers).find((d) => (d as HTMLElement).style.height === '20px') as HTMLElement | undefined;
      expect(divider).toBeTruthy();
    });

    it('uses 20px icon size via h-5 w-5', () => {
      setupPortalTarget();
      render(<EditToolbar {...baseProps} editMode="erase" />);
      const brushBtn = screen.getByLabelText('画笔工具');
      const svg = brushBtn.querySelector('svg')!;
      const svgClass = svg.getAttribute('class') || '';
      expect(svgClass).toContain('h-5');
      expect(svgClass).toContain('w-5');
    });
  });

  describe('PaintToolbar tooltips', () => {
    const tooltipLabels = ['关闭并退出', '画笔', '矩形', '橡皮擦', '撤销', '重做'];

    it('renders a tooltip wrapper for each tool button', () => {
      setupPortalTarget();
      render(<EditToolbar {...baseProps} editMode="erase" />);
      const portalRoot = document.getElementById('node-toolbar-portal')!;
      const tooltips = portalRoot.querySelectorAll('[data-tooltip]');
      expect(tooltips.length).toBe(6);
    });

    it('each tooltip has correct label text', () => {
      setupPortalTarget();
      render(<EditToolbar {...baseProps} editMode="erase" />);
      const portalRoot = document.getElementById('node-toolbar-portal')!;
      for (const label of tooltipLabels) {
        const el = portalRoot.querySelector(`[data-tooltip="${label}"]`);
        expect(el).toBeTruthy();
      }
    });
  });
});
