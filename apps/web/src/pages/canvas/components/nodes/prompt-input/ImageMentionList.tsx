import { useState, useEffect, useRef, useCallback } from 'react';
import type { ImageItem } from './types';

interface ImageMentionListProps {
  items: ImageItem[];
  selectedIndex: number;
  onSelect: (item: ImageItem) => void;
  onClose: () => void;
  clientRect: DOMRect;
}

export function ImageMentionList({
  items,
  selectedIndex,
  onSelect,
  onClose,
  clientRect,
}: ImageMentionListProps) {
  const [internalIndex, setInternalIndex] = useState(selectedIndex);
  const containerRef = useRef<HTMLDivElement>(null);
  const internalIndexRef = useRef(internalIndex);
  internalIndexRef.current = internalIndex;

  // Sync internal index when prop changes
  useEffect(() => {
    setInternalIndex(selectedIndex);
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (items.length === 0) return;

      const idx = internalIndexRef.current;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setInternalIndex((prev) => (prev + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setInternalIndex((prev) => (prev - 1 + items.length) % items.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (items[idx]) {
          onSelect(items[idx]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [items, onSelect, onClose],
  );

  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [handleClickOutside]);

  useEffect(() => {
    if (containerRef.current) {
      const el = containerRef.current.querySelector(
        `[data-image-id].command-item.selected`,
      );
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [internalIndex]);

  return (
    <div
      ref={containerRef}
      className="command-popup"
      style={{
        position: 'fixed',
        left: clientRect.left,
        top: clientRect.bottom + 8,
        zIndex: 9999,
      }}
    >
      {items.length === 0 ? (
        <div className="command-item" style={{ color: '#6b7280', cursor: 'default' }}>
          无匹配图片
        </div>
      ) : (
        items.map((item, index) => {
          const isSelected = index === internalIndex;
          return (
            <div
              key={item.id}
              data-image-id={item.id}
              className={`command-item${isSelected ? ' selected' : ''}`}
              onClick={() => onSelect(item)}
            >
              <img
                src={item.url}
                alt={item.name}
                style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4 }}
              />
              <span className="command-name">{item.name}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
