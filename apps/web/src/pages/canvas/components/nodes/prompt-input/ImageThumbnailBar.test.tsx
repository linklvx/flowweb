import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImageThumbnailBar } from './ImageThumbnailBar';
import type { ImageItem } from './types';
import { useNodeStore } from '@/stores/nodeStore';
import { useMenuStore } from '@/stores/menuStore';

// ========== Mocks ==========

// Mock SortableImageItem
vi.mock('./SortableImageItem', () => ({
  SortableImageItem: ({ image, onDelete, onClick }: any) => (
    <div
      data-testid={`thumb-${image.id}`}
      onClick={() => onClick?.(image.id)}
    >
      {image.name}
      <button
        data-testid={`delete-${image.id}`}
        onClick={(e: any) => {
          e.stopPropagation();
          onDelete?.(image.id);
        }}
      >
        ×
      </button>
    </div>
  ),
}));

// Mock useImageUpload
const mockUploadBatchImages = vi.fn();
const mockDeleteImage = vi.fn();

vi.mock('./useImageUpload', () => ({
  useImageUpload: () => ({
    uploadBatchImages: mockUploadBatchImages,
    deleteImage: mockDeleteImage,
  }),
}));

// Mock @dnd-kit/core -- capture onDragEnd for test inspection
let capturedOnDragEnd: ((event: any) => void) | null = null;

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ onDragEnd, children }: any) => {
    capturedOnDragEnd = onDragEnd;
    return <>{children}</>;
  },
  closestCenter: 'closestCenter',
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn((...sensors: any[]) => sensors),
  PointerSensor: {} as any,
  KeyboardSensor: {} as any,
}));

// Mock @dnd-kit/sortable
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: any) => <>{children}</>,
  sortableKeyboardCoordinates: {},
  arrayMove: <T,>(arr: T[], from: number, to: number): T[] => {
    const result = [...arr];
    const [item] = result.splice(from, 1);
    result.splice(to, 0, item);
    return result;
  },
}));

// ========== Test Data ==========

const baseImages: ImageItem[] = [
  { id: 'img-1', url: 'url-1', name: 'image-1.jpg', status: 'success' },
  { id: 'img-2', url: 'url-2', name: 'image-2.jpg', status: 'success' },
  { id: 'img-3', url: 'url-3', name: 'image-3.jpg', status: 'success' },
];

// ========== Tests ==========

