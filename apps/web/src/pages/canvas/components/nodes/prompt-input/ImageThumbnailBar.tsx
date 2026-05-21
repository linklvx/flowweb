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
  maxCount?: number;
  disabled?: boolean;
}

export function ImageThumbnailBar({
  nodeId,
  images,
  onChange,
  onImageClick,
  onImageUploaded,
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
              onDelete={disabled ? () => {} : deleteImage}
              onClick={disabled ? () => {} : onImageClick}
            />
          ))}
        </SortableContext>
      </DndContext>

      {showUploadButton && (
        <>
          <button
            data-testid="upload-button"
            className="w-16 h-16 rounded-md border border-dashed border-[#3F3F46] flex items-center justify-center cursor-pointer hover:border-[#52525B] transition-colors flex-shrink-0 text-gray-400"
            onClick={handleUploadClick}
          >
            +
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
