import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { CommandItem } from './types';

interface CommandMentionListProps {
  items: CommandItem[];
  onSelect: (item: CommandItem) => void;
  onClose: () => void;
  clientRect: DOMRect;
}

const CATEGORY_LABELS: Record<string, string> = {
  model: '模型选择',
  ratio: '比例调整',
  quality: '质量设置',
};

function renderGroup(
  category: string,
  categoryItems: CommandItem[],
  items: CommandItem[],
  selectedIndex: number,
  onSelect: (item: CommandItem) => void,
) {
  return (
    <div key={category}>
      <div className="px-3 py-1.5 text-xs text-gray-400 font-medium">
        {CATEGORY_LABELS[category]}
      </div>
      {categoryItems.map((item) => {
        const index = items.indexOf(item);
        const isSelected = index === selectedIndex;
        return (
          <div
            key={item.id}
            data-command-id={item.id}
            data-index={index}
            className={`px-3 py-2 flex items-center gap-2 cursor-pointer hover:bg-[#374151] ${
              isSelected ? 'selected bg-[#374151]' : ''
            }`}
            onClick={() => onSelect(item)}
          >
            <span>{item.icon}</span>
            <span className="text-white text-sm">{item.name}</span>
            <span className="text-gray-500 text-xs ml-auto">{item.description}</span>
          </div>
        );
      })}
    </div>
  );
}

export function CommandMentionList({ items, onSelect, onClose, clientRect }: CommandMentionListProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  const groupedItems = useMemo(() => {
    const result: Record<string, CommandItem[]> = {};
    for (const item of items) {
      if (!result[item.category]) result[item.category] = [];
      result[item.category].push(item);
    }
    return result;
  }, [items]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const idx = selectedIndexRef.current;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
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
      const el = containerRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (items.length === 0) return null;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        left: clientRect.left,
        top: clientRect.bottom + 8,
        zIndex: 9999,
      }}
      className="bg-[#1f2937] border border-[#374151] rounded-lg shadow-xl max-h-[300px] overflow-y-auto min-w-[220px]"
    >
      {Object.entries(groupedItems).map(([category, categoryItems]) =>
        renderGroup(category, categoryItems, items, selectedIndex, onSelect),
      )}
    </div>
  );
}
