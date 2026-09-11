import { create } from 'zustand';

interface VideoEditorState {
  open: boolean;
  sourceNodeId: string | null;
  closedAt: number;
  /** 全局同时只播一个剪辑节点（资源纪律①：播 B 停 A） */
  miniPlaybackNodeId: string | null;
  openEditor: (sourceNodeId: string) => void;
  close: () => void;
  startMiniPlayback: (nodeId: string) => void;
  stopMiniPlayback: () => void;
}

export const useVideoEditorStore = create<VideoEditorState>((set) => ({
  open: false,
  sourceNodeId: null,
  closedAt: 0,
  miniPlaybackNodeId: null,
  openEditor: (sourceNodeId) => set({ open: true, sourceNodeId, miniPlaybackNodeId: null }), // 全屏打开即停全部迷你播放（资源纪律④）
  close: () => set((s) => ({ open: false, closedAt: s.closedAt + 1 })),
  startMiniPlayback: (nodeId) => set({ miniPlaybackNodeId: nodeId }),
  stopMiniPlayback: () => set({ miniPlaybackNodeId: null }),
}));
