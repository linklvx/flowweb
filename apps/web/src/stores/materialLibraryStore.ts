import { create } from 'zustand';
import axios from 'axios';
import { message } from 'antd';
import { presignUpload, confirmUpload } from '@/api/storageApi';
import type { MaterialFolder, MaterialFile } from '@flowweb/shared';

const MAX_FILE_SIZE = { image: 10 * 1024 * 1024, video: 100 * 1024 * 1024 };

interface RenameModalState {
  open: boolean;
  folderId: string | null;
  defaultValue: string;
}

export interface MaterialLibraryContext {
  teamId?: string;
  projectId?: string;
}

const RENAME_MODAL_INIT: RenameModalState = { open: false, folderId: null, defaultValue: '' };

interface MaterialLibraryState {
  isOpen: boolean;
  selectedFolderId: string | null;
  folders: MaterialFolder[];
  files: MaterialFile[];
  fileGridSize: number;
  loading: boolean;
  uploading: boolean;
  uploadProgress: number;
  renameModal: RenameModalState;
  batchMode: boolean;
  selectedFileIds: Set<string>;
  context: MaterialLibraryContext;

  open: () => void;
  close: () => void;
  enterContext: (ctx: MaterialLibraryContext) => void;
  setSelectedFolder: (id: string | null) => void;
  setFileGridSize: (size: number) => void;
  setRenameModal: (value: RenameModalState) => void;
  loadFolders: () => Promise<void>;
  loadFiles: () => Promise<void>;
  createFolder: (name: string, parentId?: string | null) => Promise<void>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  moveFolderUp: (id: string) => Promise<void>;
  moveFolder: (id: string, dto: { parentId: string | null; afterId: string | null }) => Promise<void>;
  uploadFile: (file: File) => Promise<void>;
  deleteFile: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  enterBatchMode: () => void;
  exitBatchMode: () => void;
  selectFile: (id: string) => void;
  deselectFile: (id: string) => void;
  toggleFileSelection: (id: string) => void;
  selectAllFiles: () => void;
  batchDelete: () => Promise<void>;
  batchMove: (folderId: string | null) => Promise<void>;
}

