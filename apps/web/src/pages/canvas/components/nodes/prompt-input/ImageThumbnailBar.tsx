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

      {showUploadButton && (
        <>
          <button
            data-testid="upload-button"
            className="size-[50px] flex items-center justify-center rounded-[10px] shrink-0 transition-all focus:outline-none bg-white/[0.08] hover:bg-overlay-3 shadow-none outline-none"
            onClick={handleUploadClick}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-6 text-white/50" aria-hidden="true">
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
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
    </div>
  );
}
