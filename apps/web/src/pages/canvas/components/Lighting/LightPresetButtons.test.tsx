import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LightPresetButtons } from './LightPresetButtons';

describe('LightPresetButtons', () => {
  const defaultPosition = { x: 0, y: 0, z: 6 };

  it('should render 6 preset buttons', () => {
    render(<LightPresetButtons currentPosition={defaultPosition} onSelect={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(6);
  });

  it('should show all direction labels', () => {
    render(<LightPresetButtons currentPosition={defaultPosition} onSelect={vi.fn()} />);
    expect(screen.getByText('左侧')).toBeDefined();
    expect(screen.getByText('顶部')).toBeDefined();
    expect(screen.getByText('右侧')).toBeDefined();
    expect(screen.getByText('前方')).toBeDefined();
    expect(screen.getByText('底部')).toBeDefined();
    expect(screen.getByText('后方')).toBeDefined();
  });

  it('should highlight active preset matching current position', () => {
    render(<LightPresetButtons currentPosition={{ x: -6, y: 0, z: 4 }} onSelect={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    const leftBtn = buttons.find((b) => b.textContent === '左侧')!;
    expect(leftBtn.className).toContain('bg-blue-500');
  });

  it('should call onSelect when clicking a preset', async () => {
    const onSelect = vi.fn();
    render(<LightPresetButtons currentPosition={defaultPosition} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('右侧'));
    expect(onSelect).toHaveBeenCalledWith(6, 0, 4);
  });
});
