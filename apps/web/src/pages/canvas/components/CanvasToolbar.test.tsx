import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasToolbar } from './CanvasToolbar';

describe('CanvasToolbar', () => {
  const defaultProps = {
    zoom: 0.69,
    onFitView: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    minimapOpen: false,
    onToggleMinimap: vi.fn(),
    snapEnabled: false,
    onToggleSnap: vi.fn(),
  };

  it('should display zoom percentage', () => {
    render(<CanvasToolbar {...defaultProps} />);
    expect(screen.getByText('69%')).toBeInTheDocument();
  });

  it('should display 100% for zoom 1', () => {
    render(<CanvasToolbar {...defaultProps} zoom={1} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('should call onFitView when fit button clicked', () => {
    const onFitView = vi.fn();
    render(<CanvasToolbar {...defaultProps} onFitView={onFitView} />);
    fireEvent.click(screen.getByLabelText('整理画布'));
    expect(onFitView).toHaveBeenCalledOnce();
  });

  it('should render zoom in button and call onZoomIn', () => {
    const onZoomIn = vi.fn();
    render(<CanvasToolbar {...defaultProps} onZoomIn={onZoomIn} />);
    fireEvent.click(screen.getByLabelText('放大'));
    expect(onZoomIn).toHaveBeenCalledOnce();
  });

  it('should render zoom out button and call onZoomOut', () => {
    const onZoomOut = vi.fn();
    render(<CanvasToolbar {...defaultProps} onZoomOut={onZoomOut} />);
    fireEvent.click(screen.getByLabelText('缩小'));
    expect(onZoomOut).toHaveBeenCalledOnce();
  });

  it('should render minimap toggle button', () => {
    render(<CanvasToolbar {...defaultProps} />);
    expect(screen.getByLabelText('切换小地图')).toBeInTheDocument();
  });

  it('should reflect minimap open state via aria-pressed', () => {
    const { rerender } = render(<CanvasToolbar {...defaultProps} minimapOpen={false} />);
    expect(screen.getByLabelText('切换小地图').getAttribute('aria-pressed')).toBe('false');
    rerender(<CanvasToolbar {...defaultProps} minimapOpen={true} />);
    expect(screen.getByLabelText('切换小地图').getAttribute('aria-pressed')).toBe('true');
  });

  it('should call onToggleMinimap when minimap button clicked', () => {
    const onToggleMinimap = vi.fn();
    render(<CanvasToolbar {...defaultProps} onToggleMinimap={onToggleMinimap} />);
    fireEvent.click(screen.getByLabelText('切换小地图'));
    expect(onToggleMinimap).toHaveBeenCalledOnce();
  });

  it('should reflect snap enabled state via aria-pressed', () => {
    const { rerender } = render(<CanvasToolbar {...defaultProps} snapEnabled={false} />);
    expect(screen.getByLabelText('网格吸附').getAttribute('aria-pressed')).toBe('false');
    rerender(<CanvasToolbar {...defaultProps} snapEnabled={true} />);
    expect(screen.getByLabelText('网格吸附').getAttribute('aria-pressed')).toBe('true');
  });

  it('should call onToggleSnap when snap button clicked', () => {
    const onToggleSnap = vi.fn();
    render(<CanvasToolbar {...defaultProps} onToggleSnap={onToggleSnap} />);
    fireEvent.click(screen.getByLabelText('网格吸附'));
    expect(onToggleSnap).toHaveBeenCalledOnce();
  });

  it('should set all buttons background to container color', () => {
    render(<CanvasToolbar {...defaultProps} />);
    const buttons = [
      screen.getByLabelText('整理画布'),
      screen.getByLabelText('切换小地图'),
      screen.getByLabelText('网格吸附'),
      screen.getByLabelText('缩小'),
      screen.getByLabelText('放大'),
    ];
    for (const btn of buttons) {
      expect(btn.style.backgroundColor).toBe('rgb(48, 48, 48)');
    }
  });

  it('should reset browser button styling on all buttons (flat style)', () => {
    render(<CanvasToolbar {...defaultProps} />);
    const buttons = [
      screen.getByLabelText('整理画布'),
      screen.getByLabelText('切换小地图'),
      screen.getByLabelText('网格吸附'),
      screen.getByLabelText('缩小'),
      screen.getByLabelText('放大'),
    ];
    for (const btn of buttons) {
      expect(btn.classList.contains('appearance-none')).toBe(true);
      expect(btn.classList.contains('border-0')).toBe(true);
    }
  });

  it('should show custom tooltip data on first 3 buttons', () => {
    render(<CanvasToolbar {...defaultProps} />);
    expect(screen.getByLabelText('整理画布').getAttribute('data-tooltip')).toBe('适应画布');
    expect(screen.getByLabelText('切换小地图').getAttribute('data-tooltip')).toBe('画布小地图');
    expect(screen.getByLabelText('网格吸附').getAttribute('data-tooltip')).toBe('网格吸附');
  });

  it('should NOT have native title on first 3 buttons', () => {
    render(<CanvasToolbar {...defaultProps} />);
    expect(screen.getByLabelText('整理画布').getAttribute('title')).toBeNull();
    expect(screen.getByLabelText('切换小地图').getAttribute('title')).toBeNull();
    expect(screen.getByLabelText('网格吸附').getAttribute('title')).toBeNull();
  });

  it('should highlight minimap button background when active', () => {
    const { rerender } = render(<CanvasToolbar {...defaultProps} minimapOpen={false} />);
    expect(screen.getByLabelText('切换小地图').style.backgroundColor).toBe('rgb(48, 48, 48)');
    rerender(<CanvasToolbar {...defaultProps} minimapOpen={true} />);
    expect(screen.getByLabelText('切换小地图').style.backgroundColor).toBe('rgb(58, 58, 58)');
  });

  it('should highlight snap button background when active', () => {
    const { rerender } = render(<CanvasToolbar {...defaultProps} snapEnabled={false} />);
    expect(screen.getByLabelText('网格吸附').style.backgroundColor).toBe('rgb(48, 48, 48)');
    rerender(<CanvasToolbar {...defaultProps} snapEnabled={true} />);
    expect(screen.getByLabelText('网格吸附').style.backgroundColor).toBe('rgb(58, 58, 58)');
  });

  it('should revert minimap button background when deactivated', () => {
    const { rerender } = render(<CanvasToolbar {...defaultProps} minimapOpen={true} />);
    expect(screen.getByLabelText('切换小地图').style.backgroundColor).toBe('rgb(58, 58, 58)');
    rerender(<CanvasToolbar {...defaultProps} minimapOpen={false} />);
    expect(screen.getByLabelText('切换小地图').style.backgroundColor).toBe('rgb(48, 48, 48)');
  });
});
