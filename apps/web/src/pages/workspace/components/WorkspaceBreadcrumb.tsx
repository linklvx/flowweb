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
        <span className="text-white/90">搜索 “{searchQuery}”</span>
        <button aria-label="清除搜索" onClick={onClearSearch} className="text-white/50 hover:text-white/90 border-none bg-transparent cursor-pointer">
          <CloseOutlined style={{ fontSize: 12 }} />
        </button>
      </div>
    );
  }
  return (
    <nav className="flex items-center gap-2 px-8 py-3 text-[13px]" aria-label="当前位置">
      <span className="text-white/40">当前位置：</span>
      <span className="text-white/40">{dimensionLabel}</span>
      <span className="text-white/30">·</span>
      <button onClick={() => onNavigate(null)} className={currentFolderId ? 'text-white/60 hover:text-white/90 bg-transparent border-none cursor-pointer' : 'text-white/90 bg-transparent border-none cursor-default'}>
        根目录
      </button>
      {path.map((f, i) => (
        <span key={f.id} className="flex items-center gap-2">
          <span className="text-white/30">/</span>
          <button
            onClick={() => onNavigate(f.id)}
            className={i === path.length - 1 ? 'text-white/90 bg-transparent border-none cursor-default' : 'text-white/60 hover:text-white/90 bg-transparent border-none cursor-pointer'}
          >
            {f.name}
          </button>
        </span>
      ))}
    </nav>
  );
}
