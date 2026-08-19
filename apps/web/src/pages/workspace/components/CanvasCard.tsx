import { useState } from 'react';
import { Dropdown, Tooltip } from 'antd';
import { DeleteOutlined, InboxOutlined, EditOutlined, EyeOutlined, EyeInvisibleOutlined, MoreOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import type { Canvas } from '../types';
import { getCanvasGradient } from '../utils/gradient';
import { formatRelativeTime } from '../utils/time';
import { InlineRename } from './InlineRename';

interface CanvasCardProps {
  canvas: Canvas;
  variant?: 'grid' | 'list';
  onClick: (canvas: Canvas) => void;
  onRename: (id: string, name: string) => void;
  onMove: (canvas: Canvas) => void;
  onTogglePublic: (id: string) => void;
  onDelete: (canvas: Canvas) => void;
}

export function CanvasCard({ canvas, variant = 'grid', onClick, onRename, onMove, onTogglePublic, onDelete }: CanvasCardProps) {
  const [renaming, setRenaming] = useState(false);
  const background = canvas.coverUrl ? `url("${canvas.coverUrl}")` : getCanvasGradient(canvas.id);

  const menuItems: MenuProps['items'] = [
    { key: 'rename', label: '重命名', icon: <EditOutlined /> },
    { key: 'move', label: '移动到文件夹', icon: <InboxOutlined /> },
    { key: 'public', label: canvas.isPublic ? '设为私有' : '设为公开', icon: canvas.isPublic ? <EyeInvisibleOutlined /> : <EyeOutlined /> },
    { key: 'delete', label: '删除', icon: <DeleteOutlined /> },
  ];

  const onMenuClick: MenuProps['onClick'] = ({ key, domEvent }) => {
    domEvent.stopPropagation();
    if (key === 'delete') onDelete(canvas);
    if (key === 'rename') setRenaming(true);
    if (key === 'move') onMove(canvas);
    if (key === 'public') onTogglePublic(canvas.id);
  };

  const menuButton = (
    <Dropdown menu={{ items: menuItems, onClick: onMenuClick }} trigger={['click']}>
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
        data-testid={`canvas-card-${canvas.id}`}
        tabIndex={0}
        role="button"
        onClick={() => onClick(canvas)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(canvas); }}
        className="h-16 px-4 flex items-center border-b border-white/5 hover:bg-white/5 cursor-pointer group/menu"
      >
        <span className="w-12 h-12 rounded-lg shrink-0" style={{ background }} />
        <div className="flex-1 ml-3 min-w-0">
          <InlineRename
            value={canvas.name}
            editing={renaming}
            onEditingChange={setRenaming}
            ariaLabel="重命名画布"
            onConfirm={(next) => onRename(canvas.id, next)}
          />
        </div>
        {canvas.isPublic && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 mr-4">公开</span>}
        <span className="text-xs text-white/40 mr-4 shrink-0">编辑于 {formatRelativeTime(canvas.updatedAt)}</span>
        {menuButton}
      </div>
    );
  }

  return (
    <div
      data-testid={`canvas-card-${canvas.id}`}
      tabIndex={0}
      role="button"
      onClick={() => onClick(canvas)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(canvas); }}
      className="rounded-2xl bg-[#1F1F1F] hover:bg-[#262626] outline outline-white/[0.08] hover:outline-white/[0.16] -outline-offset-1 transition-all duration-200 p-2 pb-2 cursor-pointer overflow-hidden relative group/menu"
    >
      <div className="relative w-full overflow-hidden rounded-xl" style={{ aspectRatio: '4 / 3' }}>
        <div className="absolute inset-0 transition-transform duration-200 group-hover/menu:scale-110" style={{ background }} />
      </div>
      <div className="px-1 pt-2 pb-2 flex flex-col gap-1">
        <InlineRename
          value={canvas.name}
          editing={renaming}
          onEditingChange={setRenaming}
          ariaLabel="重命名画布"
          onConfirm={(next) => onRename(canvas.id, next)}
        />
        <div className="flex items-center justify-between text-xs text-white/50">
          <Tooltip title={new Date(canvas.updatedAt).toLocaleString()}>
            <span>编辑于 {formatRelativeTime(canvas.updatedAt)}</span>
          </Tooltip>
          {canvas.isPublic && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10">公开</span>}
        </div>
      </div>
      <div className="absolute top-4 right-4 opacity-0 group-hover/menu:opacity-100 transition-opacity duration-200">
        {menuButton}
      </div>
    </div>
  );
}
