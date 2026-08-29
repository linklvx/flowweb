import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { Navbar } from '@/pages/home/components/Navbar';
import { getMyTeams, type MyTeam } from '@/api/teamApi';
import { useWorkspaceData } from './hooks/useWorkspaceData';
import { useFolderNavigation } from './hooks/useFolderNavigation';
import { WorkspaceToolbar } from './components/WorkspaceToolbar';
import { WorkspaceBreadcrumb } from './components/WorkspaceBreadcrumb';
import { CreateCanvasCard } from './components/CreateCanvasCard';
import { FolderCard } from './components/FolderCard';
import { CanvasCard } from './components/CanvasCard';
import { CreateFolderModal } from './components/CreateFolderModal';
import { CreateCanvasModal } from './components/CreateCanvasModal';
import { MoveToFolderModal } from './components/MoveToFolderModal';
import { TeamSection } from './components/TeamSection';
import { EmptyState } from './components/EmptyState';
import { CardGridSkeleton } from './components/CardGridSkeleton';
import type { Canvas, FilterKind, FolderViewModel, ViewMode, WorkspaceItem } from './types';

const byUpdatedDesc = (a: { updatedAt: string }, b: { updatedAt: string }) => b.updatedAt.localeCompare(a.updatedAt);

export function WorkspacePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: 'personal' | 'team' = searchParams.get('tab') === 'team' ? 'team' : 'personal';
  const setTab = (t: 'personal' | 'team') => {
    // 切页签清 folder（D3）：跨 scope 的 folder id 无意义
    setSearchParams(t === 'team' ? { tab: 'team' } : {}, { replace: true });
  };
  const data = useWorkspaceData();
  const nav = useFolderNavigation(data.folders, data.status !== 'loading' && tab === 'personal');

  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterKind>('all');
  const [folderModal, setFolderModal] = useState<{ open: boolean; rename?: FolderViewModel }>({ open: false });
  const [canvasModal, setCanvasModal] = useState(false);
  const [moveTarget, setMoveTarget] = useState<Canvas | null>(null);

  // 团队页签：首次进入拉团队列表，过滤默认团队（个人项目不走团队区块）
  const [teams, setTeams] = useState<MyTeam[] | null>(null);
  useEffect(() => {
    if (tab !== 'team' || teams !== null) return;
    getMyTeams().then(setTeams).catch(() => message.error('团队列表加载失败'));
  }, [tab, teams]);
  const realTeams = (teams ?? []).filter((t) => !t.isDefault);
  const ownedTeams = realTeams.filter((t) => t.isOwner);
  const joinedTeams = realTeams.filter((t) => !t.isOwner);

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

  // URL → currentFolderId 单一数据流：点击导航与直链/刷新都经此加载对应文件夹画布。
  // 首帧为根目录时 hook 的初始加载已覆盖，跳过避免重复请求；直链文件夹仍在此加载。
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      if (nav.currentFolderId === null) return;
    }
    void data.loadFolder(nav.currentFolderId);
  }, [nav.currentFolderId, data.loadFolder]);

  // 统一入口：进入文件夹 = 定位 + 清搜索（数据加载由上面的 effect 接管）
  const enterFolder = (folderId: string | null) => {
    nav.setCurrentFolderId(folderId);
    setSearchQuery('');
  };

  const onItemClick = (item: WorkspaceItem) => {
    if (data.status === 'loading') return; // 加载中不导航
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
    <div className="min-h-screen bg-black text-white">
      <Navbar />
      <div className="mx-auto max-w-[1640px] pt-4">
        <WorkspaceToolbar
          viewMode={viewMode} onViewModeChange={setViewMode}
          onSearchChange={setSearchQuery}
          filter={filter} onFilterChange={setFilter}
          onCreateFolder={() => setFolderModal({ open: true })}
          activeTab={tab}
          onTabChange={setTab}
          showTools={tab === 'personal'}
        />
        {tab === 'personal' && (
          <WorkspaceBreadcrumb
            path={nav.path} currentFolderId={nav.currentFolderId}
            searchQuery={searchQuery}
            onNavigate={enterFolder}
            onClearSearch={() => setSearchQuery('')}
          />
        )}
        {tab === 'team' ? (
          <main className="flex-1 overflow-y-auto pt-4">
            {teams === null ? (
              <p className="text-sm text-[#888] px-8">加载中…</p>
            ) : realTeams.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3" data-testid="team-empty-state">
                <p className="text-sm text-[#888]">还没有团队，创建一个开始协作吧</p>
                <Button type="primary" onClick={() => navigate('/team')}>前往创建团队</Button>
              </div>
            ) : (
              <>
                {ownedTeams.length > 0 && (
                  <>
                    <h2 className="px-8 text-sm font-bold text-[#888] mb-2 mt-2">我创建的</h2>
                    {ownedTeams.map((t) => <TeamSection key={t.id} team={t} />)}
                  </>
                )}
                {joinedTeams.length > 0 && (
                  <>
                    <h2 className="px-8 text-sm font-bold text-[#888] mb-2 mt-2">我加入的</h2>
                    {joinedTeams.map((t) => <TeamSection key={t.id} team={t} />)}
                  </>
                )}
              </>
            )}
          </main>
        ) : (
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
            <>
              <ul className="flex flex-col" data-testid="workspace-list">
                {showCreateCanvasCard && (
                  <li data-testid="create-canvas-card" className="px-4 py-2">
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
