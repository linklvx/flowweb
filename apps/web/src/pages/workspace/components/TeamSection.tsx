import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Input, message } from 'antd';
import { teamDisplayName, type MyTeam } from '@/api/teamApi';
import { useWorkspaceData } from '../hooks/useWorkspaceData';
import { FolderCard } from './FolderCard';
import { CanvasCard } from './CanvasCard';
import { CreateCanvasCard } from './CreateCanvasCard';
import { CreateCanvasModal } from './CreateCanvasModal';
import { CreateFolderModal } from './CreateFolderModal';
import type { Canvas, FolderViewModel } from '../types';
import { MoveToFolderModal } from './MoveToFolderModal';

interface TeamSectionProps {
  team: MyTeam;
}

/** 团队页签的单团队区块：文件夹/搜索/新建与个人页签完全隔离（D7：文件夹导航用内部 state 不进 URL） */
export function TeamSection({ team }: TeamSectionProps) {
  const navigate = useNavigate();
  const data = useWorkspaceData(team.id);
  const [search, setSearch] = useState('');
  const [canvasModal, setCanvasModal] = useState(false);
  const [folderModal, setFolderModal] = useState<{ open: boolean; rename?: FolderViewModel }>({ open: false });
  const [moveTarget, setMoveTarget] = useState<Canvas | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);

  const visibleFolders = data.folders.filter(
    (f) => (folderId ? f.parentId === folderId : !f.parentId) && (!search || f.name.toLowerCase().includes(search.toLowerCase())),
  );
  const filtered = data.canvases.filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()));

  const openCanvas = (canvasProjectId: string) => navigate(`/canvas?projectId=${canvasProjectId}`);

  const handleCreateCanvas = async (name: string, targetFolderId: string | null) => {
    try {
      const projectId = await data.createCanvas(name, targetFolderId);
      setCanvasModal(false);
      openCanvas(projectId);
    } catch (err) {
      message.error('创建失败：' + (err as Error).message);
    }
  };

  const handleFolderOk = async (name: string) => {
    const renaming = folderModal.rename;
    setFolderModal({ open: false });
    try {
      if (renaming) await data.renameFolder(renaming.id, name);
      else await data.createFolder(name);
    } catch (err) {
      message.error((renaming ? '重命名失败：' : '创建失败：') + (err as Error).message);
    }
  };

  return (
    <section className="mb-10" data-testid={`team-section-${team.id}`}>
      <div className="flex items-center justify-between px-8 mb-3">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-bold text-white">{teamDisplayName(team)}</h3>
          <span className="text-xs text-[#888]">{team.memberCount} 名成员</span>
        </div>
        <div className="flex items-center gap-2">
          <Input
            aria-label={`搜索-${team.id}`}
            placeholder="搜索"
            size="small"
            style={{ width: 140 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button size="small" data-testid={`team-create-folder-${team.id}`} onClick={() => setFolderModal({ open: true })}>新建文件夹</Button>
          <Button type="primary" size="small" data-testid={`team-create-canvas-${team.id}`} onClick={() => setCanvasModal(true)}>
            新建画布
          </Button>
        </div>
      </div>
      {folderId && (
        <div className="px-8 mb-2">
          <button className="text-xs text-[#5DDCFF] cursor-pointer bg-transparent border-none" onClick={() => { setFolderId(null); void data.loadFolder(null); }}>
            ← 返回团队根目录
          </button>
        </div>
      )}
      <div className="px-8 grid gap-3 grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
        {data.status === 'loading' ? (
          <p className="text-sm text-[#888]">加载中…</p>
        ) : (
          <>
            {visibleFolders.map((f) => (
              <FolderCard
                key={f.id}
                folder={f}
                variant="grid"
                showCount={!search}
                onClick={() => { setFolderId(f.id); void data.loadFolder(f.id); }}
                onRequestRename={(folder) => setFolderModal({ open: true, rename: folder })}
                onDelete={() => void data.deleteFolder(f.id)}
              />
            ))}
            {filtered.map((c) => (
              <CanvasCard
                key={c.id}
                canvas={c}
                variant="grid"
                onClick={() => (c.projectId ? openCanvas(c.projectId) : navigate(`/works/${c.id}`))}
                onRename={data.renameCanvas}
                onMove={setMoveTarget}
                onTogglePublic={data.togglePublic}
                onDelete={(canvas) => { void data.deleteCanvas(canvas.id); }}
              />
            ))}
            <CreateCanvasCard onClick={() => setCanvasModal(true)} />
          </>
        )}
      </div>
      {data.hasMore && (
        <div className="px-8 mt-3">
          <Button block onClick={() => void data.loadMore()}>加载更多</Button>
        </div>
      )}
      <CreateCanvasModal
        open={canvasModal}
        teamId={team.id}
        folders={data.folders}
        defaultFolderId={folderId}
        onOk={(name, targetFolderId) => void handleCreateCanvas(name, targetFolderId)}
        onCancel={() => setCanvasModal(false)}
      />
      <CreateFolderModal
        open={folderModal.open}
        initialName={folderModal.rename?.name}
        onOk={(name) => void handleFolderOk(name)}
        onCancel={() => setFolderModal({ open: false })}
      />
      <MoveToFolderModal
        open={!!moveTarget}
        folders={data.folders}
        currentFolderId={moveTarget?.folderId ?? null}
        onOk={(targetFolderId) => {
          if (moveTarget) void data.moveCanvas(moveTarget.id, targetFolderId);
          setMoveTarget(null);
        }}
        onCancel={() => setMoveTarget(null)}
      />
    </section>
  );
}
