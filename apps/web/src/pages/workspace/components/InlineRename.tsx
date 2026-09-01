import { useEffect, useState } from 'react';
import { Input } from 'antd';
import { EditOutlined } from '@ant-design/icons';

interface InlineRenameProps {
  value: string;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onConfirm: (next: string) => void;
  ariaLabel: string;
}

export function InlineRename({ value, editing, onEditingChange, onConfirm, ariaLabel }: InlineRenameProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (editing) setDraft(value); }, [editing, value]);

  const commit = () => {
    onEditingChange(false);
    if (draft.trim() && draft !== value) onConfirm(draft.trim());
  };

  if (editing) {
    return (
      <Input
        size="small" autoFocus value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { onEditingChange(false); setDraft(value); }
        }}
        onClick={(e) => e.stopPropagation()}
        data-testid="inline-rename-input"
      />
    );
  }
  return (
    <span className="group/name flex items-center min-w-0">
      <span className="text-sm font-semibold truncate cursor-text text-white">{value}</span>
      <button
        aria-label={ariaLabel}
        className="opacity-0 group-hover/name:opacity-100 transition-opacity duration-150 p-0.5 ml-1 text-white/60 shrink-0 bg-transparent border-none cursor-pointer"
        onClick={(e) => { e.stopPropagation(); onEditingChange(true); }}
      >
        <EditOutlined style={{ fontSize: 12 }} />
      </button>
    </span>
  );
}