describe('ImageThumbnailBar', () => {
  let onChange: ReturnType<typeof vi.fn>;
  let onImageClick: ReturnType<typeof vi.fn>;
  let onImageUploaded: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onChange = vi.fn();
    onImageClick = vi.fn();
    onImageUploaded = vi.fn();
    mockUploadBatchImages.mockReset().mockResolvedValue([]);
    mockDeleteImage.mockReset();
    capturedOnDragEnd = null;
    useNodeStore.getState().exitReferenceSelect();
    useMenuStore.getState().closeStyleLibrary();
  });

  it('1. renders all image thumbnails (SortableImageItem)', () => {
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
      />,
    );

    expect(screen.getByTestId('thumb-img-1')).toBeInTheDocument();
    expect(screen.getByTestId('thumb-img-2')).toBeInTheDocument();
    expect(screen.getByTestId('thumb-img-3')).toBeInTheDocument();
  });

  it('2. shows upload + button when images.length < maxCount', () => {
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
        maxCount={9}
      />,
    );

    expect(screen.getByTestId('upload-button')).toBeInTheDocument();
  });

  it('3. 参考 button 仍渲染 when images.length >= maxCount（模式入口恒显，D19）', () => {
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
        maxCount={3}
      />,
    );
    expect(screen.getByTestId('upload-button')).toBeInTheDocument();
  });

  it('4. drag-and-drop files triggers uploadBatchImages', () => {
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
      />,
    );

    const container = screen.getByTestId('thumbnail-bar');
    const file = new File(['dummy'], 'test.png', { type: 'image/png' });
    const mockDataTransfer = { files: [file], types: ['Files'] };

    // Simulate dragover: must call preventDefault + stopPropagation
    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(dragOverEvent, 'dataTransfer', { value: mockDataTransfer });
    vi.spyOn(dragOverEvent, 'preventDefault');
    vi.spyOn(dragOverEvent, 'stopPropagation');

    fireEvent(container, dragOverEvent);
    expect(dragOverEvent.preventDefault).toHaveBeenCalled();
    expect(dragOverEvent.stopPropagation).toHaveBeenCalled();

    // Simulate drop: triggers uploadBatchImages
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'dataTransfer', { value: mockDataTransfer });

    fireEvent(container, dropEvent);

    expect(mockUploadBatchImages).toHaveBeenCalledWith(
      [file],
      expect.any(Number),
    );
  });

  it('5. drag reorder calls onChange with new sorted order', () => {
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
      />,
    );

    expect(capturedOnDragEnd).not.toBeNull();

    // Simulate drag from img-1 (index 0) to img-3 (index 2)
    capturedOnDragEnd!({
      active: { id: 'img-1' },
      over: { id: 'img-3' },
    });

    expect(onChange).toHaveBeenCalled();
  });

  it('6. onChange receives correctly ordered ImageItem[] after dragEnd', () => {
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
      />,
    );

    // Simulate drag from img-1 (index 0) to img-3 (index 2)
    capturedOnDragEnd!({
      active: { id: 'img-1' },
      over: { id: 'img-3' },
    });

    // Expected: arrayMove([img-1, img-2, img-3], 0, 2) = [img-2, img-3, img-1]
    const expectedOrder = [
      baseImages[1], // img-2
      baseImages[2], // img-3
      baseImages[0], // img-1
    ];

    expect(onChange).toHaveBeenCalledWith(expectedOrder);
  });

  it('7. drop upload complete calls onImageUploaded(imageId) for each uploaded image', async () => {
    const uploadedItems: ImageItem[] = [
      { id: 'new-1', url: 'url-new-1', name: 'new-1.jpg', status: 'success' },
      { id: 'new-2', url: 'url-new-2', name: 'new-2.jpg', status: 'success' },
    ];
    mockUploadBatchImages.mockResolvedValue(uploadedItems);

    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
        maxCount={9}
      />,
    );

    const container = screen.getByTestId('thumbnail-bar');
    const file = new File(['dummy'], 'test.png', { type: 'image/png' });
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'dataTransfer', { value: { files: [file], types: ['Files'] } });
    fireEvent(container, dropEvent);

    await waitFor(() => {
      expect(onImageUploaded).toHaveBeenCalledTimes(2);
    });
    expect(onChange).toHaveBeenCalledWith([...baseImages, ...uploadedItems]);
  });

  it('8. disabled prop: 参考 button 恒显但 disabled，交互全部阻断', () => {
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
        disabled={true}
        maxCount={9}
      />,
    );

    // 参考按钮恒显（D19）但 disabled 时点击无效（P9：生成中不得进模式改参考图）
    expect(screen.getByTestId('upload-button')).toBeInTheDocument();
    expect((screen.getByTestId('upload-button') as HTMLButtonElement).disabled).toBe(true);

    // Clicking thumbnail should NOT call onImageClick (disabled passes noop)
    fireEvent.click(screen.getByTestId('thumb-img-1'));
    expect(onImageClick).not.toHaveBeenCalled();

    // Drop should NOT trigger uploadBatchImages
    const container = screen.getByTestId('thumbnail-bar');
    const file = new File(['dummy'], 'test.png', { type: 'image/png' });
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [file], types: ['Files'] },
    });

    fireEvent(container, dropEvent);
    expect(mockUploadBatchImages).not.toHaveBeenCalled();
  });

  it('9. renders 风格 button (aria-label) before 参考 upload button', () => {
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
      />,
    );
    const style = screen.getByRole('button', { name: '风格' });
    const upload = screen.getByTestId('upload-button');
    expect(style).toBeInTheDocument();
    expect(upload.textContent).toContain('参考');
    // 风格在参考左侧
    expect(style.compareDocumentPosition(upload) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('10. upload-button (参考) renders before first thumbnail', () => {
    // 顺序断言语义说明：thumb-img-1 来自本文件顶部 SortableImageItem mock——被测对象是
    // ImageThumbnailBar 自身的 JSX 排列顺序（按钮在缩略图渲染位之前），与 mock/真实组件内部无关
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
      />,
    );
    const upload = screen.getByTestId('upload-button');
    const firstThumb = screen.getByTestId('thumb-img-1');
    expect(upload.compareDocumentPosition(firstThumb) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('11. 满员时风格与参考按钮均恒显（D19：参考=模式入口，不再随 maxCount 隐藏）', () => {
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
        maxCount={3}
      />,
    );
    expect(screen.getByTestId('upload-button')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '风格' })).toBeInTheDocument();
  });

  it('12. clicking 参考 button enters canvas reference select mode（不再触发 file input）', () => {
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
      />,
    );
    fireEvent.click(screen.getByTestId('upload-button'));
    expect(useNodeStore.getState().referenceSelect).toEqual({ sourceNodeId: 'node-1', notice: null });
    useNodeStore.getState().exitReferenceSelect();
  });

  it('13. 风格 button 用调色盘 svg（单 path 三段 M 子路径 evenodd，fill=currentColor）', () => {
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
      />,
    );
    const svg = screen.getByRole('button', { name: '风格' }).querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 20 20');
    const paths = svg?.querySelectorAll('path');
    expect(paths?.length).toBe(1);
    const d = paths?.[0].getAttribute('d') ?? '';
    // 用户 SVG 为单 path 内三段子路径（M9.99984 主环 + M5.37012/M14.6287 两叶）
    expect(d.startsWith('M9.99984 1.6665')).toBe(true);
    expect(d).toContain('M5.37012 9.39355');
    expect(d).toContain('M14.6287 9.39355');
    expect(paths?.[0].getAttribute('fill')).toBe('currentColor');
    expect(paths?.[0].getAttribute('fill-rule')).toBe('evenodd');
  });

  it('14. 参考 button 图标为卡片选择（三层叠卡 stroke，替换 + 号上传语义）', () => {
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
      />,
    );
    const svg = screen.getByTestId('upload-button').querySelector('svg');
    expect(svg?.getAttribute('data-icon')).toBe('card-select');
  });

  it('15. 两按钮常态背景 bg-overlay-2（解与面板底同值）+ hover overlay-3，不再用 surface-dim', () => {
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
      />,
    );
    const style = screen.getByRole('button', { name: '风格' });
    const upload = screen.getByTestId('upload-button');
    for (const btn of [style, upload]) {
      expect(btn.className).toContain('bg-overlay-2');
      expect(btn.className).toContain('hover:bg-overlay-3');
      expect(btn.className).not.toContain('bg-surface-dim');
    }
  });

  it('16. 风格 button opens style library（menuStore.styleLibrary）', () => {
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '风格' }));
    expect(useMenuStore.getState().styleLibrary).toEqual({ nodeId: 'node-1' });
    useMenuStore.getState().closeStyleLibrary();
  });

  it('17. 点击参考按钮时先关风格库（组件层收口互斥，nodeStore→menuStore 方向）', () => {
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '风格' }));
    fireEvent.click(screen.getByTestId('upload-button'));
    expect(useMenuStore.getState().styleLibrary).toBeNull();
    expect(useNodeStore.getState().referenceSelect).not.toBeNull();
    useNodeStore.getState().exitReferenceSelect();
  });
});
