import { CloseOutlined } from '@ant-design/icons';
import type { Folder } from '../types';

interface WorkspaceBreadcrumbProps {
  path: Folder[];
  currentFolderId: string | null;
  searchQuery: string;
  dimensionLabel: string;
  onNavigate: (folderId: string | null) => void;
  onClearSearch: () => void;
}

export function WorkspaceBreadcrumb({ path, currentFolderId, searchQuery, dimensionLabel, onNavigate, onClearSearch }: WorkspaceBreadcrumbProps) {
  if (searchQuery) {
    return (
      <div className="flex items-center gap-2 px-8 py-3 text-[13px]">
        <span className="text-text">搜索 “{searchQuery}”</span>
        <button aria-label="清除搜索" onClick={onClearSearch} className="text-text-dim-2 hover:text-text">
          <CloseOutlined style={{ fontSize: 12 }} />
        </button>
      </div>
    );
  }
  return (
    <nav className="flex items-center gap-2 px-8 py-3 text-[13px]" aria-label="当前位置">
      <span className="text-text-dim-2">当前位置：</span>
      <span className="text-text-dim-2">{dimensionLabel}</span>
      <span className="text-text-dim-1">·</span>
      <button onClick={() => onNavigate(null)} className={currentFolderId ? 'text-text-dim-3 hover:text-text bg-transparent' : 'text-text bg-transparent cursor-default'}>
        根目录
      </button>
      {path.map((f, i) => (
        <span key={f.id} className="flex items-center gap-2">
          <span className="text-text-dim-1">/</span>
          <button
            onClick={() => onNavigate(f.id)}
            className={i === path.length - 1 ? 'text-text bg-transparent cursor-default' : 'text-text-dim-3 hover:text-text bg-transparent'}
          >
            {f.name}
          </button>
        </span>
      ))}
    </nav>
  );
}
