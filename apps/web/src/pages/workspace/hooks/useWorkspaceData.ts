import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { getTemplates, updateTemplate, deleteTemplate } from '@/api/templateApi';
import { getFolders, createFolder as apiCreateFolder, renameFolder as apiRenameFolder, deleteFolder as apiDeleteFolder } from '@/api/folderApi';
import { createCanvas as apiCreateCanvas } from '@/api/canvasApi';
import type { Canvas, FolderViewModel } from '../types';
import { getCanvasGradient } from '../utils/gradient';

const PAGE_SIZE = 20;

function toCanvas(t: any): Canvas {
  return {
    id: t.id, projectId: t.projectId ?? null, name: t.name, coverUrl: t.coverUrl ?? null, isPublic: !!t.isPublic,
    createdAt: t.createdAt, updatedAt: t.updatedAt, folderId: t.folderId ?? null,
  };
}

export function useWorkspaceData() {
  const [canvases, setCanvases] = useState<Canvas[]>([]);
  const [folders, setFolders] = useState<FolderViewModel[]>([]);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const currentRef = useRef<string | null>(null);
  const pageRef = useRef(1);

  const refreshFolders = useCallback(async () => {
    const data = await getFolders();
    setFolders(data.folders.map((f) => ({
      id: f.id, name: f.name, parentId: f.parentId,
      createdAt: f.createdAt, updatedAt: f.updatedAt,
      canvasCount: f.canvasCount,
      thumbnails: f.thumbnails.map((t) => (t.coverUrl ? `url("${t.coverUrl}")` : getCanvasGradient(t.id))),
    })));
  }, []);

  const loadFolder = useCallback(async (folderId: string | null) => {
    currentRef.current = folderId;
    pageRef.current = 1;
    setPage(1);
    setStatus('loading');
    try {
      const [, data] = await Promise.all([
        refreshFolders(),
        getTemplates({ type: 'my', folderId: folderId ?? 'root', page: 1, limit: PAGE_SIZE }),
      ]);
      setCanvases((data.templates ?? []).map(toCanvas));
      setHasMore(1 < (data.totalPages ?? 1));
      setStatus('success');
    } catch {
      setStatus('error');
    }
  }, [refreshFolders]);

  useEffect(() => { loadFolder(null); }, [loadFolder]);

  const reload = useCallback(() => loadFolder(currentRef.current), [loadFolder]);

  const loadMore = useCallback(async () => {
    const next = pageRef.current + 1;
    const folderId = currentRef.current;
    try {
      const data = await getTemplates({ type: 'my', folderId: folderId ?? 'root', page: next, limit: PAGE_SIZE });
      setCanvases((prev) => [...prev, ...(data.templates ?? []).map(toCanvas)]);
      pageRef.current = next;
      setPage(next);
      setHasMore(next < (data.totalPages ?? 1));
    } catch {
      message.error('加载失败，请重试');
    }
  }, []);

  const createFolder = useCallback(async (name: string) => {
    await apiCreateFolder(name);
    await refreshFolders();
  }, [refreshFolders]);

  const renameFolder = useCallback(async (id: string, name: string) => {
    const prev = folders;
    const now = new Date().toISOString();
    setFolders((fs) => fs.map((f) => (f.id === id ? { ...f, name, updatedAt: now } : f)));
    try {
      await apiRenameFolder(id, name);
    } catch {
      setFolders(prev);
      message.error('重命名失败，请重试');
    }
  }, [folders]);

  const deleteFolder = useCallback(async (id: string): Promise<number> => {
    const { movedCanvasCount } = await apiDeleteFolder(id);
    // 删除的是当前浏览的文件夹 → 回根目录；删除其他文件夹 → 保持当前视图
    const target = currentRef.current === id ? null : currentRef.current;
    await Promise.all([refreshFolders(), loadFolder(target)]);
    return movedCanvasCount;
  }, [refreshFolders, loadFolder]);

  const moveCanvas = useCallback(async (canvasId: string, folderId: string | null) => {
    const prev = canvases;
    setCanvases((cs) => cs.map((c) => (c.id === canvasId ? { ...c, folderId } : c)));
    try {
      await updateTemplate(canvasId, { folderId });
    } catch {
      setCanvases(prev);
      message.error('移动失败，请重试');
    }
  }, [canvases]);

  const renameCanvas = useCallback(async (id: string, name: string) => {
    const prev = canvases;
    setCanvases((cs) => cs.map((c) => (c.id === id ? { ...c, name } : c)));
    try {
      await updateTemplate(id, { name });
    } catch {
      setCanvases(prev);
      message.error('重命名失败，请重试');
    }
  }, [canvases]);

  const togglePublic = useCallback(async (id: string) => {
    const target = canvases.find((c) => c.id === id);
    if (!target) return;
    const prev = canvases;
    setCanvases((cs) => cs.map((c) => (c.id === id ? { ...c, isPublic: !c.isPublic } : c)));
    try {
      await updateTemplate(id, { isPublic: !target.isPublic });
    } catch {
      setCanvases(prev);
      message.error('操作失败，请重试');
    }
  }, [canvases]);

  const deleteCanvas = useCallback(async (id: string) => {
    const prev = canvases;
    setCanvases((cs) => cs.filter((c) => c.id !== id));
    try {
      await deleteTemplate(id);
    } catch {
      setCanvases(prev);
      message.error('删除失败，请重试');
    }
  }, [canvases]);

  const createCanvas = useCallback(async (name: string, folderId: string | null): Promise<string> => {
    const { templateId, projectId } = await apiCreateCanvas(name, folderId);
    const now = new Date().toISOString();
    setCanvases((prev) => [
      { id: templateId, projectId, name, coverUrl: null, isPublic: false, createdAt: now, updatedAt: now, folderId },
      ...prev,
    ]);
    await refreshFolders();
    return projectId;
  }, [refreshFolders]);

  return {
    status, reload, folders, canvases, hasMore, page,
    loadFolder, loadMore,
    createFolder, renameFolder, deleteFolder,
    moveCanvas, renameCanvas, togglePublic, deleteCanvas, createCanvas,
  };
}
