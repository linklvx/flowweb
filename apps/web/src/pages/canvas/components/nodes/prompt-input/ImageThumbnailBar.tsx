import { useRef } from 'react';
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable';
import { SortableImageItem } from './SortableImageItem';
import { useImageUpload } from './useImageUpload';
import type { ImageItem } from './types';

interface ImageThumbnailBarProps {
  nodeId: string;
  images: ImageItem[];
  onChange: (images: ImageItem[]) => void;
  onImageClick: (imageId: string) => void;
  onImageUploaded: (imageId: string) => void;
  onBeforeImageDelete?: (imageId: string) => void;
  maxCount?: number;
  disabled?: boolean;
}

export function ImageThumbnailBar({
  nodeId,
  images,
  onChange,
  onImageClick,
  onImageUploaded,
  onBeforeImageDelete,
  maxCount = 9,
  disabled = false,
}: ImageThumbnailBarProps) {
  const { uploadBatchImages, deleteImage } = useImageUpload(nodeId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIdx = images.findIndex((img) => img.id === active.id);
    const newIdx = images.findIndex((img) => img.id === over.id);

    if (oldIdx === -1 || newIdx === -1) return;

    onChange(arrayMove(images, oldIdx, newIdx));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const processUpload = async (files: File[]) => {
    const uploaded = await uploadBatchImages(files, maxCount);
    if (uploaded.length === 0) return;
    onChange([...images, ...uploaded]);
    uploaded.forEach((img) => onImageUploaded(img.id));
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files.length === 0) return;
    await processUpload(Array.from(e.dataTransfer.files));
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    await processUpload(Array.from(e.target.files));
  };

  const handleDeleteImage = (imageId: string) => {
    onBeforeImageDelete?.(imageId);
    deleteImage(imageId);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const showUploadButton = !disabled && images.length < maxCount;

  return (
    <div
      data-testid="thumbnail-bar"
      className="flex items-center gap-2 overflow-x-auto pb-1"
      style={{ scrollbarWidth: 'none' as any }}
      onDragOver={disabled ? undefined : handleDragOver}
      onDrop={disabled ? undefined : handleDrop}
    >
      {/* 风格按钮 — 仅外观无功能（spec 需求4 拍板；点击无反应是预期，登记 §7-4） */}
      <button
        type="button"
        aria-label="风格"
        className="flex h-[56px] w-[56px] shrink-0 cursor-pointer flex-col items-center justify-center gap-[2px] rounded-[8px] bg-surface-dim transition-colors hover:bg-overlay-2"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 3.5a6.5 6.5 0 0 1 6.5 6.5H3.5A6.5 6.5 0 0 1 10 3.5Z" stroke="currentColor" strokeWidth="1.6" />
          <path d="M10 7a3 3 0 0 1 3 3H7a3 3 0 0 1 3-3Z" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="10" cy="9" r="1.2" fill="currentColor" />
        </svg>
        <span className="text-[12px] font-[400] leading-[120%] text-text-dim-2">风格</span>
      </button>

      {showUploadButton && (
        <>
          {/* 参考按钮 = 原 +号上传按钮改版（spec 需求5/6：上传行为/data-testid 保留，缩略图移到其右侧） */}
          <button
            data-testid="upload-button"
            aria-label="参考"
            onClick={handleUploadClick}
            className="flex h-[56px] w-[56px] shrink-0 cursor-pointer flex-col items-center justify-center gap-[2px] rounded-[8px] bg-surface-dim transition-colors hover:bg-overlay-2 focus:outline-none shadow-none outline-none"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
              <path d="M13.5 6V4.5A2.5 2.5 0 0 0 11 2H4.5A2.5 2.5 0 0 0 2 4.5V11a2.5 2.5 0 0 0 2.5 2.5H6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <span className="text-[12px] font-[400] leading-[120%] text-text-dim-2">参考</span>
          </button>
          <input
            ref={fileInputRef}
            data-testid="file-input"
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={disabled ? undefined : handleDragEnd}
      >
        <SortableContext items={images.map((img) => img.id)}>
          {images.map((image) => (
            <SortableImageItem
              key={image.id}
              image={image}
              onDelete={disabled ? () => {} : handleDeleteImage}
              onClick={disabled ? () => {} : onImageClick}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}
