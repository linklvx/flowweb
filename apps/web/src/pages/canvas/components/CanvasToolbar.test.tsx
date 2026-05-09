import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasToolbar } from './CanvasToolbar';

describe('CanvasToolbar', () => {
  it('should display current zoom as percentage', () => {
    render(<CanvasToolbar zoom={0.75} onFitView={vi.fn()} />);
    expect(screen.getByText(/75%/)).toBeInTheDocument();
  });

  it('should display 100% for zoom 1', () => {
    render(<CanvasToolbar zoom={1} onFitView={vi.fn()} />);
    expect(screen.getByText(/100%/)).toBeInTheDocument();
  });

  it('should call onFitView when fit button clicked', () => {
    const onFitView = vi.fn();
    render(<CanvasToolbar zoom={1} onFitView={onFitView} />);
    fireEvent.click(screen.getByText(/适应/));
    expect(onFitView).toHaveBeenCalledOnce();
  });
});
