import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SortableImageItem } from './SortableImageItem';
import type { ImageItem } from './types';

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: vi.fn((t: unknown) => (t ? 'translateX(10px)' : '')) } },
}));

const baseImage: ImageItem = {
  id: 'img-1',
  url: 'https://example.com/test.jpg',
  name: 'test-image.jpg',
  status: 'success',
};

describe('SortableImageItem', () => {
  let onDelete: ReturnType<typeof vi.fn>;
  let onClick: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onDelete = vi.fn();
    onClick = vi.fn();
  });

  it('1. renders thumbnail img with src=image.url', () => {
    render(
      <SortableImageItem image={baseImage} onDelete={onDelete} onClick={onClick} />,
    );

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', baseImage.url);
  });

  it('2. uploading state shows progress overlay with percentage text', () => {
    const uploadingImage: ImageItem = {
      ...baseImage,
      status: 'uploading',
      progress: 67,
    };

    render(
      <SortableImageItem image={uploadingImage} onDelete={onDelete} onClick={onClick} />,
    );

    expect(screen.getByText('67%')).toBeInTheDocument();
  });

  it('3. success state shows delete button (×)', () => {
    render(
      <SortableImageItem image={baseImage} onDelete={onDelete} onClick={onClick} />,
    );

    const deleteBtn = screen.getByText('×');
    expect(deleteBtn).toBeInTheDocument();
  });

  it('4. error state shows red overlay with retry indicator', () => {
    const errorImage: ImageItem = {
      ...baseImage,
      status: 'error',
    };

    render(
      <SortableImageItem image={errorImage} onDelete={onDelete} onClick={onClick} />,
    );

    expect(screen.getByText('🔄')).toBeInTheDocument();
  });

  it("5. clicking thumbnail calls onClick(image.id) when status='success'", () => {
    render(
      <SortableImageItem image={baseImage} onDelete={onDelete} onClick={onClick} />,
    );

    const img = screen.getByRole('img');
    fireEvent.click(img);
    expect(onClick).toHaveBeenCalledWith(baseImage.id);
  });

  it("6. clicking thumbnail does NOT call onClick when status is 'uploading' or 'error'", () => {
    const uploadingImage: ImageItem = { ...baseImage, status: 'uploading' };
    const errorImage: ImageItem = { ...baseImage, status: 'error' };

    const { rerender } = render(
      <SortableImageItem image={uploadingImage} onDelete={onDelete} onClick={onClick} />,
    );

    fireEvent.click(screen.getByRole('img'));
    expect(onClick).not.toHaveBeenCalled();

    vi.clearAllMocks();
    rerender(
      <SortableImageItem image={errorImage} onDelete={onDelete} onClick={onClick} />,
    );

    fireEvent.click(screen.getByRole('img'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('7. clicking delete button calls onDelete(image.id)', () => {
    render(
      <SortableImageItem image={baseImage} onDelete={onDelete} onClick={onClick} />,
    );

    const deleteBtn = screen.getByText('×');
    fireEvent.click(deleteBtn);
    expect(onDelete).toHaveBeenCalledWith(baseImage.id);
  });

  it('8. does not crash with minimal image data', () => {
    const minimalImage: ImageItem = {
      id: 'minimal',
      url: '',
      name: '',
      status: 'uploading',
    };

    const { container } = render(
      <SortableImageItem image={minimalImage} onDelete={onDelete} onClick={onClick} />,
    );

    expect(container.querySelector('img')).toBeInTheDocument();
  });
});
