import { useCallback, useEffect, useMemo, useState } from 'react';
import { message } from 'antd';
import { getTemplates, updateTemplate, deleteTemplate } from '@/api/templateApi';
import { createProject } from '@/api/projectApi';
import type { Canvas, Folder, FolderViewModel } from '../types';
import { MOCK_FOLDERS, buildInitialFolderMap } from '../fixtures';
import { getCanvasGradient } from '../utils/gradient';

const byUpdatedDesc = (a: { updatedAt: string }, b: { updatedAt: string }) =>
  b.updatedAt.localeCompare(a.updatedAt);

export function useWorkspaceData() {
  const [rawCanvases, setRawCanvases] = useState<Canvas[]>([]);
  const [folders, setFolders] = useState<Folder[]>(MOCK_FOLDERS);
  const [folderMap, setFolderMap] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');

  const reload = useCallback(async () => {
    setStatus('loading');
    try {
      const data: any = await getTemplates({ type: 'my', limit: 100 });
      const canvases: Canvas[] = (data.templates ?? []).map((t: any) => ({
        id: t.id, name: t.name, coverUrl: t.coverUrl ?? null, isPublic: !!t.isPublic,
        createdAt: t.createdAt, updatedAt: t.updatedAt, folderId: null,
      }));
      setRawCanvases(canvases);
      setFolderMap(buildInitialFolderMap(canvases.map((c) => c.id)));
      setStatus('success');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // 归属单源合并：本地优先（后端阶段删除 folderMap 即直连真实 folderId）
  const canvases = useMemo(
    () => rawCanvases.map((c) => ({ ...c, folderId: folderMap[c.id] ?? c.folderId })),
    [rawCanvases, folderMap],
  );

  const folderViewModels = useMemo<FolderViewModel[]>(() => {
    return folders.map((f) => {
      const mine = canvases.filter((c) => c.folderId === f.id);
      const thumbnails = [...mine]
        .sort(byUpdatedDesc)
        .slice(0, 3)
        .map((c) => (c.coverUrl ? `url("${c.coverUrl}")` : getCanvasGradient(c.id)));
      return { ...f, canvasCount: mine.length, thumbnails };
    });
  }, [folders, canvases]);

  const touchFolders = useCallback((ids: string[]) => {
    const now = new Date().toISOString();
    setFolders((prev) => prev.map((f) => (ids.includes(f.id) ? { ...f, updatedAt: now } : f)));
  }, []);

  const createFolder = useCallback((name: string) => {
    const now = new Date().toISOString();
    setFolders((prev) => [
      ...prev,
      { id: `folder-${Date.now()}`, name, parentId: null, workspaceId: 'personal', createdAt: now, updatedAt: now },
    ]);
  }, []);

  const renameFolder = useCallback((id: string, name: string) => {
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name, updatedAt: new Date().toISOString() } : f)));
  }, []);

  const deleteFolder = useCallback((id: string) => {
    if (canvases.some((c) => c.folderId === id)) throw new Error('请先移出画布');
    setFolders((prev) => prev.filter((f) => f.id !== id));
  }, [canvases]);

  const moveCanvas = useCallback((canvasId: string, folderId: string | null) => {
    const source = folderMap[canvasId] ?? null;
    setFolderMap((prev) => {
      const next = { ...prev };
      if (folderId === null) delete next[canvasId];
      else next[canvasId] = folderId;
      return next;
    });
    const touched = [source, folderId].filter((v): v is string => !!v);
    if (touched.length) touchFolders(touched);
  }, [folderMap, touchFolders]);

  const renameCanvas = useCallback(async (id: string, name: string) => {
    const prev = rawCanvases;
    setRawCanvases((cs) => cs.map((c) => (c.id === id ? { ...c, name } : c)));
    try {
      await updateTemplate(id, { name });
    } catch {
      setRawCanvases(prev);
      message.error('重命名失败，请重试');
    }
  }, [rawCanvases]);

  const togglePublic = useCallback(async (id: string) => {
    const target = rawCanvases.find((c) => c.id === id);
    if (!target) return;
    const prev = rawCanvases;
    setRawCanvases((cs) => cs.map((c) => (c.id === id ? { ...c, isPublic: !c.isPublic } : c)));
    try {
      await updateTemplate(id, { isPublic: !target.isPublic });
    } catch {
      setRawCanvases(prev);
      message.error('操作失败，请重试');
    }
  }, [rawCanvases]);

  const deleteCanvas = useCallback(async (id: string) => {
    const prev = rawCanvases;
    const sourceFolder = folderMap[id] ?? null;
    setRawCanvases((cs) => cs.filter((c) => c.id !== id));
    try {
      await deleteTemplate(id);
      if (sourceFolder) touchFolders([sourceFolder]); // 成功才级联刷新，失败回滚时不动
    } catch {
      setRawCanvases(prev);
      message.error('删除失败，请重试');
    }
  }, [rawCanvases, folderMap, touchFolders]);

  const createCanvas = useCallback(async (name: string, folderId: string | null) => {
    const project: any = await createProject(name);
    const now = new Date().toISOString();
    setRawCanvases((prev) => [
      { id: `placeholder-${project.id}`, name, coverUrl: null, isPublic: false,
        createdAt: now, updatedAt: now, folderId: null, isPlaceholder: true },
      ...prev,
    ]);
    if (folderId) {
      setFolderMap((prev) => ({ ...prev, [`placeholder-${project.id}`]: folderId }));
      touchFolders([folderId]);
    }
    return project.id as string;
  }, [touchFolders]);

  const deletePlaceholder = useCallback((id: string) => {
    setRawCanvases((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return {
    status, reload,
    folders: folderViewModels, canvases,
    createFolder, renameFolder, deleteFolder,
    moveCanvas, renameCanvas, togglePublic, deleteCanvas,
    createCanvas, deletePlaceholder,
  };
}
