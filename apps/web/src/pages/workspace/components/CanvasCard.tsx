import { useState } from 'react';
import { Dropdown, Tooltip } from 'antd';
import { DeleteOutlined, InboxOutlined, EditOutlined, EyeOutlined, EyeInvisibleOutlined, MoreOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import type { Canvas } from '../types';
import { getCanvasGradient } from '../utils/gradient';
import { formatRelativeTime, formatDateTime } from '../utils/time';
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
        className="relative group/menu"
      >
        <div className="flex items-center cursor-pointer group/row">
          <div className="shrink-0" style={{ width: 32 }} />
          <div
            className="grid flex-1 items-center gap-6 pl-4 pr-14 py-3 rounded-lg transition-colors group-hover/row:bg-white/5"
            style={{ gridTemplateColumns: '72px 1fr 120px 150px 180px 180px' }}
          >
            <div className="flex items-center justify-start">
              <div className="shrink-0 overflow-hidden rounded-lg" style={{ width: 72, height: 48, background }} />
            </div>
            <div className="min-w-0 flex items-center">
              <InlineRename
                value={canvas.name}
                editing={renaming}
                onEditingChange={setRenaming}
                ariaLabel="重命名画布"
                onConfirm={(next) => onRename(canvas.id, next)}
              />
              {canvas.isPublic && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 ml-1 shrink-0">公开</span>}
            </div>
            <div className="text-sm text-white">画布</div>
            <div className="text-sm text-white" />
            <div className="text-sm text-white whitespace-nowrap">{formatDateTime(canvas.createdAt)}</div>
            <div className="text-sm text-white whitespace-nowrap">编辑于 {formatRelativeTime(canvas.updatedAt)}</div>
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
      data-testid={`canvas-card-${canvas.id}`}
      tabIndex={0}
      role="button"
      onClick={() => onClick(canvas)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(canvas); }}
      className="rounded-2xl bg-[#1F1F1F] hover:bg-[#262626] outline outline-white/[0.08] hover:outline-white/[0.16] -outline-offset-1 transition-all duration-200 p-2 pb-2 cursor-pointer overflow-hidden relative group/menu h-full box-border"
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
