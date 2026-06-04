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

  open: () => void;
  close: () => void;
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
}

export const useMaterialLibraryStore = create<MaterialLibraryState>((set, get) => ({
  isOpen: false,
  selectedFolderId: null,
  folders: [],
  files: [],
  fileGridSize: 200,
  loading: false,
  uploading: false,
  uploadProgress: 0,

  renameModal: { open: false, folderId: null, defaultValue: '' },
  batchMode: false,
  selectedFileIds: new Set<string>(),

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false, batchMode: false, selectedFileIds: new Set() }),
  setSelectedFolder: (id) => set({ selectedFolderId: id }),
  setFileGridSize: (size) => set({ fileGridSize: size }),
  setRenameModal: (value) => set({ renameModal: value }),

  loadFolders: async () => {
    set({ loading: true });
    try {
      const { data } = await axios.get('/api/material/folders');
      if (data.data?.success) set({ folders: data.data.data });
    } catch {
      // silently handle error
    } finally {
      set({ loading: false });
    }
  },

  loadFiles: async () => {
    set({ loading: true, batchMode: false, selectedFileIds: new Set() });
    try {
      const { selectedFolderId } = get();
      const { data } = await axios.get('/api/material/files', {
        params: { folderId: selectedFolderId },
      });
      if (data.data?.success) {
        // Rewrite presigned GET URLs through Vite proxy to avoid CORS/network issues
        // Same pattern as upload: http://127.0.0.1:9000/flowai/... -> /minio-storage/...
        const files = (data.data.data as any[]).map((f: any) => ({
          ...f,
          url: import.meta.env.DEV
            ? (f.url as string).replace(/^https?:\/\/[^/]+\/flowai/, '/minio-storage')
            : f.url,
          thumbnailUrl: f.thumbnailUrl && import.meta.env.DEV
            ? (f.thumbnailUrl as string).replace(/^https?:\/\/[^/]+\/flowai/, '/minio-storage')
            : f.thumbnailUrl,
        }));
        set({ files });
      }
    } catch {
      // silently handle error
    } finally {
      set({ loading: false });
    }
  },

  createFolder: async (name, parentId = null) => {
    const { folders } = get();
    const parentKey = parentId ?? null;
    const dup = folders.find((f) => f.name === name && (f.parentId ?? null) === parentKey);
    if (dup) { message.error('同名文件夹已存在'); return; }
    await axios.post('/api/material/folders', { name, parentId });
    await get().loadFolders();
  },

  renameFolder: async (id, name) => {
    const { folders } = get();
    const folder = folders.find((f) => f.id === id);
    if (!folder) return;
    const parentKey = folder.parentId ?? null;
    const dup = folders.find((f) => f.id !== id && f.name === name && (f.parentId ?? null) === parentKey);
    if (dup) { message.error('同名文件夹已存在'); return; }
    await axios.put(`/api/material/folders/${id}`, { name });
    await get().loadFolders();
  },

  deleteFolder: async (id) => {
    await axios.delete(`/api/material/folders/${id}`);
    const { selectedFolderId } = get();
    if (selectedFolderId === id) set({ selectedFolderId: null });
    message.success('文件夹删除成功');
    await get().loadFolders();
  },

  moveFolderUp: async (id) => {
    await axios.put(`/api/material/folders/${id}/move-up`);
    await get().loadFolders();
  },

  moveFolder: async (id, dto) => {
    try {
      await axios.put(`/api/material/folders/${id}/move`, dto);
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
      const { selectedFolderId } = get();

      // 1. Get presigned URL (uses project's apiFetch wrapper that unwraps TransformInterceptor)
      const { fileId, uploadUrl, key, fields } = await presignUpload({
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        type: 'uploaded',
      });

      // 2. Upload to MinIO via Vite proxy (avoids CORS)
      const formData = new FormData();
      Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
      formData.append('file', file);

      const proxyUrl = import.meta.env.DEV
        ? uploadUrl.replace(/^https?:\/\/[^/]+\/flowai/, '/minio-storage')
        : uploadUrl;

      await axios.post(proxyUrl, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        cancelToken: source.token,
        onUploadProgress: (e) => set({ uploadProgress: Math.round((e.loaded * 100) / (e.total || 1)) }),
      });

      // 3. Confirm upload
      await confirmUpload({ fileId, key, fileSize: file.size });

      // 4. Move file to selected folder
      await axios.put(`/api/material/files/${fileId}/move`, { folderId: selectedFolderId });

      await get().loadFiles();
    } catch (err) {
      if (!axios.isCancel(err)) console.error('Upload failed:', err);
    } finally {
      set({ uploading: false, uploadProgress: 0 });
    }
  },

  deleteFile: async (id) => {
    await axios.delete(`/api/material/files/${id}`);
    set((s) => ({ files: s.files.filter((f) => f.id !== id) }));
  },

  toggleFavorite: async (id) => {
    const { data } = await axios.put(`/api/material/files/${id}/toggle-favorite`);
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
    const { selectedFileIds } = get();
    if (selectedFileIds.size === 0) return;
    try {
      const { data } = await axios.post('/api/material/files/batch-delete', {
        ids: Array.from(selectedFileIds),
      });
      set((s) => ({
        files: s.files.filter((f) => !selectedFileIds.has(f.id)),
        batchMode: false,
        selectedFileIds: new Set(),
      }));
      if (data.count === selectedFileIds.size) {
        message.success(`成功删除 ${data.count} 个文件`);
      } else {
        message.warning(`部分文件删除失败，成功删除 ${data.count}/${selectedFileIds.size} 个`);
      }
    } catch {
      message.error('批量删除失败，请稍后重试');
    }
  },
}));
