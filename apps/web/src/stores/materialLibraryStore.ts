import { create } from 'zustand';
import axios from 'axios';
import type { MaterialFolder, MaterialFile } from '@flowweb/shared';

const MAX_FILE_SIZE = { image: 10 * 1024 * 1024, video: 100 * 1024 * 1024 };

interface MaterialLibraryState {
  isOpen: boolean;
  selectedFolderId: string | null;
  folders: MaterialFolder[];
  files: MaterialFile[];
  fileGridSize: number;
  loading: boolean;
  uploading: boolean;
  uploadProgress: number;

  open: () => void;
  close: () => void;
  setSelectedFolder: (id: string | null) => void;
  setFileGridSize: (size: number) => void;
  loadFolders: () => Promise<void>;
  loadFiles: () => Promise<void>;
  createFolder: (name: string, parentId?: string | null) => Promise<void>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  moveFolderUp: (id: string) => Promise<void>;
  uploadFile: (file: File) => Promise<void>;
  deleteFile: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
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

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setSelectedFolder: (id) => set({ selectedFolderId: id }),
  setFileGridSize: (size) => set({ fileGridSize: size }),

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
    set({ loading: true });
    try {
      const { selectedFolderId } = get();
      const { data } = await axios.get('/api/material/files', {
        params: { folderId: selectedFolderId },
      });
      if (data.success) set({ files: data.data });
    } catch {
      // silently handle error
    } finally {
      set({ loading: false });
    }
  },

  createFolder: async (name, parentId = null) => {
    await axios.post('/api/material/folders', { name, parentId });
    await get().loadFolders();
  },

  renameFolder: async (id, name) => {
    await axios.put(`/api/material/folders/${id}`, { name });
    await get().loadFolders();
  },

  deleteFolder: async (id) => {
    await axios.delete(`/api/material/folders/${id}`);
    const { selectedFolderId } = get();
    if (selectedFolderId === id) set({ selectedFolderId: null });
    await get().loadFolders();
  },

  moveFolderUp: async (id) => {
    await axios.put(`/api/material/folders/${id}/move-up`);
    await get().loadFolders();
  },

  uploadFile: async (file) => {
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) { alert('仅支持图片和视频文件'); return; }
    const maxSize = isVideo ? MAX_FILE_SIZE.video : MAX_FILE_SIZE.image;
    if (file.size > maxSize) {
      alert(`文件太大，${isVideo ? '视频' : '图片'}最大 ${maxSize / 1024 / 1024}MB`);
      return;
    }

    set({ uploading: true, uploadProgress: 0 });
    const source = axios.CancelToken.source();
    try {
      const { selectedFolderId } = get();
      const presignRes = await axios.post('/api/storage/presign', {
        fileName: file.name, fileSize: file.size, fileType: file.type, type: 'uploaded',
      });
      const { fileId, uploadUrl, fields } = presignRes.data.data;
      const formData = new FormData();
      Object.entries(fields).forEach(([k, v]) => formData.append(k, v as string));
      formData.append('file', file);

      await axios.post(uploadUrl, formData, {
        cancelToken: source.token,
        onUploadProgress: (e) => set({ uploadProgress: Math.round((e.loaded * 100) / (e.total || 1)) }),
      });
      await axios.post('/api/storage/confirm', { fileId, key: fields.key, fileSize: file.size });
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
}));
