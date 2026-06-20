import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ViewToggle } from './ViewToggle';

describe('ViewToggle', () => {
  it('should render two radio buttons', () => {
    render(<ViewToggle value="perspective" onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: '透视' })).toBeDefined();
    expect(screen.getByRole('radio', { name: '正面' })).toBeDefined();
  });

  it('should mark perspective as checked when active', () => {
    render(<ViewToggle value="perspective" onChange={vi.fn()} />);
    const perspective = screen.getByRole('radio', { name: '透视' });
    expect(perspective.getAttribute('aria-checked')).toBe('true');
  });

  it('should mark front as checked when active', () => {
    render(<ViewToggle value="front" onChange={vi.fn()} />);
    const front = screen.getByRole('radio', { name: '正面' });
    expect(front.getAttribute('aria-checked')).toBe('true');
  });

  it('should call onChange when clicking front view', async () => {
    const onChange = vi.fn();
    render(<ViewToggle value="perspective" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: '正面' }));
    expect(onChange).toHaveBeenCalledWith('front');
  });
});
