import { useEffect, useRef, useState } from 'react';
import { Dropdown, Button } from 'antd';
import { SearchOutlined, DownOutlined, AppstoreOutlined, UnorderedListOutlined, UploadOutlined, FolderAddOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import type { FilterKind, ViewMode } from '../types';
import { message } from 'antd';

interface WorkspaceToolbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onSearchChange: (query: string) => void;
  filter: FilterKind;
  onFilterChange: (filter: FilterKind) => void;
  onCreateFolder: () => void;
}

const FILTER_LABEL: Record<FilterKind, string> = { all: '显示全部', folders: '仅文件夹', canvases: '仅画布' };

export function WorkspaceToolbar({ viewMode, onViewModeChange, onSearchChange, filter, onFilterChange, onCreateFolder }: WorkspaceToolbarProps) {
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
    <div className="flex flex-col md:flex-row items-start md:items-center gap-y-2 justify-between px-8 pb-2">
      <div className="flex items-center gap-2">
        <div className="h-10 px-3 flex items-center gap-1 bg-white/5 rounded-lg ring-1 ring-inset ring-white/10 focus-within:ring-white/20" style={{ width: 160 }}>
          <SearchOutlined className="text-[#646464] shrink-0" />
          <input
            aria-label="搜索"
            type="text" placeholder="搜索" value={text}
            onChange={(e) => handleSearch(e.target.value)}
            className="flex-1 bg-transparent border-none text-sm text-white placeholder:text-[#646464] min-w-0 focus:outline-none"
          />
        </div>
        <Dropdown menu={{ items: filterMenu, onClick: ({ key }) => onFilterChange(key as FilterKind) }} trigger={['click']}>
          <button className="h-10 px-3 flex items-center gap-1 bg-white/5 rounded-lg ring-1 ring-inset ring-white/10 hover:bg-white/10 text-white text-sm border-none cursor-pointer">
            {FILTER_LABEL[filter]}
            <DownOutlined style={{ fontSize: 12 }} />
          </button>
        </Dropdown>
        <div className="p-1 flex items-center gap-2 bg-white/5 rounded-lg ring-1 ring-inset ring-white/10">
          <button
            aria-label="Grid view"
            onClick={() => onViewModeChange('grid')}
            className={`p-1.5 rounded-md border-none cursor-pointer ${viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'}`}
          >
            <AppstoreOutlined />
          </button>
          <button
            aria-label="List view"
            onClick={() => onViewModeChange('list')}
            className={`p-1.5 rounded-md border-none cursor-pointer ${viewMode === 'list' ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'}`}
          >
            <UnorderedListOutlined />
          </button>
        </div>
        <div className="h-6 w-px bg-white/10 mx-1" />
        <Button aria-label="导入" icon={<UploadOutlined />} onClick={() => message.info('即将上线')} style={{ width: 40 }} />
        <Button type="primary" icon={<FolderAddOutlined />} onClick={onCreateFolder}>新建文件夹</Button>
      </div>
    </div>
  );
}
