import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandMentionList } from './CommandMentionList';
import type { CommandItem } from './types';

const mockItems: CommandItem[] = [
  { id: 'model-sdxl', name: 'SD XL', description: 'Stable Diffusion XL', icon: '🎨', value: 'sdxl', category: 'model' },
  { id: 'model-flux', name: 'Flux', description: 'Flux 模型', icon: '✨', value: 'flux', category: 'model' },
  { id: 'ratio-1-1', name: '1:1', description: '正方形', icon: '⬜', value: '1:1', category: 'ratio' },
  { id: 'ratio-16-9', name: '16:9', description: '宽屏', icon: '📺', value: '16:9', category: 'ratio' },
  { id: 'quality-std', name: '标准', description: '标准画质', icon: '📷', value: 'standard', category: 'quality' },
];

const mockClientRect: DOMRect = {
  left: 100,
  top: 200,
  bottom: 250,
  right: 300,
  width: 200,
  height: 50,
  x: 100,
  y: 200,
  toJSON: () => ({}),
};

describe('CommandMentionList', () => {
  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('1. renders items grouped by category with group headers (模型选择, 比例调整, 质量设置)', () => {
    render(
      <CommandMentionList
        items={mockItems}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        clientRect={mockClientRect}
      />,
    );

    expect(screen.getByText('模型选择')).toBeInTheDocument();
    expect(screen.getByText('比例调整')).toBeInTheDocument();
    expect(screen.getByText('质量设置')).toBeInTheDocument();

    // Items should be rendered
    expect(screen.getByText('SD XL')).toBeInTheDocument();
    expect(screen.getByText('Flux')).toBeInTheDocument();
    expect(screen.getByText('1:1')).toBeInTheDocument();
    expect(screen.getByText('16:9')).toBeInTheDocument();
    expect(screen.getByText('标准')).toBeInTheDocument();
  });

  it('2. highlights item at selectedIndex with selected class', () => {
    render(
      <CommandMentionList
        items={mockItems}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        clientRect={mockClientRect}
      />,
    );

    // selectedIndex starts at 0, so first item should have 'selected' class
    const firstItem = document.querySelector('[data-command-id="model-sdxl"]');
    expect(firstItem?.className).toContain('selected');
  });

  it('3. calls onSelect with correct item on click', () => {
    const onSelect = vi.fn();
    render(
      <CommandMentionList
        items={mockItems}
        onSelect={onSelect}
        onClose={vi.fn()}
        clientRect={mockClientRect}
      />,
    );

    fireEvent.click(screen.getByText('Flux'));
    expect(onSelect).toHaveBeenCalledWith(mockItems[1]);
  });

  it('4. renders nothing (null) when items array is empty', () => {
    const { container } = render(
      <CommandMentionList
        items={[]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        clientRect={mockClientRect}
      />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('5. ArrowDown key advances selectedIndex, wraps from last to first', () => {
    render(
      <CommandMentionList
        items={mockItems}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        clientRect={mockClientRect}
      />,
    );

    // Start at index 0
    let selected = document.querySelector('[data-command-id].selected');
    expect(selected?.getAttribute('data-command-id')).toBe('model-sdxl');

    // ArrowDown → index 1
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    selected = document.querySelector('[data-command-id].selected');
    expect(selected?.getAttribute('data-command-id')).toBe('model-flux');

    // ArrowDown through remaining items to last
    fireEvent.keyDown(window, { key: 'ArrowDown' }); // → index 2
    fireEvent.keyDown(window, { key: 'ArrowDown' }); // → index 3
    fireEvent.keyDown(window, { key: 'ArrowDown' }); // → index 4 (last)
    selected = document.querySelector('[data-command-id].selected');
    expect(selected?.getAttribute('data-command-id')).toBe('quality-std');

    // ArrowDown wraps from last back to first
    fireEvent.keyDown(window, { key: 'ArrowDown' }); // → index 0
    selected = document.querySelector('[data-command-id].selected');
    expect(selected?.getAttribute('data-command-id')).toBe('model-sdxl');
  });

  it('6. ArrowUp key retreats selectedIndex, wraps from first to last', () => {
    render(
      <CommandMentionList
        items={mockItems}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        clientRect={mockClientRect}
      />,
    );

    // Start at index 0, ArrowUp wraps to last (index 4)
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    const selected = document.querySelector('[data-command-id].selected');
    expect(selected?.getAttribute('data-command-id')).toBe('quality-std');

    // ArrowUp again → index 3
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    const selected2 = document.querySelector('[data-command-id].selected');
    expect(selected2?.getAttribute('data-command-id')).toBe('ratio-16-9');
  });

  it('7. Enter key calls onSelect with highlighted item', () => {
    const onSelect = vi.fn();
    render(
      <CommandMentionList
        items={mockItems}
        onSelect={onSelect}
        onClose={vi.fn()}
        clientRect={mockClientRect}
      />,
    );

    // Navigate to second item, then press Enter
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(mockItems[1]);
  });

  it('8. Escape key calls onClose', () => {
    const onClose = vi.fn();
    render(
      <CommandMentionList
        items={mockItems}
        onSelect={vi.fn()}
        onClose={onClose}
        clientRect={mockClientRect}
      />,
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('9. click outside calls onClose', () => {
    const onClose = vi.fn();
    render(
      <CommandMentionList
        items={mockItems}
        onSelect={vi.fn()}
        onClose={onClose}
        clientRect={mockClientRect}
      />,
    );

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
