import { create } from 'zustand';

/** 编辑器 open 态放 stores/（spec：避免 hooks→pages 反向依赖；isGroupEditContext/Shell/节点三处消费） */
interface VideoEditorState {
  open: boolean;
  sourceNodeId: string | null;
  /** close 版本号：VideoEditNode 据此 refetch 工程缩略（编辑器保存后节点本体刷新） */
  closedAt: number;
  openEditor: (sourceNodeId: string) => void;
  close: () => void;
}

export const useVideoEditorStore = create<VideoEditorState>((set) => ({
  open: false,
  sourceNodeId: null,
  closedAt: 0,
  openEditor: (sourceNodeId) => set({ open: true, sourceNodeId }),
  close: () => set((s) => ({ open: false, closedAt: s.closedAt + 1 })),
}));
