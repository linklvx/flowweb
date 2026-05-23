import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
        className="absolute top-0 right-0 w-[18px] h-[18px] bg-black text-white rounded-full flex items-center justify-center text-[11px] opacity-0 group-hover:opacity-100 transition-opacity"
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

  const [hovered, setHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const style = useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition,
    }),
    [transform, transition],
  );

  // Merge setNodeRef with our own ref
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      containerRef.current = node;
    },
    [setNodeRef],
  );

  // Native mouseover/mouseout — bypasses dnd-kit event interference
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onEnter = (e: MouseEvent) => {
      if (!el.contains(e.relatedTarget as Node)) setHovered(true);
    };
    const onLeave = (e: MouseEvent) => {
      if (!el.contains(e.relatedTarget as Node)) setHovered(false);
    };
    el.addEventListener('mouseover', onEnter);
    el.addEventListener('mouseout', onLeave);
    return () => {
      el.removeEventListener('mouseover', onEnter);
      el.removeEventListener('mouseout', onLeave);
    };
  }, []);

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
    <>
      <div
        ref={setRef}
        style={style}
        {...attributes}
        {...listeners}
        className="w-[50px] h-[50px] rounded-md overflow-hidden flex-shrink-0 border border-[#2A2A34] cursor-pointer relative group"
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

      {/* Preview popup — portal to document.body, avoids all clipping/event issues */}
      {hovered && status === 'success' && containerRef.current &&
        createPortal(
          <div
            data-testid="image-preview"
            className="z-[9999] fixed pointer-events-none"
            style={(() => {
              const rect = containerRef.current.getBoundingClientRect();
              return {
                left: rect.left + rect.width / 2,
                top: rect.top - 8,
                transform: 'translate(-50%, -100%)',
              };
            })()}
          >
            <div className="h-[100px] rounded-[12px] overflow-hidden shadow-[0px_8px_24px_rgba(0,0,0,0.5)] bg-black">
              <img
                src={url}
                alt={name}
                className="block h-[100px] w-auto object-cover"
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
