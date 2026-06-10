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

  it('renders "退出", "生成", and "保存为新变体" in outpaint mode', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="outpaint" />);
    expect(screen.getByText('退出')).toBeInTheDocument();
    expect(screen.getByText('生成')).toBeInTheDocument();
    expect(screen.getByText('保存为新变体')).toBeInTheDocument();
  });

  it('does not render undo/clear/save buttons in outpaint mode', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="outpaint" />);
    expect(screen.queryByText('撤销')).not.toBeInTheDocument();
    expect(screen.queryByText('清除')).not.toBeInTheDocument();
    expect(screen.queryByText('保存')).not.toBeInTheDocument();
  });

  // ── erase mode buttons ──

  it('renders undo, clear, generate, and save-as-variant in erase mode', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="erase" />);
    expect(screen.getByText('退出')).toBeInTheDocument();
    expect(screen.getByText('撤销')).toBeInTheDocument();
    expect(screen.getByText('清除')).toBeInTheDocument();
    expect(screen.getByText('生成')).toBeInTheDocument();
    expect(screen.getByText('保存为新变体')).toBeInTheDocument();
  });

  it('does not render save button in erase mode', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="erase" />);
    expect(screen.queryByText('保存')).not.toBeInTheDocument();
  });

  // ── redraw mode buttons ──

  it('renders undo, clear, generate, and save-as-variant in redraw mode', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="redraw" />);
    expect(screen.getByText('退出')).toBeInTheDocument();
    expect(screen.getByText('撤销')).toBeInTheDocument();
    expect(screen.getByText('清除')).toBeInTheDocument();
    expect(screen.getByText('生成')).toBeInTheDocument();
    expect(screen.getByText('保存为新变体')).toBeInTheDocument();
  });

  // ── isSaving disabled state ──

  it('shows "保存中..." and disables save button when isSaving in crop mode', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} isSaving={true} />);
    const saveBtn = screen.getByText('保存中...');
    expect(saveBtn).toBeInTheDocument();
    expect(saveBtn).toBeDisabled();
  });

  it('shows "生成中..." and disables generate button when isSaving', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="outpaint" isSaving={true} />);
    const genBtn = screen.getByText('生成中...');
    expect(genBtn).toBeInTheDocument();
    expect(genBtn).toBeDisabled();
  });

  it('disables exit button when isSaving', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} isSaving={true} />);
    expect(screen.getByText('退出').closest('button')).toBeDisabled();
  });

  it('disables undo/clear buttons when isSaving in erase mode', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="erase" isSaving={true} />);
    expect(screen.getByText('撤销').closest('button')).toBeDisabled();
    expect(screen.getByText('清除').closest('button')).toBeDisabled();
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
    render(<EditToolbar {...baseProps} editMode="outpaint" isSaving={true} onGenerate={onGenerate} />);
    fireEvent.click(screen.getByText('生成中...'));
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

  it('calls onSave when save button is clicked in crop mode', () => {
    setupPortalTarget();
    const onSave = vi.fn();
    render(<EditToolbar {...baseProps} onSave={onSave} />);
    fireEvent.click(screen.getByText('保存'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('calls onGenerate when generate button is clicked', () => {
    setupPortalTarget();
    const onGenerate = vi.fn();
    render(<EditToolbar {...baseProps} editMode="outpaint" onGenerate={onGenerate} />);
    fireEvent.click(screen.getByText('生成'));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it('calls onUndo when undo button is clicked in erase mode', () => {
    setupPortalTarget();
    const onUndo = vi.fn();
    render(<EditToolbar {...baseProps} editMode="erase" onUndo={onUndo} />);
    fireEvent.click(screen.getByText('撤销'));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('calls onClear when clear button is clicked in erase mode', () => {
    setupPortalTarget();
    const onClear = vi.fn();
    render(<EditToolbar {...baseProps} editMode="erase" onClear={onClear} />);
    fireEvent.click(screen.getByText('清除'));
    expect(onClear).toHaveBeenCalledTimes(1);
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
});
