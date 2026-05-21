import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ImageItem } from './types';

// Component under test — import after types
// eslint-disable-next-line import/first
import { ImageMentionList } from './ImageMentionList';

const mockImages: ImageItem[] = [
  { id: 'img-1', url: 'https://example.com/cat.jpg', name: '猫咪', status: 'success' },
  { id: 'img-2', url: 'https://example.com/dog.jpg', name: '小狗', status: 'success' },
  { id: 'img-3', url: 'https://example.com/bird.jpg', name: '小鸟', status: 'success' },
];

const mockClientRect: DOMRect = {
  left: 0,
  top: 100,
  right: 300,
  bottom: 150,
  width: 300,
  height: 50,
  x: 0,
  y: 100,
  toJSON: () => ({}),
};

describe('ImageMentionList', () => {
  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('1. renders all images with thumbnail img and name', () => {
    render(
      <ImageMentionList
        items={mockImages}
        selectedIndex={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        clientRect={mockClientRect}
      />,
    );

    // Each image should have an <img> tag with correct src
    const imgs = screen.getAllByRole('img');
    expect(imgs).toHaveLength(3);
    expect(imgs[0]).toHaveAttribute('src', mockImages[0].url);
    expect(imgs[1]).toHaveAttribute('src', mockImages[1].url);
    expect(imgs[2]).toHaveAttribute('src', mockImages[2].url);

    // Each image name should be rendered
    expect(screen.getByText('猫咪')).toBeInTheDocument();
    expect(screen.getByText('小狗')).toBeInTheDocument();
    expect(screen.getByText('小鸟')).toBeInTheDocument();
  });

  it('2. highlights item at selectedIndex', () => {
    render(
      <ImageMentionList
        items={mockImages}
        selectedIndex={1}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        clientRect={mockClientRect}
      />,
    );

    // Item at index 1 should have 'selected' class
    const selectedItem = document.querySelector('[data-image-id="img-2"]');
    expect(selectedItem?.className).toContain('selected');

    // Other items should NOT have 'selected' class
    const firstItem = document.querySelector('[data-image-id="img-1"]');
    expect(firstItem?.className).not.toContain('selected');

    const thirdItem = document.querySelector('[data-image-id="img-3"]');
    expect(thirdItem?.className).not.toContain('selected');
  });

  it('3. shows "无匹配图片" text when items array is empty', () => {
    render(
      <ImageMentionList
        items={[]}
        selectedIndex={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        clientRect={mockClientRect}
      />,
    );

    expect(screen.getByText('无匹配图片')).toBeInTheDocument();
  });

  it('4. calls onSelect with clicked item', () => {
    const onSelect = vi.fn();
    render(
      <ImageMentionList
        items={mockImages}
        selectedIndex={0}
        onSelect={onSelect}
        onClose={vi.fn()}
        clientRect={mockClientRect}
      />,
    );

    // Click on the second item (小狗)
    fireEvent.click(screen.getByText('小狗'));
    expect(onSelect).toHaveBeenCalledWith(mockImages[1]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('5. ArrowDown/ArrowUp navigates (wraps), Enter selects, Escape closes', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <ImageMentionList
        items={mockImages}
        selectedIndex={0}
        onSelect={onSelect}
        onClose={onClose}
        clientRect={mockClientRect}
      />,
    );

    // Start at index 0
    let selected = document.querySelector('[data-image-id].command-item.selected');
    expect(selected?.getAttribute('data-image-id')).toBe('img-1');

    // ArrowDown → index 1
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    selected = document.querySelector('[data-image-id].command-item.selected');
    expect(selected?.getAttribute('data-image-id')).toBe('img-2');

    // ArrowDown → index 2
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    selected = document.querySelector('[data-image-id].command-item.selected');
    expect(selected?.getAttribute('data-image-id')).toBe('img-3');

    // ArrowDown wraps from last → index 0
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    selected = document.querySelector('[data-image-id].command-item.selected');
    expect(selected?.getAttribute('data-image-id')).toBe('img-1');

    // ArrowUp wraps from first → index 2
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    selected = document.querySelector('[data-image-id].command-item.selected');
    expect(selected?.getAttribute('data-image-id')).toBe('img-3');

    // Enter selects current item
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(mockImages[2]);

    // Escape calls onClose
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('6. does not crash with single item', () => {
    const singleImage: ImageItem[] = [
      { id: 'img-solo', url: 'https://example.com/solo.jpg', name: '单张图', status: 'success' },
    ];

    render(
      <ImageMentionList
        items={singleImage}
        selectedIndex={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        clientRect={mockClientRect}
      />,
    );

    // Should render the single item
    expect(screen.getByText('单张图')).toBeInTheDocument();
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/solo.jpg');

    // ArrowDown should wrap to itself (0 → 0)
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    const selected = document.querySelector('[data-image-id].command-item.selected');
    expect(selected?.getAttribute('data-image-id')).toBe('img-solo');

    // Should not throw when Enter is pressed
    const onSelect = vi.fn();
    fireEvent.keyDown(window, { key: 'Enter' });
  });
});
