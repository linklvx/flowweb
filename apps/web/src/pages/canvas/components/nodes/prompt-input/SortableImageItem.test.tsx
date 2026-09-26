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

  it('3. success state shows delete button (×)（hover 后角标变 X）', () => {
    const { container } = render(<SortableImageItem image={baseImage} index={0} onDelete={onDelete} onClick={onClick} />);
    fireEvent.mouseOver(container.querySelector('.group') as Element, { relatedTarget: document.body });
    expect(screen.getByTestId('ref-badge-x')).toBeInTheDocument();
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
    const { container } = render(<SortableImageItem image={baseImage} index={0} onDelete={onDelete} onClick={onClick} />);
    fireEvent.mouseOver(container.querySelector('.group') as Element, { relatedTarget: document.body });
    fireEvent.click(screen.getByTestId('ref-badge-x'));
    expect(onDelete).toHaveBeenCalledWith(baseImage.id);
  });

  it('8. shows preview popup on hover via portal with aspect ratio', () => {
    const { container } = render(
      <SortableImageItem image={baseImage} onDelete={onDelete} onClick={onClick} />,
    );
    // Preview not visible initially
    expect(screen.queryByTestId('image-preview')).toBeNull();
    // Fire mouseOver on the thumbnail container (fires both native + React)
    const thumbContainer = container.firstChild as HTMLElement;
    fireEvent.mouseOver(thumbContainer);
    // Preview rendered via portal to document.body
    const preview = screen.getByTestId('image-preview');
    expect(preview).toBeInTheDocument();
    const previewImg = preview.querySelector('img');
    expect(previewImg).toHaveAttribute('src', baseImage.url);
    // Has object-cover and fixed height styling
    expect(previewImg).toHaveClass('object-cover');
    // mouseOut hides preview
    fireEvent.mouseOut(thumbContainer);
    expect(screen.queryByTestId('image-preview')).toBeNull();
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

  // ---- 序号/X 角标两态（spec §3.4，D8）----
  it('9. 传 index 时常态渲染序号角标（index+1），一半悬外（transform 含 translate）', () => {
    render(<SortableImageItem image={baseImage} index={2} onDelete={onDelete} onClick={onClick} />);
    const badge = screen.getByTestId('ref-badge-index');
    expect(badge.textContent).toBe('3');
    expect(badge.parentElement?.style.transform).toContain('translate'); // 不锚字面量（jsdom 归一化差异防脆）
  });

  it('10. hover 后角标变 X，点击调 onDelete；移出还原序号', () => {
    const { container } = render(<SortableImageItem image={baseImage} index={0} onDelete={onDelete} onClick={onClick} />);
    const item = container.querySelector('.group') as Element;
    fireEvent.mouseOver(item, { relatedTarget: document.body });
    fireEvent.click(screen.getByTestId('ref-badge-x'));
    expect(onDelete).toHaveBeenCalledWith(baseImage.id);
    fireEvent.mouseOut(item, { relatedTarget: document.body });
    expect(screen.getByTestId('ref-badge-index')).toBeInTheDocument();
  });

  it('11. uploading 态序号角标仍显示（z 高于进度蒙层，B18）', () => {
    render(<SortableImageItem image={{ ...baseImage, status: 'uploading', progress: 42 }} index={0} onDelete={onDelete} onClick={onClick} />);
    expect(screen.getByTestId('ref-badge-index').textContent).toBe('1');
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('12. 不传 index 时不渲染角标（MultiImageConfigPanel 同名组件不受影响的语义护栏）', () => {
    render(<SortableImageItem image={baseImage} onDelete={onDelete} onClick={onClick} />);
    expect(screen.queryByTestId('ref-badge-index')).not.toBeInTheDocument();
  });
});
