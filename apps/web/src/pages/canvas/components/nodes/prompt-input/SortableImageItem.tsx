import { useMemo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ImageItem } from './types';

interface SortableImageItemProps {
  image: ImageItem;
  onDelete: (id: string) => void;
  onClick: (id: string) => void;
}

function StatusOverlay({
  status,
  progress,
  isDragging,
  onDelete,
}: {
  status: ImageItem['status'];
  progress?: number;
  isDragging: boolean;
  onDelete: (e: React.MouseEvent) => void;
}) {
  if (status === 'uploading') {
    return (
      <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center">
        <span className="text-white text-xs font-medium">
          {progress ?? 0}%
        </span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="absolute inset-0 bg-red-500/30 flex items-center justify-center">
        <span className="text-white text-sm">🔄</span>
      </div>
    );
  }

  if (status === 'success' && !isDragging) {
    return (
      <button
        onClick={onDelete}
        className="absolute top-0 right-0 w-[18px] h-[18px] bg-red-500 text-white rounded-full flex items-center justify-center text-[11px]"
        aria-label="删除图片"
      >
        ×
      </button>
    );
  }

  return null;
}

export function SortableImageItem({ image, onDelete, onClick }: SortableImageItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: image.id });

  const style = useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition,
    }),
    [transform, transition],
  );

  const handleClick = () => {
    if (isDragging) return;
    if (image.status === 'success') {
      onClick(image.id);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDragging) return;
    onDelete(image.id);
  };

  const { status, url, name, progress } = image;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="w-[50px] h-[50px] rounded-md overflow-hidden flex-shrink-0 border border-[#2A2A34] cursor-pointer relative"
    >
      <img
        src={url}
        alt={name}
        className="w-full h-full object-cover"
        onClick={handleClick}
      />

      <StatusOverlay
        status={status}
        progress={progress}
        isDragging={isDragging}
        onDelete={handleDelete}
      />
    </div>
  );
}
