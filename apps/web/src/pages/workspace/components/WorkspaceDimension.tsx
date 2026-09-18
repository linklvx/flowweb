import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useWorkspaceData } from '../hooks/useWorkspaceData';
import { useFolderNavigation } from '../hooks/useFolderNavigation';
import { WorkspaceToolbar } from './WorkspaceToolbar';
import { WorkspaceBreadcrumb } from './WorkspaceBreadcrumb';
import { CreateCanvasCard } from './CreateCanvasCard';
import { FolderCard } from './FolderCard';
import { CanvasCard } from './CanvasCard';
import { CreateFolderModal } from './CreateFolderModal';
import { CreateCanvasModal } from './CreateCanvasModal';
import { MoveToFolderModal } from './MoveToFolderModal';
import { EmptyState } from './EmptyState';
import { CardGridSkeleton } from './CardGridSkeleton';
import type { Canvas, FilterKind, FolderViewModel, ViewMode, WorkspaceItem } from '../types';

const byUpdatedDesc = (a: { updatedAt: string }, b: { updatedAt: string }) => b.updatedAt.localeCompare(a.updatedAt);

interface WorkspaceDimensionProps {
  teamId?: string;
  dimensionLabel?: string;
  activeTab?: 'personal' | 'team';
  onTabChange?: (tab: 'personal' | 'team') => void;
  children?: ReactNode;
}

/**
 * 工作区维度组件：个人（teamId=undefined）与团队 tab 选中团队渲染同一组件。
 * 以 key={teamId ?? 'personal'} 重挂载实现切维度状态归零；nav+data+URL effect 全部内聚，
 * 父组件只产出有效选中 teamId。activeTab/onTabChange/children 供头部合并行（Tabs 左区 + 团队 Tabs 插槽）。
 */
export function WorkspaceDimension({ teamId, dimensionLabel = '个人项目', activeTab = 'personal', onTabChange, children }: WorkspaceDimensionProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // initialFolderId 取 URL 原始值（未经 nav valid 过滤——挂载瞬间 folders 为空会被判无效）
  const initialFolderIdRef = useRef(searchParams.get('folder'));

  const data = useWorkspaceData(teamId, initialFolderIdRef.current);
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

  const showCreateCanvasCard = !searchQuery && filter !== 'folders';

  // URL→loadFolder 单一数据流（raw + lastLoadedRef）：盯「原始 searchParams」而非
  // nav.currentFolderId——nav 值经 valid 过滤，挂载瞬间 folders 为空 →
  // 有效 folder 也返回 null，请求回来后 null→yyy 跳变会被误判为"后续导航"造成双发。
  // 基准初始化 = 挂载时 raw → 首帧必然等于基准自然被吞；与 fallback effect（同盯 raw）数据源一致。
  const rawFolderId = searchParams.get('folder');
  const lastLoadedRef = useRef<string | null>(rawFolderId);
  useEffect(() => {
    if (rawFolderId === lastLoadedRef.current) return; // valid 恢复造成的跳变 / 首帧，mount 已加载，吞掉
    lastLoadedRef.current = rawFolderId;
    void data.loadFolder(rawFolderId);
  }, [rawFolderId, data.loadFolder]);

  const enterFolder = (folderId: string | null) => {
    nav.setCurrentFolderId(folderId);
    setSearchQuery('');
  };

  const onItemClick = (item: WorkspaceItem) => {
    if (data.status === 'loading') return;
    if (item.type === 'folder') enterFolder(item.data.id);
    // 画布卡片 id 是 template id，进编辑器需用其关联的 projectId
    else if (item.data.projectId) navigate(`/canvas?projectId=${item.data.projectId}`);
    else navigate(`/works/${item.data.id}`);
  };

  const handleDeleteFolder = async (folder: FolderViewModel) => {
    try {
      const moved = await data.deleteFolder(folder.id);
      message.success(moved > 0 ? `文件夹已删除，${moved} 张画布已移至根目录` : '文件夹已删除');
    } catch {
      message.error('删除失败，请重试');
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

  const isEmpty = items.length === 0 && !showCreateCanvasCard;

  return (
    <>
      <WorkspaceToolbar
        activeTab={activeTab} onTabChange={onTabChange ?? (() => {})}
        viewMode={viewMode} onViewModeChange={setViewMode}
        onSearchChange={setSearchQuery}
        filter={filter} onFilterChange={setFilter}
        onCreateFolder={() => setFolderModal({ open: true })}
      />
      {children}
      <WorkspaceBreadcrumb
        path={nav.path} currentFolderId={nav.currentFolderId}
        searchQuery={searchQuery}
        dimensionLabel={dimensionLabel}
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
          <>
            <ul className={gridClass} data-testid="workspace-grid">
              {showCreateCanvasCard && (
                <li data-testid="create-canvas-card"><CreateCanvasCard onClick={() => setCanvasModal(true)} /></li>
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
                      onDelete={(c) => { void data.deleteCanvas(c.id); }}
                    />
                  )}
                </li>
              ))}
            </ul>
            {data.hasMore && !searchQuery && (
              <button
                data-testid="load-more"
                onClick={() => { void data.loadMore(); }}
                className="mt-4 mx-auto block px-6 py-2 border border-white/20 rounded-lg text-sm text-white/70 bg-transparent cursor-pointer hover:border-white/40"
              >
                加载更多
              </button>
            )}
          </>
        )}
        {data.status === 'success' && !isEmpty && viewMode === 'list' && (
          <div data-testid="workspace-list-shell" className="rounded-xl bg-white/5 overflow-hidden">
            <div className="px-4 pt-5">
              <div className="flex items-center">
                <div className="shrink-0" style={{ width: 32 }} />
                <div
                  className="grid flex-1 items-center gap-4 pl-4 pr-12 text-sm text-white/40"
                  style={{ gridTemplateColumns: '72px 1fr 70px 100px 145px 145px' }}
                >
                  <div>预览</div>
                  <div>名称</div>
                  <div>类型</div>
                  <div>内容</div>
                  <div>创建时间</div>
                  <div>最近更新</div>
                </div>
              </div>
              <div className="mx-12 mr-4 mt-4 border-b border-white/10" />
            </div>
            {/* 外层 div 承担左右 padding：ul 依赖 preflight 的 margin/padding 归零重置，不自带水平 padding */}
            <div className="px-4 pb-5">
              <ul className="flex flex-col" data-testid="workspace-list">
                {showCreateCanvasCard && (
                  <li data-testid="create-canvas-card" className="py-2">
                    <button
                      onClick={() => setCanvasModal(true)}
                      className="h-12 w-full flex items-center justify-center gap-2 border border-dashed border-white/20 rounded-lg text-sm text-white/60 bg-transparent cursor-pointer hover:border-white/40"
                    >
                      <PlusOutlined /> 新建画布
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
                        onDelete={(c) => { void data.deleteCanvas(c.id); }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>
            {data.hasMore && !searchQuery && (
              <div className="px-4 pb-4">
                <button
                  data-testid="load-more"
                  onClick={() => { void data.loadMore(); }}
                  className="mx-auto block px-6 py-2 border border-white/20 rounded-lg text-sm text-white/70 bg-transparent cursor-pointer hover:border-white/40"
                >
                  加载更多
                </button>
              </div>
            )}
          </div>
        )}
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
        teamId={teamId}
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
    </>
  );
}
