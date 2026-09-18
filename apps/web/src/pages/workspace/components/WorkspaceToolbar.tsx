import { useEffect, useRef, useState } from 'react';
import { Dropdown } from 'antd';
import { SearchOutlined, DownOutlined, AppstoreOutlined, UnorderedListOutlined, FolderAddOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import type { FilterKind, ViewMode } from '../types';
import { WorkspaceTabBar } from './WorkspaceTabBar';

interface WorkspaceToolbarProps {
  activeTab: 'personal' | 'team';
  onTabChange: (tab: 'personal' | 'team') => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onSearchChange: (query: string) => void;
  filter: FilterKind;
  onFilterChange: (filter: FilterKind) => void;
  onCreateFolder: () => void;
}

const FILTER_LABEL: Record<FilterKind, string> = { all: '显示全部', folders: '仅文件夹', canvases: '仅画布' };

export function WorkspaceToolbar({ activeTab, onTabChange, viewMode, onViewModeChange, onSearchChange, filter, onFilterChange, onCreateFolder }: WorkspaceToolbarProps) {
  const [text, setText] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const handleSearch = (value: string) => {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onSearchChange(value.trim()), 300);
  };

  const filterMenu: MenuProps['items'] = [
    { key: 'all', label: '显示全部' },
    { key: 'folders', label: '仅文件夹' },
    { key: 'canvases', label: '仅画布' },
  ];

  return (
    <div className="flex flex-col md:flex-row items-start gap-y-2 pt-2 pb-2 justify-between px-8">
      <WorkspaceTabBar activeTab={activeTab} onTabChange={onTabChange} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="h-10 px-3 flex items-center gap-1 bg-overlay-1 rounded-lg ring-1 ring-inset ring-overlay-2 focus-within:ring-overlay-3 transition-colors" style={{ width: 160 }}>
          <SearchOutlined className="text-text-dim-1 shrink-0" />
          <input
            aria-label="搜索"
            type="text" placeholder="搜索" value={text}
            onChange={(e) => handleSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm text-text placeholder:text-text-dim-1 min-w-0 focus:outline-none"
          />
        </div>
        <Dropdown menu={{ items: filterMenu, onClick: ({ key }) => onFilterChange(key as FilterKind) }} trigger={['click']}>
          <button className="h-10 px-3 flex items-center gap-1 bg-overlay-1 rounded-lg ring-1 ring-inset ring-overlay-2 hover:bg-overlay-2 text-text text-sm border-none transition-colors">
            {FILTER_LABEL[filter]}
            <DownOutlined style={{ fontSize: 12 }} />
          </button>
        </Dropdown>
        <div className="p-1 flex items-center gap-2 bg-overlay-1 rounded-lg ring-1 ring-inset ring-overlay-2">
          <button
            aria-label="Grid view"
            onClick={() => onViewModeChange('grid')}
            className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-overlay-2 text-text' : 'text-text-dim-3 hover:bg-overlay-1 bg-transparent'}`}
          >
            <AppstoreOutlined />
          </button>
          <button
            aria-label="List view"
            onClick={() => onViewModeChange('list')}
            className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-overlay-2 text-text' : 'text-text-dim-3 hover:bg-overlay-1 bg-transparent'}`}
          >
            <UnorderedListOutlined />
          </button>
        </div>
        <div className="h-6 w-px bg-overlay-2 mx-1" />
        <button
          onClick={onCreateFolder}
          className="h-10 px-3 flex items-center gap-1 bg-overlay-2 hover:bg-overlay-3 rounded-lg text-text text-sm font-medium transition-colors"
        ><FolderAddOutlined />新建文件夹</button>
      </div>
    </div>
  );
}
