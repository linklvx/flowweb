import { create } from 'zustand';
import axios from 'axios';
import { message } from 'antd';
import type { MaterialFile } from '@flowweb/shared';

interface HistoryState {
  isOpen: boolean;
  activeTab: 'image' | 'video' | 'audio';
  files: MaterialFile[];
  counts: { image: number; video: number; audio: number };
  fileGridSize: number;
  loading: boolean;
  batchMode: boolean;
  selectedFileIds: Set<string>;

  open: () => void;
  close: () => void;
  setActiveTab: (tab: 'image' | 'video' | 'audio') => void;
  loadFiles: () => Promise<void>;
  loadCounts: () => Promise<void>;
  setFileGridSize: (size: number) => void;
  // Batch
  enterBatchMode: () => void;
  exitBatchMode: () => void;
  toggleFileSelection: (id: string) => void;
  selectAllFiles: () => void;
  batchDelete: () => Promise<void>;
  // Single file
  deleteFile: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  isOpen: false,
  activeTab: 'image',
  files: [],
  counts: { image: 0, video: 0, audio: 0 },
  fileGridSize: 200,
  loading: false,
  batchMode: false,
  selectedFileIds: new Set<string>(),

  open: () => {
    set({ isOpen: true });
    const { loadCounts, loadFiles } = get();
    void Promise.all([loadCounts(), loadFiles()]);
  },

  close: () => {
    set({ isOpen: false, batchMode: false, selectedFileIds: new Set<string>() });
  },

  setActiveTab: (tab) => {
    set({ activeTab: tab, batchMode: false, selectedFileIds: new Set<string>() });
    void get().loadFiles();
  },

  loadFiles: async () => {
    const { activeTab } = get();
    set({ loading: true });
    try {
      const { data } = await axios.get('/api/material/files', { params: { type: activeTab } });
      if (data.success) {
        set({ files: data.data });
      }
    } catch (err) {
      console.error('加载文件失败:', err);
    } finally {
      set({ loading: false });
    }
  },

  loadCounts: async () => {
    try {
      const { data } = await axios.get('/api/material/files/count');
      if (data.success) {
        set({ counts: data.data });
      }
    } catch (err) {
      console.error('加载文件数量失败:', err);
    }
  },

  setFileGridSize: (size) => set({ fileGridSize: size }),

  enterBatchMode: () => set({ batchMode: true }),

  exitBatchMode: () => set({ batchMode: false, selectedFileIds: new Set<string>() }),

  toggleFileSelection: (id) => {
    const { selectedFileIds } = get();
    const next = new Set(selectedFileIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    set({ selectedFileIds: next });
  },

  selectAllFiles: () => {
    const { files } = get();
    set({ selectedFileIds: new Set(files.map((f) => f.id)) });
  },

  batchDelete: async () => {
    const { selectedFileIds, loadFiles, loadCounts, exitBatchMode } = get();
    if (selectedFileIds.size === 0) return;

    try {
      await axios.post('/api/material/files/batch-delete', {
        ids: Array.from(selectedFileIds),
      });
      await Promise.all([loadFiles(), loadCounts()]);
      exitBatchMode();
      message.success('删除成功');
    } catch (err) {
      message.error('批量删除失败：' + (err as Error).message);
    }
  },

  deleteFile: async (id) => {
    try {
      await axios.delete(`/api/material/files/${id}`);
      set((s) => ({ files: s.files.filter((f) => f.id !== id) }));
      await get().loadCounts();
      message.success('删除成功');
    } catch (err) {
      message.error('删除失败：' + (err as Error).message);
    }
  },

  toggleFavorite: async (id) => {
    try {
      const { data } = await axios.put(`/api/material/files/${id}/toggle-favorite`);
      if (data.success) {
        set((s) => ({
          files: s.files.map((f) => (f.id === id ? { ...f, isFavorite: !f.isFavorite } : f)),
        }));
      }
    } catch (err) {
      message.error('操作失败：' + (err as Error).message);
    }
  },
}));
