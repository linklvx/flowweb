import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasToolbar } from './CanvasToolbar';

describe('CanvasToolbar', () => {
  const defaultProps = {
    zoom: 0.69,
    onFitView: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
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

  it('should toggle minimap state on click', () => {
    render(<CanvasToolbar {...defaultProps} />);
    const btn = screen.getByLabelText('切换小地图');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
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
      expect(btn.style.backgroundColor).toBe('rgb(38, 38, 38)');
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
});
