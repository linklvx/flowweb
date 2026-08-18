import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { message } from 'antd';
import { FolderAddOutlined } from '@ant-design/icons';
import { Navbar } from '@/pages/home/components/Navbar';
import { useWorkspaceData } from './hooks/useWorkspaceData';
import { useFolderNavigation } from './hooks/useFolderNavigation';
import { WorkspaceToolbar } from './components/WorkspaceToolbar';
import { WorkspaceBreadcrumb } from './components/WorkspaceBreadcrumb';
import { CreateFolderCard } from './components/CreateFolderCard';
import { FolderCard } from './components/FolderCard';
import { CanvasCard } from './components/CanvasCard';
import { CreateFolderModal } from './components/CreateFolderModal';
import { CreateCanvasModal } from './components/CreateCanvasModal';
import { MoveToFolderModal } from './components/MoveToFolderModal';
import { EmptyState } from './components/EmptyState';
import { CardGridSkeleton } from './components/CardGridSkeleton';
import type { Canvas, FilterKind, FolderViewModel, ViewMode, WorkspaceItem } from './types';

const byUpdatedDesc = (a: { updatedAt: string }, b: { updatedAt: string }) => b.updatedAt.localeCompare(a.updatedAt);

export function WorkspacePage() {
  const navigate = useNavigate();
  const data = useWorkspaceData();
  const nav = useFolderNavigation(data.folders, data.status !== 'loading');

  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterKind>('all');
  const [folderModal, setFolderModal] = useState<{ open: boolean; rename?: FolderViewModel }>({ open: false });
  const [canvasModal, setCanvasModal] = useState(false);
  const [moveTarget, setMoveTarget] = useState<Canvas | null>(null);

  const items = useMemo<WorkspaceItem[]>(() => {
    let folders = data.folders;
    let canvases = data.canvases;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      folders = folders.filter((f) => f.name.toLowerCase().includes(q));
      canvases = canvases.filter((c) => c.name.toLowerCase().includes(q));
    } else {
      folders = folders.filter((f) => f.parentId === nav.currentFolderId);
      canvases = canvases.filter((c) => c.folderId === nav.currentFolderId);
    }
    if (filter === 'folders') canvases = [];
    if (filter === 'canvases') folders = [];
    return [
      ...[...folders].sort(byUpdatedDesc).map((f) => ({ type: 'folder' as const, data: f })),
      ...[...canvases].sort(byUpdatedDesc).map((c) => ({ type: 'canvas' as const, data: c })),
    ];
  }, [data.folders, data.canvases, searchQuery, filter, nav.currentFolderId]);

  const showCreateFolderCard = !searchQuery && filter !== 'canvases';

  // 统一入口：进入文件夹 = 定位 + 清搜索 + 同步 URL
  const enterFolder = (folderId: string | null) => {
    nav.setCurrentFolderId(folderId);
    setSearchQuery('');
  };

  const onItemClick = (item: WorkspaceItem) => {
    if (data.status === 'loading') return; // 加载中不导航
    if (item.type === 'folder') enterFolder(item.data.id);
    else if (item.data.isPlaceholder) navigate(`/canvas?projectId=${item.data.id.replace('placeholder-', '')}`);
    else navigate(`/works/${item.data.id}`);
  };

  const handleDeleteFolder = (folder: FolderViewModel) => {
    try {
      data.deleteFolder(folder.id);
      message.success('文件夹已删除');
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const handleCreateCanvas = async (name: string, folderId: string | null) => {
    setCanvasModal(false);
    try {
      const projectId = await data.createCanvas(name, folderId);
      navigate(`/canvas?projectId=${projectId}`);
    } catch {
      message.error('创建画布失败，请重试');
    }
  };

  const gridClass = 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4';

  const isEmpty = items.length === 0 && !showCreateFolderCard;

  return (
    <div className="min-h-screen bg-black text-white">
      <Navbar />
      <div className="mx-auto max-w-[1640px] pt-4">
        <WorkspaceToolbar
          viewMode={viewMode} onViewModeChange={setViewMode}
          onSearchChange={setSearchQuery}
          filter={filter} onFilterChange={setFilter}
          onCreateCanvas={() => setCanvasModal(true)}
        />
        <WorkspaceBreadcrumb
          path={nav.path} currentFolderId={nav.currentFolderId}
          searchQuery={searchQuery}
          onNavigate={enterFolder}
          onClearSearch={() => setSearchQuery('')}
        />
        <div className="px-8 pb-10">
          {data.status === 'loading' && <CardGridSkeleton />}
          {data.status === 'error' && <EmptyState variant="error" onAction={data.reload} />}
          {data.status === 'success' && isEmpty && (
            <EmptyState
              variant={searchQuery ? 'no-results' : nav.currentFolderId ? 'empty-folder' : 'empty-root'}
              onAction={searchQuery ? () => setSearchQuery('') : () => setCanvasModal(true)}
            />
          )}
          {data.status === 'success' && !isEmpty && viewMode === 'grid' && (
            <ul className={gridClass} data-testid="workspace-grid">
              {showCreateFolderCard && (
                <li data-testid="create-folder-card"><CreateFolderCard onClick={() => setFolderModal({ open: true })} /></li>
              )}
              {items.map((item) => (
                <li key={item.data.id}>
                  {item.type === 'folder' ? (
                    <FolderCard
                      folder={item.data}
                      showCount={!searchQuery}
                      onClick={() => onItemClick(item)}
                      onRequestRename={(f) => setFolderModal({ open: true, rename: f })}
                      onDelete={handleDeleteFolder}
                    />
                  ) : (
                    <CanvasCard
                      canvas={item.data}
                      onClick={() => onItemClick(item)}
                      onRename={data.renameCanvas}
                      onMove={setMoveTarget}
                      onTogglePublic={data.togglePublic}
                      onDelete={(c) => {
                        if (c.isPlaceholder) data.deletePlaceholder(c.id);
                        else void data.deleteCanvas(c.id);
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          {data.status === 'success' && !isEmpty && viewMode === 'list' && (
            <ul className="flex flex-col" data-testid="workspace-list">
              {showCreateFolderCard && (
                <li data-testid="create-folder-card" className="px-4 py-2">
                  <button
                    onClick={() => setFolderModal({ open: true })}
                    className="h-12 w-full flex items-center justify-center gap-2 border border-dashed border-white/20 rounded-lg text-sm text-white/60 bg-transparent cursor-pointer hover:border-white/40"
                  >
                    <FolderAddOutlined /> 新建文件夹
                  </button>
                </li>
              )}
              {items.map((item) => (
                <li key={item.data.id}>
                  {item.type === 'folder' ? (
                    <FolderCard
                      variant="list"
                      folder={item.data}
                      showCount={!searchQuery}
                      onClick={() => onItemClick(item)}
                      onRequestRename={(f) => setFolderModal({ open: true, rename: f })}
                      onDelete={handleDeleteFolder}
                    />
                  ) : (
                    <CanvasCard
                      variant="list"
                      canvas={item.data}
                      onClick={() => onItemClick(item)}
                      onRename={data.renameCanvas}
                      onMove={setMoveTarget}
                      onTogglePublic={data.togglePublic}
                      onDelete={(c) => {
                        if (c.isPlaceholder) data.deletePlaceholder(c.id);
                        else void data.deleteCanvas(c.id);
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <CreateFolderModal
        open={folderModal.open}
        initialName={folderModal.rename?.name}
        onOk={(name) => {
          if (folderModal.rename) data.renameFolder(folderModal.rename.id, name);
          else data.createFolder(name);
          setFolderModal({ open: false });
        }}
        onCancel={() => setFolderModal({ open: false })}
      />
      <CreateCanvasModal
        open={canvasModal}
        folders={data.folders}
        defaultFolderId={nav.currentFolderId}
        onOk={handleCreateCanvas}
        onCancel={() => setCanvasModal(false)}
      />
      <MoveToFolderModal
        open={!!moveTarget}
        folders={data.folders}
        currentFolderId={moveTarget?.folderId ?? null}
        onOk={(folderId) => { if (moveTarget) data.moveCanvas(moveTarget.id, folderId); setMoveTarget(null); }}
        onCancel={() => setMoveTarget(null)}
      />
    </div>
  );
}
