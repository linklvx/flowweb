// components/FolderCard.tsx（重命名统一走 Modal：铅笔/菜单都只触发 onRequestRename）
import { Dropdown, Tooltip } from 'antd';
import { DeleteOutlined, EditOutlined, MoreOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import type { FolderViewModel } from '../types';
import { formatRelativeTime, formatDateTime } from '../utils/time';
import { FolderStackPreview } from './FolderStackPreview';
import { FolderListPreview } from './FolderListPreview';

interface FolderCardProps {
  folder: FolderViewModel;
  showCount: boolean;
  variant?: 'grid' | 'list';
  onClick: (folder: FolderViewModel) => void;
  onRequestRename: (folder: FolderViewModel) => void;
  onDelete: (folder: FolderViewModel) => void;
}

export function FolderCard({ folder, showCount, variant = 'grid', onClick, onRequestRename, onDelete }: FolderCardProps) {
  const items: MenuProps['items'] = [
    { key: 'rename', label: '重命名', icon: <EditOutlined /> },
    { key: 'delete', label: '删除', icon: <DeleteOutlined /> },
  ];
  const onMenuClick: MenuProps['onClick'] = ({ key, domEvent }) => {
    domEvent.stopPropagation();
    if (key === 'rename') onRequestRename(folder);
    if (key === 'delete') onDelete(folder);
  };

  const menuButton = (
    <Dropdown menu={{ items, onClick: onMenuClick }} trigger={['click']}>
      <button
        aria-label="更多操作"
        onClick={(e) => e.stopPropagation()}
        className="p-1.5 rounded-md text-white/80 border-none cursor-pointer z-30 bg-transparent hover:bg-white/10"
      >
        <MoreOutlined />
      </button>
    </Dropdown>
  );

  if (variant === 'list') {
    return (
      <div
        data-testid={`folder-card-${folder.id}`}
        tabIndex={0}
        role="button"
        onClick={() => onClick(folder)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(folder); }}
        className="relative group/menu"
      >
        <div className="flex items-center cursor-pointer group/row">
          <div className="shrink-0" style={{ width: 32 }} />
          <div
            className="grid flex-1 items-center gap-4 pl-4 pr-12 py-3 rounded-lg transition-colors group-hover/row:bg-white/5"
            style={{ gridTemplateColumns: '72px 1fr 70px 100px 145px 145px' }}
          >
            <div className="flex items-center justify-start">
              <FolderListPreview thumbnails={folder.thumbnails} />
            </div>
            <div className="min-w-0">
              <span className="text-sm text-white truncate">{folder.name}</span>
            </div>
            <div className="text-sm text-white">文件夹</div>
            <div className="text-sm text-white">{showCount ? `${folder.canvasCount} 个画布` : ''}</div>
            <div className="text-sm text-white whitespace-nowrap">{formatDateTime(folder.createdAt)}</div>
            <div className="text-sm text-white whitespace-nowrap">编辑于 {formatRelativeTime(folder.updatedAt)}</div>
          </div>
        </div>
        <div className="mx-12 mr-4 border-b border-white/10" />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 z-30 flex rounded-md bg-black/50 opacity-0 group-hover/menu:opacity-100 transition-opacity duration-200">
          {menuButton}
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid={`folder-card-${folder.id}`}
      tabIndex={0}
      role="button"
      onClick={() => onClick(folder)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(folder); }}
      className="rounded-2xl bg-[#1F1F1F] hover:bg-[#262626] outline outline-white/[0.08] hover:outline-white/[0.16] -outline-offset-1 transition-all duration-200 p-2 cursor-pointer overflow-hidden relative group/menu h-full"
    >
      <FolderStackPreview thumbnails={folder.thumbnails} />
      <div className="px-2 pt-2 pb-1">
        <span className="group/name flex items-center min-w-0">
          <span className="text-sm font-semibold truncate text-white">{folder.name}</span>
          <button
            aria-label="重命名文件夹"
            className="opacity-0 group-hover/name:opacity-100 transition-opacity duration-150 p-0.5 ml-1 text-white/60 shrink-0 bg-transparent border-none cursor-pointer"
            onClick={(e) => { e.stopPropagation(); onRequestRename(folder); }}
          >
            <EditOutlined style={{ fontSize: 12 }} />
          </button>
        </span>
        <div className="flex items-center justify-between text-xs text-white/50 mt-1">
          <Tooltip title={new Date(folder.updatedAt).toLocaleString()}>
            <span>编辑于 {formatRelativeTime(folder.updatedAt)}</span>
          </Tooltip>
          {showCount && <span className="text-[10px]">{folder.canvasCount} 个画布</span>}
        </div>
      </div>
      <div className="absolute top-4 right-4 opacity-0 group-hover/menu:opacity-100 transition-opacity duration-200">
        {menuButton}
      </div>
    </div>
  );
}