export const useMaterialLibraryStore = create<MaterialLibraryState>((set, get) => {
  // 替换型序号：慢响应后到一律丢弃（spec §二.5）
  let foldersSeq = 0;
  let filesSeq = 0;

  return ({
  isOpen: false,
  selectedFolderId: null,
  folders: [],
  files: [],
  fileGridSize: 200,
  loading: false,
  uploading: false,
  uploadProgress: 0,

  renameModal: RENAME_MODAL_INIT,
  batchMode: false,
  selectedFileIds: new Set<string>(),
  context: {},

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false, batchMode: false, selectedFileIds: new Set() }),

  enterContext: (ctx) => {
    // 单一入口：完整重置 + reload（spec §二.3，时序约束编码进 API）
    set({
      context: ctx,
      selectedFolderId: null,
      folders: [],
      files: [],
      batchMode: false,
      selectedFileIds: new Set(),
      renameModal: RENAME_MODAL_INIT,
    });
    void get().loadFolders();
    void get().loadFiles();
  },
  setSelectedFolder: (id) => set({ selectedFolderId: id }),
  setFileGridSize: (size) => set({ fileGridSize: size }),
  setRenameModal: (value) => set({ renameModal: value }),

  loadFolders: async () => {
    const seq = ++foldersSeq;
    set({ loading: true });
    try {
      const { data } = await axios.get('/api/material/folders', {
        params: { teamId: get().context.teamId ?? undefined },
      });
      if (seq !== foldersSeq) return;
      if (data.data?.success) set({ folders: data.data.data });
    } catch {
      // silently handle error
    } finally {
      if (seq === foldersSeq) set({ loading: false });
    }
  },

  loadFiles: async () => {
    const seq = ++filesSeq;
    set({ loading: true, batchMode: false, selectedFileIds: new Set() });
    try {
      const { selectedFolderId } = get();
      const { data } = await axios.get('/api/material/files', {
        params: { folderId: selectedFolderId, teamId: get().context.teamId ?? undefined },
      });
      if (seq !== filesSeq) return;
      if (data.data?.success) {
        // Rewrite presigned GET URLs through Vite proxy to avoid CORS/network issues
        // Same pattern as upload: http://127.0.0.1:9000/flowai/... -> /flowai/...
        const files = (data.data.data as any[]).map((f: any) => ({
          ...f,
          url: (f.url as string).replace(/^https?:\/\/[^/]+\/flowai/, '/flowai'),
          thumbnailUrl: f.thumbnailUrl
            ? (f.thumbnailUrl as string).replace(/^https?:\/\/[^/]+\/flowai/, '/flowai')
            : undefined,
        }));
        set({ files });
      }
    } catch {
      // silently handle error
    } finally {
      if (seq === filesSeq) set({ loading: false });
    }
  },

  createFolder: async (name, parentId = null) => {
    const { folders, context } = get();
    const parentKey = parentId ?? null;
    const dup = folders.find((f) => f.name === name && (f.parentId ?? null) === parentKey);
    if (dup) { message.error('同名文件夹已存在'); return; }
    const body: { name: string; parentId: string | null; teamId?: string } = { name, parentId };
    if (context.teamId) body.teamId = context.teamId;
    await axios.post('/api/material/folders', body);
    await get().loadFolders();
  },

  renameFolder: async (id, name) => {
    const { folders, context } = get();
    const folder = folders.find((f) => f.id === id);
    if (!folder) return;
    const parentKey = folder.parentId ?? null;
    const dup = folders.find((f) => f.id !== id && f.name === name && (f.parentId ?? null) === parentKey);
    if (dup) { message.error('同名文件夹已存在'); return; }
    const body: { name: string; teamId?: string } = { name };
    if (context.teamId) body.teamId = context.teamId;
    await axios.put(`/api/material/folders/${id}`, body);
    await get().loadFolders();
  },

  deleteFolder: async (id) => {
    await axios.delete(`/api/material/folders/${id}`, { params: { teamId: get().context.teamId ?? undefined } });
    const { selectedFolderId } = get();
    if (selectedFolderId === id) set({ selectedFolderId: null });
    message.success('文件夹删除成功');
    await Promise.all([get().loadFolders(), get().loadFiles()]);
  },

  moveFolderUp: async (id) => {
    await axios.put(`/api/material/folders/${id}/move-up`, null, { params: { teamId: get().context.teamId ?? undefined } });
    await get().loadFolders();
  },

  moveFolder: async (id, dto) => {
    try {
      const body = { ...dto, teamId: get().context.teamId };
      await axios.put(`/api/material/folders/${id}/move`, body);
      await get().loadFolders();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err.message || '未知错误';
      message.error(`移动文件夹失败：${msg}`);
    }
  },

  uploadFile: async (file) => {
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) { message.warning('仅支持图片和视频文件'); return; }
    const maxSize = isVideo ? MAX_FILE_SIZE.video : MAX_FILE_SIZE.image;
    if (file.size > maxSize) {
      message.warning(`文件太大，${isVideo ? '视频' : '图片'}最大 ${maxSize / 1024 / 1024}MB`);
      return;
    }

    set({ uploading: true, uploadProgress: 0 });
    const source = axios.CancelToken.source();
    try {
      // 请求链路一律快照：上传在途的上下文切换不影响归属
      const snapCtx = { ...get().context };
      const snapFolderId = get().selectedFolderId;

      // 1. Get presigned URL (uses project's apiFetch wrapper that unwraps TransformInterceptor)
      const { fileId, uploadUrl, key, fields } = await presignUpload({
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        type: 'uploaded',
        teamId: snapCtx.teamId,
        projectId: snapCtx.projectId,
      });

      // 2. Upload to MinIO via Vite proxy (avoids CORS)
      const formData = new FormData();
      Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
      formData.append('file', file);

      const proxyUrl = uploadUrl.replace(/^https?:\/\/[^/]+\/flowai/, '/flowai');

      await axios.post(proxyUrl, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        cancelToken: source.token,
        onUploadProgress: (e) => set({ uploadProgress: Math.round((e.loaded * 100) / (e.total || 1)) }),
      });

      // 3. Confirm upload (不传 teamId：后端按 fileId 自证)
      await confirmUpload({ fileId, key, fileSize: file.size });

      // 4. Move file to selected folder
      await axios.put(`/api/material/files/${fileId}/move`, { folderId: snapFolderId, teamId: snapCtx.teamId });

      // 末尾刷新口径：仅当前 context 与快照一致且 folder 未变才刷新
      const cur = get();
      const ctxUnchanged =
        cur.context.teamId === snapCtx.teamId && cur.context.projectId === snapCtx.projectId;
      if (ctxUnchanged && cur.selectedFolderId === snapFolderId) {
        await get().loadFiles();
      }
    } catch (err) {
      if (!axios.isCancel(err)) console.error('Upload failed:', err);
    } finally {
      set({ uploading: false, uploadProgress: 0 });
    }
  },

  deleteFile: async (id) => {
    await axios.delete(`/api/material/files/${id}`, { params: { teamId: get().context.teamId ?? undefined } });
    set((s) => ({ files: s.files.filter((f) => f.id !== id) }));
  },

  toggleFavorite: async (id) => {
    const { data } = await axios.put(`/api/material/files/${id}/toggle-favorite`, null, { params: { teamId: get().context.teamId ?? undefined } });
    if (data.data?.success) {
      set((s) => ({ files: s.files.map((f) => f.id === id ? { ...f, isFavorite: data.data.data.isFavorite } : f) }));
    }
  },

  enterBatchMode: () => set({ batchMode: true }),
  exitBatchMode: () => set({ batchMode: false, selectedFileIds: new Set() }),

  selectFile: (id) => set((s) => ({ selectedFileIds: new Set([...s.selectedFileIds, id]) })),
  deselectFile: (id) => set((s) => {
    const next = new Set(s.selectedFileIds);
    next.delete(id);
    return { selectedFileIds: next };
  }),

  toggleFileSelection: (id) => {
    const { selectedFileIds } = get();
    if (selectedFileIds.has(id)) {
      get().deselectFile(id);
    } else {
      get().selectFile(id);
    }
  },

  selectAllFiles: () => set((s) => ({ selectedFileIds: new Set(s.files.map((f) => f.id)) })),

  batchDelete: async () => {
    const { selectedFileIds, context } = get();
    if (selectedFileIds.size === 0) return;
    try {
      const body: { ids: string[]; teamId?: string } = { ids: Array.from(selectedFileIds) };
      if (context.teamId) body.teamId = context.teamId;
      const { data } = await axios.post('/api/material/files/batch-delete', body);
      set((s) => ({
        files: s.files.filter((f) => !selectedFileIds.has(f.id)),
        batchMode: false,
        selectedFileIds: new Set(),
      }));
      const count = data.data?.count ?? 0;
      if (count === selectedFileIds.size) {
        message.success(`成功删除 ${count} 个文件`);
      } else {
        message.warning(`部分文件删除失败，成功删除 ${count}/${selectedFileIds.size} 个`);
      }
    } catch {
      message.error('批量删除失败，请稍后重试');
    }
  },

  batchMove: async (folderId) => {
    const { selectedFileIds, selectedFolderId, context } = get();
    if (selectedFileIds.size === 0) return;
    if (folderId === selectedFolderId) {
      message.warning('文件已在目标文件夹中');
      return;
    }
    try {
      const ids = Array.from(selectedFileIds);
      const body: { ids: string[]; folderId: string | null; teamId?: string } = { ids, folderId };
      if (context.teamId) body.teamId = context.teamId;
      const { data } = await axios.post('/api/material/files/batch-move', body);
      const count = data.data?.count ?? 0;
      if (count > 0) {
        set((s) => ({
          files: s.files.filter((f) => !selectedFileIds.has(f.id)),
          batchMode: false,
          selectedFileIds: new Set(),
        }));
        if (count === selectedFileIds.size) {
          message.success(`成功移动 ${count} 个文件`);
        } else {
          message.warning(`部分文件移动失败，成功移动 ${count}/${selectedFileIds.size} 个`);
        }
      } else {
        message.info('没有文件被移动');
      }
    } catch {
      message.error('批量移动失败，请稍后重试');
    }
  },
  });
});
